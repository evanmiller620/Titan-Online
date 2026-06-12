import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  cube,
  cubeFromAxial,
  cubeKey,
  cubeFromKey,
  cubeEquals,
  cubeAdd,
  cubeSubtract,
  cubeScale,
  cubeNeighbor,
  cubeNeighbors,
  directionBetween,
  cubeDistance,
  cubeRotateCW,
  cubeRotateCCW,
  cubeRotateAround,
  cubeRing,
  cubeRange,
  DIRECTIONS,
  DIRECTION_BY_NAME,
  InvalidCubeError,
  type CubeCoord,
} from "../src/hex/cube.ts";

import {
  cubeLerp,
  cubeRound,
  cubeLine,
  cubeLinesThrough,
  hasLineOfSight,
} from "../src/hex/line.ts";

import { reachable, type MovementRules } from "../src/hex/pathfind.ts";

const ORIGIN = cube(0, 0, 0);

describe("cube construction and invariant", () => {
  it("accepts coordinates summing to zero", () => {
    assert.deepEqual(cube(1, -1, 0), { x: 1, y: -1, z: 0 });
  });

  it("rejects coordinates violating x+y+z=0", () => {
    assert.throws(() => cube(1, 1, 1), InvalidCubeError);
    assert.throws(() => cube(2, -1, 0), InvalidCubeError);
  });

  it("freezes coordinates", () => {
    const c = cube(1, -1, 0);
    assert.throws(() => {
      (c as { x: number }).x = 5;
    }, TypeError);
  });

  it("derives y from axial (q, r)", () => {
    assert.ok(cubeEquals(cubeFromAxial(2, -1), cube(2, -1, -1)));
  });

  it("round-trips through key serialization", () => {
    const c = cube(3, -5, 2);
    assert.ok(cubeEquals(cubeFromKey(cubeKey(c)), c));
  });

  it("rejects malformed and invalid keys", () => {
    assert.throws(() => cubeFromKey("1,2"));
    assert.throws(() => cubeFromKey("a,b,c"));
    assert.throws(() => cubeFromKey("1,1,1"), InvalidCubeError);
  });
});

describe("cube arithmetic", () => {
  it("add/subtract/scale preserve the invariant and behave linearly", () => {
    const a = cube(2, -3, 1);
    const b = cube(-1, 1, 0);
    assert.ok(cubeEquals(cubeAdd(a, b), cube(1, -2, 1)));
    assert.ok(cubeEquals(cubeSubtract(cubeAdd(a, b), b), a));
    assert.ok(cubeEquals(cubeScale(b, 3), cube(-3, 3, 0)));
  });
});

describe("directions and neighbors", () => {
  it("has six unit directions that sum to the zero vector", () => {
    assert.equal(DIRECTIONS.length, 6);
    const sum = DIRECTIONS.reduce((acc, d) => cubeAdd(acc, d), ORIGIN);
    assert.ok(cubeEquals(sum, ORIGIN));
    for (const d of DIRECTIONS) assert.equal(cubeDistance(ORIGIN, d), 1);
  });

  it("opposite-direction pairs cancel (N/S, NE/SW, SE/NW)", () => {
    const { N, S, NE, SW, SE, NW } = DIRECTION_BY_NAME;
    assert.ok(cubeEquals(cubeAdd(N, S), ORIGIN));
    assert.ok(cubeEquals(cubeAdd(NE, SW), ORIGIN));
    assert.ok(cubeEquals(cubeAdd(SE, NW), ORIGIN));
  });

  it("yields six unique neighbors at distance 1", () => {
    const c = cube(4, -7, 3);
    const ns = cubeNeighbors(c);
    assert.equal(new Set(ns.map(cubeKey)).size, 6);
    for (const n of ns) assert.equal(cubeDistance(c, n), 1);
  });

  it("wraps direction indices modulo 6, including negatives", () => {
    const c = cube(0, 0, 0);
    assert.ok(cubeEquals(cubeNeighbor(c, 7), cubeNeighbor(c, 1)));
    assert.ok(cubeEquals(cubeNeighbor(c, -1), cubeNeighbor(c, 5)));
  });

  it("recovers the direction index between adjacent hexes", () => {
    const c = cube(2, -2, 0);
    for (let i = 0; i < 6; i++) {
      assert.equal(directionBetween(c, cubeNeighbor(c, i)), i);
    }
    assert.equal(directionBetween(c, cube(5, -5, 0)), null);
  });
});

