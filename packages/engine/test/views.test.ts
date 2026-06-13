import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createGame, type GameState } from "../src/state/GameState.ts";
import { viewFor, publicState, contentsVisible } from "../src/state/views.ts";
import { scriptedRng } from "../src/core/rng/Rng.ts";
import type { GameCommand } from "../src/core/commands/Command.ts";
import {
  RollTurnOrderCommand,
  SelectColorCommand,
  SelectTowerCommand,
} from "../src/core/commands/setup.ts";

function exec(state: GameState, c: GameCommand, rng = scriptedRng([])) {
  const v = c.validate(state);
  assert.ok(v.ok, !v.ok ? `${c.type} rejected: ${v.failure.message}` : "");
  return c.execute(state, rng);
}

/** A 2-player game past setup: p1 and p2 each have a starting legion. */
function startedGame(): GameState {
  let s = createGame({ gameId: "g", players: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }] });
  s = exec(s, new RollTurnOrderCommand("p1", {}), scriptedRng([6, 2])).state;
  s = exec(s, new SelectTowerCommand("p1", { tower: 100 })).state;
  s = exec(s, new SelectTowerCommand("p2", { tower: 400 })).state;
  s = exec(s, new SelectColorCommand("p2", { color: "Red" })).state;
  s = exec(s, new SelectColorCommand("p1", { color: "Black" })).state;
  return s;
}

describe("state redaction (RLS mirror)", () => {
  it("an owner sees their own legion's contents", () => {
    const s = startedGame();
    const v = viewFor(s, "p1");
    assert.ok(contentsVisible(v, "Black-01"));
    assert.deepEqual(
      [...v.legions["Black-01"]!.creatures!].sort(),
      [...s.legions["Black-01"]!.creatures].sort(),
    );
  });

  it("an opponent never sees contents but always sees height", () => {
    const s = startedGame();
    const v = viewFor(s, "p2"); // p2 looking at p1's legion
    assert.ok(!contentsVisible(v, "Black-01"), "opponent must not see contents");
    assert.equal(v.legions["Black-01"]!.creatures, undefined);
    assert.equal(v.legions["Black-01"]!.height, 8); // height is public
    assert.equal(v.legions["Black-01"]!.ownerId, "p1");
  });

  it("the public (spectator) view hides every legion's contents", () => {
    const s = startedGame();
    const pub = publicState(s);
    for (const marker of Object.keys(s.legions)) {
      assert.ok(!contentsVisible(pub, marker), `${marker} leaked in public view`);
      assert.equal(pub.legions[marker]!.height, s.legions[marker]!.creatures.length);
    }
  });

  it("a revealed legion's contents become visible to everyone", () => {
    let s = startedGame();
    // Force a reveal on p1's legion (an engagement would do this in play).
    s = {
      ...s,
      legions: {
        ...s.legions,
        "Black-01": { ...s.legions["Black-01"]!, revealed: true },
      },
    };
    const opp = viewFor(s, "p2");
    const pub = publicState(s);
    assert.ok(contentsVisible(opp, "Black-01"), "revealed legion visible to opponent");
    assert.ok(contentsVisible(pub, "Black-01"), "revealed legion visible publicly");
    assert.ok(opp.revealedMarkers.includes("Black-01"));
  });

  it("battling legions are treated as revealed to both sides", () => {
    let s = startedGame();
    s = {
      ...s,
      battle: {
        land: 1, terrain: "Plains",
        attackerLegion: "Black-01", defenderLegion: "Red-01",
        attackerPlayerId: "p1", defenderPlayerId: "p2",
        attackerSide: "BOTTOM", round: 1, activeSide: "defender",
        summonUsed: false, firstKillHappened: false, reinforcementUsed: false,
        combatants: [],
      },
    };
    const pub = publicState(s);
    assert.ok(pub.revealedMarkers.includes("Black-01"));
    assert.ok(pub.revealedMarkers.includes("Red-01"));
    assert.ok(contentsVisible(pub, "Black-01") && contentsVisible(pub, "Red-01"));
  });

  it("redaction never mutates the input state", () => {
    const s = startedGame();
    const snapshot = JSON.stringify(s);
    viewFor(s, "p2");
    publicState(s);
    assert.equal(JSON.stringify(s), snapshot);
  });

  it("the public view preserves non-secret state verbatim", () => {
    const s = startedGame();
    const pub = publicState(s);
    assert.equal(pub.fsm.path, s.fsm.path);
    assert.deepEqual(pub.playerOrder, s.playerOrder);
    assert.equal(pub.turn.number, s.turn.number);
    assert.deepEqual(pub.caretaker, s.caretaker);
  });
});

describe("persistence round-trip logic (load reconstructs what publicState strips)", () => {
  // Simulates the Edge Function's loadGameState marshalling WITHOUT a database:
  // publicState() strips contents; reattaching from a contents map (the
  // legion_contents rows) must reproduce the original legions exactly.
  it("reattaching legion_contents rebuilds the authoritative legions", () => {
    const s = startedGame();
    const pub = publicState(s);

    // Build the "legion_contents rows" the way persist() would.
    const contentRows: Array<{ marker: string; slot_index: number; creature: string }> = [];
    for (const l of Object.values(s.legions)) {
      l.creatures.forEach((creature, slot_index) =>
        contentRows.push({ marker: l.marker, slot_index, creature }),
      );
    }

    // Reattach exactly as loadGameState does.
    const byMarker = new Map<string, string[]>();
    for (const row of contentRows) {
      const arr = byMarker.get(row.marker) ?? [];
      arr[row.slot_index] = row.creature;
      byMarker.set(row.marker, arr);
    }
    const rebuilt: Record<string, unknown> = {};
    for (const [marker, legion] of Object.entries(pub.legions)) {
      rebuilt[marker] = {
        marker: legion.marker,
        ownerId: legion.ownerId,
        land: legion.land,
        moved: legion.moved,
        splitThisTurn: legion.splitThisTurn,
        recruitedThisTurn: legion.recruitedThisTurn,
        revealed: legion.revealed,
        creatures: (byMarker.get(marker) ?? []).filter((c) => c !== undefined),
      };
    }

    // The rebuilt creatures must match the originals exactly.
    for (const marker of Object.keys(s.legions)) {
      assert.deepEqual(
        [...(rebuilt[marker] as { creatures: string[] }).creatures].sort(),
        [...s.legions[marker]!.creatures].sort(),
        `legion ${marker} contents mismatch after round-trip`,
      );
    }
  });
});
