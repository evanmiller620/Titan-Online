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
 *   ResolveEngagementCommand  settle the selected engagement. v1 implements the
 *                             two outcomes that need no tactical battle board:
 *                               - "flee":   the DEFENDER withdraws; their legion
 *                                           is eliminated and the attacker scores
 *                                           its point value (sum of creature
 *                                           powers). The attacker holds the Land.
 *                               - "concede": same elimination/scoring, initiated
 *                                           by the defender conceding.
 *                             Full tactical battle resolution (the Battle subtree
 *                             with Strike/Strikeback) remains available via the
 *                             combat module; this command resolves the
 *                             engagement administratively so play is never stuck.
 *
 * When the last engagement is resolved, the phase advances to Mustering exactly
 * as the empty-list fast path in EndMovement does — one topology, no special
 * cases.
 *
 * Scoring & elimination are faithful to the rules for the flee/concede case:
 * the surviving side keeps its legion on the Land; the losing legion's creatures
 * return to the caretaker pool; the loser scores nothing; the winner scores the
 * combined point value of the creatures removed. A player who loses their last
 * legion containing the Titan is eliminated (handled by the shared helper).
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

/** The two administrative outcomes this module resolves without a battle board. */
export type EngagementOutcome = "flee" | "concede";

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

    if (this.payload.outcome !== "flee" && this.payload.outcome !== "concede") {
      return invalid(ValidationCode.ILLEGAL_OUTCOME, "outcome must be 'flee' or 'concede'");
    }
    return valid;
  }

  protected override apply(draft: Draft, _rng: Rng, events: DomainEvent[]): void {
    const land = draft.turn.engagementLand as LandId;
    const { attacker, defender } = sidesAt(draft, land, this.playerId);
    // In both flee and concede, the defender's legion is removed and the
    // attacker scores its value. (A fuller model would let either side flee;
    // this minimal resolution always withdraws the non-active defender, which
    // is the common case and keeps the game completable.)
    const losing = defender!;
    const winningId = attacker!.ownerId;

    const points = losing.creatures.reduce((sum, c) => sum + pointValue(c), 0);

    // Return the losing legion's creatures to the caretaker pool.
    for (const c of losing.creatures) {
      draft.caretaker[c] = (draft.caretaker[c] ?? 0) + 1;
    }
    // Remove the losing legion; its marker returns to its owner.
    delete draft.legions[losing.marker];
    const loserPlayer = draft.players[losing.ownerId]!;
    draft.players[losing.ownerId] = {
      ...loserPlayer,
      markersAvailable: [...loserPlayer.markersAvailable, losing.marker].sort(),
    };

    // Score the winner.
    const winner = draft.players[winningId]!;
    draft.players[winningId] = { ...winner, score: winner.score + points };

    // Reveal is moot now (legion gone); emit the public outcome.
    events.push({
      type: "EngagementResolved",
      audience: PUBLIC,
      land,
      outcome: this.payload.outcome,
      winnerId: winningId,
      loserId: losing.ownerId,
      pointsAwarded: points,
      eliminatedMarker: losing.marker,
    });

    // Advance the engagement FSM FIRST: clear the selection and step back to
    // Choosing, then to Mustering if this was the last engagement.
    draft.turn = { ...draft.turn, engagementLand: null };
    this.fireFsm(draft, events, GameEvent.DEFENDER_FLED);
    if (pendingEngagements(draft).length === 0) {
      this.fireFsm(draft, events, GameEvent.ALL_ENGAGEMENTS_RESOLVED);
    }

    // THEN check elimination / game end. Firing GAME_ENDED last means we never
    // attempt an engagement transition out of the terminal GameOver state.
    maybeEliminate(draft, losing.ownerId, events);
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
