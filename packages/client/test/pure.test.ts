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
    assert.ok(masterLandToPixel(5, 0, ext).x > a.x, "higher col → larger x");
    assert.ok(masterLandToPixel(0, 4, ext).y > a.y, "higher row → larger y");
  });

  it("nearestLand finds the closest land and respects the miss radius", () => {
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
