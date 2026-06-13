import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  cubeToPixelFlat,
  pixelToCubeFlat,
  hexCornersFlat,
  masterLandToPixel,
  nearestLand,
  distance,
  type HexLayout,
  type BoardExtent,
} from "../src/render/projection.ts";
import {
  initialStore,
  reduce,
  isMyTurn,
  inputsLocked,
  phaseLabel,
  type StoreState,
} from "../src/store/gameStore.ts";

const cube = (x: number, y: number, z: number) => ({ x, y, z });

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

describe("flat-top cube↔pixel projection", () => {
  const layout: HexLayout = { size: 30, origin: { x: 400, y: 300 } };

  it("maps the origin cube to the layout origin", () => {
    const p = cubeToPixelFlat(cube(0, 0, 0), layout);
    assert.equal(Math.round(p.x), 400);
    assert.equal(Math.round(p.y), 300);
  });

  it("round-trips cube → pixel → cube for a spread of hexes", () => {
    const hexes = [
      cube(0, 0, 0), cube(1, -1, 0), cube(2, -1, -1),
      cube(-2, 1, 1), cube(3, -5, 2), cube(0, -3, 3),
    ];
    for (const h of hexes) {
      const back = pixelToCubeFlat(cubeToPixelFlat(h, layout), layout);
      assert.deepEqual(back, h, `round-trip failed for ${JSON.stringify(h)}`);
    }
  });

  it("always produces a valid cube (x+y+z=0) from arbitrary pixels", () => {
    for (let px = 0; px < 800; px += 53) {
      for (let py = 0; py < 600; py += 47) {
        const c = pixelToCubeFlat({ x: px, y: py }, layout);
        assert.equal(c.x + c.y + c.z, 0);
      }
    }
  });

  it("produces six distinct corners around a center", () => {
    const corners = hexCornersFlat({ x: 100, y: 100 }, 20);
    assert.equal(corners.length, 6);
    const keys = new Set(corners.map((c) => `${Math.round(c.x)},${Math.round(c.y)}`));
    assert.equal(keys.size, 6);
    // Every corner is `size` from the center.
    for (const c of corners) {
      assert.ok(Math.abs(distance(c, { x: 100, y: 100 }) - 20) < 1e-9);
    }
  });

  it("neighbouring cubes project to adjacent (non-identical, close) pixels", () => {
    const a = cubeToPixelFlat(cube(0, 0, 0), layout);
    const b = cubeToPixelFlat(cube(1, -1, 0), layout);
    const d = distance(a, b);
    // Flat-top neighbour spacing is √3·size ≈ 51.96 for size 30.
    assert.ok(d > layout.size && d < 2 * layout.size, `neighbour spacing ${d}`);
  });
});

describe("masterboard wheel placement", () => {
  const ext: BoardExtent = { cols: 15, rows: 8, width: 1200, height: 800, margin: 40 };

  it("keeps every land inside the margins", () => {
    for (let col = 0; col < ext.cols; col++) {
      for (let row = 0; row < ext.rows; row++) {
        const p = masterLandToPixel(col, row, ext);
        assert.ok(p.x >= ext.margin && p.x <= ext.width - ext.margin, `x ${p.x}`);
        assert.ok(p.y >= ext.margin && p.y <= ext.height - ext.margin, `y ${p.y}`);
      }
    }
  });

  it("orders lands left-to-right and top-to-bottom", () => {
    const a = masterLandToPixel(0, 0, ext);
    const b = masterLandToPixel(5, 0, ext);
    const c = masterLandToPixel(0, 4, ext);
    assert.ok(b.x > a.x, "higher col → larger x");
    assert.ok(c.y > a.y, "higher row → larger y");
  });

  it("nearestLand finds the closest land and respects the miss radius", () => {
    const positions = [
      { id: 100, point: { x: 100, y: 100 } },
      { id: 200, point: { x: 300, y: 100 } },
      { id: 300, point: { x: 200, y: 300 } },
    ];
    assert.equal(nearestLand({ x: 110, y: 95 }, positions, 50), 100);
    assert.equal(nearestLand({ x: 295, y: 105 }, positions, 50), 200);
    // A click far from every land is a miss.
    assert.equal(nearestLand({ x: 700, y: 700 }, positions, 50), null);
  });
});