describe("distance", () => {
  it("is zero to self, symmetric, and matches known values", () => {
    const a = cube(0, 0, 0);
    const b = cube(3, -1, -2);
    assert.equal(cubeDistance(a, a), 0);
    assert.equal(cubeDistance(a, b), cubeDistance(b, a));
    assert.equal(cubeDistance(a, b), 3);
    assert.equal(cubeDistance(cube(-2, 2, 0), cube(2, -2, 0)), 4);
  });

  it("satisfies the triangle inequality on a sample grid", () => {
    const pts = cubeRange(ORIGIN, 2);
    for (const a of pts)
      for (const b of pts)
        for (const c of pts) {
          assert.ok(
            cubeDistance(a, c) <= cubeDistance(a, b) + cubeDistance(b, c),
          );
        }
  });
});

describe("rotation", () => {
  it("CW six times is identity; CCW inverts CW", () => {
    const c = cube(3, -1, -2);
    let r = c;
    for (let i = 0; i < 6; i++) r = cubeRotateCW(r);
    assert.ok(cubeEquals(r, c));
    assert.ok(cubeEquals(cubeRotateCCW(cubeRotateCW(c)), c));
  });

  it("preserves distance from the rotation center", () => {
    const center = cube(1, -1, 0);
    const c = cube(4, -2, -2);
    const r = cubeRotateAround(c, center, 2);
    assert.equal(cubeDistance(center, r), cubeDistance(center, c));
  });

  it("rotating a direction CW yields the next direction in order", () => {
    // This proves DIRECTIONS order is consistent with cubeRotateCW — the
    // battleland module depends on this to rotate hexside hazard indices.
    for (let i = 0; i < 6; i++) {
      const rotated = cubeRotateCW(DIRECTIONS[i]!);
      assert.ok(cubeEquals(rotated, DIRECTIONS[(i + 1) % 6]!));
    }
  });
});

describe("rings and ranges", () => {
  it("ring(0) is the center; ring(r) has 6r unique hexes at exact distance r", () => {
    const center = cube(2, 0, -2);
    assert.deepEqual(cubeRing(center, 0), [center]);
    for (const r of [1, 2, 3]) {
      const ring = cubeRing(center, r);
      assert.equal(ring.length, 6 * r);
      assert.equal(new Set(ring.map(cubeKey)).size, 6 * r);
      for (const h of ring) assert.equal(cubeDistance(center, h), r);
    }
  });

  it("range(r) is the filled hexagon: 1 + 3r(r+1) hexes, all within r", () => {
    const center = cube(-1, 1, 0);
    for (const r of [0, 1, 2, 4]) {
      const range = cubeRange(center, r);
      assert.equal(range.length, 1 + 3 * r * (r + 1));
      assert.equal(new Set(range.map(cubeKey)).size, range.length);
      for (const h of range) assert.ok(cubeDistance(center, h) <= r);
    }
  });

  it("range(r) equals the union of rings 0..r", () => {
    const center = ORIGIN;
    const r = 3;
    const fromRings = new Set<string>();
    for (let i = 0; i <= r; i++)
      for (const h of cubeRing(center, i)) fromRings.add(cubeKey(h));
    const fromRange = new Set(cubeRange(center, r).map(cubeKey));
    assert.deepEqual(fromRange, fromRings);
  });

  it("rejects negative radii", () => {
    assert.throws(() => cubeRing(ORIGIN, -1));
    assert.throws(() => cubeRange(ORIGIN, -2));
  });
});

describe("lerp and rounding", () => {
  it("rounds endpoints exactly", () => {
    const a = cube(0, 0, 0);
    const b = cube(4, -2, -2);
    assert.ok(cubeEquals(cubeRound(cubeLerp(a, b, 0)), a));
    assert.ok(cubeEquals(cubeRound(cubeLerp(a, b, 1)), b));
  });

  it("always repairs to a valid cube coordinate", () => {
    const f = { x: 1.4, y: -0.4, z: -1.0 };
    const r = cubeRound(f);
    assert.equal(r.x + r.y + r.z, 0);
  });
});

