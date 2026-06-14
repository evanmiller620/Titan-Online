/**
 * Battle-flow commands (Titan engine, module: core/commands).
 *
 * THE GAP THIS FILLS: engagement.ts could only resolve a clash administratively
 * (flee/concede). The Battle subtree (BattleFSM) and StrikeCommand existed, but
 * nothing fired BATTLE_JOINED or drove a tactical battle to conclusion. This
 * module makes a fought battle fully playable end to end:
 *
 *   DeployLegionCommand        defender then attacker place their combatants
 *   MoveCombatantCommand       maneuver a combatant on the battleland
 *   EndManeuversCommand        close the active side's Maneuver phase
 *   StrikeCommand (battle-strike.ts)   strike / strike back
 *   EndStrikesCommand          close a Strike/Strikeback phase; runs the
 *                              round/half-turn bookkeeping, the 7-round
 *                              time-loss, wipe-out detection, and conclusion
 *   SummonAngelCommand /
 *   DeclineSummonCommand       the attacker's first-blood Angel summon (§7.5)
 *   ReinforceBattleCommand     the defender's round-4 muster (§7.5)
 *
 * Conclusion handles full scoring (§8): normal win, attacker time-loss (§7.4),
 * mutual Titan destruction (§8.1), Titan death → elimination + marker
 * inheritance + half-points (§8.1), and overstack culling (§8.2) when a summon
 * or reinforcement would push a battle force over the cap.
 *
 * SIMPLIFICATIONS (documented, deliberate): the attacker entry side defaults to
 * one wide side rather than being derived from the masterboard trajectory, and
 * the deploy zone is the entry edge plus its inward neighbours so a full 7-stack
 * always fits. The Angel-summon and round-4 windows are modelled as flags on the
 * BattleContext rather than the FSM's SummonAngel/Reinforce substates, so the
 * FSM stays on its robust linear Maneuver→Strike→Strikeback cycle. The RULES are
 * faithful; only the internal routing is streamlined.
 */

import {
  BaseCommand,
  invalid,
  valid,
  ValidationCode,
  type Draft,
  type ValidationResult,
} from "./Command.ts";
import type {
  BattleContext,
  Combatant,
  GameState,
  LegionState,
} from "../../state/GameState.ts";
import { matches } from "../fsm/StateMachine.ts";
import { transition } from "../fsm/StateMachine.ts";
import { GAME_MACHINE, GameEvent, Scope } from "../fsm/GameFSM.ts";
import { BattleEvent } from "../fsm/BattleFSM.ts";
import type { DomainEvent, LandId, LegionId, PlayerId } from "../events/DomainEvent.ts";
import { PUBLIC } from "../events/DomainEvent.ts";
import type { Rng } from "../rng/Rng.ts";
import { pendingEngagements } from "../../state/selectors.ts";
import { getLand } from "../../masterboard/board.data.ts";
import { battleMapFor, type BattleHex, type BattleMap } from "../../battleland/maps.data.ts";
import { indexMap, movementRulesFor, hexAt, isImpassableTerrain, type BattleGrid } from "../../battleland/terrain.ts";
import { reachable } from "../../hex/pathfind.ts";
import { cubeKey, type CubeCoord } from "../../hex/cube.ts";
import {
  attackerEntryHexes,
  defenderEntryHexes,
  type EntrySide,
} from "../../battleland/entry.ts";
import { CREATURE_STATS, pointValue } from "../../creatures/stats.data.ts";
import { LORDS, MAX_LEGION_HEIGHT, type CreatureName } from "../../creatures/names.ts";
import { canRecruit } from "../../creatures/recruitment.ts";
import {
  cullOverstack,
  halfPoints,
  isTimeLoss,
} from "../../combat/battle.ts";
import { awardScore } from "./scoring.ts";

// ===========================================================================
// Shared helpers (pure)
// ===========================================================================

type Side = "attacker" | "defender";
function otherSide(s: Side): Side {
  return s === "attacker" ? "defender" : "attacker";
}

/** Index a battle map's hexes by their board label (e.g. "D4"). */
function labelIndex(map: BattleMap): Map<string, BattleHex> {
  const m = new Map<string, BattleHex>();
  for (const h of map.hexes) m.set(h.label, h);
  return m;
}

/** Cube keys currently occupied by living, placed combatants. */
function occupiedKeys(battle: BattleContext, excludeId?: string): Set<string> {
  const s = new Set<string>();
  for (const c of battle.combatants) {
    if (!c.slain && c.hex && c.id !== excludeId) s.add(cubeKey(c.hex));
  }
  return s;
}

/** Build the deploy zone for a side: the entry-edge hexes plus their on-board
 *  neighbours (so a 7-stack always fits near the correct edge). */
