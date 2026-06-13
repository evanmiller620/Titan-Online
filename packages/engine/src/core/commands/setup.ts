/**
 * Setup commands (Titan engine, module: core/commands).
 *
 *   RollTurnOrderCommand   one roll-off resolving the full order; ties are
 *                          re-rolled recursively among the tied players
 *   SelectTowerCommand     towers picked in DESCENDING roll order
 *   SelectColorCommand     colors picked in ASCENDING roll order (the last
 *                          mover chooses first); picking a color also deals
 *                          the player's 12 markers and musters the fixed
 *                          8-creature starting legion at their tower
 *
 * v1 simplification, on the record: the starting legion automatically takes
 * the player's marker 01 rather than offering a pictogram choice. Cosmetic;
 * revisit if players care.
 */

import {
  BaseCommand,
  invalid,
  valid,
  ValidationCode,
  type Draft,
  type ValidationResult,
} from "./Command.ts";
import type { GameState, PlayerColor } from "../../state/GameState.ts";
import { PLAYER_COLORS, markerIdsFor } from "../../state/GameState.ts";
import { matches } from "../fsm/StateMachine.ts";
import { GameEvent } from "../fsm/GameFSM.ts";
import type { DomainEvent, LandId, PlayerId } from "../events/DomainEvent.ts";
import { PUBLIC } from "../events/DomainEvent.ts";
import type { Rng } from "../rng/Rng.ts";
import { claimedTowers } from "../../state/selectors.ts";
import { isTower } from "../../masterboard/constants.ts";
import { INITIAL_LEGION } from "../../creatures/names.ts";

// ---------------------------------------------------------------------------

export class RollTurnOrderCommand extends BaseCommand<Record<string, never>> {
  static readonly TYPE = "RollTurnOrder";
  override readonly type = RollTurnOrderCommand.TYPE;

  override validate(state: GameState): ValidationResult {
    if (!matches(state.fsm, "Setup.RollingForOrder")) {
      return invalid(ValidationCode.WRONG_PHASE, "turn order has already been rolled");
    }
    if (!(this.playerId in state.players)) {
      return invalid(ValidationCode.UNKNOWN_PLAYER, `no player "${this.playerId}"`);
    }
    return valid;
  }

  protected override apply(draft: Draft, rng: Rng, events: DomainEvent[]): void {
    const rounds: Array<Record<PlayerId, number>> = [];

    /** Order `ids` by descending d6 rolls, re-rolling ties recursively. */
    const order = (ids: readonly PlayerId[]): PlayerId[] => {
      if (ids.length <= 1) return ids.slice();
      const round: Record<PlayerId, number> = {};
      for (const id of ids) round[id] = rng.d6();
      rounds.push(round);
      const byRoll = new Map<number, PlayerId[]>();
      for (const id of ids) {
        const r = round[id]!;
        const group = byRoll.get(r) ?? [];
        group.push(id);
        byRoll.set(r, group);
      }
      const out: PlayerId[] = [];
      for (const roll of [...byRoll.keys()].sort((a, b) => b - a)) {
        out.push(...order(byRoll.get(roll)!)); // tied groups re-roll among themselves
      }
      return out;
    };

    const finalOrder = order(Object.keys(draft.players));
    draft.playerOrder = finalOrder;
    draft.setup = { order: finalOrder, towerPickIndex: 0, colorPickIndex: finalOrder.length - 1 };

    events.push({
      type: "TurnOrderRolled",
      audience: PUBLIC,
      rounds,
      order: finalOrder,
    });
    this.fireFsm(draft, events, GameEvent.TURN_ORDER_DETERMINED);
  }
}

// ---------------------------------------------------------------------------

export interface SelectTowerPayload {
  readonly tower: LandId;
}

export class SelectTowerCommand extends BaseCommand<SelectTowerPayload> {
  static readonly TYPE = "SelectTower";
  override readonly type = SelectTowerCommand.TYPE;

