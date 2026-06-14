import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createGame, type GameState } from "../src/state/GameState.ts";
import { scriptedRng } from "../src/core/rng/Rng.ts";
import type { GameCommand } from "../src/core/commands/Command.ts";
import { RollTurnOrderCommand, SelectColorCommand, SelectTowerCommand } from "../src/core/commands/setup.ts";
import { EndMovementCommand, EndSplitsCommand, EndTurnCommand, RollMovementCommand, SplitLegionCommand } from "../src/core/commands/turn.ts";
import { MoveLegionCommand } from "../src/core/commands/movement.ts";
import { SelectEngagementCommand, ResolveEngagementCommand } from "../src/core/commands/engagement.ts";
import { legionsOf, pendingEngagements } from "../src/state/selectors.ts";
import { destinationsForRoll } from "../src/masterboard/movement.ts";
import { MAX_LEGION_HEIGHT } from "../src/creatures/names.ts";

// ---------------------------------------------------------------------------
// A driver that plays whole turns through the REAL command pipeline, asserting
// the loop never soft-locks and core invariants hold at every step.
// ---------------------------------------------------------------------------

function exec(s: GameState, c: GameCommand, rng = scriptedRng([])): GameState {
  const v = c.validate(s);
  assert.ok(v.ok, !v.ok ? `${c.type} rejected: ${v.failure.message}` : "");
  const { state } = c.execute(s, rng);
  invariants(state, c.type);
  return state;
}

function invariants(s: GameState, after: string): void {
  // Caretaker pool is never negative.
  for (const [name, n] of Object.entries(s.caretaker)) assert.ok(n >= 0, `caretaker ${name}<0 after ${after}`);
  // No legion exceeds the cap outside the turn-1 pre-split.
  for (const l of Object.values(s.legions)) {
    const cap = s.turn.number <= 1 ? 8 : MAX_LEGION_HEIGHT; // 8 allowed in setup + turn-1 pre-split
    assert.ok(l.creatures.length <= cap, `legion ${l.marker} height ${l.creatures.length} after ${after}`);
  }
  // Scores never go negative; the FSM is always on a known leaf.
  for (const p of Object.values(s.players)) assert.ok(p.score >= 0, "negative score");
  assert.ok(s.fsm.path.length > 0, "empty fsm path");
}

function setup2(): GameState {
  let s = createGame({ gameId: "g", players: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }] });
  s = exec(s, new RollTurnOrderCommand("p1", {}), scriptedRng([6, 2])); // order p1, p2
  s = exec(s, new SelectTowerCommand(s.setup!.order[s.setup!.towerPickIndex]!, { tower: 100 }));
  s = exec(s, new SelectTowerCommand(s.setup!.order[s.setup!.towerPickIndex]!, { tower: 400 }));
  s = exec(s, new SelectColorCommand(s.setup!.order[s.setup!.colorPickIndex]!, { color: "Red" }));
  s = exec(s, new SelectColorCommand(s.setup!.order[s.setup!.colorPickIndex]!, { color: "Black" }));
  return s;
}

/** Move every owned legion that still has a friendly-free destination. */
function moveAll(s: GameState, me: string, roll: number): GameState {
  for (const legion of legionsOf(s, me)) {
    if (legion.moved) continue;
    const dest = destinationsForRoll(legion.land, roll)
      .map((d) => d.destination)
      .find((d) => !legionsOf(s, me).some((l) => l.land === d && l.marker !== legion.marker));
    if (dest !== undefined) s = exec(s, new MoveLegionCommand(me, { legionId: legion.marker, destination: dest }));
  }
  return s;
}

function playTurn(s: GameState): GameState {
  const me = s.playerOrder[s.turn.activeIndex]!;

  // Commencement — the mandatory turn-1 split, then close the phase.
  if (s.turn.number === 1) {
    const leg = legionsOf(s, me).find((l) => l.creatures.length === 8)!;
    const others = leg.creatures.filter((c) => c !== "Titan" && c !== "Angel");
    const child = ["Angel", others[0]!, others[1]!, others[2]!] as typeof leg.creatures;
    const marker = s.players[me]!.markersAvailable[0]!;
    s = exec(s, new SplitLegionCommand(me, { legionId: leg.marker, newMarker: marker, toNewLegion: child }));
  }
  s = exec(s, new EndSplitsCommand(me, {}));

  // Movement — roll, then move everything that can.
  s = exec(s, new RollMovementCommand(me, {}), scriptedRng([3]));
  s = moveAll(s, me, 3);
  s = exec(s, new EndMovementCommand(me, {}));

  // Engagement — resolve any clash by a negotiated settlement (no concessions).
  while (s.fsm.path.endsWith("Engagement.Choosing") && pendingEngagements(s).length > 0) {
    const land = pendingEngagements(s)[0]!;
    s = exec(s, new SelectEngagementCommand(me, { land }));
    s = exec(s, new ResolveEngagementCommand(me, { outcome: "settle", attackerShare: 1 }));
  }

  // Mustering — close the turn.
  assert.ok(s.fsm.path.endsWith("Mustering") || s.fsm.path === "GameOver", `expected Mustering, got ${s.fsm.path}`);
  if (s.fsm.path.endsWith("Mustering")) s = exec(s, new EndTurnCommand(me, {}));
  return s;
}

describe("full gameplay loop (real command pipeline)", () => {
  it("completes setup and lands in Turn 1 Commencement for the first player", () => {
    const s = setup2();
    assert.equal(s.fsm.path, "Turn.Commencement");
    assert.equal(s.turn.number, 1);
    assert.equal(s.playerOrder[s.turn.activeIndex], "p1");
    // Each player has exactly their starting eight-stack.
    for (const pid of ["p1", "p2"]) {
      const legs = legionsOf(s, pid);
      assert.equal(legs.length, 1);
      assert.equal(legs[0]!.creatures.length, 8);
    }
  });

  it("plays whole turns and rotates the active player without soft-locking", () => {
    let s = setup2();
    s = playTurn(s); // p1's turn 1
    assert.equal(s.playerOrder[s.turn.activeIndex], "p2", "rotated to p2");
    assert.equal(s.turn.number, 1);
    assert.ok(s.fsm.path === "Turn.Commencement");

    s = playTurn(s); // p2's turn 1 → wraps to turn 2
    assert.equal(s.playerOrder[s.turn.activeIndex], "p1", "wrapped back to p1");
    assert.equal(s.turn.number, 2);

    // A few more turns to be sure the loop is stable.
    for (let i = 0; i < 4; i++) s = playTurn(s);
    assert.ok(s.turn.number >= 3, `advanced to turn ${s.turn.number}`);
  });

  it("each player split their eight-stack into two legions on turn 1", () => {
    let s = setup2();
    s = playTurn(s);
    assert.equal(legionsOf(s, "p1").length, 2, "p1 split into two legions");
  });
});
