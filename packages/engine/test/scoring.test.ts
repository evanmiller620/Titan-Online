import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createGame, type GameState } from "../src/state/GameState.ts";
import { awardScore } from "../src/core/commands/scoring.ts";
import type { DomainEvent } from "../src/core/events/DomainEvent.ts";

function stateWithLegion(creatures: string[]): GameState {
  const s = createGame({ gameId: "g", players: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }] });
  const draft = JSON.parse(JSON.stringify(s)) as GameState as unknown as {
    players: Record<string, { score: number }>;
    legions: Record<string, unknown>;
    caretaker: Record<string, number>;
  };
  draft.legions["Black-01"] = {
    marker: "Black-01", ownerId: "p1", land: 100, creatures, moved: false,
    splitThisTurn: false, recruitedThisTurn: false, revealed: false,
  };
  return draft as unknown as GameState;
}

describe("awardScore + acquisition (§7.5)", () => {
  it("grants an Angel into a legion when the score crosses 100", () => {
    const s = stateWithLegion(["Titan", "Ogre"]);
    const events: DomainEvent[] = [];
    const angelsBefore = s.caretaker.Angel;
    awardScore(s as never, "p1", 100, events);
    assert.equal(s.players.p1.score, 100);
    assert.ok(s.legions["Black-01"]!.creatures.includes("Angel"), "Angel added to the legion");
    assert.equal(s.caretaker.Angel, angelsBefore - 1, "drawn from the pool");
    assert.ok(events.some((e) => e.type === "CreatureAcquired" && e.creature === "Angel"));
  });

  it("grants nothing when no threshold is crossed", () => {
    const s = stateWithLegion(["Titan", "Ogre"]);
    const events: DomainEvent[] = [];
    awardScore(s as never, "p1", 50, events);
    assert.equal(s.players.p1.score, 50);
    assert.ok(!events.some((e) => e.type === "CreatureAcquired"));
  });

  it("grants an Angel per 100 and an Archangel at 500 (Avalon Hill), capped by legion room", () => {
    const s = stateWithLegion(["Titan"]); // 1 creature → room for 6 more (cap 7)
    const events: DomainEvent[] = [];
    awardScore(s as never, "p1", 600, events); // crosses 100,200,300,400,500,600
    const acquired = events.filter((e) => e.type === "CreatureAcquired").map((e) => (e as { creature: string }).creature);
    // Six multiples crossed, six slots free (1 Titan + 6 = 7): all placed.
    assert.equal(acquired.filter((c) => c === "Archangel").length, 1);
    assert.equal(acquired.filter((c) => c === "Angel").length, 5);
    assert.equal(s.legions["Black-01"]!.creatures.length, 7);
  });

  it("forfeits the acquisition if every legion is at the 7-cap (still scores)", () => {
    const s = stateWithLegion(["Titan", "Ogre", "Ogre", "Centaur", "Centaur", "Gargoyle", "Gargoyle"]); // 7
    const events: DomainEvent[] = [];
    const angelsBefore = s.caretaker.Angel;
    awardScore(s as never, "p1", 100, events);
    assert.equal(s.players.p1.score, 100);
    assert.equal(s.caretaker.Angel, angelsBefore, "pool untouched");
    assert.ok(!events.some((e) => e.type === "CreatureAcquired"));
  });
});