  override validate(state: GameState): ValidationResult {
    if (!matches(state.fsm, "Setup.TowerSelection")) {
      return invalid(ValidationCode.WRONG_PHASE, "not in tower selection");
    }
    const setup = state.setup!;
    const picker = setup.order[setup.towerPickIndex];
    if (picker !== this.playerId) {
      return invalid(
        ValidationCode.NOT_YOUR_TURN_TO_PICK,
        `it is ${picker}'s pick (descending roll order)`,
      );
    }
    if (!isTower(this.payload.tower)) {
      return invalid(ValidationCode.BAD_PAYLOAD, `land ${this.payload.tower} is not a Tower`);
    }
    if (claimedTowers(state).has(this.payload.tower)) {
      return invalid(ValidationCode.TOWER_UNAVAILABLE, `Tower ${this.payload.tower} is taken`);
    }
    return valid;
  }

  protected override apply(draft: Draft, _rng: Rng, events: DomainEvent[]): void {
    const player = draft.players[this.playerId]!;
    draft.players[this.playerId] = { ...player, tower: this.payload.tower };
    events.push({
      type: "TowerSelected",
      audience: PUBLIC,
      playerId: this.playerId,
      land: this.payload.tower,
    });

    const setup = draft.setup!;
    draft.setup = { ...setup, towerPickIndex: setup.towerPickIndex + 1 };
    if (draft.setup.towerPickIndex >= setup.order.length) {
      this.fireFsm(draft, events, GameEvent.TOWERS_SELECTED);
    }
  }
}

// ---------------------------------------------------------------------------

export interface SelectColorPayload {
  readonly color: PlayerColor;
}

export class SelectColorCommand extends BaseCommand<SelectColorPayload> {
  static readonly TYPE = "SelectColor";
  override readonly type = SelectColorCommand.TYPE;

  override validate(state: GameState): ValidationResult {
    if (!matches(state.fsm, "Setup.ColorSelection")) {
      return invalid(ValidationCode.WRONG_PHASE, "not in color selection");
    }
    const setup = state.setup!;
    const picker = setup.order[setup.colorPickIndex];
    if (picker !== this.playerId) {
      return invalid(
        ValidationCode.NOT_YOUR_TURN_TO_PICK,
        `it is ${picker}'s pick (ascending roll order)`,
      );
    }
    if (!PLAYER_COLORS.includes(this.payload.color)) {
      return invalid(ValidationCode.BAD_PAYLOAD, `"${this.payload.color}" is not a Titan color`);
    }
    const taken = Object.values(state.players).some((p) => p.color === this.payload.color);
    if (taken) {
      return invalid(ValidationCode.COLOR_UNAVAILABLE, `${this.payload.color} is taken`);
    }
    return valid;
  }

  protected override apply(draft: Draft, _rng: Rng, events: DomainEvent[]): void {
    const color = this.payload.color;
    const markers = markerIdsFor(color);
    const initialMarker = markers[0]!;
    const player = draft.players[this.playerId]!;
    const tower = player.tower!;

    draft.players[this.playerId] = {
      ...player,
      color,
      markersAvailable: markers.slice(1),
    };

    // Muster the fixed starting eight at the player's tower.
    draft.legions[initialMarker] = {
      marker: initialMarker,
      ownerId: this.playerId,
      land: tower,
      creatures: [...INITIAL_LEGION],
      moved: false,
      splitThisTurn: false,
      recruitedThisTurn: false,
    };
    for (const c of INITIAL_LEGION) {
      draft.caretaker[c] = draft.caretaker[c] - 1;
    }

    events.push({
      type: "ColorSelected",
      audience: PUBLIC,
      playerId: this.playerId,
      color,
    });
    events.push({
      type: "InitialLegionMustered",
      audience: PUBLIC, // the starting composition is public knowledge
      playerId: this.playerId,
      legionId: initialMarker,
      land: tower,
      creatures: [...INITIAL_LEGION],
    });

    const setup = draft.setup!;
    draft.setup = { ...setup, colorPickIndex: setup.colorPickIndex - 1 };
    if (draft.setup.colorPickIndex < 0) {
      draft.setup = null;
      draft.turn = { number: 1, activeIndex: 0, movementRoll: null, mulliganUsed: false };
      this.fireFsm(draft, events, GameEvent.COLORS_SELECTED);
    }
  }
}
