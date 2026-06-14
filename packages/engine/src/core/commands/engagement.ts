/**
 * Engagement-resolution commands (Titan engine, module: core/commands).
 *
 * THE GAP THIS FILLS: the Game FSM defines Turn.Engagement.{Choosing,
 * Negotiation} and the events that move through them, but before this module
 * no command fired them. The moment two enemy legions shared a Land, EndMovement
 * stepped into Engagement.Choosing and the game had no legal command to proceed
 * — a hard soft-lock. These commands give the Engagement phase a complete,
 * playable resolution path so a full game can run start to finish.
 *
 *   SelectEngagementCommand   the moving (attacking) player picks the next
 *                             contested Land to resolve, entering Negotiation.
 *   ResolveEngagementCommand  resolve the selected engagement two ways — there
 *                             are NO one-sided concessions:
 *                               - "fight":  open the tactical Battle subtree and
 *                                           settle it with steel.
 *                               - "settle": a NEGOTIATED point-split. The
 *                                           defender's legion withdraws (removed
 *                                           to the caretaker pool) and its point
 *                                           value is divided between the two
 *                                           players — an even split by default,
 *                                           or any agreed ratio via
 *                                           `attackerShare`. The attacker holds
 *                                           the Land.
 *
 * When the last engagement is resolved, the phase advances to Mustering exactly
 * as the empty-list fast path in EndMovement does. A player who loses their last
 * Titan-bearing legion is eliminated (shared helper); if one player remains, the
 * game ends.
 */

import {
  BaseCommand,
  invalid,
  valid,
  ValidationCode,
  type Draft,
  type ValidationResult,
} from "./Command.ts";
import type { GameState, LegionState } from "../../state/GameState.ts";
import { matches } from "../fsm/StateMachine.ts";
import { GameEvent, Scope } from "../fsm/GameFSM.ts";
import type { DomainEvent, LandId, PlayerId } from "../events/DomainEvent.ts";
import { PUBLIC } from "../events/DomainEvent.ts";
import type { Rng } from "../rng/Rng.ts";
import { legionsAt, pendingEngagements } from "../../state/selectors.ts";
import { pointValue } from "../../creatures/stats.data.ts";
import { createBattleContext } from "./battle-flow.ts";
import { awardScore } from "./scoring.ts";

/** Engagement outcomes — fight it out, or agree a negotiated point-split. There
 *  are no concessions. */
export type EngagementOutcome = "fight" | "settle";

// ---------------------------------------------------------------------------

export interface SelectEngagementPayload {
  readonly land: LandId;
}

export class SelectEngagementCommand extends BaseCommand<SelectEngagementPayload> {
  static readonly TYPE = "SelectEngagement";
  override readonly type = SelectEngagementCommand.TYPE;

  override validate(state: GameState): ValidationResult {
    if (!matches(state.fsm, "Turn.Engagement.Choosing")) {
      return invalid(ValidationCode.WRONG_PHASE, "engagements are chosen during the Engagement phase");
    }
    const active = this.requireActivePlayer(state);
    if (!active.ok) return active;

    if (!pendingEngagements(state).includes(this.payload.land)) {
      return invalid(
        ValidationCode.NO_SUCH_ENGAGEMENT,
        `land ${this.payload.land} is not a pending engagement`,
      );
    }
    return valid;
  }

  protected override apply(draft: Draft, _rng: Rng, events: DomainEvent[]): void {
    draft.turn = { ...draft.turn, engagementLand: this.payload.land };
    events.push({
      type: "EngagementSelected",
      audience: PUBLIC,
      land: this.payload.land,
      attackerId: this.playerId,
    });
    this.fireFsm(draft, events, GameEvent.ENGAGEMENT_SELECTED);
  }
}

// ---------------------------------------------------------------------------

export interface ResolveEngagementPayload {
  readonly outcome: EngagementOutcome;
  /** For "settle": the attacker's fraction (0–1) of the removed legion's points.
   *  Defaults to an even split. */
  readonly attackerShare?: number;
}

export class ResolveEngagementCommand extends BaseCommand<ResolveEngagementPayload> {
  static readonly TYPE = "ResolveEngagement";
  override readonly type = ResolveEngagementCommand.TYPE;

  override validate(state: GameState): ValidationResult {
    if (!matches(state.fsm, "Turn.Engagement.Negotiation")) {
      return invalid(ValidationCode.WRONG_PHASE, "no engagement is being negotiated");
    }
    const land = state.turn.engagementLand;
    if (land === null || land === undefined) {
      return invalid(ValidationCode.NO_SUCH_ENGAGEMENT, "no engagement is selected");
    }
    const { attacker, defender } = sidesAt(state, land, this.playerId);
    if (!attacker || !defender) {
      return invalid(ValidationCode.NO_SUCH_ENGAGEMENT, "that engagement is not resolvable");
    }
    // The active player is the attacker; only the attacker drives "flee"
    // (defender chose to withdraw) or accepts a "concede" in this minimal flow.
    const active = this.requireActivePlayer(state);
    if (!active.ok) return active;

    if (this.payload.outcome !== "fight" && this.payload.outcome !== "settle") {
      return invalid(ValidationCode.ILLEGAL_OUTCOME, "outcome must be 'fight' or 'settle'");
    }
    return valid;
  }

