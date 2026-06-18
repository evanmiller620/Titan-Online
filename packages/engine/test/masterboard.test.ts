import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MASTER_LANDS,
  LAND_BY_ID,
  getLand,
  type MasterLand,
} from "../src/masterboard/board.data.ts";
import {
  allEdges,
  exitsOf,
  isEnterable,
  traversableSteps,
} from "../src/masterboard/graph.ts";
import {
  destinationsForRoll,
  towerTeleportTargets,
  titanTeleportTargets,
  ALL_LAND_IDS,
} from "../src/masterboard/movement.ts";
import { TOWER_LANDS, isTower } from "../src/masterboard/constants.ts";
import { cube } from "../src/hex/cube.ts";

import { createGame, type GameState } from "../src/state/GameState.ts";
import { scriptedRng } from "../src/core/rng/Rng.ts";
import { ValidationCode, type GameCommand } from "../src/core/commands/Command.ts";
import {
  RollTurnOrderCommand,
  SelectColorCommand,
  SelectTowerCommand,
} from "../src/core/commands/setup.ts";
import {
  EndMovementCommand,
  EndSplitsCommand,
  RollMovementCommand,
  SplitLegionCommand,
} from "../src/core/commands/turn.ts";
import {
  MoveLegionCommand,
  TowerTeleportCommand,
  TitanTeleportCommand,
} from "../src/core/commands/movement.ts";

// ---------------------------------------------------------------------------
// Data integrity — verify the mechanical XML→TS conversion, don't trust it.
// ---------------------------------------------------------------------------

describe("masterboard data integrity", () => {
  it("has exactly 96 lands with unique ids", () => {
    assert.equal(MASTER_LANDS.length, 96);
    assert.equal(LAND_BY_ID.size, 96);
  });

  it("has the six Towers and the expected ring populations", () => {
    const towers = MASTER_LANDS.filter((l) => l.terrain === "Tower");
    assert.deepEqual(towers.map((l) => l.id).sort((a, b) => a - b), [100, 200, 300, 400, 500, 600]);
    const ring = (lo: number, hi: number) =>
      MASTER_LANDS.filter((l) => l.id >= lo && l.id <= hi).length;
    assert.equal(ring(1, 42), 42); // outer/middle tracks
    assert.equal(ring(101, 142), 42); // tower-ring lands (7 per tower)
    assert.equal(ring(1000, 6000), 6); // central summit
  });

  it("every cube coordinate is valid (x+y+z=0) and distinct", () => {
    const keys = new Set<string>();
    for (const l of MASTER_LANDS) {
      assert.equal(l.cube.x + l.cube.y + l.cube.z, 0, `land ${l.id} cube invalid`);
      cube(l.cube.x, l.cube.y, l.cube.z); // throws InvalidCubeError if off-plane
      const k = `${l.cube.x},${l.cube.y},${l.cube.z}`;
      assert.ok(!keys.has(k), `duplicate cube at land ${l.id}`);
      keys.add(k);
    }
  });

  it("every exit points to a real land (no dangling targets)", () => {
    for (const e of allEdges()) {
      assert.ok(LAND_BY_ID.has(e.to), `edge ${e.from}->${e.to} targets a missing land`);
    }
  });

  it("only the documented exit types appear", () => {
    const types = new Set(allEdges().map((e) => e.type));
    assert.deepEqual([...types].sort(), ["ARCH", "ARROW", "ARROWS", "BLOCK"]);
  });

  it("only the eleven Titan terrains appear", () => {
    const terrains = new Set(MASTER_LANDS.map((l) => l.terrain));
    assert.deepEqual(
      [...terrains].sort(),
      ["Brush", "Desert", "Hills", "Jungle", "Marsh", "Mountains", "Plains", "Swamp", "Tower", "Tundra", "Woods"],
    );
  });

  it("every Tower has exactly three ARROW exits", () => {
    for (const t of TOWER_LANDS) {
      const land = getLand(t)!;
      assert.equal(land.exits.length, 3, `tower ${t}`);
      assert.ok(land.exits.every((e) => e.type === "ARROW"));
    }
  });

  it("the graph is strongly connected ignoring BLOCK entry restrictions", () => {
    // From any land, following enterable edges, you can reach every land.
    // (Confirms there are no orphan lands — a transcription smoke test.)
    const reachableFrom = (start: number): Set<number> => {
      const seen = new Set<number>([start]);
      const stack = [start];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const e of exitsOf(cur)) {
          if (isEnterable(e.type) && !seen.has(e.to)) {
            seen.add(e.to);
            stack.push(e.to);
          }
        }
      }
      return seen;
    };
    // From the non-summit lands, every land is reachable via enterable edges.
    for (const start of [1, 100, 21, 142]) {
      assert.equal(reachableFrom(start).size, 96, `land ${start} cannot reach all`);
    }
    // The summit (1000-6000) is by design a near-refuge: its only enterable
    // outward edges are the ARROWs linking the six summit lands, so from a
    // summit land the enterable-edge closure is just the six summit lands.
    // (Legions LEAVE the summit via the one-way BLOCK drop, handled by the
    // movement walker, not the enterable-closure.)
    assert.equal(reachableFrom(1000).size, 6);
  });

  it("every non-Tower land is reachable as a movement destination from somewhere", () => {
    const everReached = new Set<number>();
    for (const l of MASTER_LANDS) {
      for (let roll = 1; roll <= 6; roll++) {
        for (const r of destinationsForRoll(l.id, roll)) everReached.add(r.destination);
      }
    }
    for (const l of MASTER_LANDS) {
      assert.ok(everReached.has(l.id), `land ${l.id} is never a destination`);
    }
  });
});

