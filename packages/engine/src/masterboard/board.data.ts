/**
 * Masterboard land data (Titan engine, module: masterboard).
 *
 * SOURCE OF TRUTH: the Colossus project's Default variant `DefaultMap.xml`
 * (the community reference implementation of Avalon Hill Titan). This file
 * was MECHANICALLY CONVERTED from that XML — not hand-transcribed — to avoid
 * the data-entry errors that 96 lands × multiple exits would otherwise invite.
 * The conversion is re-verified by the invariants in masterboard.test.ts.
 *
 * Land identity is the integer `id`, exactly as in the XML and in community
 * PbEM notation. The numbering:
 *   100, 200 … 600   the six Towers
 *   1 … 42           the three concentric outer/middle tracks
 *   101 … 142        the ring of seven lands around each Tower (the inner
 *                    approach), 7 per tower
 *   1000 … 6000      the six central Mountains/Tundra "summit" lands
 *
 * CUBE COORDINATE: per the project's no-offset-coordinates constraint, every
 * land carries a canonical CubeCoord, derived once here from the Colossus
 * (col,row) offset layout via an odd-q flat-top embedding. All 96 are
 * distinct. IMPORTANT: the Masterboard is a DIRECTED GRAPH for movement —
 * cube ADJACENCY is NOT used for legality. The cube coord exists only for
 * rendering, spatial queries, and sanity checks. Movement runs on `exits`.
 *
 * EXIT TYPES (the painted boundary signs), faithful to the XML:
 *   ARROWS  the thick painted arrows: the normal forward flow of a track.
 *           A legion passing through must follow these; they are also legal
 *           stopping exits.
 *   ARROW   single arrows: Tower exits and the central-land connectors.
 *   ARCH    a gateway you may pass/stop through; the controlled entry to the
 *           Tower ring and cross-links.
 *   BLOCK   one-way: legal to LEAVE a land this way, but a legion may NOT
 *           ENTER the target across a blocked side. Enforced by the graph's
 *           entry rules, not just the exit list.
 */

import type { CubeCoord } from "../hex/cube.ts";
import type { LandId } from "../core/events/DomainEvent.ts";

export type MasterTerrain =
  | "Plains"
  | "Woods"
  | "Brush"
  | "Jungle"
  | "Desert"
  | "Hills"
  | "Mountains"
  | "Swamp"
  | "Marsh"
  | "Tundra"
  | "Tower";

export type ExitType = "ARROWS" | "ARROW" | "ARCH" | "BLOCK";

export interface MasterExit {
  readonly type: ExitType;
  readonly to: LandId;
}

export interface MasterLand {
  readonly id: LandId;
  readonly terrain: MasterTerrain;
  /** Colossus offset-grid column (rendering only). */
  readonly col: number;
  /** Colossus offset-grid row (rendering only). */
  readonly row: number;
  /** Canonical cube coordinate (rendering / spatial only — NOT movement). */
  readonly cube: CubeCoord;
  /** Directed exits, exactly as in the source XML. */
  readonly exits: readonly MasterExit[];
}