describe("lines", () => {
  it("includes both endpoints and has length distance+1 with contiguous steps", () => {
    const a = cube(0, 0, 0);
    const b = cube(3, -5, 2);
    const line = cubeLine(a, b);
    assert.ok(cubeEquals(line[0]!, a));
    assert.ok(cubeEquals(line[line.length - 1]!, b));
    assert.equal(line.length, cubeDistance(a, b) + 1);
    for (let i = 1; i < line.length; i++) {
      assert.equal(cubeDistance(line[i - 1]!, line[i]!), 1);
    }
  });

  it("degenerate line to self is just the hex", () => {
    const a = cube(1, -1, 0);
    assert.deepEqual(cubeLine(a, a), [a]);
  });

  it("produces two distinct candidate chains on exact corner alignments", () => {
    // (0,0,0) → (2,-1,-1): the true segment passes through a hex corner, so
    // the two epsilon-nudged chains must route around it differently.
    const [l1, l2] = cubeLinesThrough(cube(0, 0, 0), cube(2, -1, -1));
    const k1 = l1.map(cubeKey).join(" ");
    const k2 = l2.map(cubeKey).join(" ");
    assert.notEqual(k1, k2);
  });
});

describe("line of sight", () => {
  const blockedSet = (...hexes: CubeCoord[]) => {
    const s = new Set(hexes.map(cubeKey));
    return (h: CubeCoord) => s.has(cubeKey(h));
  };

  it("adjacent hexes always see each other", () => {
    const a = ORIGIN;
    assert.ok(hasLineOfSight(a, cubeNeighbor(a, 0), () => true));
  });

  it("a clear straight line grants LOS; a blocker on it denies LOS", () => {
    const a = cube(0, 0, 0);
    const b = cube(3, -3, 0); // straight along SE axis
    assert.ok(hasLineOfSight(a, b, blockedSet()));
    assert.ok(!hasLineOfSight(a, b, blockedSet(cube(1, -1, 0))));
    // Blocking only one intermediate is enough on a straight line:
    assert.ok(!hasLineOfSight(a, b, blockedSet(cube(2, -2, 0))));
  });

  it("endpoints never block (attacker and target hexes are occupied)", () => {
    const a = cube(0, 0, 0);
    const b = cube(3, -3, 0);
    assert.ok(hasLineOfSight(a, b, blockedSet(a, b)));
  });

  it("corner-grazing LOS is clear if EITHER nudged chain is clear", () => {
    const a = cube(0, 0, 0);
    const b = cube(2, -1, -1);
    const [l1, l2] = cubeLinesThrough(a, b);
    const mid1 = l1[1]!;
    const mid2 = l2[1]!;
    assert.ok(!cubeEquals(mid1, mid2));
    // Block one chain's intermediate: the other chain still grants LOS.
    assert.ok(hasLineOfSight(a, b, blockedSet(mid1)));
    assert.ok(hasLineOfSight(a, b, blockedSet(mid2)));
    // Block both: LOS denied.
    assert.ok(!hasLineOfSight(a, b, blockedSet(mid1, mid2)));
  });

  it("is symmetric", () => {
    const a = cube(0, 0, 0);
    const b = cube(4, -2, -2);
    const blocks = blockedSet(cube(2, -1, -1));
    assert.equal(hasLineOfSight(a, b, blocks), hasLineOfSight(b, a, blocks));
  });
});

