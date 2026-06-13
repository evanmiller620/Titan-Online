/**
 * Turn-flow commands (Titan engine, module: core/commands).
 *
 *   SplitLegionCommand   Commencement: divide one legion into two
 *   EndSplitsCommand     close Commencement (turn 1 REQUIRES the 8-stack
 *                        to have been split)
 *   RollMovementCommand  the turn's movement die (server-side rng)
 *   TakeMulliganCommand  the one free re-roll, first game-turn only
 *   EndMovementCommand   close Movement; auto-resolves an empty Engagement
 *                        phase by chaining ALL_ENGAGEMENTS_RESOLVED
 *   EndTurnCommand       close Mustering, rotate to the next live player,
 *                        reset per-turn flags
 *
 * Deferred to later modules (so their absence is explicit, not forgotten):
 *  - MoveLegionCommand needs the Masterboard directed graph (module 4); the
 *    "every legion that can move must, and split halves must separate"
 *    legality checks land there, wired into EndMovementCommand's validate.
 *  - MusterCommand needs recruitment trees (module 5).
 *  - Engagement/battle commands need modules 6–7.
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
import { matches } from "../fsm/StateMachine.ts";
import { GameEvent, Scope } from "../fsm/GameFSM.ts";
import type { DomainEvent, LegionId } from "../events/DomainEvent.ts";
import { onlyPlayer, PUBLIC } from "../events/DomainEvent.ts";
import type { Rng } from "../rng/Rng.ts";
import {
  isSubMultiset,
  legionHeight,
  pendingEngagements,
  subtractMultiset,
} from "../../state/selectors.ts";
import { unmovedButAble } from "./movement.ts";
import {
  MAX_LEGION_HEIGHT,
  type CreatureName,
} from "../../creatures/names.ts";

// ---------------------------------------------------------------------------

export interface SplitLegionPayload {
  readonly legionId: LegionId;
  /** Marker for the NEW legion; must be one of the player's unused markers. */
  readonly newMarker: string;
  /** Creatures moving to the new legion (a sub-multiset of the parent). */
  readonly toNewLegion: readonly CreatureName[];
}

export class SplitLegionCommand extends BaseCommand<SplitLegionPayload> {
  static readonly TYPE = "SplitLegion";
  override readonly type = SplitLegionCommand.TYPE;

  override validate(state: GameState): ValidationResult {
    if (!matches(state.fsm, Scope.Commencement)) {
      return invalid(ValidationCode.WRONG_PHASE, "splits happen during Commencement");
    }
    const active = this.requireActivePlayer(state);
    if (!active.ok) return active;

    const legion = state.legions[this.payload.legionId];
    if (!legion) {
      return invalid(ValidationCode.UNKNOWN_LEGION, `no legion "${this.payload.legionId}"`);
    }
    if (legion.ownerId !== this.playerId) {
      return invalid(ValidationCode.NOT_LEGION_OWNER, "that legion is not yours");
    }
    if (legion.splitThisTurn) {
      return invalid(ValidationCode.ILLEGAL_SPLIT, "a legion may only split once per turn");
    }

    const player = state.players[this.playerId]!;
    if (!player.markersAvailable.includes(this.payload.newMarker)) {
      return invalid(
        ValidationCode.MARKER_UNAVAILABLE,
        `marker "${this.payload.newMarker}" is not available to you`,
      );
    }

    const moving = this.payload.toNewLegion;
    if (!isSubMultiset(moving, legion.creatures)) {
      return invalid(ValidationCode.ILLEGAL_SPLIT, "those creatures are not all in that legion");
    }
    const childHeight = moving.length;
    const parentHeight = legionHeight(legion) - childHeight;

    if (state.turn.number === 1) {
      // The initial split: exactly 4 + 4, one Lord anchoring each half.
      if (legionHeight(legion) !== 8 || childHeight !== 4) {
        return invalid(
          ValidationCode.ILLEGAL_SPLIT,
          "the initial split must divide the eight starting characters 4/4",
        );
      }
      const childLords = moving.filter((c) => c === "Titan" || c === "Angel").length;
      if (childLords !== 1) {
        return invalid(
          ValidationCode.ILLEGAL_SPLIT,
          "the Titan and the Angel must end up in different legions",
        );
      }
    } else {
      if (childHeight < 2 || parentHeight < 2) {
        return invalid(
          ValidationCode.ILLEGAL_SPLIT,
          "both legions of a split must contain at least two characters",
        );
      }
    }
    return valid;
  }