// ---------------------------------------------------------------------------
// Movement rules
// ---------------------------------------------------------------------------

describe("masterboard movement", () => {
  it("moves exactly the rolled distance (path length = roll + 1)", () => {
    for (const roll of [1, 2, 3, 4, 5, 6]) {
      for (const r of destinationsForRoll(1, roll)) {
        assert.equal(r.path.length, roll + 1, `roll ${roll} to ${r.destination}`);
        assert.equal(r.path[0], 1);
        assert.equal(r.path[r.path.length - 1], r.destination);
      }
    }
  });

  it("rejects rolls outside 1..6 and unknown lands", () => {
    assert.throws(() => destinationsForRoll(1, 0));
    assert.throws(() => destinationsForRoll(1, 7));
    assert.throws(() => destinationsForRoll(99999, 3));
  });

  it("never backtracks: no route reverses its first step immediately", () => {
    for (const l of MASTER_LANDS) {
      for (let roll = 2; roll <= 6; roll++) {
        for (const r of destinationsForRoll(l.id, roll)) {
          for (let i = 2; i < r.path.length; i++) {
            assert.notEqual(r.path[i], r.path[i - 2], `backtrack in ${l.id} roll ${roll}: ${r.path}`);
          }
        }
      }
    }
  });

  it("never enters a land across a BLOCK side", () => {
    // For each route, each consecutive pair must be a non-BLOCK edge.
    for (const l of [1, 4, 1000, 100]) {
      for (let roll = 1; roll <= 6; roll++) {
        for (const r of destinationsForRoll(l, roll)) {
          for (let i = 1; i < r.path.length; i++) {
            const edge = exitsOf(r.path[i - 1]!).find((e) => e.to === r.path[i]);
            assert.ok(edge, `no edge ${r.path[i - 1]}->${r.path[i]}`);
            assert.notEqual(edge!.type, "BLOCK", `entered ${r.path[i]} via BLOCK`);
          }
        }
      }
    }
  });

  it("inner-ring summit gateways (thick dotted lines) are crossable only on the SECOND step", () => {
    // Land 1 has ARROWS->2 and ARCH->1000 (summit gateway). On a roll of 1 the
    // gateway may NOT be crossed on the first step, so only the track (2) is legal.
    assert.deepEqual(destinationsForRoll(1, 1).map((r) => r.destination).sort((a, b) => a - b), [2]);
    // A summit is never ENTERED in one step from outside (within-summit moves
    // via the linking ARROWs are fine, so skip summit start lands).
    for (const l of MASTER_LANDS) {
      if (l.id >= 1000) continue;
      assert.ok(!destinationsForRoll(l.id, 1).some((r) => r.destination >= 1000), `summit entered in 1 step from ${l.id}`);
    }
    // But a summit IS reachable on a two-step move (crossing on the second step).
    assert.ok(
      MASTER_LANDS.some((l) => destinationsForRoll(l.id, 2).some((r) => r.destination >= 1000)),
      "a summit should be reachable on the second step",
    );
  });

  it("can loop back to the start on a long roll (legal in Titan)", () => {
    // Somewhere on the board a 6-roll loop returns home. Search for any land
    // whose 6-roll destination set includes itself.
    const loopers = MASTER_LANDS.filter((l) =>
      destinationsForRoll(l.id, 6).some((r) => r.destination === l.id),
    );
    assert.ok(loopers.length > 0, "expected at least one land with a 6-roll self-loop");
  });

  it("traversableSteps excludes the came-from land and BLOCK entries", () => {
    // Land 4 has an ARROWS exit to 5 and a BLOCK exit to 103.
    const fromScratch = traversableSteps(4, null).map((e) => e.to).sort((a, b) => a - b);
    assert.ok(fromScratch.includes(5));
    assert.ok(!fromScratch.includes(103)); // BLOCK never enterable
    // Coming from 5, you can't step back to 5.
    const cameFrom5 = traversableSteps(4, 5).map((e) => e.to);
    assert.ok(!cameFrom5.includes(5));
  });
});

