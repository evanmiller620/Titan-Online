import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { GAME_MACHINE } from "../src/core/fsm/GameFSM.ts";
import { transition } from "../src/core/fsm/StateMachine.ts";
import { scriptedRng } from "../src/core/rng/Rng.ts";
import { SplitLegionCommand } from "../src/core/commands/turn.ts";
import { MIN_LEGION_HEIGHT } from "../src/creatures/names.ts";
import type { GameState } from "../src/state/GameState.ts";

/** Minimal state parked in Turn.Commencement on turn 2 with one p1 legion. */
function commencement(creatures: string[]): GameState {
  let fsm = GAME_MACHINE.initialState;
  for (const e of ["TURN_ORDER_DETERMINED", "TOWERS_SELECTED", "COLORS_SELECTED"]) {
    fsm = transition(GAME_MACHINE, fsm, e);
  }
  return {
    gameId: "g", fsm, playerOrder: ["p1", "p2"],
    players: {
      p1: { id: "p1", name: "A", color: "Black", tower: 100, score: 0, eliminated: false, markersAvailable: ["Black-02"] },
      p2: { id: "p2", name: "B", color: "Red", tower: 200, score: 0, eliminated: false, markersAvailable: ["Red-02"] },
    },
    setup: null,
    turn: { number: 2, activeIndex: 0, movementRoll: null, mulliganUsed: false, engagementLand: null },
    legions: {
      "Black-01": { marker: "Black-01", ownerId: "p1", land: 100, creatures, moved: false, splitThisTurn: false, recruitedThisTurn: false, revealed: false },
    },
    caretaker: {} as GameState["caretaker"],
    battle: null,
  };
}

describe("Avalon Hill legion size (2–7, single-counter only for a combat-reduced Titan)", () => {
  it("the minimum legal legion is two characters", () => {
    assert.equal(MIN_LEGION_HEIGHT, 2);
  });

  it("a split may not create a single-character legion", () => {
    const s = commencement(["Ogre", "Centaur", "Lion"]); // 3 → 1/2 is illegal
    const cmd = new SplitLegionCommand("p1", { legionId: "Black-01", newMarker: "Black-02", toNewLegion: ["Ogre"] });
    const v = cmd.validate(s);
    assert.ok(!v.ok && v.failure.code === "ILLEGAL_SPLIT");
  });

  it("a split into two legions of two or more is legal", () => {
    const s = commencement(["Ogre", "Centaur", "Lion", "Troll"]); // 4 → 2/2
    const cmd = new SplitLegionCommand("p1", { legionId: "Black-01", newMarker: "Black-02", toNewLegion: ["Ogre", "Centaur"] });
    const v = cmd.validate(s);
    assert.ok(v.ok, !v.ok ? v.failure.message : "");
    const after = cmd.execute(s, scriptedRng([])).state;
    assert.equal(after.legions["Black-01"]!.creatures.length, 2);
    assert.equal(after.legions["Black-02"]!.creatures.length, 2);
  });
});