  protected override apply(draft: Draft, _rng: Rng, events: DomainEvent[]): void {
    const parent = draft.legions[this.payload.legionId]!;
    const childCreatures = [...this.payload.toNewLegion];
    const parentCreatures = subtractMultiset(parent.creatures, childCreatures);

    draft.legions[this.payload.legionId] = {
      ...parent,
      creatures: parentCreatures,
      splitThisTurn: true,
    };
    draft.legions[this.payload.newMarker] = {
      marker: this.payload.newMarker,
      ownerId: this.playerId,
      land: parent.land,
      creatures: childCreatures,
      moved: false,
      splitThisTurn: true,
      recruitedThisTurn: false,
    };

    const player = draft.players[this.playerId]!;
    draft.players[this.playerId] = {
      ...player,
      markersAvailable: player.markersAvailable.filter((m) => m !== this.payload.newMarker),
    };

    // Public: markers and heights. Owner-only: which creatures went where.
    events.push({
      type: "LegionSplit",
      audience: PUBLIC,
      playerId: this.playerId,
      parentLegionId: parent.marker,
      childLegionId: this.payload.newMarker,
      land: parent.land,
      parentHeight: parentCreatures.length,
      childHeight: childCreatures.length,
    });
    events.push({
      type: "LegionSplitDetail",
      audience: onlyPlayer(this.playerId),
      playerId: this.playerId,
      parentLegionId: parent.marker,
      childLegionId: this.payload.newMarker,
      parentCreatures,
      childCreatures,
    });
  }
}

// ---------------------------------------------------------------------------

export class EndSplitsCommand extends BaseCommand<Record<string, never>> {
  static readonly TYPE = "EndSplits";
  override readonly type = EndSplitsCommand.TYPE;

  override validate(state: GameState): ValidationResult {
    if (!matches(state.fsm, Scope.Commencement)) {
      return invalid(ValidationCode.WRONG_PHASE, "not in Commencement");
    }
    const active = this.requireActivePlayer(state);
    if (!active.ok) return active;

    // Turn 1: the eight-stack MUST have been split before play continues.
    for (const legion of Object.values(state.legions)) {
      if (legion.ownerId === this.playerId && legionHeight(legion) > MAX_LEGION_HEIGHT) {
        return invalid(
          ValidationCode.SPLIT_REQUIRED,
          "your starting legion must be split 4/4 before ending Commencement",
        );
      }
    }
    return valid;
  }

  protected override apply(draft: Draft, _rng: Rng, events: DomainEvent[]): void {
    this.fireFsm(draft, events, GameEvent.SPLITS_COMPLETED);
  }
}

// ---------------------------------------------------------------------------

export class RollMovementCommand extends BaseCommand<Record<string, never>> {
  static readonly TYPE = "RollMovement";
  override readonly type = RollMovementCommand.TYPE;

  override validate(state: GameState): ValidationResult {
    if (!matches(state.fsm, Scope.Movement)) {
      return invalid(ValidationCode.WRONG_PHASE, "not in Movement");
    }
    const active = this.requireActivePlayer(state);
    if (!active.ok) return active;
    if (state.turn.movementRoll !== null) {
      return invalid(ValidationCode.ALREADY_ROLLED, "movement has already been rolled");
    }
    return valid;
  }

  protected override apply(draft: Draft, rng: Rng, events: DomainEvent[]): void {
    const roll = rng.d6();
    draft.turn = { ...draft.turn, movementRoll: roll };
    events.push({
      type: "MovementRolled",
      audience: PUBLIC,
      playerId: this.playerId,
      roll,
      mulligan: false,
    });
  }
}

// ---------------------------------------------------------------------------

export class TakeMulliganCommand extends BaseCommand<Record<string, never>> {
  static readonly TYPE = "TakeMulligan";
  override readonly type = TakeMulliganCommand.TYPE;