function deployZone(grid: BattleGrid, baseLabels: readonly string[]): Set<string> {
  const idx = labelIndex(grid.map);
  const keys = new Set<string>();
  for (const label of baseLabels) {
    const hex = idx.get(label);
    if (!hex) continue;
    keys.add(cubeKey(hex.cube));
    // add the six neighbours that are on the board
    for (let d = 0; d < 6; d++) {
      const nb = neighborCube(hex.cube, d);
      if (grid.byKey.has(cubeKey(nb)) && !isImpassableTerrain(hexAt(grid, nb)!.terrain)) {
        keys.add(cubeKey(nb));
      }
    }
  }
  return keys;
}

// Local neighbour (avoid importing the whole hex module surface).
const DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, -1], [1, 0, -1], [1, -1, 0], [0, -1, 1], [-1, 0, 1], [-1, 1, 0],
];
function neighborCube(c: CubeCoord, dir: number): CubeCoord {
  const [dx, dy, dz] = DIRS[dir]!;
  return { x: c.x + dx, y: c.y + dy, z: c.z + dz };
}

function makeCombatants(legion: LegionState, side: Side): Combatant[] {
  const prefix = side === "attacker" ? "atk" : "def";
  return legion.creatures.map((creature, i) => ({
    id: `${prefix}-${i}`,
    side,
    creature,
    hex: null,
    damage: 0,
    movedThisPhase: false,
    struckThisPhase: false,
    slain: false,
  }));
}

/** Build the initial BattleContext for two clashing legions. */
export function createBattleContext(
  state: GameState,
  land: LandId,
  attackerLegion: LegionId,
  defenderLegion: LegionId,
  attackerId: PlayerId,
  defenderId: PlayerId,
): BattleContext {
  const terrain = getLand(land)!.terrain;
  const atk = state.legions[attackerLegion]!;
  const def = state.legions[defenderLegion]!;
  return {
    land,
    terrain,
    attackerLegion,
    defenderLegion,
    attackerPlayerId: attackerId,
    defenderPlayerId: defenderId,
    attackerSide: "BOTTOM",
    round: 1,
    activeSide: "defender", // the defender takes the first half-turn
    summonUsed: false,
    firstKillHappened: false,
    reinforcementUsed: false,
    summonPending: false,
    combatants: [...makeCombatants(atk, "attacker"), ...makeCombatants(def, "defender")],
  };
}

/** Fire an FSM event from a free function (mirrors BaseCommand.fireFsm). */
function fire(draft: Draft, events: DomainEvent[], fsmEvent: string): void {
  const from = draft.fsm.path;
  draft.fsm = transition(GAME_MACHINE, draft.fsm, fsmEvent);
  events.push({ type: "PhaseChanged", audience: PUBLIC, fsmEvent, from, to: draft.fsm.path });
}

function aliveOf(battle: BattleContext, side: Side): Combatant[] {
  return battle.combatants.filter((c) => c.side === side && !c.slain);
}

/** Can the attacker summon an Angel/Archangel from an unengaged legion now? */
function summonAvailable(state: GameState | Draft, battle: BattleContext): boolean {
  if ((battle.summonUsed ?? false)) return false;
  if (aliveOf(battle, "attacker").length >= MAX_LEGION_HEIGHT) return false;
  return Object.values(state.legions).some(
    (l) =>
      l.ownerId === battle.attackerPlayerId &&
      l.marker !== battle.attackerLegion &&
      l.creatures.some((c) => c === "Angel" || c === "Archangel"),
  );
}

// ===========================================================================
// Deployment
// ===========================================================================

export interface DeployPlacement {
  readonly combatantId: string;
  readonly hex: string; // board label, e.g. "C1"
}
export interface DeployLegionPayload {
  readonly placements: readonly DeployPlacement[];
}

export class DeployLegionCommand extends BaseCommand<DeployLegionPayload> {
  static readonly TYPE = "DeployLegion";
  override readonly type = DeployLegionCommand.TYPE;

  private phaseSide(state: GameState): Side | null {
    if (matches(state.fsm, `${Scope.Battle}.DefenderDeployment`)) return "defender";
    if (matches(state.fsm, `${Scope.Battle}.AttackerDeployment`)) return "attacker";
    return null;
  }

