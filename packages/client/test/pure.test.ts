import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  cubeToPixelFlat,
  pixelToCubeFlat,
  hexCornersFlat,
  nearestLand,
  distance,
  hexBounds,
  fitHexLayout,
  fitTriLayout,
  triCentroid,
  triLandPolygon,
  triPointsUp,
  type HexLayout,
} from "../src/render/projection.ts";
import { BATTLE_MAPS, MASTER_LANDS } from "@titan/engine";

const cube = (x: number, y: number, z: number) => ({ x, y, z });

describe("flat-top cube↔pixel projection", () => {
  const layout: HexLayout = { size: 30, origin: { x: 400, y: 300 } };

  it("maps the origin cube to the layout origin", () => {
    const p = cubeToPixelFlat(cube(0, 0, 0), layout);
    assert.equal(Math.round(p.x), 400);
    assert.equal(Math.round(p.y), 300);
  });

  it("round-trips cube → pixel → cube for a spread of hexes", () => {
    const hexes = [cube(0, 0, 0), cube(1, -1, 0), cube(2, -1, -1), cube(-2, 1, 1), cube(3, -5, 2), cube(0, -3, 3)];
    for (const h of hexes) {
      assert.deepEqual(pixelToCubeFlat(cubeToPixelFlat(h, layout), layout), h, `round-trip failed for ${JSON.stringify(h)}`);
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
    assert.equal(new Set(corners.map((c) => `${Math.round(c.x)},${Math.round(c.y)}`)).size, 6);
    for (const c of corners) assert.ok(Math.abs(distance(c, { x: 100, y: 100 }) - 20) < 1e-9);
  });

  it("neighbouring cubes project to adjacent (non-identical, close) pixels", () => {
    const a = cubeToPixelFlat(cube(0, 0, 0), layout);
    const b = cubeToPixelFlat(cube(1, -1, 0), layout);
    const d = distance(a, b);
    assert.ok(d > layout.size && d < 2 * layout.size, `neighbour spacing ${d}`);
  });
});

describe("fit-to-bounds battle layout", () => {
  const cubes = (BATTLE_MAPS.Plains as { hexes: Array<{ cube: { x: number; y: number; z: number } }> }).hexes.map((h) => h.cube);

  it("hexBounds spans the column/row extent", () => {
    const b = hexBounds([cube(0, 0, 0), cube(2, -2, 0)]);
    assert.equal(b.minX, 0);
    assert.equal(b.maxX, 3); // 1.5 * 2
  });

  it("keeps every hex centre inside the canvas, for any viewport", () => {
    for (const [w, h] of [[600, 400], [1200, 900], [400, 800]] as const) {
      const margin = Math.min(w, h) * 0.06;
      const layout = fitHexLayout(cubes, w, h, margin);
      for (const c of cubes) {
        const p = cubeToPixelFlat(c, layout);
        assert.ok(p.x >= 0 && p.x <= w, `x ${p.x} in ${w}`);
        assert.ok(p.y >= 0 && p.y <= h, `y ${p.y} in ${h}`);
      }
    }
  });

  it("scales the board up with the viewport (bigger board on a bigger screen)", () => {
    const small = fitHexLayout(cubes, 600, 450, 24).size;
    const big = fitHexLayout(cubes, 1200, 900, 24).size;
    assert.ok(big > small, `expected ${big} > ${small}`);
  });

  it("centres the board: the hex centroid lands near the canvas centre", () => {
    const w = 800, h = 600;
    const layout = fitHexLayout(cubes, w, h, 24);
    const pts = cubes.map((c) => cubeToPixelFlat(c, layout));
    const cx = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2;
    const cy = (Math.min(...pts.map((p) => p.y)) + Math.max(...pts.map((p) => p.y))) / 2;
    assert.ok(Math.abs(cx - w / 2) < 1, `cx ${cx}`);
    assert.ok(Math.abs(cy - h / 2) < 1, `cy ${cy}`);
  });
});

describe("masterboard triangular layout — authentic board", () => {
  const cells = MASTER_LANDS.map((l) => ({ col: l.col, row: l.row }));
  const towers = MASTER_LANDS.filter((l) => l.terrain === "Tower");
  const byId = new Map(MASTER_LANDS.map((l) => [l.id, l]));

  it("every directed exit crosses a shared edge (centroids exactly side/√3 apart)", () => {
    const L = fitTriLayout(cells, 900, 680, 18);
    const expected = L.side / Math.sqrt(3);
    for (const land of MASTER_LANDS) {
      const a = triCentroid(land, L);
      for (const ex of land.exits) {
        const to = byId.get(ex.to)!;
        const b = triCentroid(to, L);
        assert.ok(Math.abs(distance(a, b) - expected) < 1e-6, `${land.id}→${ex.to} not edge-adjacent`);
        assert.notEqual(triPointsUp(land), triPointsUp(to), `${land.id}→${ex.to} same orientation`);
      }
    }
  });

  it("places the six towers at the hexagon's vertices (≈60° apart)", () => {
    const w = 900, h = 680;
    const L = fitTriLayout(cells, w, h, 18);
    assert.equal(towers.length, 6);
    const angles = towers
      .map((t) => {
        const p = triCentroid(t, L);
        return (Math.atan2(p.y - h / 2, p.x - w / 2) * 180) / Math.PI;
      })
      .map((a) => (a + 360) % 360)
      .sort((x, y) => x - y);
    for (let i = 0; i < 6; i++) {
      const gap = ((angles[(i + 1) % 6]! - angles[i]! + 360) % 360);
      assert.ok(Math.abs(gap - 60) < 22, `tower gap ${gap.toFixed(0)}° near 60°`);
    }
  });

  it("keeps every land inside the canvas and centred", () => {
    const w = 800, h = 600, L = fitTriLayout(cells, w, h, 18);
    const pts = cells.map((c) => triCentroid(c, L));
    for (const p of pts) { assert.ok(p.x >= 0 && p.x <= w); assert.ok(p.y >= 0 && p.y <= h); }
    const cx = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2;
    assert.ok(Math.abs(cx - w / 2) < 1, `cx ${cx}`);
  });

  it("land polygons are truncated triangles: 6 distinct corners around the centroid", () => {
    const L = fitTriLayout(cells, 900, 680, 18);
    for (const cell of [cells[0]!, cells[40]!, cells[95]!]) {
      const poly = triLandPolygon(cell, L, 0.18, 0.955);
      assert.equal(poly.length, 6);
      assert.equal(new Set(poly.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)).size, 6);
      const c = triCentroid(cell, L);
      for (const p of poly) assert.ok(distance(p, c) < L.side, "corner within the land's extent");
    }
  });
});

describe("nearestLand hit-testing", () => {
  it("finds the closest land and respects the miss radius", () => {
    const positions = [
      { id: 100, point: { x: 100, y: 100 } },
      { id: 200, point: { x: 300, y: 100 } },
      { id: 300, point: { x: 200, y: 300 } },
    ];
    assert.equal(nearestLand({ x: 110, y: 95 }, positions, 50), 100);
    assert.equal(nearestLand({ x: 295, y: 105 }, positions, 50), 200);
    assert.equal(nearestLand({ x: 700, y: 700 }, positions, 50), null);
  });
});