/** All 96 lands, mechanically generated from DefaultMap.xml. */
export const MASTER_LANDS: readonly MasterLand[] = [
  { id: 100, terrain: "Tower", col: 7, row: 6, cube: { x: 7, y: -10, z: 3 }, exits: [{ type: "ARROW", to: 41 }, { type: "ARROW", to: 101 }, { type: "ARROW", to: 3 }] },
  { id: 200, terrain: "Tower", col: 11, row: 5, cube: { x: 11, y: -11, z: 0 }, exits: [{ type: "ARROW", to: 6 }, { type: "ARROW", to: 108 }, { type: "ARROW", to: 10 }] },
  { id: 300, terrain: "Tower", col: 11, row: 2, cube: { x: 11, y: -8, z: -3 }, exits: [{ type: "ARROW", to: 13 }, { type: "ARROW", to: 115 }, { type: "ARROW", to: 17 }] },
  { id: 400, terrain: "Tower", col: 7, row: 1, cube: { x: 7, y: -5, z: -2 }, exits: [{ type: "ARROW", to: 20 }, { type: "ARROW", to: 122 }, { type: "ARROW", to: 24 }] },
  { id: 500, terrain: "Tower", col: 3, row: 2, cube: { x: 3, y: -4, z: 1 }, exits: [{ type: "ARROW", to: 27 }, { type: "ARROW", to: 129 }, { type: "ARROW", to: 31 }] },
  { id: 600, terrain: "Tower", col: 3, row: 5, cube: { x: 3, y: -7, z: 4 }, exits: [{ type: "ARROW", to: 34 }, { type: "ARROW", to: 136 }, { type: "ARROW", to: 38 }] },
  { id: 1, terrain: "Plains", col: 7, row: 5, cube: { x: 7, y: -9, z: 2 }, exits: [{ type: "ARROWS", to: 2 }, { type: "ARCH", to: 1000 }] },
  { id: 2, terrain: "Woods", col: 8, row: 5, cube: { x: 8, y: -9, z: 1 }, exits: [{ type: "ARROWS", to: 3 }, { type: "ARCH", to: 7 }] },
  { id: 3, terrain: "Brush", col: 8, row: 6, cube: { x: 8, y: -10, z: 2 }, exits: [{ type: "ARROWS", to: 4 }, { type: "ARCH", to: 100 }] },
  { id: 4, terrain: "Hills", col: 9, row: 6, cube: { x: 9, y: -11, z: 2 }, exits: [{ type: "ARROWS", to: 5 }, { type: "BLOCK", to: 103 }] },
  { id: 5, terrain: "Jungle", col: 10, row: 6, cube: { x: 10, y: -11, z: 1 }, exits: [{ type: "ARROWS", to: 6 }, { type: "BLOCK", to: 106 }] },
  { id: 6, terrain: "Plains", col: 10, row: 5, cube: { x: 10, y: -10, z: 0 }, exits: [{ type: "ARROWS", to: 7 }, { type: "ARCH", to: 200 }] },
  { id: 7, terrain: "Desert", col: 9, row: 5, cube: { x: 9, y: -10, z: 1 }, exits: [{ type: "ARROWS", to: 8 }, { type: "ARCH", to: 2 }] },
  { id: 8, terrain: "Marsh", col: 9, row: 4, cube: { x: 9, y: -9, z: 0 }, exits: [{ type: "ARROWS", to: 9 }, { type: "ARCH", to: 2000 }] },
  { id: 9, terrain: "Hills", col: 10, row: 4, cube: { x: 10, y: -9, z: -1 }, exits: [{ type: "ARROWS", to: 10 }, { type: "ARCH", to: 14 }] },
  { id: 10, terrain: "Brush", col: 11, row: 4, cube: { x: 11, y: -10, z: -1 }, exits: [{ type: "ARROWS", to: 11 }, { type: "ARCH", to: 200 }] },
  { id: 11, terrain: "Woods", col: 12, row: 4, cube: { x: 12, y: -10, z: -2 }, exits: [{ type: "ARROWS", to: 12 }, { type: "BLOCK", to: 110 }] },
  { id: 12, terrain: "Jungle", col: 12, row: 3, cube: { x: 12, y: -9, z: -3 }, exits: [{ type: "ARROWS", to: 13 }, { type: "BLOCK", to: 113 }] },
  { id: 13, terrain: "Marsh", col: 11, row: 3, cube: { x: 11, y: -9, z: -2 }, exits: [{ type: "ARROWS", to: 14 }, { type: "ARCH", to: 300 }] },
  { id: 14, terrain: "Swamp", col: 10, row: 3, cube: { x: 10, y: -8, z: -2 }, exits: [{ type: "ARROWS", to: 15 }, { type: "ARCH", to: 9 }] },
  { id: 15, terrain: "Plains", col: 9, row: 3, cube: { x: 9, y: -8, z: -1 }, exits: [{ type: "ARROWS", to: 16 }, { type: "ARCH", to: 3000 }] },
  { id: 16, terrain: "Woods", col: 9, row: 2, cube: { x: 9, y: -7, z: -2 }, exits: [{ type: "ARROWS", to: 17 }, { type: "ARCH", to: 21 }] },
  { id: 17, terrain: "Brush", col: 10, row: 2, cube: { x: 10, y: -7, z: -3 }, exits: [{ type: "ARROWS", to: 18 }, { type: "ARCH", to: 300 }] },
  { id: 18, terrain: "Hills", col: 10, row: 1, cube: { x: 10, y: -6, z: -4 }, exits: [{ type: "ARROWS", to: 19 }, { type: "BLOCK", to: 117 }] },
  { id: 19, terrain: "Jungle", col: 9, row: 1, cube: { x: 9, y: -6, z: -3 }, exits: [{ type: "ARROWS", to: 20 }, { type: "BLOCK", to: 120 }] },
  { id: 20, terrain: "Plains", col: 8, row: 1, cube: { x: 8, y: -5, z: -3 }, exits: [{ type: "ARROWS", to: 21 }, { type: "ARCH", to: 400 }] },
  { id: 21, terrain: "Desert", col: 8, row: 2, cube: { x: 8, y: -6, z: -2 }, exits: [{ type: "ARROWS", to: 22 }, { type: "ARCH", to: 16 }] },
  { id: 22, terrain: "Marsh", col: 7, row: 2, cube: { x: 7, y: -6, z: -1 }, exits: [{ type: "ARROWS", to: 23 }, { type: "ARCH", to: 4000 }] },
  { id: 23, terrain: "Hills", col: 6, row: 2, cube: { x: 6, y: -5, z: -1 }, exits: [{ type: "ARROWS", to: 24 }, { type: "ARCH", to: 28 }] },
  { id: 24, terrain: "Brush", col: 6, row: 1, cube: { x: 6, y: -4, z: -2 }, exits: [{ type: "ARROWS", to: 25 }, { type: "ARCH", to: 400 }] },
  { id: 25, terrain: "Woods", col: 5, row: 1, cube: { x: 5, y: -4, z: -1 }, exits: [{ type: "ARROWS", to: 26 }, { type: "BLOCK", to: 124 }] },
  { id: 26, terrain: "Jungle", col: 4, row: 1, cube: { x: 4, y: -3, z: -1 }, exits: [{ type: "ARROWS", to: 27 }, { type: "BLOCK", to: 127 }] },
  { id: 27, terrain: "Marsh", col: 4, row: 2, cube: { x: 4, y: -4, z: 0 }, exits: [{ type: "ARROWS", to: 28 }, { type: "ARCH", to: 500 }] },
  { id: 28, terrain: "Swamp", col: 5, row: 2, cube: { x: 5, y: -5, z: 0 }, exits: [{ type: "ARROWS", to: 29 }, { type: "ARCH", to: 23 }] },
  { id: 29, terrain: "Plains", col: 5, row: 3, cube: { x: 5, y: -6, z: 1 }, exits: [{ type: "ARROWS", to: 30 }, { type: "ARCH", to: 5000 }] },
  { id: 30, terrain: "Woods", col: 4, row: 3, cube: { x: 4, y: -5, z: 1 }, exits: [{ type: "ARROWS", to: 31 }, { type: "ARCH", to: 35 }] },
  { id: 31, terrain: "Brush", col: 3, row: 3, cube: { x: 3, y: -5, z: 2 }, exits: [{ type: "ARROWS", to: 32 }, { type: "ARCH", to: 500 }] },
  { id: 32, terrain: "Hills", col: 2, row: 3, cube: { x: 2, y: -4, z: 2 }, exits: [{ type: "ARROWS", to: 33 }, { type: "BLOCK", to: 131 }] },
  { id: 33, terrain: "Jungle", col: 2, row: 4, cube: { x: 2, y: -5, z: 3 }, exits: [{ type: "ARROWS", to: 34 }, { type: "BLOCK", to: 134 }] },
  { id: 34, terrain: "Plains", col: 3, row: 4, cube: { x: 3, y: -6, z: 3 }, exits: [{ type: "ARROWS", to: 35 }, { type: "ARCH", to: 600 }] },
  { id: 35, terrain: "Desert", col: 4, row: 4, cube: { x: 4, y: -6, z: 2 }, exits: [{ type: "ARROWS", to: 36 }, { type: "ARCH", to: 30 }] },
  { id: 36, terrain: "Marsh", col: 5, row: 4, cube: { x: 5, y: -7, z: 2 }, exits: [{ type: "ARROWS", to: 37 }, { type: "ARCH", to: 6000 }] },
  { id: 37, terrain: "Hills", col: 5, row: 5, cube: { x: 5, y: -8, z: 3 }, exits: [{ type: "ARROWS", to: 38 }, { type: "ARCH", to: 42 }] },
  { id: 38, terrain: "Brush", col: 4, row: 5, cube: { x: 4, y: -7, z: 3 }, exits: [{ type: "ARROWS", to: 39 }, { type: "ARCH", to: 600 }] },
  { id: 39, terrain: "Woods", col: 4, row: 6, cube: { x: 4, y: -8, z: 4 }, exits: [{ type: "ARROWS", to: 40 }, { type: "BLOCK", to: 138 }] },
  { id: 40, terrain: "Jungle", col: 5, row: 6, cube: { x: 5, y: -9, z: 4 }, exits: [{ type: "ARROWS", to: 41 }, { type: "BLOCK", to: 141 }] },
  { id: 41, terrain: "Marsh", col: 6, row: 6, cube: { x: 6, y: -9, z: 3 }, exits: [{ type: "ARROWS", to: 42 }, { type: "ARCH", to: 100 }] },
  { id: 42, terrain: "Swamp", col: 6, row: 5, cube: { x: 6, y: -8, z: 2 }, exits: [{ type: "ARROWS", to: 1 }, { type: "ARCH", to: 37 }] },
  { id: 101, terrain: "Plains", col: 7, row: 7, cube: { x: 7, y: -11, z: 4 }, exits: [{ type: "ARROWS", to: 142 }, { type: "ARCH", to: 100 }] },
  { id: 102, terrain: "Brush", col: 8, row: 7, cube: { x: 8, y: -11, z: 3 }, exits: [{ type: "ARROWS", to: 101 }] },
  { id: 103, terrain: "Marsh", col: 9, row: 7, cube: { x: 9, y: -12, z: 3 }, exits: [{ type: "ARROWS", to: 102 }, { type: "ARCH", to: 4 }] },
  { id: 104, terrain: "Jungle", col: 10, row: 7, cube: { x: 10, y: -12, z: 2 }, exits: [{ type: "ARROWS", to: 103 }] },
  { id: 105, terrain: "Plains", col: 11, row: 7, cube: { x: 11, y: -13, z: 2 }, exits: [{ type: "ARROWS", to: 104 }] },
  { id: 106, terrain: "Brush", col: 11, row: 6, cube: { x: 11, y: -12, z: 1 }, exits: [{ type: "ARROWS", to: 105 }, { type: "ARCH", to: 5 }] },
  { id: 107, terrain: "Desert", col: 12, row: 6, cube: { x: 12, y: -12, z: 0 }, exits: [{ type: "ARROWS", to: 106 }] },
  { id: 108, terrain: "Marsh", col: 12, row: 5, cube: { x: 12, y: -11, z: -1 }, exits: [{ type: "ARROWS", to: 107 }, { type: "ARCH", to: 200 }] },
  { id: 109, terrain: "Brush", col: 13, row: 5, cube: { x: 13, y: -12, z: -1 }, exits: [{ type: "ARROWS", to: 108 }] },
  { id: 110, terrain: "Plains", col: 13, row: 4, cube: { x: 13, y: -11, z: -2 }, exits: [{ type: "ARROWS", to: 109 }, { type: "ARCH", to: 11 }] },
  { id: 111, terrain: "Swamp", col: 14, row: 4, cube: { x: 14, y: -11, z: -3 }, exits: [{ type: "ARROWS", to: 110 }] },
  { id: 112, terrain: "Marsh", col: 14, row: 3, cube: { x: 14, y: -10, z: -4 }, exits: [{ type: "ARROWS", to: 111 }] },
  { id: 113, terrain: "Brush", col: 13, row: 3, cube: { x: 13, y: -10, z: -3 }, exits: [{ type: "ARROWS", to: 112 }, { type: "ARCH", to: 12 }] },
  { id: 114, terrain: "Jungle", col: 13, row: 2, cube: { x: 13, y: -9, z: -4 }, exits: [{ type: "ARROWS", to: 113 }] },
  { id: 115, terrain: "Plains", col: 12, row: 2, cube: { x: 12, y: -8, z: -4 }, exits: [{ type: "ARROWS", to: 114 }, { type: "ARCH", to: 300 }] },
  { id: 116, terrain: "Brush", col: 12, row: 1, cube: { x: 12, y: -7, z: -5 }, exits: [{ type: "ARROWS", to: 115 }] },
  { id: 117, terrain: "Marsh", col: 11, row: 1, cube: { x: 11, y: -7, z: -4 }, exits: [{ type: "ARROWS", to: 116 }, { type: "ARCH", to: 18 }] },
  { id: 118, terrain: "Desert", col: 11, row: 0, cube: { x: 11, y: -6, z: -5 }, exits: [{ type: "ARROWS", to: 117 }] },
  { id: 119, terrain: "Plains", col: 10, row: 0, cube: { x: 10, y: -5, z: -5 }, exits: [{ type: "ARROWS", to: 118 }] },
  { id: 120, terrain: "Brush", col: 9, row: 0, cube: { x: 9, y: -5, z: -4 }, exits: [{ type: "ARROWS", to: 119 }, { type: "ARCH", to: 19 }] },
  { id: 121, terrain: "Swamp", col: 8, row: 0, cube: { x: 8, y: -4, z: -4 }, exits: [{ type: "ARROWS", to: 120 }] },
  { id: 122, terrain: "Marsh", col: 7, row: 0, cube: { x: 7, y: -4, z: -3 }, exits: [{ type: "ARROWS", to: 121 }, { type: "ARCH", to: 400 }] },
  { id: 123, terrain: "Brush", col: 6, row: 0, cube: { x: 6, y: -3, z: -3 }, exits: [{ type: "ARROWS", to: 122 }] },
  { id: 124, terrain: "Plains", col: 5, row: 0, cube: { x: 5, y: -3, z: -2 }, exits: [{ type: "ARROWS", to: 123 }, { type: "ARCH", to: 25 }] },
  { id: 125, terrain: "Jungle", col: 4, row: 0, cube: { x: 4, y: -2, z: -2 }, exits: [{ type: "ARROWS", to: 124 }] },
  { id: 126, terrain: "Marsh", col: 3, row: 0, cube: { x: 3, y: -2, z: -1 }, exits: [{ type: "ARROWS", to: 125 }] },
  { id: 127, terrain: "Brush", col: 3, row: 1, cube: { x: 3, y: -3, z: 0 }, exits: [{ type: "ARROWS", to: 126 }, { type: "ARCH", to: 26 }] },
  { id: 128, terrain: "Desert", col: 2, row: 1, cube: { x: 2, y: -2, z: 0 }, exits: [{ type: "ARROWS", to: 127 }] },
  { id: 129, terrain: "Plains", col: 2, row: 2, cube: { x: 2, y: -3, z: 1 }, exits: [{ type: "ARROWS", to: 128 }, { type: "ARCH", to: 500 }] },
  { id: 130, terrain: "Brush", col: 1, row: 2, cube: { x: 1, y: -3, z: 2 }, exits: [{ type: "ARROWS", to: 129 }] },
  { id: 131, terrain: "Marsh", col: 1, row: 3, cube: { x: 1, y: -4, z: 3 }, exits: [{ type: "ARROWS", to: 130 }, { type: "ARCH", to: 32 }] },
  { id: 132, terrain: "Swamp", col: 0, row: 3, cube: { x: 0, y: -3, z: 3 }, exits: [{ type: "ARROWS", to: 131 }] },
  { id: 133, terrain: "Plains", col: 0, row: 4, cube: { x: 0, y: -4, z: 4 }, exits: [{ type: "ARROWS", to: 132 }] },
  { id: 134, terrain: "Brush", col: 1, row: 4, cube: { x: 1, y: -5, z: 4 }, exits: [{ type: "ARROWS", to: 133 }, { type: "ARCH", to: 33 }] },
  { id: 135, terrain: "Jungle", col: 1, row: 5, cube: { x: 1, y: -6, z: 5 }, exits: [{ type: "ARROWS", to: 134 }] },
  { id: 136, terrain: "Marsh", col: 2, row: 5, cube: { x: 2, y: -6, z: 4 }, exits: [{ type: "ARROWS", to: 135 }, { type: "ARCH", to: 600 }] },
  { id: 137, terrain: "Brush", col: 2, row: 6, cube: { x: 2, y: -7, z: 5 }, exits: [{ type: "ARROWS", to: 136 }] },
  { id: 138, terrain: "Plains", col: 3, row: 6, cube: { x: 3, y: -8, z: 5 }, exits: [{ type: "ARROWS", to: 137 }, { type: "ARCH", to: 39 }] },
  { id: 139, terrain: "Desert", col: 3, row: 7, cube: { x: 3, y: -9, z: 6 }, exits: [{ type: "ARROWS", to: 138 }] },
  { id: 140, terrain: "Marsh", col: 4, row: 7, cube: { x: 4, y: -9, z: 5 }, exits: [{ type: "ARROWS", to: 139 }] },
  { id: 141, terrain: "Brush", col: 5, row: 7, cube: { x: 5, y: -10, z: 5 }, exits: [{ type: "ARROWS", to: 140 }, { type: "ARCH", to: 40 }] },
  { id: 142, terrain: "Swamp", col: 6, row: 7, cube: { x: 6, y: -10, z: 4 }, exits: [{ type: "ARROWS", to: 141 }] },
  { id: 1000, terrain: "Mountains", col: 7, row: 4, cube: { x: 7, y: -8, z: 1 }, exits: [{ type: "BLOCK", to: 1 }, { type: "ARROW", to: 2000 }, { type: "ARROW", to: 6000 }] },
  { id: 2000, terrain: "Tundra", col: 8, row: 4, cube: { x: 8, y: -8, z: 0 }, exits: [{ type: "BLOCK", to: 8 }, { type: "ARROW", to: 3000 }, { type: "ARROW", to: 1000 }] },
  { id: 3000, terrain: "Mountains", col: 8, row: 3, cube: { x: 8, y: -7, z: -1 }, exits: [{ type: "BLOCK", to: 15 }, { type: "ARROW", to: 4000 }, { type: "ARROW", to: 2000 }] },
  { id: 4000, terrain: "Tundra", col: 7, row: 3, cube: { x: 7, y: -7, z: 0 }, exits: [{ type: "BLOCK", to: 22 }, { type: "ARROW", to: 5000 }, { type: "ARROW", to: 3000 }] },
  { id: 5000, terrain: "Mountains", col: 6, row: 3, cube: { x: 6, y: -6, z: 0 }, exits: [{ type: "BLOCK", to: 29 }, { type: "ARROW", to: 6000 }, { type: "ARROW", to: 4000 }] },
  { id: 6000, terrain: "Tundra", col: 6, row: 4, cube: { x: 6, y: -7, z: 1 }, exits: [{ type: "BLOCK", to: 36 }, { type: "ARROW", to: 1000 }, { type: "ARROW", to: 5000 }] },];

/** Indexed lookup by land id, built once. */
export const LAND_BY_ID: ReadonlyMap<LandId, MasterLand> = new Map(
  MASTER_LANDS.map((l) => [l.id, l]),
);

export function getLand(id: LandId): MasterLand | undefined {
  return LAND_BY_ID.get(id);
}