  override validate(state: GameState): ValidationResult {
    const side = this.phaseSide(state);
    if (!side) return invalid(ValidationCode.WRONG_PHASE, "not a deployment phase");
    const battle = state.battle;
    if (!battle) return invalid(ValidationCode.WRONG_PHASE, "no active battle");

    const owner = side === "attacker" ? battle.attackerPlayerId : battle.defenderPlayerId;
    if (this.playerId !== owner) {
      return invalid(ValidationCode.NOT_ACTIVE_PLAYER, `it is the ${side}'s deployment`);
    }

    const map = battleMapFor(battle.terrain);
    if (!map) return invalid(ValidationCode.ILLEGAL_DEPLOYMENT, "unknown battleland");
    const grid = indexMap(map);
    const idx = labelIndex(map);

    const mine = battle.combatants.filter((c) => c.side === side);
    const ids = new Set(mine.map((c) => c.id));

    // Every combatant of this side must be placed exactly once.
    if (this.payload.placements.length !== mine.length) {
      return invalid(ValidationCode.ILLEGAL_DEPLOYMENT, "place each of your characters exactly once");
    }
    const seenIds = new Set<string>();
    const seenHexes = new Set<string>();
    const base = side === "attacker"
      ? attackerEntryHexes(map, battle.attackerSide as EntrySide)
      : defenderEntryHexes(map, battle.attackerSide as EntrySide);
    const zone = deployZone(grid, base);

    for (const p of this.payload.placements) {
      if (!ids.has(p.combatantId)) {
        return invalid(ValidationCode.ILLEGAL_DEPLOYMENT, `combatant ${p.combatantId} is not yours to deploy`);
      }
      if (seenIds.has(p.combatantId)) {
        return invalid(ValidationCode.ILLEGAL_DEPLOYMENT, `combatant ${p.combatantId} placed twice`);
      }
      seenIds.add(p.combatantId);
      const hex = idx.get(p.hex);
      if (!hex) return invalid(ValidationCode.ILLEGAL_DEPLOYMENT, `no such hex ${p.hex}`);
      const key = cubeKey(hex.cube);
      if (seenHexes.has(key)) return invalid(ValidationCode.ILLEGAL_DEPLOYMENT, `two characters on ${p.hex}`);
      seenHexes.add(key);
      if (!zone.has(key)) {
        return invalid(ValidationCode.ILLEGAL_DEPLOYMENT, `${p.hex} is outside your deployment zone`);
      }
      // Cannot deploy onto a hex already occupied by the defender (attacker only).
      if (side === "attacker" && occupiedKeys(battle).has(key)) {
        return invalid(ValidationCode.ILLEGAL_DEPLOYMENT, `${p.hex} is occupied`);
      }
    }
    return valid;
  }

  protected override apply(draft: Draft, _rng: Rng, events: DomainEvent[]): void {
    const battle = draft.battle!;
    const side = matches(draft.fsm, `${Scope.Battle}.DefenderDeployment`) ? "defender" : "attacker";
    const map = battleMapFor(battle.terrain)!;
    const idx = labelIndex(map);

    const place = new Map(this.payload.placements.map((p) => [p.combatantId, idx.get(p.hex)!.cube]));
    const combatants = battle.combatants.map((c) =>
      place.has(c.id) ? { ...c, hex: place.get(c.id)! } : c,
    );
    draft.battle = { ...battle, combatants };

    events.push({ type: "LegionDeployed", audience: PUBLIC, side, playerId: this.playerId });
    fire(draft, events, side === "defender" ? BattleEvent.DEFENDER_DEPLOYED : BattleEvent.ATTACKER_DEPLOYED);
    if (side === "attacker") {
      events.push({
        type: "BattlePhaseAdvanced", audience: PUBLIC,
        round: draft.battle.round, activeSide: draft.battle.activeSide, phase: "Maneuver",
      });
    }
  }
}

// ===========================================================================
// Maneuver
// ===========================================================================

export interface MoveCombatantPayload {
  readonly combatantId: string;
  readonly hex: string; // board label
}

export class MoveCombatantCommand extends BaseCommand<MoveCombatantPayload> {
  static readonly TYPE = "MoveCombatant";
  override readonly type = MoveCombatantCommand.TYPE;