// ---------------------------------------------------------------------------
// Store reconciliation (strict-wait)
// ---------------------------------------------------------------------------

/** Minimal fake GameStateView for store tests. */
function fakeView(activeIndex: number, fsmPath: string): any {
  return {
    gameId: "g",
    fsm: { path: fsmPath, returnStack: [] },
    playerOrder: ["p1", "p2"],
    players: {},
    setup: null,
    turn: { number: 1, activeIndex, movementRoll: null, mulliganUsed: false },
    caretaker: {},
    legions: {},
    battle: null,
    revealedMarkers: [],
  };
}

describe("store: strict-wait reconciliation", () => {
  it("adopts a newer snapshot and clears in-flight command state", () => {
    let s: StoreState = reduce(initialStore, { type: "setViewer", slot: "p1" });
    s = reduce(s, { type: "submitStart", commandType: "RollMovement" });
    assert.equal(s.command.kind, "submitting");
    s = reduce(s, { type: "snapshot", version: 0, view: fakeView(0, "Turn.Movement") });
    assert.equal(s.version, 0);
    assert.equal(s.command.kind, "idle", "newer snapshot clears command UI");
  });

  it("ignores stale or duplicate snapshots (no backward rolls)", () => {
    let s: StoreState = reduce(initialStore, {
      type: "snapshot", version: 5, view: fakeView(0, "Turn.Movement"),
    });
    const before = s;
    // Lower version — ignored.
    s = reduce(s, { type: "snapshot", version: 3, view: fakeView(1, "Turn.Mustering") });
    assert.equal(s, before, "stale frame must be ignored (same reference)");
    // Equal version — ignored.
    s = reduce(s, { type: "snapshot", version: 5, view: fakeView(1, "Turn.Mustering") });
    assert.equal(s.version, 5);
    assert.equal(s.snapshot!.turn.activeIndex, 0, "equal-version frame ignored");
  });

  it("locks inputs while submitting and when it is not the viewer's turn", () => {
    let s: StoreState = reduce(initialStore, { type: "setViewer", slot: "p1" });
    s = reduce(s, { type: "snapshot", version: 0, view: fakeView(0, "Turn.Movement") });
    assert.ok(isMyTurn(s));
    assert.ok(!inputsLocked(s), "my turn, idle → unlocked");

    s = reduce(s, { type: "submitStart", commandType: "RollMovement" });
    assert.ok(inputsLocked(s), "submitting → locked");

    // Opponent's turn → locked.
    let t: StoreState = reduce(initialStore, { type: "setViewer", slot: "p1" });
    t = reduce(t, { type: "snapshot", version: 0, view: fakeView(1, "Turn.Movement") });
    assert.ok(!isMyTurn(t));
    assert.ok(inputsLocked(t));
  });

  it("surfaces a rejection without changing the snapshot", () => {
    let s: StoreState = reduce(initialStore, {
      type: "snapshot", version: 1, view: fakeView(0, "Turn.Movement"),
    });
    const snapBefore = s.snapshot;
    s = reduce(s, { type: "submitReject", commandType: "MoveLegion", message: "illegal move" });
    assert.equal(s.command.kind, "rejected");
    assert.equal(s.snapshot, snapBefore, "rejection must not alter authoritative state");
  });

  it("derives readable phase labels from the FSM path", () => {
    const mk = (p: string) =>
      reduce(initialStore, { type: "snapshot", version: 0, view: fakeView(0, p) });
    assert.equal(phaseLabel(mk("Setup.TowerSelection")), "Setup");
    assert.equal(phaseLabel(mk("Turn.Commencement")), "Split");
    assert.equal(phaseLabel(mk("Turn.Movement")), "Movement");
    assert.equal(phaseLabel(mk("Turn.Engagement.Battle.Round.Strike")), "Battle");
    assert.equal(phaseLabel(mk("Turn.Mustering")), "Muster");
    assert.equal(phaseLabel(mk("GameOver")), "Game over");
  });

  it("tracks selection and hover independently of the snapshot", () => {
    let s: StoreState = reduce(initialStore, { type: "select", id: "Black-01" });
    assert.equal(s.selection.selected, "Black-01");
    s = reduce(s, { type: "hover", id: "42" });
    assert.equal(s.selection.hovered, "42");
    assert.equal(s.selection.selected, "Black-01", "hover must not clear selection");
  });
});
