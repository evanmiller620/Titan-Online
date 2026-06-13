/**
 * Hex → pixel projection (Titan client, render layer).
 *
 * The render layer's ONLY job is to turn engine data into pixels; it never
 * mutates game state and never decides legality. This module is the pure
 * geometry that backs every PixiJS draw call, kept dependency-free so it can
 * be unit-tested under Node without a browser or canvas.
 *
 * Two coordinate consumers:
 *   - Battlelands are true flat-top hex grids; we use the standard cube→pixel
 *     projection for flat-top orientation.
 *   - The Masterboard is NOT a regular grid (it is a directed wheel), so its
 *     lands are positioned from the Colossus (col,row) layout the board data
 *     carries, arranged as the physical board's concentric rings. Cube coords
 *     are retained for hit-testing and adjacency sanity but the wheel layout
 *     drives placement.
 *
 * All functions are pure: same inputs → same Point. No globals, no Pixi types.
 */

import type { CubeCoord } from "@titan/engine";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface HexLayout {
  /** Center-to-corner radius in px. */
  readonly size: number;
  /** Pixel origin that cube (0,0,0) maps to. */
  readonly origin: Point;
}

const SQRT3 = Math.sqrt(3);

/**
 * Flat-top cube → pixel. For flat-top hexes the column step is 3/2·size in x
 * and the row step is √3·size in y, with odd columns offset half a row.
 * Derived from the axial (q = x, r = z) of the cube.
 */
export function cubeToPixelFlat(c: CubeCoord, layout: HexLayout): Point {
  const q = c.x;
  const r = c.z;
  const x = layout.size * (1.5 * q);
  const y = layout.size * (SQRT3 * (r + q / 2));
  return { x: layout.origin.x + x, y: layout.origin.y + y };
}

/**
 * The six corner points of a flat-top hex centered at `center`, clockwise from
 * the right-most vertex. Used to build the PixiJS polygon for a hex cell.
 */
export function hexCornersFlat(center: Point, size: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i); // flat-top: first corner at 0°
    pts.push({
      x: center.x + size * Math.cos(angle),
      y: center.y + size * Math.sin(angle),
    });
  }
  return pts;
}

/**
 * Inverse projection (flat-top): pixel → nearest cube. Used for click/hover
 * hit-testing on Battlelands. Rounds via the cube-rounding rule so the result
 * always satisfies x+y+z=0.
 */
export function pixelToCubeFlat(p: Point, layout: HexLayout): CubeCoord {
  const px = (p.x - layout.origin.x) / layout.size;
  const py = (p.y - layout.origin.y) / layout.size;
  const q = (2 / 3) * px;
  const r = (-1 / 3) * px + (SQRT3 / 3) * py;
  return cubeRound(q, -q - r, r);
}

/** Round fractional cube to the nearest valid integer cube (x+y+z=0). */
function cubeRound(fx: number, fy: number, fz: number): CubeCoord {
  let rx = Math.round(fx);
  let ry = Math.round(fy);
  let rz = Math.round(fz);
  const dx = Math.abs(rx - fx);
  const dy = Math.abs(ry - fy);
  const dz = Math.abs(rz - fz);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  // Normalize -0 → 0 so coordinates compare and serialize cleanly.
  return { x: rx + 0, y: ry + 0, z: rz + 0 };
}

/**
 * Masterboard wheel placement. The 96 lands sit on a 15×8 Colossus grid; we
 * map (col,row) into a centered pixel field. The board is wider than tall, so
 * we scale columns and rows independently to fill the viewport while keeping
 * the wheel's proportions. Pure function of the land's grid coords.
 */
export interface BoardExtent {
  readonly cols: number; // grid columns (15 for the Default masterboard)
  readonly rows: number; // grid rows (8)
  readonly width: number; // viewport px
  readonly height: number;
  readonly margin: number;
}

export function masterLandToPixel(
  col: number,
  row: number,
  ext: BoardExtent,
): Point {
  const usableW = ext.width - 2 * ext.margin;
  const usableH = ext.height - 2 * ext.margin;
  // +1 so the last col/row isn't flush against the margin edge.
  const stepX = usableW / (ext.cols + 1);
  const stepY = usableH / (ext.rows + 1);
  return {
    x: ext.margin + stepX * (col + 1),
    y: ext.margin + stepY * (row + 1),
  };
}

/** Distance between two points (for nearest-land hit testing on the wheel). */
export function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Nearest land id to a pixel, given precomputed land pixel positions. Returns
 * null if the click is farther than `maxDist` from every land (a miss).
 */
export function nearestLand(
  p: Point,
  landPositions: ReadonlyArray<{ readonly id: number; readonly point: Point }>,
  maxDist: number,
): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (const { id, point } of landPositions) {
    const d = distance(p, point);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return bestD <= maxDist ? best : null;
}