  override validate(state: GameState): ValidationResult {
    if (!matches(state.fsm, `${Scope.BattleRound}.Maneuver`)) {
      return invalid(ValidationCode.WRONG_PHASE, "maneuvering happens in the Maneuver phase");
    }
    const battle = state.battle;
    if (!battle) return invalid(ValidationCode.WRONG_PHASE, "no active battle");
    const actor = battle.activeSide;
    const owner = actor === "attacker" ? battle.attackerPlayerId : battle.defenderPlayerId;
    if (this.playerId !== owner) return invalid(ValidationCode.NOT_ACTIVE_PLAYER, "not your maneuver");

    const c = battle.combatants.find((x) => x.id === this.payload.combatantId);
    if (!c) return invalid(ValidationCode.UNKNOWN_COMBATANT, "no such combatant");
    if (c.side !== actor) return invalid(ValidationCode.ILLEGAL_MANEUVER, "that is not your character");
    if (c.slain) return invalid(ValidationCode.ILLEGAL_MANEUVER, "that character is slain");
    if (c.movedThisPhase) return invalid(ValidationCode.ILLEGAL_MANEUVER, "already moved this phase");
    if (!c.hex) return invalid(ValidationCode.ILLEGAL_MANEUVER, "character not on the board");

    const map = battleMapFor(battle.terrain)!;
    const grid = indexMap(map);
    const target = labelIndex(map).get(this.payload.hex);
    if (!target) return invalid(ValidationCode.ILLEGAL_MANEUVER, `no such hex ${this.payload.hex}`);
    const targetKey = cubeKey(target.cube);
    if (targetKey === cubeKey(c.hex)) return valid; // standing still is allowed

    const occ = occupiedKeys(battle, c.id);
    const rules = movementRulesFor(c.creature, grid, {
      isOccupied: (q) => occ.has(cubeKey(q)),
      maxSteps: CREATURE_STATS[c.creature].skill,
    });
    const { destinations } = reachable(c.hex, rules);
    if (!destinations.has(targetKey)) {
      return invalid(ValidationCode.ILLEGAL_MANEUVER, `${this.payload.hex} is not reachable`);
    }
    return valid;
  }

  protected override apply(draft: Draft, _rng: Rng, events: DomainEvent[]): void {
    const battle = draft.battle!;
    const map = battleMapFor(battle.terrain)!;
    const target = labelIndex(map).get(this.payload.hex)!.cube;
    draft.battle = {
      ...battle,
      combatants: battle.combatants.map((c) =>
        c.id === this.payload.combatantId ? { ...c, hex: target, movedThisPhase: true } : c,
      ),
    };
    events.push({ type: "CombatantMoved", audience: PUBLIC, combatantId: this.payload.combatantId });
  }
}

// ===========================================================================
// Phase advance: end maneuvers
// ===========================================================================

export class EndManeuversCommand extends BaseCommand<Record<string, never>> {
  static readonly TYPE = "EndManeuvers";
  override readonly type = EndManeuversCommand.TYPE;

  override validate(state: GameState): ValidationResult {
    if (!matches(state.fsm, `${Scope.BattleRound}.Maneuver`)) {
      return invalid(ValidationCode.WRONG_PHASE, "not in the Maneuver phase");
    }
    const battle = state.battle!;
    const owner = battle.activeSide === "attacker" ? battle.attackerPlayerId : battle.defenderPlayerId;
    if (this.playerId !== owner) return invalid(ValidationCode.NOT_ACTIVE_PLAYER, "not your maneuver");
    return valid;
  }

  protected override apply(draft: Draft, _rng: Rng, events: DomainEvent[]): void {
    fire(draft, events, BattleEvent.MANEUVERS_COMPLETED);
    events.push({
      type: "BattlePhaseAdvanced", audience: PUBLIC,
      round: draft.battle!.round, activeSide: draft.battle!.activeSide, phase: "Strike",
    });
  }
}

// ===========================================================================
// Phase advance: end strikes / strikeback (round + half-turn bookkeeping)
// ===========================================================================

export class EndStrikesCommand extends BaseCommand<Record<string, never>> {
  static readonly TYPE = "EndStrikes";
  override readonly type = EndStrikesCommand.TYPE;

  override validate(state: GameState): ValidationResult {
    const inStrike = matches(state.fsm, `${Scope.BattleRound}.Strike`);
    const inStrikeback = matches(state.fsm, `${Scope.BattleRound}.Strikeback`);
    if (!inStrike && !inStrikeback) {
      return invalid(ValidationCode.WRONG_PHASE, "not in a strike phase");
    }
    const battle = state.battle!;
    const actor = inStrike ? battle.activeSide : otherSide(battle.activeSide);
    const owner = actor === "attacker" ? battle.attackerPlayerId : battle.defenderPlayerId;
    if (this.playerId !== owner) return invalid(ValidationCode.NOT_ACTIVE_PLAYER, "not your strike phase");
    if (battle.summonPending) {
      return invalid(ValidationCode.ILLEGAL_PHASE_ADVANCE, "resolve the Angel summon first");
    }
    return valid;
  }

