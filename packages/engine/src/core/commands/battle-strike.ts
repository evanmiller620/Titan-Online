/**
 * Battle strike command (Titan engine, module: core/commands).
 *
 * StrikeCommand is the heart of combat: one combatant strikes one adjacent
 * enemy, applying the verified Strike Chart with hazard modifiers, optional
 * forced-higher strike number (§13.4) and carry-over to a declared secondary
 * target (§13.4–13.5). Dice come from the injected server Rng.
 *
 * The phase-flow battle commands (deploy, maneuver, advance phase, summon,
 * reinforce, conclude) live in battle-flow.ts; this file is the strike itself
 * so the most rules-dense logic is isolated and heavily tested.
 */

import {
  BaseCommand,
  invalid,
  valid,
  ValidationCode,
  type Draft,
  type ValidationResult,
} from "./Command.ts";
import type { GameState } from "../../state/GameState.ts";
import type { Combatant } from "../../state/GameState.ts";
import { matches } from "../fsm/StateMachine.ts";
import { Scope } from "../fsm/GameFSM.ts";
import type { DomainEvent, PlayerId } from "../events/DomainEvent.ts";
import { PUBLIC } from "../events/DomainEvent.ts";
import type { Rng } from "../rng/Rng.ts";
import { cubeDistance, type CubeCoord } from "../../hex/cube.ts";
import { CREATURE_STATS } from "../../creatures/stats.data.ts";
import {
  effectiveStrikeNumber,
  resolveStrike,
  type StrikeInputs,
} from "../../combat/strike.ts";
import { carryOverAllowed, meleeStrikeMods } from "../../combat/hazards.ts";
import { planRangestrike } from "../../combat/rangestrike.ts";
import { slayThreshold } from "../../combat/battle.ts";
import { indexMap } from "../../battleland/terrain.ts";
import { battleMapFor } from "../../battleland/maps.data.ts";
import type { BattleContext } from "../../state/GameState.ts";

export interface StrikePayload {
  readonly strikerId: string;
  readonly targetId: string;
  /** Optionally force a higher strike-number to enable carry (§13.4). */
  readonly forcedStrikeNumber?: number;
  /** Optional secondary target to carry excess hits to. */
  readonly carryToId?: string;
  /** Waive positional advantage to keep carry rights (§13.5). */
  readonly waiveAdvantage?: boolean;
}

export class StrikeCommand extends BaseCommand<StrikePayload> {
  static readonly TYPE = "Strike";
  override readonly type = StrikeCommand.TYPE;

  override validate(state: GameState): ValidationResult {
    if (!matches(state.fsm, `${Scope.BattleRound}.Strike`) &&
        !matches(state.fsm, `${Scope.BattleRound}.Strikeback`)) {
      return invalid(ValidationCode.WRONG_PHASE, "striking happens in a Strike phase");
    }
    const battle = state.battle;
    if (!battle) return invalid(ValidationCode.WRONG_PHASE, "no active battle");

    const striker = battle.combatants.find((c) => c.id === this.payload.strikerId);
    const target = battle.combatants.find((c) => c.id === this.payload.targetId);
    if (!striker) return invalid(ValidationCode.UNKNOWN_COMBATANT, "no such striker");
    if (!target) return invalid(ValidationCode.UNKNOWN_COMBATANT, "no such target");
    if (striker.slain || target.slain) {
      return invalid(ValidationCode.ILLEGAL_STRIKE, "striker or target already slain");
    }
    if (striker.side === target.side) {
      return invalid(ValidationCode.ILLEGAL_STRIKE, "cannot strike your own side");
    }

    // The active side strikes in Strike; the other side in Strikeback.
    const inStrike = matches(state.fsm, `${Scope.BattleRound}.Strike`);
    const strikingSide = inStrike ? battle.activeSide : otherSide(battle.activeSide);
    if (striker.side !== strikingSide) {
      return invalid(ValidationCode.ILLEGAL_STRIKE, "it is not that side's turn to strike");
    }
    // The command's player must own the striking side.
    const ownerOfSide =
      strikingSide === "attacker" ? battle.attackerPlayerId : battle.defenderPlayerId;
    if (this.playerId !== ownerOfSide) {
      return invalid(ValidationCode.NOT_ACTIVE_PLAYER, "not your strike phase");
    }
    if (striker.struckThisPhase) {
      return invalid(ValidationCode.ILLEGAL_STRIKE, "that character already struck this phase");
    }
    if (!striker.hex || !target.hex) {
      return invalid(ValidationCode.ILLEGAL_STRIKE, "striker or target not on the board");
    }
    if (cubeDistance(striker.hex, target.hex) !== 1) {
      return invalid(ValidationCode.ILLEGAL_STRIKE, "melee strike requires adjacency");
    }

    // Carry target, if declared, must be a distinct living enemy adjacent to
    // the striker; full carry legality is checked at apply time after the roll.
    if (this.payload.carryToId !== undefined) {
      const carry = battle.combatants.find((c) => c.id === this.payload.carryToId);
      if (!carry || carry.slain) return invalid(ValidationCode.ILLEGAL_STRIKE, "bad carry target");
      if (carry.side === striker.side) return invalid(ValidationCode.ILLEGAL_STRIKE, "carry must be an enemy");
      if (!carry.hex || cubeDistance(striker.hex, carry.hex) !== 1) {
        return invalid(ValidationCode.ILLEGAL_STRIKE, "carry target must be adjacent to the striker");
      }
    }
    return valid;
  }

