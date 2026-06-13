/**
 * Command Pattern core (Titan engine, module: core/commands).
 *
 * Every player action is a Command:
 *
 *   DTO  { type, playerId, payload }   — what travels over the wire and is
 *                                        appended to the Postgres command log
 *   validate(state)                    — pure legality check against the
 *                                        CURRENT state (FSM phase, ownership,
 *                                        game rules); returns a structured
 *                                        failure, never throws for rule
 *                                        violations
 *   execute(state, rng)                — validate() again (defense in depth:
 *                                        the server must never trust that the
 *                                        caller validated), then produce
 *                                        { state', events }. Pure: the input
 *                                        state is never mutated.
 *
 * The SAME command code runs in the browser (pre-validate for instant UI
 * feedback; strict-wait v1 never applies results locally) and in the Edge
 * Function (authoritative validate + execute). Dice only exist server-side
 * because only the server constructs a real Rng for dice-bearing commands.
 *
 * Implementation note on purity: execute() deep-clones the state via
 * structuredClone and mutates the DRAFT. From the outside this is fully
 * immutable (input untouched, fresh output); inside, draft mutation keeps
 * multi-step rules readable. GameState is plain JSON so structuredClone is
 * safe and exact.
 */

import type {
  BattleContext,
  GameState,
  PlayerState,
  SetupState,
  TurnState,
  LegionState,
} from "../../state/GameState.ts";
import type { CreatureName } from "../../creatures/names.ts";
import type { DomainEvent, LegionId, PlayerId } from "../events/DomainEvent.ts";
import { PUBLIC } from "../events/DomainEvent.ts";
import type { Rng } from "../rng/Rng.ts";
import { GAME_MACHINE } from "../fsm/GameFSM.ts";
import type { FsmState } from "../fsm/StateMachine.ts";
import { transition } from "../fsm/StateMachine.ts";
import { activePlayerId } from "../../state/selectors.ts";

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

export interface CommandDTO {
  readonly type: string;
  readonly playerId: PlayerId;
  readonly payload: unknown;
}

// ---------------------------------------------------------------------------
// Validation vocabulary
// ---------------------------------------------------------------------------

export const ValidationCode = {
  WRONG_PHASE: "WRONG_PHASE",
  NOT_ACTIVE_PLAYER: "NOT_ACTIVE_PLAYER",
  NOT_YOUR_TURN_TO_PICK: "NOT_YOUR_TURN_TO_PICK",
  NOT_LEGION_OWNER: "NOT_LEGION_OWNER",
  UNKNOWN_LEGION: "UNKNOWN_LEGION",
  UNKNOWN_PLAYER: "UNKNOWN_PLAYER",
  BAD_PAYLOAD: "BAD_PAYLOAD",
  ILLEGAL_SPLIT: "ILLEGAL_SPLIT",
  MARKER_UNAVAILABLE: "MARKER_UNAVAILABLE",
  TOWER_UNAVAILABLE: "TOWER_UNAVAILABLE",
  COLOR_UNAVAILABLE: "COLOR_UNAVAILABLE",
  ALREADY_ROLLED: "ALREADY_ROLLED",
  NOTHING_TO_REROLL: "NOTHING_TO_REROLL",
  MULLIGAN_UNAVAILABLE: "MULLIGAN_UNAVAILABLE",
  MOVEMENT_NOT_ROLLED: "MOVEMENT_NOT_ROLLED",
  SPLIT_REQUIRED: "SPLIT_REQUIRED",
  ALREADY_MOVED: "ALREADY_MOVED",
  ILLEGAL_MOVE: "ILLEGAL_MOVE",
  MUST_MOVE: "MUST_MOVE",
  ALREADY_RECRUITED: "ALREADY_RECRUITED",
  RECRUIT_NOT_ELIGIBLE: "RECRUIT_NOT_ELIGIBLE",
  UNKNOWN_COMBATANT: "UNKNOWN_COMBATANT",
  ILLEGAL_STRIKE: "ILLEGAL_STRIKE",
  ILLEGAL_MANEUVER: "ILLEGAL_MANEUVER",
} as const;
export type ValidationCode =
  (typeof ValidationCode)[keyof typeof ValidationCode];