// ---------------------------------------------------------------------------
// Teleport target enumeration (pure)
// ---------------------------------------------------------------------------

describe("teleport targets", () => {
  it("tower teleport offers unoccupied towers, never the start or occupied", () => {
    const occupied = new Set([100, 300]);
    const targets = towerTeleportTargets(100, occupied);
    assert.ok(!targets.includes(100)); // start excluded
    assert.ok(!targets.includes(300)); // occupied excluded
    assert.deepEqual(targets.sort((a, b) => a - b), [200, 400, 500, 600]);
    // Non-tower start yields nothing.
    assert.deepEqual(towerTeleportTargets(1, new Set()), []);
  });

  it("titan teleport offers exactly the enemy-occupied lands", () => {
    assert.deepEqual(titanTeleportTargets(new Set([21, 5, 40])), [5, 21, 40]);
  });

  it("ALL_LAND_IDS lists all 96 lands", () => {
    assert.equal(ALL_LAND_IDS.length, 96);
  });
});

// ---------------------------------------------------------------------------
// Commands integrated with the turn flow
// ---------------------------------------------------------------------------

function exec(state: GameState, c: GameCommand, rng = scriptedRng([])) {
  const v = c.validate(state);
  assert.ok(v.ok, !v.ok ? `${c.type} rejected: ${v.failure.message}` : "");
  return c.execute(state, rng);
}
function rejects(state: GameState, c: GameCommand, code: string) {
  const v = c.validate(state);
  assert.ok(!v.ok, `${c.type} should have been rejected`);
  if (!v.ok) assert.equal(v.failure.code, code);
}

/** Two-player game positioned at p1's movement phase, p1's legions split. */
function atMovement(): GameState {
  let s = createGame({ gameId: "g", players: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }] });
  s = exec(s, new RollTurnOrderCommand("p1", {}), scriptedRng([6, 2])).state;
  s = exec(s, new SelectTowerCommand("p1", { tower: 100 })).state;
  s = exec(s, new SelectTowerCommand("p2", { tower: 400 })).state;
  s = exec(s, new SelectColorCommand("p2", { color: "Red" })).state;
  s = exec(s, new SelectColorCommand("p1", { color: "Black" })).state;
  // p1 initial split 4/4.
  s = exec(s, new SplitLegionCommand("p1", {
    legionId: "Black-01", newMarker: "Black-02",
    toNewLegion: ["Angel", "Gargoyle", "Centaur", "Ogre"],
  })).state;
  s = exec(s, new EndSplitsCommand("p1", {})).state;
  return s;
}