  protected override apply(draft: Draft, rng: Rng, events: DomainEvent[]): void {
    const battle = draft.battle!;
    const grid = indexMap(battleMapFor(battle.terrain)!);
    const striker = battle.combatants.find((c) => c.id === this.payload.strikerId)!;
    const target = battle.combatants.find((c) => c.id === this.payload.targetId)!;

    const aScore = scoreOf(draft, striker.side, battle);
    const dScore = scoreOf(draft, target.side, battle);

    // Build strike inputs with hazard mods (waivable advantage).
    let mods = meleeStrikeMods(grid, striker.creature, target.creature, striker.hex!, target.hex!);
    if (this.payload.waiveAdvantage && mods.advantage) {
      mods = { ...mods, advantage: false, diceDelta: Math.min(0, mods.diceDelta), attackerSkillDelta: Math.min(0, mods.attackerSkillDelta) };
    }
    const inputs: StrikeInputs = {
      attackerPower: effectivePower(striker.creature, aScore),
      attackerSkill: CREATURE_STATS[striker.creature].skill,
      defenderSkill: CREATURE_STATS[target.creature].skill,
      mods,
    };

    const resolved = resolveStrike(inputs, rng, this.payload.forcedStrikeNumber);

    // Work on a local mutable combatants list; assign draft.battle once.
    let combatants: Combatant[] = battle.combatants.slice();

    const targetThreshold = slayThreshold(target.creature, dScore);
    const needed = targetThreshold - target.damage;
    const toPrimary = Math.min(resolved.hits, Math.max(0, needed));
    let excess = resolved.hits - toPrimary;
    combatants = applyDamage(combatants, target.id, toPrimary, targetThreshold, events);

    // Carry-over (§13.4–13.5).
    if (excess > 0 && this.payload.carryToId !== undefined) {
      const carry = battle.combatants.find((c) => c.id === this.payload.carryToId)!;
      const carryMods = meleeStrikeMods(grid, striker.creature, carry.creature, striker.hex!, carry.hex!);
      const secondaryNatural = effectiveStrikeNumber({
        attackerPower: inputs.attackerPower,
        attackerSkill: CREATURE_STATS[striker.creature].skill,
        defenderSkill: CREATURE_STATS[carry.creature].skill,
        mods: carryMods,
      });
      const allowed = carryOverAllowed({
        usedStrikeNumber: resolved.strikeNumber,
        primaryUsedAdvantage: mods.advantage,
        secondaryStrikeNumber: secondaryNatural,
        advantageAppliesToSecondary: carryMods.advantage,
      });
      if (allowed) {
        const carryThreshold = slayThreshold(carry.creature, scoreOf(draft, carry.side, battle));
        const toCarry = Math.min(excess, Math.max(0, carryThreshold - carry.damage));
        combatants = applyDamage(combatants, carry.id, toCarry, carryThreshold, events);
        excess -= toCarry;
      }
    }

    // Mark the striker as having struck and commit the whole battle update.
    combatants = combatants.map((c) =>
      c.id === striker.id ? { ...c, struckThisPhase: true } : c,
    );

    // First blood (§7.5): the attacker's first kill opens an immediate Angel
    // summon window, IF an Angel/Archangel sits in another unengaged legion and
    // the battle force is below the cap. Tracked as a flag; resolved by
    // SummonAngel/DeclineSummon before the strike phase may end.
    let firstKillHappened = battle.firstKillHappened;
    let summonPending = battle.summonPending ?? false;
    const killedDefender = events.some(
      (e) => e.type === "CombatantSlain" && e.side === "defender",
    );
    if (striker.side === "attacker" && killedDefender && !battle.firstKillHappened) {
      firstKillHappened = true;
      const onBoardAttackers = combatants.filter((c) => c.side === "attacker" && !c.slain).length;
      const angelAvailable =
        onBoardAttackers < 7 &&
        Object.values(draft.legions).some(
          (l) =>
            l.ownerId === battle.attackerPlayerId &&
            l.marker !== battle.attackerLegion &&
            l.creatures.some((c) => c === "Angel" || c === "Archangel"),
        );
      if (angelAvailable) summonPending = true;
    }

    draft.battle = { ...battle, combatants, firstKillHappened, summonPending };

    events.push({
      type: "StrikeResolved",
      audience: PUBLIC,
      strikerId: striker.id,
      targetId: target.id,
      dice: resolved.dice,
      strikeNumber: resolved.strikeNumber,
      rolls: resolved.rolls,
      hits: resolved.hits,
      carriedTo: this.payload.carryToId ?? null,
    });
  }
}

