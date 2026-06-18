/**
 * Mustering command (Titan engine, module: core/commands).
 *
 *   MusterCommand   during the Mustering phase, a legion that moved (or split)
 *                   this turn and is below the 7-creature cap may recruit ONE
 *                   creature its terrain and contents permit, drawing it from
 *                   the shared caretaker pool.
 *
 * Eligibility rules enforced here (the rest of the chain math lives in
 * creatures/recruitment.ts):
 *  - phase is Mustering and the active player owns the legion;
 *  - the legion has not already recruited this turn;
 *  - the legion height is < 7 (a 7-high legion cannot recruit);
 *  - a legion that did NOT move this turn may not recruit (it must have
 *    entered the terrain this turn). Freshly split legions count as having
 *    "arrived" only if they then moved; an unmoved split half cannot recruit.
 *    (Classic rule: you recruit by MOVING into recruiting terrain.)
 *  - the target is offered by eligibleRecruits for the land's terrain;
 *  - the caretaker pool has the creature available.
 *
 * On success the recruited creature is added to the legion (its identity is
 * hidden from opponents) and the caretaker count decremented. A public
 * CreatureRecruited event carries the new height; an owner-scoped event
 * carries the creature identity.
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
import type { DomainEvent, LegionId } from "../events/DomainEvent.ts";
import { onlyPlayer, PUBLIC } from "../events/DomainEvent.ts";
import type { Rng } from "../rng/Rng.ts";
import { legionHeight } from "../../state/selectors.ts";
import { getLand } from "../../masterboard/board.data.ts";
import { MAX_LEGION_HEIGHT, type CreatureName } from "../../creatures/names.ts";
import { canRecruit, eligibleRecruits } from "../../creatures/recruitment.ts";

export interface MusterPayload {
  readonly legionId: LegionId;
  readonly creature: CreatureName;
}

export class MusterCommand extends BaseCommand<MusterPayload> {
  static readonly TYPE = "Muster";
  override readonly type = MusterCommand.TYPE;

  override validate(state: GameState): ValidationResult {
    if (!matches(state.fsm, Scope.Mustering)) {
      return invalid(ValidationCode.WRONG_PHASE, "recruiting happens during Mustering");
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
    if (legion.recruitedThisTurn) {
      return invalid(ValidationCode.ALREADY_RECRUITED, "that legion already recruited this turn");
    }
    if (!legion.moved) {
      return invalid(
        ValidationCode.RECRUIT_NOT_ELIGIBLE,
        "a legion recruits by moving into recruiting terrain; this one did not move",
      );
    }
    if (legionHeight(legion) >= MAX_LEGION_HEIGHT) {
      return invalid(
        ValidationCode.RECRUIT_NOT_ELIGIBLE,
        "a legion at the seven-creature cap cannot recruit",
      );
    }

    const land = getLand(legion.land);
    if (!land) {
      return invalid(ValidationCode.RECRUIT_NOT_ELIGIBLE, "legion is on an unknown land");
    }

    const containsOwnTitan = legion.creatures.includes("Titan");
    const ok = canRecruit(
      land.terrain,
      legion.creatures,
      this.payload.creature,
      state.caretaker,
      { containsOwnTitan },
    );
    if (!ok) {
      return invalid(
        ValidationCode.RECRUIT_NOT_ELIGIBLE,
        `${this.payload.creature} cannot be mustered here by this legion (or none left in the pool)`,
      );
    }
    return valid;
  }

  protected override apply(draft: Draft, _rng: Rng, events: DomainEvent[]): void {
    const legion = draft.legions[this.payload.legionId]!;
    const creature = this.payload.creature;

    draft.legions[this.payload.legionId] = {
      ...legion,
      creatures: [...legion.creatures, creature],
      recruitedThisTurn: true,
    };
    draft.caretaker[creature] = draft.caretaker[creature] - 1;

    // The prerequisite creatures the player must publicly REVEAL to justify the
    // recruit (e.g. two Centaurs to breed a Lion). Tower basics reveal nothing.
    const land = getLand(legion.land)!;
    const option = eligibleRecruits(
      land.terrain, legion.creatures, draft.caretaker,
      { containsOwnTitan: legion.creatures.includes("Titan") },
    ).find((o) => o.creature === creature);

    events.push({
      type: "CreatureRecruited",
      audience: PUBLIC,
      playerId: this.playerId,
      legionId: legion.marker,
      land: legion.land,
      newHeight: legion.creatures.length + 1,
      revealed: option ? [...option.via] : [],
    });
    events.push({
      type: "CreatureRecruitedDetail",
      audience: onlyPlayer(this.playerId),
      playerId: this.playerId,
      legionId: legion.marker,
      creature,
    });
  }
}