  protected override apply(draft: Draft, _rng: Rng, events: DomainEvent[]): void {
    const battle = draft.battle!;
    const inStrike = matches(draft.fsm, `${Scope.BattleRound}.Strike`);

    // A wiped side OR a slain Titan ends the battle immediately, whatever phase.
    const titanDead = battle.combatants.some((c) => c.creature === "Titan" && c.slain);
    if (aliveOf(battle, "attacker").length === 0 || aliveOf(battle, "defender").length === 0 || titanDead) {
      concludeBattle(draft, events, { timeLoss: false });
      return;
    }

    if (inStrike) {
      // Active side finished striking → the other side strikes back.
      draft.battle = {
        ...battle,
        combatants: battle.combatants.map((c) => ({ ...c, struckThisPhase: false })),
      };
      fire(draft, events, BattleEvent.STRIKES_COMPLETED);
      events.push({
        type: "BattlePhaseAdvanced", audience: PUBLIC,
        round: draft.battle.round, activeSide: draft.battle.activeSide, phase: "Strikeback",
      });
      return;
    }

    // Strikeback done → the half-turn ends.
    const newActiveSide = otherSide(battle.activeSide);
    const roundCompleted = newActiveSide === "defender"; // both halves done

    if (roundCompleted && isTimeLoss(battle.round, aliveOf(battle, "defender").length)) {
      concludeBattle(draft, events, { timeLoss: true });
      return;
    }

    const newRound = roundCompleted ? battle.round + 1 : battle.round;
    draft.battle = {
      ...battle,
      round: newRound,
      activeSide: newActiveSide,
      summonPending: false,
      combatants: battle.combatants.map((c) => ({ ...c, struckThisPhase: false, movedThisPhase: false })),
    };
    fire(draft, events, BattleEvent.HALF_TURN_ENDED);
    events.push({
      type: "BattlePhaseAdvanced", audience: PUBLIC,
      round: newRound, activeSide: newActiveSide, phase: "Maneuver",
    });
  }
}

// ===========================================================================
// Angel summon (§7.5) — the attacker's first-blood reinforcement
// ===========================================================================

export interface SummonAngelPayload {
  readonly fromLegion: LegionId;
  /** "Angel" (default) or "Archangel". */
  readonly creature?: CreatureName;
}

export class SummonAngelCommand extends BaseCommand<SummonAngelPayload> {
  static readonly TYPE = "SummonAngel";
  override readonly type = SummonAngelCommand.TYPE;

  override validate(state: GameState): ValidationResult {
    if (!matches(state.fsm, `${Scope.BattleRound}.Strike`) &&
        !matches(state.fsm, `${Scope.BattleRound}.Strikeback`)) {
      return invalid(ValidationCode.WRONG_PHASE, "no summon window open");
    }
    const battle = state.battle!;
    if (!battle.summonPending) return invalid(ValidationCode.ILLEGAL_SUMMON, "no summon is pending");
    if (this.playerId !== battle.attackerPlayerId) {
      return invalid(ValidationCode.ILLEGAL_SUMMON, "only the attacker may summon");
    }
    if (aliveOf(battle, "attacker").length >= MAX_LEGION_HEIGHT) {
      return invalid(ValidationCode.ILLEGAL_SUMMON, "the battle force is already at the cap");
    }
    const src = state.legions[this.payload.fromLegion];
    if (!src || src.ownerId !== this.playerId || src.marker === battle.attackerLegion) {
      return invalid(ValidationCode.ILLEGAL_SUMMON, "invalid source legion");
    }
    const want = this.payload.creature ?? "Angel";
    if (want !== "Angel" && want !== "Archangel") {
      return invalid(ValidationCode.ILLEGAL_SUMMON, "may only summon an Angel or Archangel");
    }
    if (!src.creatures.includes(want)) {
      return invalid(ValidationCode.ILLEGAL_SUMMON, `that legion has no ${want}`);
    }
    return valid;
  }

  protected override apply(draft: Draft, _rng: Rng, events: DomainEvent[]): void {
    const battle = draft.battle!;
    const want = this.payload.creature ?? "Angel";
    const src = draft.legions[this.payload.fromLegion]!;

    // Remove one Angel/Archangel from the source legion.
    const i = src.creatures.indexOf(want);
    const newSrc = [...src.creatures.slice(0, i), ...src.creatures.slice(i + 1)];
    if (newSrc.length === 0) {
      delete draft.legions[src.marker];
      const owner = draft.players[src.ownerId]!;
      draft.players[src.ownerId] = {
        ...owner,
        markersAvailable: [...owner.markersAvailable, src.marker].sort(),
      };
    } else {
      draft.legions[src.marker] = { ...src, creatures: newSrc };
    }

    // Place the summoned flyer on an empty hex near the attacker's force.
    const map = battleMapFor(battle.terrain)!;
    const grid = indexMap(map);
    const occ = occupiedKeys(battle);
    const spot = firstEmptyAdjacentToSide(grid, battle, "attacker", occ) ?? firstEmptyHex(grid, occ)!;

    const newId = `atk-s${battle.combatants.length}`;
    const summoned: Combatant = {
      id: newId, side: "attacker", creature: want, hex: spot,
      damage: 0, movedThisPhase: true, struckThisPhase: false, slain: false,
    };
    draft.battle = {
      ...battle,
      summonUsed: true,
      summonPending: false,
      firstKillHappened: true,
      combatants: [...battle.combatants, summoned],
    };
    events.push({ type: "AngelSummoned", audience: PUBLIC, playerId: this.playerId, creature: want, fromLegion: src.marker });
  }
}