  protected override apply(draft: Draft, _rng: Rng, events: DomainEvent[]): void {
    const land = draft.turn.engagementLand as LandId;
    const { attacker, defender } = sidesAt(draft, land, this.playerId);

    // FIGHT: open the tactical battle instead of resolving administratively.
    if (this.payload.outcome === "fight") {
      draft.legions[attacker!.marker] = { ...draft.legions[attacker!.marker]!, revealed: true };
      draft.legions[defender!.marker] = { ...draft.legions[defender!.marker]!, revealed: true };
      draft.battle = createBattleContext(
        draft, land, attacker!.marker, defender!.marker, attacker!.ownerId, defender!.ownerId,
      );
      events.push({
        type: "BattleJoined", audience: PUBLIC,
        land, terrain: draft.battle.terrain,
        attackerLegion: attacker!.marker, defenderLegion: defender!.marker,
        attackerId: attacker!.ownerId, defenderId: defender!.ownerId,
      });
      this.fireFsm(draft, events, GameEvent.BATTLE_JOINED);
      return;
    }
    // SETTLE: a negotiated point-split. The defender's legion withdraws (removed
    // to the caretaker pool) and its point value is divided between both players.
    const losing = defender!;
    const attackerId = attacker!.ownerId;
    const defenderId = defender!.ownerId;

    const total = losing.creatures.reduce((sum, c) => sum + pointValue(c), 0);
    const share = Math.min(1, Math.max(0, this.payload.attackerShare ?? 0.5));
    const attackerPts = Math.round(total * share);
    const defenderPts = total - attackerPts;

    // Return the withdrawn legion's creatures to the caretaker pool.
    for (const c of losing.creatures) draft.caretaker[c] = (draft.caretaker[c] ?? 0) + 1;
    delete draft.legions[losing.marker];
    const loserPlayer = draft.players[defenderId]!;
    draft.players[defenderId] = {
      ...loserPlayer,
      markersAvailable: [...loserPlayer.markersAvailable, losing.marker].sort(),
    };

    // Split the points (each award also grants any Angel/Archangel crossed).
    awardScore(draft, attackerId, attackerPts, events);
    awardScore(draft, defenderId, defenderPts, events);

    events.push({
      type: "EngagementResolved",
      audience: PUBLIC,
      land,
      outcome: "settle",
      winnerId: attackerId,
      loserId: defenderId,
      pointsAwarded: total,
      eliminatedMarker: losing.marker,
    });

    // Advance the engagement FSM, then to Mustering if this was the last clash.
    draft.turn = { ...draft.turn, engagementLand: null };
    this.fireFsm(draft, events, GameEvent.SETTLEMENT_AGREED);
    if (pendingEngagements(draft).length === 0) {
      this.fireFsm(draft, events, GameEvent.ALL_ENGAGEMENTS_RESOLVED);
    }

    // Elimination / game-end last (settling away a Titan legion is legal).
    maybeEliminate(draft, defenderId, events);
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Identify the attacker (active player's legion) and defender (the other
 * player's legion) at a contested Land. Returns the first legion of each side
 * — the minimal flow assumes one legion per side at the Land, which holds for
 * the common case; multi-legion stacks are a later refinement.
 */
function sidesAt(
  state: GameState,
  land: LandId,
  activePlayerId: PlayerId,
): { attacker: LegionState | null; defender: LegionState | null } {
  const here = legionsAt(state, land);
  const attacker = here.find((l) => l.ownerId === activePlayerId) ?? null;
  const defender = here.find((l) => l.ownerId !== activePlayerId) ?? null;
  return { attacker, defender };
}

/**
 * A player with no remaining legion containing their Titan is eliminated. If
 * eliminating them leaves a single player standing, the game ends.
 */
function maybeEliminate(draft: Draft, playerId: PlayerId, events: DomainEvent[]): void {
  const player = draft.players[playerId];
  if (!player || player.eliminated) return;

  const hasTitan = Object.values(draft.legions).some(
    (l) => l.ownerId === playerId && l.creatures.includes("Titan"),
  );
  if (hasTitan) return;

  draft.players[playerId] = { ...player, eliminated: true };
  events.push({ type: "PlayerEliminated", audience: PUBLIC, playerId });

  const survivors = Object.values(draft.players).filter((p) => !p.eliminated);
  if (survivors.length <= 1) {
    events.push({
      type: "GameEnded",
      audience: PUBLIC,
      winnerId: survivors[0]?.id ?? null,
    });
    this_fireGameEnded(draft, events);
  }
}

/** Fire GAME_ENDED on the draft (free function — no `this` in helpers). */
function this_fireGameEnded(draft: Draft, events: DomainEvent[]): void {
  // Reuse the FSM transition machinery via a tiny inline command-less fire.
  // GAME_ENDED is declared on the Setup and Turn scopes (see GameFSM).
  // We import lazily to avoid a cycle at module load.
  draft.fsm = fireRaw(draft.fsm, GameEvent.GAME_ENDED);
  void events;
}

// Local import kept at the bottom to avoid an import cycle with StateMachine.
import { transition } from "../fsm/StateMachine.ts";
import { GAME_MACHINE } from "../fsm/GameFSM.ts";
function fireRaw(fsm: GameState["fsm"], event: string): GameState["fsm"] {
  return transition(GAME_MACHINE, fsm, event);
}