// ---------------------------------------------------------------------------
// Rangestrike (§12) — a ranged attack during the ACTIVE side's Strike phase.
// ---------------------------------------------------------------------------

export interface RangestrikePayload {
  readonly strikerId: string;
  readonly targetId: string;
}

export class RangestrikeCommand extends BaseCommand<RangestrikePayload> {
  static readonly TYPE = "Rangestrike";
  override readonly type = RangestrikeCommand.TYPE;

  override validate(state: GameState): ValidationResult {
    // §12: only the MOVING (active) player rangestrikes — never in Strikeback.
    if (!matches(state.fsm, `${Scope.BattleRound}.Strike`)) {
      return invalid(ValidationCode.WRONG_PHASE, "rangestrikes happen in your Strike phase");
    }
    const battle = state.battle;
    if (!battle) return invalid(ValidationCode.WRONG_PHASE, "no active battle");

    const striker = battle.combatants.find((c) => c.id === this.payload.strikerId);
    const target = battle.combatants.find((c) => c.id === this.payload.targetId);
    if (!striker) return invalid(ValidationCode.UNKNOWN_COMBATANT, "no such striker");
    if (!target) return invalid(ValidationCode.UNKNOWN_COMBATANT, "no such target");
    if (striker.slain || target.slain) {
      return invalid(ValidationCode.ILLEGAL_STRIKE, "striker or target already slain");
    }
    if (striker.side === target.side) {
      return invalid(ValidationCode.ILLEGAL_STRIKE, "cannot rangestrike your own side");
    }
    if (striker.side !== battle.activeSide) {
      return invalid(ValidationCode.ILLEGAL_STRIKE, "only the moving side may rangestrike");
    }
    const ownerOfSide =
      striker.side === "attacker" ? battle.attackerPlayerId : battle.defenderPlayerId;
    if (this.playerId !== ownerOfSide) {
      return invalid(ValidationCode.NOT_ACTIVE_PLAYER, "not your strike phase");
    }
    if (striker.struckThisPhase) {
      return invalid(ValidationCode.ILLEGAL_STRIKE, "that character already struck this phase");
    }
    if (!striker.hex || !target.hex) {
      return invalid(ValidationCode.ILLEGAL_STRIKE, "striker or target not on the board");
    }
    if (cubeDistance(striker.hex, target.hex) < 2) {
      return invalid(ValidationCode.ILLEGAL_STRIKE, "adjacent enemies are struck in melee, not rangestruck");
    }
    const plan = planRange(state, battle, striker, target);
    if (!plan.ok) {
      return invalid(ValidationCode.ILLEGAL_STRIKE, `rangestrike illegal: ${plan.reason}`);
    }
    return valid;
  }