export interface ValidationFailure {
  readonly code: ValidationCode;
  readonly message: string;
}

export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: ValidationFailure };

export const valid: ValidationResult = Object.freeze({ ok: true });
export function invalid(code: ValidationCode, message: string): ValidationResult {
  return { ok: false, failure: { code, message } };
}

export class CommandValidationError extends Error {
  readonly failure: ValidationFailure;
  constructor(commandType: string, failure: ValidationFailure) {
    super(`${commandType} rejected [${failure.code}]: ${failure.message}`);
    this.name = "CommandValidationError";
    this.failure = failure;
  }
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface ExecutionResult {
  readonly state: GameState;
  readonly events: readonly DomainEvent[];
}

/**
 * Mutable working view used INSIDE execute() only. Containers (records and
 * top-level slots) are writable; the VALUE types stay the canonical readonly
 * shapes, so drafts write by wholesale replacement of entries — never by
 * mutating a value object in place.
 */
export interface Draft {
  gameId: string;
  fsm: FsmState;
  playerOrder: readonly PlayerId[];
  players: Record<PlayerId, PlayerState>;
  setup: SetupState | null;
  turn: TurnState;
  legions: Record<LegionId, LegionState>;
  caretaker: Record<CreatureName, number>;
  battle: BattleContext | null;
}

/**
 * Clone via JSON round-trip. GameState is plain JSON by contract (it is a
 * Postgres row); this clone is exact for such data AND fails loudly if
 * someone smuggles a non-JSON value (function, Map, undefined) into state.
 */
function cloneState(state: GameState): Draft {
  return JSON.parse(JSON.stringify(state)) as Draft;
}

export abstract class BaseCommand<P> {
  abstract readonly type: string;
  readonly playerId: PlayerId;
  readonly payload: P;

  constructor(playerId: PlayerId, payload: P) {
    this.playerId = playerId;
    this.payload = payload;
  }

  abstract validate(state: GameState): ValidationResult;

  /** Apply the command to the draft. Dice via rng only. Push events. */
  protected abstract apply(draft: Draft, rng: Rng, events: DomainEvent[]): void;

  /** Template method: re-validate, clone, apply. Never mutates `state`. */
  execute(state: GameState, rng: Rng): ExecutionResult {
    const v = this.validate(state);
    if (!v.ok) throw new CommandValidationError(this.type, v.failure);
    const draft = cloneState(state);
    const events: DomainEvent[] = [];
    this.apply(draft, rng, events);
    return { state: draft, events };
  }

  toDTO(): CommandDTO {
    return { type: this.type, playerId: this.playerId, payload: this.payload };
  }

  // ----- shared guards -----------------------------------------------------

  protected requireActivePlayer(state: GameState): ValidationResult {
    if (activePlayerId(state) !== this.playerId) {
      return invalid(
        ValidationCode.NOT_ACTIVE_PLAYER,
        `it is not ${this.playerId}'s turn`,
      );
    }
    return valid;
  }

  /**
   * Drive the FSM from inside apply(). Throws IllegalTransitionError if the
   * event is not legal — by construction unreachable after a passing
   * validate(), so a throw here is an engine bug, not a player error.
   */
  protected fireFsm(draft: Draft, events: DomainEvent[], fsmEvent: string): void {
    const from = draft.fsm.path;
    draft.fsm = transition(GAME_MACHINE, draft.fsm, fsmEvent);
    events.push({
      type: "PhaseChanged",
      audience: PUBLIC,
      fsmEvent,
      from,
      to: draft.fsm.path,
    });
  }
}

/** The minimal interface the registry and the edge function dispatch on. */
export type GameCommand = BaseCommand<unknown>;