export class DeclineSummonCommand extends BaseCommand<Record<string, never>> {
  static readonly TYPE = "DeclineSummon";
  override readonly type = DeclineSummonCommand.TYPE;

  override validate(state: GameState): ValidationResult {
    if (!matches(state.fsm, `${Scope.BattleRound}.Strike`) &&
        !matches(state.fsm, `${Scope.BattleRound}.Strikeback`)) {
      return invalid(ValidationCode.WRONG_PHASE, "no summon window open");
    }
    const battle = state.battle!;
    if (!battle.summonPending) return invalid(ValidationCode.ILLEGAL_SUMMON, "no summon is pending");
    if (this.playerId !== battle.attackerPlayerId) {
      return invalid(ValidationCode.ILLEGAL_SUMMON, "only the attacker may decline");
    }
    return valid;
  }

  protected override apply(draft: Draft, _rng: Rng, _events: DomainEvent[]): void {
    const battle = draft.battle!;
    // The right is use-it-or-lose-it: forfeit it for the rest of the battle.
    draft.battle = { ...battle, summonPending: false, summonUsed: true };
  }
}

// ===========================================================================
// Round-4 defensive muster (§7.5)
// ===========================================================================

export interface ReinforceBattlePayload {
  readonly creature: CreatureName;
}

export class ReinforceBattleCommand extends BaseCommand<ReinforceBattlePayload> {
  static readonly TYPE = "ReinforceBattle";
  override readonly type = ReinforceBattleCommand.TYPE;

  override validate(state: GameState): ValidationResult {
    if (!matches(state.fsm, `${Scope.BattleRound}.Maneuver`)) {
      return invalid(ValidationCode.WRONG_PHASE, "reinforcements muster during the Maneuver phase");
    }
    const battle = state.battle!;
    if (battle.round !== 4 || battle.activeSide !== "defender") {
      return invalid(ValidationCode.ILLEGAL_REINFORCE, "the defensive muster is only at the start of round 4");
    }
    if (battle.reinforcementUsed) {
      return invalid(ValidationCode.ILLEGAL_REINFORCE, "the round-4 muster has been used");
    }
    if (this.playerId !== battle.defenderPlayerId) {
      return invalid(ValidationCode.ILLEGAL_REINFORCE, "only the defender may muster a reinforcement");
    }
    if (aliveOf(battle, "defender").length >= MAX_LEGION_HEIGHT) {
      return invalid(ValidationCode.ILLEGAL_REINFORCE, "the battle force is at the cap");
    }
    const onBoard = aliveOf(battle, "defender").map((c) => c.creature);
    const containsOwnTitan = onBoard.includes("Titan");
    if (!canRecruit(battle.terrain as never, onBoard, this.payload.creature, state.caretaker, { containsOwnTitan })) {
      return invalid(ValidationCode.ILLEGAL_REINFORCE, `${this.payload.creature} cannot be mustered here`);
    }
    return valid;
  }

  protected override apply(draft: Draft, _rng: Rng, events: DomainEvent[]): void {
    const battle = draft.battle!;
    const map = battleMapFor(battle.terrain)!;
    const grid = indexMap(map);
    const occ = occupiedKeys(battle);
    const base = defenderEntryHexes(map, battle.attackerSide as EntrySide);
    const zoneKey = [...deployZone(grid, base)].find((k) => !occ.has(k));
    const spot = (zoneKey ? keyToCube(grid, zoneKey) : null) ?? firstEmptyHex(grid, occ)!;

    const newId = `def-r${battle.combatants.length}`;
    const reinforcement: Combatant = {
      id: newId, side: "defender", creature: this.payload.creature, hex: spot,
      damage: 0, movedThisPhase: true, struckThisPhase: false, slain: false,
    };
    draft.caretaker[this.payload.creature] = (draft.caretaker[this.payload.creature] ?? 0) - 1;
    draft.battle = {
      ...battle,
      reinforcementUsed: true,
      combatants: [...battle.combatants, reinforcement],
    };
    events.push({ type: "BattleReinforced", audience: PUBLIC, playerId: this.playerId, creature: this.payload.creature });
  }
}

// ===========================================================================
// Conclusion & scoring (§8)
// ===========================================================================

function legionScore(state: GameState | Draft, playerId: PlayerId): number {
  return state.players[playerId]?.score ?? 0;
}

