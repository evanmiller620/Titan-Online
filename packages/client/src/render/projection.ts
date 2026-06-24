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
// The masterboard is NOT a sheared hex tessellation: it is a solid hexagonal
// honeycomb of 96 lands whose (col,row) grid, plotted DIRECTLY (no odd-q
// shear), reproduces the original 1980 board — a regular hexagon with the
// six towers at its vertices and the Mountains/Tundra summit at its centre.
// Insetting each hex opens the black gaps between lands. Cube coords (used by
// the battle board) would shear this into a lopsided blob, so the masterboard
// uses its own simple grid projection here.
// ---------------------------------------------------------------------------

export interface GridLayout {
  /** Pixel step per column / row. */
  readonly sx: number;
  readonly sy: number;
  /** Hex radius (inset below the grid step so gaps show). */
  readonly size: number;
  /** Pixel position that grid (0,0) maps to. */
  readonly origin: Point;
}

export interface GridCell { readonly col: number; readonly row: number }

/** Fit the (col,row) grid of `cells` into width×height (minus margin), centred,
 *  with hexes inset so the board reads as a hexagon of separated lands.
 *
 *  The lands are flat-top hexes on a near-square lattice (the authentic Titan
 *  wheel: 15 columns × 8 rows). Earlier this stretched the column and row steps
 *  to the viewport INDEPENDENTLY — because the grid is far wider than tall, the
 *  row step ballooned and opened wide empty channels between rows. We now derive
 *  ONE hex radius that fits both axes and use an equal centre-to-centre step on
 *  both, so rows pack as tightly as columns and each land is as large as the
 *  space allows. A flat-top hex spans 2·r wide and √3·r tall; STEP past those
 *  leaves a thin, even seam. */
export function fitColRowLayout(cells: readonly GridCell[], width: number, height: number, margin: number): GridLayout {
  let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const c of cells) {
    if (c.col < minC) minC = c.col;
    if (c.col > maxC) maxC = c.col;
    if (c.row < minR) minR = c.row;
    if (c.row > maxR) maxR = c.row;
  }
  const spanC = (maxC - minC) || 1;
  const spanR = (maxR - minR) || 1;
  const STEP = 2.16; // centre-to-centre in hex radii — larger, more readable hexes;
  //                    arrows draw on top so they stay visible despite the tighter seam.
  // Largest radius that fits each axis (board spans spanC·STEP·r + 2r wide,
  // spanR·STEP·r + √3·r tall), then take the binding one.
  const sizeW = (width - 2 * margin) / (spanC * STEP + 2);
  const sizeH = (height - 2 * margin) / (spanR * STEP + SQRT3);
  const size = Math.max(1, Math.min(sizeW, sizeH));
  const sx = size * STEP;
  const sy = size * STEP;
  const cx = (minC + maxC) / 2;
  const cy = (minR + maxR) / 2;
  return { sx, sy, size, origin: { x: width / 2 - sx * cx, y: height / 2 - sy * cy } };
}

/** Project a (col,row) cell to its pixel centre under a GridLayout. */
export function colRowToPixel(cell: GridCell, layout: GridLayout): Point {
  return { x: layout.origin.x + cell.col * layout.sx, y: layout.origin.y + cell.row * layout.sy };
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
