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
 * The unit-size pixel bounds of a set of hexes (centres only, size = 1). Used to
 * size a battle board to its ACTUAL extent rather than guessing from the
 * viewport, so it never overflows or hides under the side panels.
 */
export function hexBounds(cubes: readonly CubeCoord[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cubes) {
    const x = 1.5 * c.x;
    const y = SQRT3 * (c.z + c.x / 2);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * A HexLayout that fits all `cubes` inside `width`×`height` (minus `margin`) and
 * centres them. The +2 padding leaves room for the hexes' own radius so corners
 * aren't clipped. Pure — unit-tested without a canvas.
 */
export function fitHexLayout(cubes: readonly CubeCoord[], width: number, height: number, margin: number): HexLayout {
  const b = hexBounds(cubes);
  const spanX = (b.maxX - b.minX) || 1;
  const spanY = (b.maxY - b.minY) || 1;
  const size = Math.max(1, Math.min((width - 2 * margin) / (spanX + 2), (height - 2 * margin) / (spanY + 2)));
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return { size, origin: { x: width / 2 - size * cx, y: height / 2 - size * cy } };
}

// ---------------------------------------------------------------------------
// Masterboard layout — the AUTHENTIC board geometry.
//
// The 1980 masterboard is a TRIANGULAR tessellation, not a honeycomb: the 96
// lands are equilateral triangles with truncated corners, alternately pointing
// up and down, packed into one large hexagon with the six Towers at its
// vertices and the Mountains/Tundra summit at its centre. On the Colossus
// (col,row) grid this falls out directly:
//   - the column step is HALF a land's base (neighbouring columns interlock),
//   - the row step is a land's full height,
//   - a land points UP when (col+row) is odd, DOWN when even (forced by the
//     exit graph: every directed exit must cross a shared edge).
// Corner truncation turns each triangle into the classic near-triangular
// hexagon and opens the small diamond gaps where lands meet.
// ---------------------------------------------------------------------------

export interface TriLayout {
  /** Horizontal pixel step per column — half a land's base. */
  readonly colStep: number;
  /** Vertical pixel step per row — a land's full height. */
  readonly rowStep: number;
  /** Side length of the (untruncated) triangular land, in px. */
  readonly side: number;
  /** Pixel that column 0's centreline / row 0's top edge map to. */
  readonly origin: Point;
}

export interface GridCell { readonly col: number; readonly row: number }

/** Whether a land's triangle points up (apex on top). Forced by the exit
 *  graph: vertically adjacent lands share a horizontal edge only when the
 *  upper one points up and the lower one points down. */
export function triPointsUp(cell: GridCell): boolean {
  return ((cell.col + cell.row) & 1) === 1;
}

/** Fit the triangular land grid into width×height (minus margin), centred. */
export function fitTriLayout(cells: readonly GridCell[], width: number, height: number, margin: number): TriLayout {
  let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const c of cells) {
    if (c.col < minC) minC = c.col;
    if (c.col > maxC) maxC = c.col;
    if (c.row < minR) minR = c.row;
    if (c.row > maxR) maxR = c.row;
  }
  const spanC = (maxC - minC) || 1;
  const spanR = (maxR - minR) || 1;
  // Width: centres span spanC half-bases, plus half a base each side.
  // Height: (spanR + 1) triangle heights of side·√3/2 each.
  const sideW = (width - 2 * margin) / (spanC / 2 + 1);
  const sideH = (height - 2 * margin) / ((spanR + 1) * (SQRT3 / 2));
  const side = Math.max(1, Math.min(sideW, sideH));
  const colStep = side / 2;
  const rowStep = side * (SQRT3 / 2);
  const cx = (minC + maxC) / 2;
  const cy = (minR + maxR + 1) / 2; // rows occupy [minR, maxR+1] in rowTop units
  return { colStep, rowStep, side, origin: { x: width / 2 - colStep * cx, y: height / 2 - rowStep * cy } };
}

/** A land's centroid — the anchor for hit-testing, labels and gate rays. */
export function triCentroid(cell: GridCell, layout: TriLayout): Point {
  const x = layout.origin.x + cell.col * layout.colStep;
  const top = layout.origin.y + cell.row * layout.rowStep;
  const third = layout.rowStep / 3;
  return { x, y: top + (triPointsUp(cell) ? 2 : 1) * third };
}

/**
 * The land's polygon: its equilateral triangle scaled about the centroid by
 * `scale` (opens the dark seam between lands) with each corner cut at fraction
 * `trunc` of the side — the classic Titan land shape. Returned as corner
 * points in drawing order.
 */
export function triLandPolygon(cell: GridCell, layout: TriLayout, trunc: number, scale: number): Point[] {
  const up = triPointsUp(cell);
  const x = layout.origin.x + cell.col * layout.colStep;
  const top = layout.origin.y + cell.row * layout.rowStep;
  const bot = top + layout.rowStep;
  const half = layout.side / 2;
  const c = triCentroid(cell, layout);
  const sh = (p: Point): Point => ({ x: c.x + (p.x - c.x) * scale, y: c.y + (p.y - c.y) * scale });
  const A = sh(up ? { x, y: top } : { x, y: bot });        // apex
  const B = sh({ x: x - half, y: up ? bot : top });        // base left
  const C = sh({ x: x + half, y: up ? bot : top });        // base right
  const lerp = (p: Point, q: Point, t: number): Point => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  return [lerp(A, B, trunc), lerp(B, A, trunc), lerp(B, C, trunc), lerp(C, B, trunc), lerp(C, A, trunc), lerp(A, C, trunc)];
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