  override validate(state: GameState): ValidationResult {
    if (!matches(state.fsm, Scope.Movement)) {
      return invalid(ValidationCode.WRONG_PHASE, "not in Movement");
    }
    const active = this.requireActivePlayer(state);
    if (!active.ok) return active;
    if (state.turn.number !== 1) {
      return invalid(ValidationCode.MULLIGAN_UNAVAILABLE, "the mulligan exists only on turn 1");
    }
    if (state.turn.mulliganUsed) {
      return invalid(ValidationCode.MULLIGAN_UNAVAILABLE, "the mulligan has been used");
    }
    if (state.turn.movementRoll === null) {
      return invalid(ValidationCode.NOTHING_TO_REROLL, "roll movement before taking a mulligan");
    }
    return valid;
  }

  protected override apply(draft: Draft, rng: Rng, events: DomainEvent[]): void {
    const roll = rng.d6();
    draft.turn = { ...draft.turn, movementRoll: roll, mulliganUsed: true };
    events.push({
      type: "MovementRolled",
      audience: PUBLIC,
      playerId: this.playerId,
      roll,
      mulligan: true,
    });
  }
}

// ---------------------------------------------------------------------------

export class EndMovementCommand extends BaseCommand<Record<string, never>> {
  static readonly TYPE = "EndMovement";
  override readonly type = EndMovementCommand.TYPE;

  override validate(state: GameState): ValidationResult {
    if (!matches(state.fsm, Scope.Movement)) {
      return invalid(ValidationCode.WRONG_PHASE, "not in Movement");
    }
    const active = this.requireActivePlayer(state);
    if (!active.ok) return active;
    if (state.turn.movementRoll === null) {
      return invalid(ValidationCode.MOVEMENT_NOT_ROLLED, "roll movement first");
    }
    // Every legion that CAN move MUST have moved before the phase ends.
    const owing = unmovedButAble(state);
    if (owing !== null) {
      return invalid(
        ValidationCode.MUST_MOVE,
        `legion ${owing} can move and so must move before ending Movement`,
      );
    }
    return valid;
  }

  protected override apply(draft: Draft, _rng: Rng, events: DomainEvent[]): void {
    this.fireFsm(draft, events, GameEvent.MOVEMENT_COMPLETED);
    // Empty engagement list: resolve the phase immediately. One topology,
    // zero special cases — the chain happens in command land, not the FSM.
    if (pendingEngagements(draft).length === 0) {
      this.fireFsm(draft, events, GameEvent.ALL_ENGAGEMENTS_RESOLVED);
    }
  }
}

// ---------------------------------------------------------------------------

export class EndTurnCommand extends BaseCommand<Record<string, never>> {
  static readonly TYPE = "EndTurn";
  override readonly type = EndTurnCommand.TYPE;

  override validate(state: GameState): ValidationResult {
    if (!matches(state.fsm, Scope.Mustering)) {
      return invalid(ValidationCode.WRONG_PHASE, "not in Mustering");
    }
    return this.requireActivePlayer(state);
  }

  protected override apply(draft: Draft, _rng: Rng, events: DomainEvent[]): void {
    // Rotate to the next non-eliminated player; wrap increments turn number.
    const order = draft.playerOrder;
    let i = draft.turn.activeIndex;
    let turnNumber = draft.turn.number;
    for (let hops = 0; hops < order.length; hops++) {
      i = (i + 1) % order.length;
      if (i === 0) turnNumber += 1;
      const candidate = draft.players[order[i]!]!;
      if (!candidate.eliminated) break;
    }

    draft.turn = {
      number: turnNumber,
      activeIndex: i,
      movementRoll: null,
      mulliganUsed: false,
    };

    // Per-turn legion flags reset for everyone.
    for (const [id, legion] of Object.entries(draft.legions)) {
      draft.legions[id] = { ...legion, moved: false, splitThisTurn: false, recruitedThisTurn: false };
    }

    events.push({
      type: "TurnEnded",
      audience: PUBLIC,
      endedByPlayerId: this.playerId,
      nextPlayerId: order[i]!,
      turnNumber,
    });
    this.fireFsm(draft, events, GameEvent.TURN_ENDED);
  }
}