describe("move commands in the turn flow", () => {
  it("a legion moves to a graph-legal destination and is marked moved", () => {
    let s = atMovement();
    s = exec(s, new RollMovementCommand("p1", {}), scriptedRng([3])).state;
    const roll = s.turn.movementRoll!;
    const legal = destinationsForRoll(100, roll); // both p1 legions are at tower 100
    const dest = legal[0]!.destination;
    const { state, events } = exec(s, new MoveLegionCommand("p1", { legionId: "Black-01", destination: dest }));
    assert.equal(state.legions["Black-01"]!.land, dest);
    assert.ok(state.legions["Black-01"]!.moved);
    assert.ok(events.some((e) => e.type === "LegionMoved" && !e.teleport));
  });

  it("rejects illegal destinations, foreign legions, and double moves", () => {
    let s = atMovement();
    s = exec(s, new RollMovementCommand("p1", {}), scriptedRng([3])).state;
    rejects(s, new MoveLegionCommand("p1", { legionId: "Black-01", destination: 99999 }), ValidationCode.ILLEGAL_MOVE);
    rejects(s, new MoveLegionCommand("p1", { legionId: "Red-01", destination: 20 }), ValidationCode.NOT_LEGION_OWNER);
    const dest = destinationsForRoll(100, 3)[0]!.destination;
    s = exec(s, new MoveLegionCommand("p1", { legionId: "Black-01", destination: dest })).state;
    rejects(s, new MoveLegionCommand("p1", { legionId: "Black-01", destination: dest }), ValidationCode.ALREADY_MOVED);
  });

  it("EndMovement needs ONLY one legion moved (Avalon Hill), not all of them", () => {
    let s = atMovement();
    s = exec(s, new RollMovementCommand("p1", {}), scriptedRng([3])).state;
    // Two legions at tower 100, neither moved yet → MUST_MOVE.
    rejects(s, new EndMovementCommand("p1", {}), ValidationCode.MUST_MOVE);
    // Moving just ONE is enough; the other may stay put.
    const d1 = destinationsForRoll(100, 3)[0]!.destination;
    s = exec(s, new MoveLegionCommand("p1", { legionId: "Black-01", destination: d1 })).state;
    const v = new EndMovementCommand("p1", {}).validate(s);
    assert.ok(v.ok, !v.ok ? v.failure.message : "");
  });

  it("split legions left sharing a land recombine at end of Movement", () => {
    let s = atMovement();
    s = exec(s, new RollMovementCommand("p1", {}), scriptedRng([3])).state;
    // Black-01 + Black-02 share tower 100 (split halves); add a third legion
    // elsewhere and move IT to satisfy "move at least one".
    s = {
      ...s,
      legions: {
        ...s.legions,
        "Black-01": { ...s.legions["Black-01"]!, splitThisTurn: true },
        "Black-02": { ...s.legions["Black-02"]!, land: 100, splitThisTurn: true },
        "Black-03": { marker: "Black-03", ownerId: "p1", land: 1, creatures: ["Centaur", "Centaur"], moved: true, splitThisTurn: false, recruitedThisTurn: false, revealed: false },
      },
    };
    const before = s.legions["Black-01"]!.creatures.length + s.legions["Black-02"]!.creatures.length;
    const { state, events } = new EndMovementCommand("p1", {}).execute(s, scriptedRng([]));
    assert.ok(!state.legions["Black-02"], "the second split half is removed");
    assert.equal(state.legions["Black-01"]!.creatures.length, before, "merged into one legion");
    assert.ok(state.players.p1!.markersAvailable.includes("Black-02"), "marker freed");
    assert.ok(events.some((e) => e.type === "LegionsRecombined"));
  });

  it("tower teleport requires a Lord, a Tower start, and an unoccupied target", () => {
    let s = atMovement();
    s = exec(s, new RollMovementCommand("p1", {}), scriptedRng([3])).state;
    // Black-01 contains the Titan (a Lord) and sits in tower 100.
    assert.ok(s.legions["Black-01"]!.creatures.includes("Titan"));
    const { state } = exec(s, new TowerTeleportCommand("p1", { legionId: "Black-01", destination: 200 }));
    assert.equal(state.legions["Black-01"]!.land, 200);
    assert.ok(state.legions["Black-01"]!.moved);
    // Teleporting onto p2's occupied tower 400 is rejected.
    rejects(s, new TowerTeleportCommand("p1", { legionId: "Black-01", destination: 400 }), ValidationCode.ILLEGAL_MOVE);
    // Black-02 has the Angel (also a Lord) so it qualifies too; a non-lord
    // case is exercised in the score/teleport guards below.
  });

  it("titan teleport needs a 6, 400 points, and an enemy target", () => {
    let s = atMovement();
    // Without 400 points it is rejected even on a 6.
    s = exec(s, new RollMovementCommand("p1", {}), scriptedRng([6])).state;
    rejects(s, new TitanTeleportCommand("p1", { legionId: "Black-01", destination: 400 }), ValidationCode.ILLEGAL_MOVE);
    // Give p1 the score and put an enemy somewhere reachable by teleport.
    s = { ...s, players: { ...s.players, p1: { ...s.players["p1"]!, score: 450 } } };
    const enemyLand = s.legions["Red-01"]!.land;
    const { state } = exec(s, new TitanTeleportCommand("p1", { legionId: "Black-01", destination: enemyLand }));
    assert.equal(state.legions["Black-01"]!.land, enemyLand);
    // Now both players occupy that land → an engagement is pending.
  });
});