  protected override apply(draft: Draft, rng: Rng, events: DomainEvent[]): void {
    const battle = draft.battle!;
    const striker = battle.combatants.find((c) => c.id === this.payload.strikerId)!;
    const target = battle.combatants.find((c) => c.id === this.payload.targetId)!;
    const plan = planRange(draft, battle, striker, target);
    if (!plan.ok) return; // validate() guarantees legality; defensive only

    const resolved = resolveStrike(plan.plan.inputs, rng);

    let combatants: Combatant[] = battle.combatants.slice();
    const threshold = slayThreshold(target.creature, scoreOf(draft, target.side, battle));
    const toTarget = Math.min(resolved.hits, Math.max(0, threshold - target.damage));
    // §12: rangestrikes NEVER carry over — excess hits are lost.
    combatants = applyDamage(combatants, target.id, toTarget, threshold, events);
    combatants = combatants.map((c) =>
      c.id === striker.id ? { ...c, struckThisPhase: true } : c,
    );

    // First blood via rangestrike opens the same summon window as melee.
    let firstKillHappened = battle.firstKillHappened;
    let summonPending = battle.summonPending ?? false;
    const killedDefender = events.some((e) => e.type === "CombatantSlain" && e.side === "defender");
    if (striker.side === "attacker" && killedDefender && !battle.firstKillHappened) {
      firstKillHappened = true;
      const onBoardAttackers = combatants.filter((c) => c.side === "attacker" && !c.slain).length;
      const angelAvailable =
        onBoardAttackers < 7 &&
        Object.values(draft.legions).some(
          (l) =>
            l.ownerId === battle.attackerPlayerId &&
            l.marker !== battle.attackerLegion &&
            l.creatures.some((c) => c === "Angel" || c === "Archangel"),
        );
      if (angelAvailable) summonPending = true;
    }

    draft.battle = { ...battle, combatants, firstKillHappened, summonPending };

    events.push({
      type: "StrikeResolved",
      audience: PUBLIC,
      strikerId: striker.id,
      targetId: target.id,
      dice: resolved.dice,
      strikeNumber: resolved.strikeNumber,
      rolls: resolved.rolls,
      hits: resolved.hits,
      carriedTo: null,
    });
  }
}

/** Shared legality/plan for a rangestrike against the live battle. */
function planRange(
  state: GameState,
  battle: BattleContext,
  striker: Combatant,
  target: Combatant,
) {
  const grid = indexMap(battleMapFor(battle.terrain)!);
  const occupied = new Set(
    battle.combatants.filter((c) => !c.slain && c.hex).map((c) => cubeKeyOf(c.hex!)),
  );
  const inContact = battle.combatants.some(
    (e) => e.side !== striker.side && !e.slain && e.hex && cubeDistance(striker.hex!, e.hex) === 1,
  );
  return planRangestrike({
    grid,
    attacker: striker.creature,
    defender: target.creature,
    from: striker.hex!,
    to: target.hex!,
    attackerInContact: inContact,
    isOccupied: (c) => occupied.has(cubeKeyOf(c)),
    attackerScore: scoreOf(state, striker.side, battle),
    defenderScore: scoreOf(state, target.side, battle),
  });
}

function cubeKeyOf(c: CubeCoord): string {
  return `${c.x},${c.y},${c.z}`;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function otherSide(s: "attacker" | "defender"): "attacker" | "defender" {
  return s === "attacker" ? "defender" : "attacker";
}

function effectivePower(name: string, score: number): number {
  if (name === "Titan") return 6 + Math.floor(score / 100);
  return CREATURE_STATS[name as keyof typeof CREATURE_STATS].power;
}

function scoreOf(
  draft: GameState,
  side: "attacker" | "defender",
  battle: NonNullable<GameState["battle"]>,
): number {
  const pid = side === "attacker" ? battle.attackerPlayerId : battle.defenderPlayerId;
  return draft.players[pid]?.score ?? 0;
}

/** Apply `hits` damage within a combatants array, slaying at threshold. */
function applyDamage(
  combatants: Combatant[],
  combatantId: string,
  hits: number,
  threshold: number,
  events: DomainEvent[],
): Combatant[] {
  if (hits <= 0) return combatants;
  return combatants.map((c) => {
    if (c.id !== combatantId) return c;
    const damage = c.damage + hits;
    const slain = damage >= threshold;
    if (slain) {
      events.push({
        type: "CombatantSlain",
        audience: PUBLIC,
        combatantId: c.id,
        creature: c.creature,
        side: c.side,
      });
    }
    return { ...c, damage, slain };
  });
}
