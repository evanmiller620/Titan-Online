/**
 * Movement-phase legion commands (Titan engine, module: core/commands).
 *
 *   MoveLegionCommand      move a legion exactly the rolled distance to a
 *                          graph-legal destination
 *   TowerTeleportCommand   Lord-bearing legion teleports from its Tower to an
 *                          unoccupied Tower (begins-in-Tower rule)
 *   TitanTeleportCommand   power-10 Titan legion teleports onto an enemy on a
 *                          roll of 6
 *
 * Movement legality (exact distance, no backtracking, BLOCK entry) comes from
 * masterboard/movement.ts. These commands add the GAME-STATE checks that the
 * pure graph cannot know: ownership, that the legion hasn't already moved,
 * Lord/score/roll prerequisites for teleports, and Tower occupancy.
 *
 * Deferred (explicit): the "every legion that CAN move MUST move, and split
 * halves must separate" obligation is a turn-level rule checked at EndMovement
 * (movementObligationsMet, below) — individual moves stay optional here.
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
import { Scope } from "../fsm/GameFSM.ts";
import type { DomainEvent, LandId, LegionId } from "../events/DomainEvent.ts";
import { PUBLIC } from "../events/DomainEvent.ts";
import type { Rng } from "../rng/Rng.ts";
import { legionsAt, legionsOf } from "../../state/selectors.ts";
import {
  destinationsForRoll,
  titanTeleportTargets,
  towerTeleportTargets,
} from "../../masterboard/movement.ts";
import { isTower } from "../../masterboard/constants.ts";
import { LORDS } from "../../creatures/names.ts";

const TITAN_TELEPORT_SCORE = 400;

// ---------------------------------------------------------------------------

export interface MoveLegionPayload {
  readonly legionId: LegionId;
  readonly destination: LandId;
}

export class MoveLegionCommand extends BaseCommand<MoveLegionPayload> {
  static readonly TYPE = "MoveLegion";
  override readonly type = MoveLegionCommand.TYPE;

  override validate(state: GameState): ValidationResult {
    if (!matches(state.fsm, Scope.Movement)) {
      return invalid(ValidationCode.WRONG_PHASE, "legions move during Movement");
    }
    const active = this.requireActivePlayer(state);
    if (!active.ok) return active;

    if (state.turn.movementRoll === null) {
      return invalid(ValidationCode.MOVEMENT_NOT_ROLLED, "roll movement first");
    }
    const legion = state.legions[this.payload.legionId];
    if (!legion) {
      return invalid(ValidationCode.UNKNOWN_LEGION, `no legion "${this.payload.legionId}"`);
    }
    if (legion.ownerId !== this.playerId) {
      return invalid(ValidationCode.NOT_LEGION_OWNER, "that legion is not yours");
    }
    if (legion.moved) {
      return invalid(ValidationCode.ALREADY_MOVED, "that legion has already moved this turn");
    }

    // Lands held by an enemy legion — a moving legion may END on one (engaging)
    // but may not pass THROUGH it (Law of Titan).
    const enemyLands = enemyOccupiedLands(state, this.playerId);
    const routes = destinationsForRoll(legion.land, state.turn.movementRoll, (land) => enemyLands.has(land));
    const legal = routes.some((r) => r.destination === this.payload.destination);
    if (!legal) {
      return invalid(
        ValidationCode.ILLEGAL_MOVE,
        `${this.payload.destination} is not reachable from ${legion.land} in ${state.turn.movementRoll} (you may not move through an enemy legion)`,
      );
    }

    // A legion may not land on a friendly legion (own stacks never co-occupy
    // except transiently during split, which happens in Commencement).
    const friendlyThere = legionsAt(state, this.payload.destination).some(
      (l) => l.ownerId === this.playerId && l.marker !== legion.marker,
    );
    if (friendlyThere) {
      return invalid(
        ValidationCode.ILLEGAL_MOVE,
        "a legion may not move onto another of your own legions",
      );
    }
    return valid;
  }

  protected override apply(draft: Draft, _rng: Rng, events: DomainEvent[]): void {
    const legion = draft.legions[this.payload.legionId]!;
    const from = legion.land;
    draft.legions[this.payload.legionId] = {
      ...legion,
      land: this.payload.destination,
      moved: true,
    };
    events.push({
      type: "LegionMoved",
      audience: PUBLIC,
      playerId: this.playerId,
      legionId: legion.marker,
      from,
      to: this.payload.destination,
      teleport: false,
    });
  }
}

// ---------------------------------------------------------------------------

export interface TowerTeleportPayload {
  readonly legionId: LegionId;
  readonly destination: LandId;
}

export class TowerTeleportCommand extends BaseCommand<TowerTeleportPayload> {
  static readonly TYPE = "TowerTeleport";
  override readonly type = TowerTeleportCommand.TYPE;

  override validate(state: GameState): ValidationResult {
    if (!matches(state.fsm, Scope.Movement)) {
      return invalid(ValidationCode.WRONG_PHASE, "teleport happens during Movement");
    }
    const active = this.requireActivePlayer(state);
    if (!active.ok) return active;
    if (state.turn.movementRoll === null) {
      return invalid(ValidationCode.MOVEMENT_NOT_ROLLED, "roll movement first");
    }
    const legion = state.legions[this.payload.legionId];
    if (!legion) {
      return invalid(ValidationCode.UNKNOWN_LEGION, `no legion "${this.payload.legionId}"`);
    }
    if (legion.ownerId !== this.playerId) {
      return invalid(ValidationCode.NOT_LEGION_OWNER, "that legion is not yours");
    }
    if (legion.moved) {
      return invalid(ValidationCode.ALREADY_MOVED, "that legion has already moved");
    }
    if (!isTower(legion.land)) {
      return invalid(ValidationCode.ILLEGAL_MOVE, "tower teleport requires starting in a Tower");
    }
    if (!legion.creatures.some((c) => LORDS.has(c))) {
      return invalid(ValidationCode.ILLEGAL_MOVE, "tower teleport requires a Lord in the legion");
    }
    const occupied = occupiedTowers(state);
    const targets = towerTeleportTargets(legion.land, occupied);
    if (!targets.includes(this.payload.destination)) {
      return invalid(ValidationCode.ILLEGAL_MOVE, `cannot tower-teleport to ${this.payload.destination}`);
    }
    return valid;
  }

  protected override apply(draft: Draft, _rng: Rng, events: DomainEvent[]): void {
    const legion = draft.legions[this.payload.legionId]!;
    const from = legion.land;
    draft.legions[this.payload.legionId] = {
      ...legion,
      land: this.payload.destination,
      moved: true,
    };
    events.push({
      type: "LegionMoved",
      audience: PUBLIC,
      playerId: this.playerId,
      legionId: legion.marker,
      from,
      to: this.payload.destination,
      teleport: true,
    });
  }
}

// ---------------------------------------------------------------------------

export interface TitanTeleportPayload {
  readonly legionId: LegionId;
  readonly destination: LandId;
}

export class TitanTeleportCommand extends BaseCommand<TitanTeleportPayload> {
  static readonly TYPE = "TitanTeleport";
  override readonly type = TitanTeleportCommand.TYPE;

  override validate(state: GameState): ValidationResult {
    if (!matches(state.fsm, Scope.Movement)) {
      return invalid(ValidationCode.WRONG_PHASE, "teleport happens during Movement");
    }
    const active = this.requireActivePlayer(state);
    if (!active.ok) return active;
    if (state.turn.movementRoll !== 6) {
      return invalid(ValidationCode.ILLEGAL_MOVE, "Titan teleport requires a roll of 6");
    }
    const player = state.players[this.playerId]!;
    if (player.score < TITAN_TELEPORT_SCORE) {
      return invalid(ValidationCode.ILLEGAL_MOVE, "Titan teleport requires 400+ points");
    }
    const legion = state.legions[this.payload.legionId];
    if (!legion) {
      return invalid(ValidationCode.UNKNOWN_LEGION, `no legion "${this.payload.legionId}"`);
    }
    if (legion.ownerId !== this.playerId) {
      return invalid(ValidationCode.NOT_LEGION_OWNER, "that legion is not yours");
    }
    if (legion.moved) {
      return invalid(ValidationCode.ALREADY_MOVED, "that legion has already moved");
    }
    if (!legion.creatures.includes("Titan")) {
      return invalid(ValidationCode.ILLEGAL_MOVE, "only the Titan's legion may Titan-teleport");
    }
    const enemyLands = enemyOccupiedLands(state, this.playerId);
    if (!titanTeleportTargets(enemyLands).includes(this.payload.destination)) {
      return invalid(ValidationCode.ILLEGAL_MOVE, "destination has no enemy legion to attack");
    }
    return valid;
  }

  protected override apply(draft: Draft, _rng: Rng, events: DomainEvent[]): void {
    const legion = draft.legions[this.payload.legionId]!;
    const from = legion.land;
    draft.legions[this.payload.legionId] = {
      ...legion,
      land: this.payload.destination,
      moved: true,
    };
    events.push({
      type: "LegionMoved",
      audience: PUBLIC,
      playerId: this.playerId,
      legionId: legion.marker,
      from,
      to: this.payload.destination,
      teleport: true,
    });
  }
}

// ---------------------------------------------------------------------------
// Shared helpers (also used by EndMovement's obligation check)
// ---------------------------------------------------------------------------

export function occupiedTowers(state: GameState): Set<LandId> {
  const set = new Set<LandId>();
  for (const l of Object.values(state.legions)) {
    if (isTower(l.land)) set.add(l.land);
  }
  return set;
}

export function enemyOccupiedLands(state: GameState, playerId: string): Set<LandId> {
  const set = new Set<LandId>();
  for (const l of Object.values(state.legions)) {
    if (l.ownerId !== playerId) set.add(l.land);
  }
  return set;
}

/**
 * Turn-level movement obligation: every legion that CAN reach at least one
 * legal destination MUST have moved. Returns the marker of the first legion
 * still owing a move, or null if all obligations are met. Used by
 * EndMovementCommand. (Split-halves-must-separate is a stricter rule layered
 * later; this covers the core "you must move if you can".)
 */
export function unmovedButAble(state: GameState): LegionId | null {
  if (state.turn.movementRoll === null) return null;
  for (const legion of legionsOf(state, activeId(state))) {
    if (legion.moved) continue;
    const enemyLands = enemyOccupiedLands(state, legion.ownerId);
    const routes = destinationsForRoll(legion.land, state.turn.movementRoll, (land) => enemyLands.has(land));
    // A legion can satisfy its obligation by ordinary move if any destination
    // is free of friendly legions.
    const canMove = routes.some(
      (r) =>
        !legionsAt(state, r.destination).some(
          (l) => l.ownerId === legion.ownerId && l.marker !== legion.marker,
        ),
    );
    if (canMove) return legion.marker;
  }
  return null;
}

function activeId(state: GameState): string {
  return state.playerOrder[state.turn.activeIndex]!;
}