function slainValue(battle: BattleContext, side: Side, ownerScore: number): number {
  return battle.combatants
    .filter((c) => c.side === side && c.slain)
    .reduce((sum, c) => sum + pointValue(c.creature, ownerScore), 0);
}

function returnToCaretaker(draft: Draft, creatures: readonly CreatureName[]): void {
  for (const c of creatures) draft.caretaker[c] = (draft.caretaker[c] ?? 0) + 1;
}

/** Keep the winner's surviving battle force as the legion on the contested land. */
function settleWinnerLegion(draft: Draft, marker: LegionId, survivors: readonly Combatant[], land: LandId): void {
  const legion = draft.legions[marker];
  if (!legion) return;
  // Overstack culling (§8.2) covers a force swollen by a summon.
  const { kept, removed } = cullOverstack(survivors.map((c) => c.creature));
  returnToCaretaker(draft, removed);
  draft.legions[marker] = { ...legion, creatures: kept, land, revealed: true };
}

interface EndAccumulator { ended: boolean; winnerId: PlayerId | null }

/** Eliminate a player whose Titan has fallen: inherit markers + half-points. */
function eliminatePlayer(
  draft: Draft,
  events: DomainEvent[],
  loserId: PlayerId,
  heirId: PlayerId | null,
  end: EndAccumulator,
): void {
  const loser = draft.players[loserId];
  if (!loser || loser.eliminated) return;

  // The loser's OTHER legions (unengaged): half-points to the heir, then gone.
  const otherLegions = Object.values(draft.legions).filter((l) => l.ownerId === loserId);
  const unengagedCreatures: CreatureName[] = [];
  const inheritedMarkers: LegionId[] = [];
  for (const l of otherLegions) {
    unengagedCreatures.push(...l.creatures);
    inheritedMarkers.push(l.marker);
    returnToCaretaker(draft, l.creatures);
    delete draft.legions[l.marker];
  }

  if (heirId) {
    const half = halfPoints(unengagedCreatures, loser.score);
    awardScore(draft, heirId, half, events);
    const heir = draft.players[heirId]!;
    const allMarkers = [...heir.markersAvailable, ...loser.markersAvailable, ...inheritedMarkers].sort();
    draft.players[heirId] = { ...heir, markersAvailable: allMarkers };
    events.push({
      type: "MarkersInherited", audience: PUBLIC,
      heirId, fromId: loserId, markers: [...loser.markersAvailable, ...inheritedMarkers].sort(),
    });
  }

  draft.players[loserId] = { ...draft.players[loserId]!, eliminated: true, markersAvailable: [] };
  events.push({ type: "PlayerEliminated", audience: PUBLIC, playerId: loserId });

  const survivors = Object.values(draft.players).filter((p) => !p.eliminated);
  if (survivors.length <= 1) {
    end.ended = true;
    end.winnerId = survivors[0]?.id ?? null;
  }
}