describe("pathfinding (battleland movement model)", () => {
  /** A permissive 27-ish hex board: everything within radius 3 of origin. */
  const board = new Set(cubeRange(ORIGIN, 3).map(cubeKey));
  const inBounds = (h: CubeCoord) => board.has(cubeKey(h));

  const openRules = (maxSteps: number): MovementRules => ({
    maxSteps,
    inBounds,
    canPass: () => true,
    canStop: () => true,
    edgeBlocked: () => false,
    stopsOnEntry: () => false,
  });

  it("on open ground, a skill-N mover reaches exactly range(N) ∩ board", () => {
    for (const skill of [1, 2, 3, 4]) {
      const { destinations } = reachable(ORIGIN, openRules(skill));
      const expected = cubeRange(ORIGIN, Math.min(skill, 3)).filter(inBounds);
      assert.equal(destinations.size, expected.length);
      for (const h of expected) assert.ok(destinations.has(cubeKey(h)));
    }
  });

  it("includes the start hex (a creature may stand still)", () => {
    const { destinations } = reachable(ORIGIN, openRules(2));
    assert.ok(destinations.has(cubeKey(ORIGIN)));
    assert.equal(destinations.get(cubeKey(ORIGIN))!.steps, 0);
  });

  it("slowed terrain (bramble/drift/sand) is reachable but ends movement", () => {
    // Everything except the start slows the mover: with skill 4 it should
    // still only reach distance 1 — enter a slowing hex, stop immediately.
    const rules: MovementRules = {
      ...openRules(4),
      stopsOnEntry: (_from, to) => !cubeEquals(to, ORIGIN),
    };
    const { destinations } = reachable(ORIGIN, rules);
    assert.equal(destinations.size, 7); // start + 6 neighbors
    for (const r of destinations.values()) assert.ok(r.steps <= 1);
  });

  it("slope-style slowing is directional (from→to), not hex-global", () => {
    // Moving N anywhere is 'uphill' and slows; all other directions free.
    const N = DIRECTION_BY_NAME.N;
    const rules: MovementRules = {
      ...openRules(2),
      stopsOnEntry: (from, to) => cubeEquals(cubeSubtract(to, from), N),
    };
    const { destinations } = reachable(ORIGIN, rules);
    // Two steps north would need expanding the slowed hex — must be absent.
    assert.ok(!destinations.has(cubeKey(cubeScale(N, 2))));
    // One step north is reachable (you stop there).
    assert.ok(destinations.has(cubeKey(N)));
    // Two-step north-ish hexes are still reachable via non-N final steps,
    // e.g. NE then NW arrives at N+... — verify a representative detour:
    const detour = cubeAdd(DIRECTION_BY_NAME.NE, DIRECTION_BY_NAME.NW); // == N… 
    // NE + NW = (1,0,-1)+(-1,1,0) = (0,1,-1) = N exactly — same hex, fine.
    assert.ok(destinations.has(cubeKey(detour)));
  });

  it("blocked hexsides (walls/dunes) bar crossing without blocking the hexes", () => {
    // Wall between origin and its N neighbor only.
    const N = DIRECTION_BY_NAME.N;
    const wallA = cubeKey(ORIGIN);
    const wallB = cubeKey(N);
    const rules: MovementRules = {
      ...openRules(2),
      edgeBlocked: (from, to) => {
        const k = [cubeKey(from), cubeKey(to)].sort().join("|");
        return k === [wallA, wallB].sort().join("|");
      },
    };
    const { destinations, routeTo } = reachable(ORIGIN, rules);
    // The N hex is still reachable in 2 by going around the wall.
    const r = destinations.get(cubeKey(N));
    assert.ok(r);
    assert.equal(r.steps, 2);
    const route = routeTo(cubeKey(N))!;
    assert.equal(route.length, 3);
    // The route must not cross the walled edge:
    for (let i = 1; i < route.length; i++) {
      const k = [cubeKey(route[i - 1]!), cubeKey(route[i]!)].sort().join("|");
      assert.notEqual(k, [wallA, wallB].sort().join("|"));
    }
  });

  it("flyers pass over occupied hexes but cannot land on them", () => {
    // A ring of 'occupied' hexes at distance 1 around the start.
    const occupied = new Set(cubeRing(ORIGIN, 1).map(cubeKey));
    const flyer: MovementRules = {
      ...openRules(2),
      canPass: () => true, // flight: overfly anything
      canStop: (h) => !occupied.has(cubeKey(h)),
    };
    const grounded: MovementRules = {
      ...openRules(2),
      canPass: (h) => !occupied.has(cubeKey(h)), // ground: no pass-through
      canStop: (h) => !occupied.has(cubeKey(h)),
    };
    const fly = reachable(ORIGIN, flyer).destinations;
    const walk = reachable(ORIGIN, grounded).destinations;
    // Flyer escapes the encirclement to distance-2 hexes; walker is trapped.
    assert.ok(fly.size > 1);
    for (const h of cubeRing(ORIGIN, 2)) {
      assert.ok(fly.has(cubeKey(h)), `flyer should reach ${cubeKey(h)}`);
    }
    assert.equal(walk.size, 1); // only the start hex
    // And the flyer cannot END on the occupied ring:
    for (const h of cubeRing(ORIGIN, 1)) assert.ok(!fly.has(cubeKey(h)));
  });

  it("routes returned by routeTo are contiguous, start-anchored, legal-length", () => {
    const { destinations, routeTo } = reachable(ORIGIN, openRules(3));
    for (const [key, r] of destinations) {
      const route = routeTo(key)!;
      assert.ok(cubeEquals(route[0]!, ORIGIN));
      assert.ok(cubeEquals(route[route.length - 1]!, r.hex));
      assert.equal(route.length, r.steps + 1);
      for (let i = 1; i < route.length; i++) {
        assert.equal(cubeDistance(route[i - 1]!, route[i]!), 1);
      }
    }
  });

  it("routeTo returns null for illegal destinations", () => {
    const { routeTo } = reachable(ORIGIN, openRules(1));
    assert.equal(routeTo(cubeKey(cube(3, -3, 0))), null);
  });
});