function concludeBattle(draft: Draft, events: DomainEvent[], opts: { timeLoss: boolean }): void {
  const battle = draft.battle!;
  const atkId = battle.attackerPlayerId;
  const defId = battle.defenderPlayerId;
  const atkAlive = aliveOf(battle, "attacker");
  const defAlive = aliveOf(battle, "defender");
  const atkTitanDead = battle.combatants.some((c) => c.side === "attacker" && c.creature === "Titan" && c.slain);
  const defTitanDead = battle.combatants.some((c) => c.side === "defender" && c.creature === "Titan" && c.slain);

  // Slain combatants of both sides return to the caretaker pool.
  returnToCaretaker(draft, battle.combatants.filter((c) => c.slain).map((c) => c.creature));

  const end: EndAccumulator = { ended: false, winnerId: null };
  let outcome = "attacker";
  let winnerId: PlayerId | null = null;
  let loserId: PlayerId | null = null;
  let points = 0;

  if (atkTitanDead && defTitanDead) {
    // Mutual destruction — "I see dead people!" (§8.1). Nobody scores; both
    // legions and ALL their markers are removed from the game.
    outcome = "mutual";
    returnToCaretaker(draft, [...atkAlive, ...defAlive].map((c) => c.creature));
    delete draft.legions[battle.attackerLegion];
    delete draft.legions[battle.defenderLegion];
    eliminatePlayer(draft, events, atkId, null, end);
    eliminatePlayer(draft, events, defId, null, end);
  } else if (opts.timeLoss) {
    // Attacker time-loss (§7.4): attacker legion wiped, defender keeps its
    // survivors but scores NOTHING.
    outcome = "defender";
    winnerId = defId;
    loserId = atkId;
    returnToCaretaker(draft, atkAlive.map((c) => c.creature));
    settleWinnerLegion(draft, battle.defenderLegion, defAlive, battle.land);
    delete draft.legions[battle.attackerLegion];
    if (atkTitanDead || !ownerHasTitan(draft, atkId)) {
      eliminatePlayer(draft, events, atkId, defId, end);
    } else {
      returnMarker(draft, atkId, battle.attackerLegion);
    }
  } else {
    // The loser is the side whose Titan fell; otherwise the wiped-out side.
    let attackerWon: boolean;
    if (defTitanDead && !atkTitanDead) attackerWon = true;
    else if (atkTitanDead && !defTitanDead) attackerWon = false;
    else attackerWon = defAlive.length === 0 && atkAlive.length > 0;

    winnerId = attackerWon ? atkId : defId;
    loserId = attackerWon ? defId : atkId;
    outcome = attackerWon ? "attacker" : "defender";

    const loserSide: Side = attackerWon ? "defender" : "attacker";
    points = slainValue(battle, loserSide, legionScore(draft, loserId));

    const winnerLegion = attackerWon ? battle.attackerLegion : battle.defenderLegion;
    const winnerAlive = attackerWon ? atkAlive : defAlive;
    const loserAlive = attackerWon ? defAlive : atkAlive;
    const loserLegion = attackerWon ? battle.defenderLegion : battle.attackerLegion;
    const loserTitanDead = attackerWon ? defTitanDead : atkTitanDead;

    // The destroyed loser legion's surviving creatures return to the pool.
    returnToCaretaker(draft, loserAlive.map((c) => c.creature));
    settleWinnerLegion(draft, winnerLegion, winnerAlive, battle.land);
    delete draft.legions[loserLegion];

    awardScore(draft, winnerId, points, events);

    if (loserTitanDead || !ownerHasTitanExcept(draft, loserId, loserLegion)) {
      eliminatePlayer(draft, events, loserId, winnerId, end);
    } else {
      returnMarker(draft, loserId, loserLegion);
    }
  }

  draft.battle = null;
  draft.turn = { ...draft.turn, engagementLand: null };

  events.push({
    type: "BattleConcluded", audience: PUBLIC,
    land: battle.land, outcome, winnerId, loserId, pointsAwarded: points, timeLoss: opts.timeLoss,
  });

  // Advance the engagement FSM out of the battle, then to Mustering if done.
  fire(draft, events, BattleEvent.BATTLE_CONCLUDED);
  fire(draft, events, GameEvent.ENGAGEMENT_RESOLVED);
  if (pendingEngagements(draft).length === 0) {
    fire(draft, events, GameEvent.ALL_ENGAGEMENTS_RESOLVED);
  }

  if (end.ended) {
    events.push({ type: "GameEnded", audience: PUBLIC, winnerId: end.winnerId });
    fire(draft, events, GameEvent.GAME_ENDED);
  }
}

// --- small mutation helpers ------------------------------------------------

function returnMarker(draft: Draft, ownerId: PlayerId, marker: LegionId): void {
  const p = draft.players[ownerId];
  if (!p) return;
  if (p.markersAvailable.includes(marker)) return;
  draft.players[ownerId] = { ...p, markersAvailable: [...p.markersAvailable, marker].sort() };
}

function ownerHasTitan(draft: Draft, ownerId: PlayerId): boolean {
  return Object.values(draft.legions).some((l) => l.ownerId === ownerId && l.creatures.includes("Titan"));
}
function ownerHasTitanExcept(draft: Draft, ownerId: PlayerId, exceptMarker: LegionId): boolean {
  return Object.values(draft.legions).some(
    (l) => l.ownerId === ownerId && l.marker !== exceptMarker && l.creatures.includes("Titan"),
  );
}

// --- hex placement helpers -------------------------------------------------

function firstEmptyAdjacentToSide(
  grid: BattleGrid, battle: BattleContext, side: Side, occ: Set<string>,
): CubeCoord | null {
  const mine = battle.combatants.filter((c) => c.side === side && !c.slain && c.hex);
  for (const c of mine) {
    for (let d = 0; d < 6; d++) {
      const nb = neighborCube(c.hex!, d);
      const k = cubeKey(nb);
      if (grid.byKey.has(k) && !occ.has(k) && !isImpassableTerrain(hexAt(grid, nb)!.terrain)) {
        return nb;
      }
    }
  }
  return null;
}

function firstEmptyHex(grid: BattleGrid, occ: Set<string>): CubeCoord | null {
  for (const h of grid.map.hexes) {
    const k = cubeKey(h.cube);
    if (!occ.has(k) && !isImpassableTerrain(h.terrain)) return h.cube;
  }
  return null;
}
function keyToCube(grid: BattleGrid, key: string): CubeCoord | null {
  const h = grid.byKey.get(key);
  return h ? h.cube : null;
}
