/**
 * Battleland map data (Titan engine, module: battleland).
 *
 * SOURCE OF TRUTH: the Colossus Default variant battle-map XMLs (Plains.xml,
 * Brush.xml, … Woods.xml) + battlemap.dtd. Mechanically converted, then
 * re-verified by battleland.test.ts (27 hexes each, valid cubes, label scheme
 * matching the DTD, border reciprocity).
 *
 * GEOMETRY (derived and verified, not assumed):
 *  - 27 hexes in six flat-top columns A–F with heights 3,4,5,6,5,4. Labels
 *    increase left→right (column) and bottom→top (number), per the DTD.
 *  - Colossus (x,y): x = column 0..5, y = row index. Mapped to cube via an
 *    odd-q flat-top embedding; all 27 cubes are distinct and adjacency is
 *    physically correct (verified against the Tower wall ring).
 *  - Border `dir` is the hexside direction index 0..5 and equals module 1's
 *    DIRECTIONS order EXACTLY (N=0, NE=1, SE=2, S=3, SW=4, NW=5) — proven by
 *    solving the Tower's wall geometry; the permutation is the identity.
 *
 * Only NON-DEFAULT hexes are special; every other hex is Plains/elevation 0.
 * The converter expanded each map to the full 27 so callers never special-case
 * "missing" hexes.
 *
 * HEX TERRAIN (in-hex hazards): Plains, Brambles, Sand, Bog, Drift, Tree,
 * Volcano, Tower, Lake, Stone, Abyss (last three unused in Default).
 * BORDER TYPES (hexside features): "w" wall, "s" slope, "c" cliff, "d" dune
 * ("r" river exists in the DTD but is unused in Default).
 */

import type { CubeCoord } from "../hex/cube.ts";

export type HexTerrain =
  | "Plains"
  | "Brambles"
  | "Sand"
  | "Bog"
  | "Drift"
  | "Tree"
  | "Volcano"
  | "Tower"
  | "Lake"
  | "Stone"
  | "Abyss";

/** Hexside feature codes from the Colossus DTD. */
export type BorderType = "w" | "s" | "c" | "d" | "r";

export interface HexBorder {
  /** Direction index 0..5 (== module 1 DIRECTIONS order). */
  readonly dir: number;
  readonly type: BorderType;
}

export interface BattleHex {
  /** Board label, e.g. "D4". */
  readonly label: string;
  /** Colossus column 0..5 (rendering). */
  readonly x: number;
  /** Colossus row (rendering). */
  readonly y: number;
  /** Canonical cube coordinate (movement & LOS run on this). */
  readonly cube: CubeCoord;
  readonly terrain: HexTerrain;
  readonly elevation: number;
  /** Hexside features on this hex's edges. */
  readonly borders: readonly HexBorder[];
}

export interface BattleMap {
  readonly terrain: string;
  /** True only for the Tower battleland. */
  readonly tower: boolean;
  /** Defender start hexes (Tower only in Default); attacker entry is by side. */
  readonly startlist: readonly string[];
  readonly hexes: readonly BattleHex[];
}

/** The eleven battlelands, mechanically generated from the Colossus XMLs. */
export const BATTLE_MAPS: Readonly<Record<string, BattleMap>> = {
  Plains: {
    terrain: "Plains",
    tower: false,
    startlist: [],
    hexes: [
        { label: "A3", x: 0, y: 2, cube: { x: 0, y: -2, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "A2", x: 0, y: 3, cube: { x: 0, y: -3, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "A1", x: 0, y: 4, cube: { x: 0, y: -4, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B4", x: 1, y: 1, cube: { x: 1, y: -2, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B3", x: 1, y: 2, cube: { x: 1, y: -3, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B2", x: 1, y: 3, cube: { x: 1, y: -4, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B1", x: 1, y: 4, cube: { x: 1, y: -5, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C5", x: 2, y: 1, cube: { x: 2, y: -2, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C4", x: 2, y: 2, cube: { x: 2, y: -3, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C3", x: 2, y: 3, cube: { x: 2, y: -4, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C2", x: 2, y: 4, cube: { x: 2, y: -5, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C1", x: 2, y: 5, cube: { x: 2, y: -6, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D6", x: 3, y: 0, cube: { x: 3, y: -2, z: -1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D5", x: 3, y: 1, cube: { x: 3, y: -3, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D4", x: 3, y: 2, cube: { x: 3, y: -4, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D3", x: 3, y: 3, cube: { x: 3, y: -5, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D2", x: 3, y: 4, cube: { x: 3, y: -6, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D1", x: 3, y: 5, cube: { x: 3, y: -7, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E5", x: 4, y: 1, cube: { x: 4, y: -3, z: -1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E4", x: 4, y: 2, cube: { x: 4, y: -4, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E3", x: 4, y: 3, cube: { x: 4, y: -5, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E2", x: 4, y: 4, cube: { x: 4, y: -6, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E1", x: 4, y: 5, cube: { x: 4, y: -7, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F4", x: 5, y: 1, cube: { x: 5, y: -4, z: -1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F3", x: 5, y: 2, cube: { x: 5, y: -5, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F2", x: 5, y: 3, cube: { x: 5, y: -6, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F1", x: 5, y: 4, cube: { x: 5, y: -7, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
    ],
  },
  Brush: {
    terrain: "Brush",
    tower: false,
    startlist: [],
    hexes: [
        { label: "A3", x: 0, y: 2, cube: { x: 0, y: -2, z: 2 }, terrain: "Brambles", elevation: 0, borders: [] },
        { label: "A2", x: 0, y: 3, cube: { x: 0, y: -3, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "A1", x: 0, y: 4, cube: { x: 0, y: -4, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B4", x: 1, y: 1, cube: { x: 1, y: -2, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B3", x: 1, y: 2, cube: { x: 1, y: -3, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B2", x: 1, y: 3, cube: { x: 1, y: -4, z: 3 }, terrain: "Brambles", elevation: 0, borders: [] },
        { label: "B1", x: 1, y: 4, cube: { x: 1, y: -5, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C5", x: 2, y: 1, cube: { x: 2, y: -2, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C4", x: 2, y: 2, cube: { x: 2, y: -3, z: 1 }, terrain: "Brambles", elevation: 0, borders: [] },
        { label: "C3", x: 2, y: 3, cube: { x: 2, y: -4, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C2", x: 2, y: 4, cube: { x: 2, y: -5, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C1", x: 2, y: 5, cube: { x: 2, y: -6, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D6", x: 3, y: 0, cube: { x: 3, y: -2, z: -1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D5", x: 3, y: 1, cube: { x: 3, y: -3, z: 0 }, terrain: "Brambles", elevation: 0, borders: [] },
        { label: "D4", x: 3, y: 2, cube: { x: 3, y: -4, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D3", x: 3, y: 3, cube: { x: 3, y: -5, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D2", x: 3, y: 4, cube: { x: 3, y: -6, z: 3 }, terrain: "Brambles", elevation: 0, borders: [] },
        { label: "D1", x: 3, y: 5, cube: { x: 3, y: -7, z: 4 }, terrain: "Brambles", elevation: 0, borders: [] },
        { label: "E5", x: 4, y: 1, cube: { x: 4, y: -3, z: -1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E4", x: 4, y: 2, cube: { x: 4, y: -4, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E3", x: 4, y: 3, cube: { x: 4, y: -5, z: 1 }, terrain: "Brambles", elevation: 0, borders: [] },
        { label: "E2", x: 4, y: 4, cube: { x: 4, y: -6, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E1", x: 4, y: 5, cube: { x: 4, y: -7, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F4", x: 5, y: 1, cube: { x: 5, y: -4, z: -1 }, terrain: "Brambles", elevation: 0, borders: [] },
        { label: "F3", x: 5, y: 2, cube: { x: 5, y: -5, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F2", x: 5, y: 3, cube: { x: 5, y: -6, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F1", x: 5, y: 4, cube: { x: 5, y: -7, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
    ],
  },
  Desert: {
    terrain: "Desert",
    tower: false,
    startlist: [],
    hexes: [
        { label: "A3", x: 0, y: 2, cube: { x: 0, y: -2, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "A2", x: 0, y: 3, cube: { x: 0, y: -3, z: 3 }, terrain: "Sand", elevation: 0, borders: [{ dir: 0, type: "d" }, { dir: 1, type: "d" }] },
        { label: "A1", x: 0, y: 4, cube: { x: 0, y: -4, z: 4 }, terrain: "Sand", elevation: 0, borders: [] },
        { label: "B4", x: 1, y: 1, cube: { x: 1, y: -2, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B3", x: 1, y: 2, cube: { x: 1, y: -3, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B2", x: 1, y: 3, cube: { x: 1, y: -4, z: 3 }, terrain: "Sand", elevation: 0, borders: [{ dir: 0, type: "d" }, { dir: 1, type: "d" }, { dir: 2, type: "d" }, { dir: 3, type: "c" }] },
        { label: "B1", x: 1, y: 4, cube: { x: 1, y: -5, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C5", x: 2, y: 1, cube: { x: 2, y: -2, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C4", x: 2, y: 2, cube: { x: 2, y: -3, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C3", x: 2, y: 3, cube: { x: 2, y: -4, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C2", x: 2, y: 4, cube: { x: 2, y: -5, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C1", x: 2, y: 5, cube: { x: 2, y: -6, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D6", x: 3, y: 0, cube: { x: 3, y: -2, z: -1 }, terrain: "Sand", elevation: 0, borders: [] },
        { label: "D5", x: 3, y: 1, cube: { x: 3, y: -3, z: 0 }, terrain: "Sand", elevation: 0, borders: [{ dir: 4, type: "d" }] },
        { label: "D4", x: 3, y: 2, cube: { x: 3, y: -4, z: 1 }, terrain: "Sand", elevation: 0, borders: [{ dir: 2, type: "d" }, { dir: 3, type: "c" }, { dir: 4, type: "c" }, { dir: 5, type: "d" }] },
        { label: "D3", x: 3, y: 3, cube: { x: 3, y: -5, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D2", x: 3, y: 4, cube: { x: 3, y: -6, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D1", x: 3, y: 5, cube: { x: 3, y: -7, z: 4 }, terrain: "Sand", elevation: 0, borders: [{ dir: 0, type: "d" }, { dir: 5, type: "d" }] },
        { label: "E5", x: 4, y: 1, cube: { x: 4, y: -3, z: -1 }, terrain: "Sand", elevation: 0, borders: [] },
        { label: "E4", x: 4, y: 2, cube: { x: 4, y: -4, z: 0 }, terrain: "Sand", elevation: 0, borders: [{ dir: 2, type: "d" }, { dir: 3, type: "d" }] },
        { label: "E3", x: 4, y: 3, cube: { x: 4, y: -5, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E2", x: 4, y: 4, cube: { x: 4, y: -6, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E1", x: 4, y: 5, cube: { x: 4, y: -7, z: 3 }, terrain: "Sand", elevation: 0, borders: [{ dir: 0, type: "c" }, { dir: 1, type: "d" }, { dir: 5, type: "d" }] },
        { label: "F4", x: 5, y: 1, cube: { x: 5, y: -4, z: -1 }, terrain: "Sand", elevation: 0, borders: [] },
        { label: "F3", x: 5, y: 2, cube: { x: 5, y: -5, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F2", x: 5, y: 3, cube: { x: 5, y: -6, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F1", x: 5, y: 4, cube: { x: 5, y: -7, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
    ],
  },
  Hills: {
    terrain: "Hills",
    tower: false,
    startlist: [],
    hexes: [
        { label: "A3", x: 0, y: 2, cube: { x: 0, y: -2, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "A2", x: 0, y: 3, cube: { x: 0, y: -3, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "A1", x: 0, y: 4, cube: { x: 0, y: -4, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B4", x: 1, y: 1, cube: { x: 1, y: -2, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B3", x: 1, y: 2, cube: { x: 1, y: -3, z: 2 }, terrain: "Plains", elevation: 1, borders: [{ dir: 0, type: "s" }, { dir: 1, type: "s" }, { dir: 2, type: "s" }, { dir: 3, type: "s" }, { dir: 4, type: "s" }, { dir: 5, type: "s" }] },
        { label: "B2", x: 1, y: 3, cube: { x: 1, y: -4, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B1", x: 1, y: 4, cube: { x: 1, y: -5, z: 4 }, terrain: "Plains", elevation: 1, borders: [{ dir: 0, type: "s" }, { dir: 1, type: "s" }, { dir: 2, type: "s" }, { dir: 5, type: "s" }] },
        { label: "C5", x: 2, y: 1, cube: { x: 2, y: -2, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C4", x: 2, y: 2, cube: { x: 2, y: -3, z: 1 }, terrain: "Tree", elevation: 1, borders: [] },
        { label: "C3", x: 2, y: 3, cube: { x: 2, y: -4, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C2", x: 2, y: 4, cube: { x: 2, y: -5, z: 3 }, terrain: "Tree", elevation: 1, borders: [] },
        { label: "C1", x: 2, y: 5, cube: { x: 2, y: -6, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D6", x: 3, y: 0, cube: { x: 3, y: -2, z: -1 }, terrain: "Plains", elevation: 1, borders: [{ dir: 2, type: "s" }, { dir: 3, type: "s" }, { dir: 4, type: "s" }] },
        { label: "D5", x: 3, y: 1, cube: { x: 3, y: -3, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D4", x: 3, y: 2, cube: { x: 3, y: -4, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D3", x: 3, y: 3, cube: { x: 3, y: -5, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D2", x: 3, y: 4, cube: { x: 3, y: -6, z: 3 }, terrain: "Plains", elevation: 1, borders: [{ dir: 0, type: "s" }, { dir: 1, type: "s" }, { dir: 2, type: "s" }, { dir: 3, type: "s" }, { dir: 4, type: "s" }, { dir: 5, type: "s" }] },
        { label: "D1", x: 3, y: 5, cube: { x: 3, y: -7, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E5", x: 4, y: 1, cube: { x: 4, y: -3, z: -1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E4", x: 4, y: 2, cube: { x: 4, y: -4, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E3", x: 4, y: 3, cube: { x: 4, y: -5, z: 1 }, terrain: "Plains", elevation: 1, borders: [{ dir: 0, type: "s" }, { dir: 1, type: "s" }, { dir: 2, type: "s" }, { dir: 3, type: "s" }, { dir: 4, type: "s" }, { dir: 5, type: "s" }] },
        { label: "E2", x: 4, y: 4, cube: { x: 4, y: -6, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E1", x: 4, y: 5, cube: { x: 4, y: -7, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F4", x: 5, y: 1, cube: { x: 5, y: -4, z: -1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F3", x: 5, y: 2, cube: { x: 5, y: -5, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F2", x: 5, y: 3, cube: { x: 5, y: -6, z: 1 }, terrain: "Tree", elevation: 1, borders: [] },
        { label: "F1", x: 5, y: 4, cube: { x: 5, y: -7, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
    ],
  },
  Jungle: {
    terrain: "Jungle",
    tower: false,
    startlist: [],
    hexes: [
        { label: "A3", x: 0, y: 2, cube: { x: 0, y: -2, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "A2", x: 0, y: 3, cube: { x: 0, y: -3, z: 3 }, terrain: "Brambles", elevation: 0, borders: [] },
        { label: "A1", x: 0, y: 4, cube: { x: 0, y: -4, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B4", x: 1, y: 1, cube: { x: 1, y: -2, z: 1 }, terrain: "Tree", elevation: 1, borders: [] },
        { label: "B3", x: 1, y: 2, cube: { x: 1, y: -3, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B2", x: 1, y: 3, cube: { x: 1, y: -4, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B1", x: 1, y: 4, cube: { x: 1, y: -5, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C5", x: 2, y: 1, cube: { x: 2, y: -2, z: 0 }, terrain: "Brambles", elevation: 0, borders: [] },
        { label: "C4", x: 2, y: 2, cube: { x: 2, y: -3, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C3", x: 2, y: 3, cube: { x: 2, y: -4, z: 2 }, terrain: "Brambles", elevation: 0, borders: [] },
        { label: "C2", x: 2, y: 4, cube: { x: 2, y: -5, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C1", x: 2, y: 5, cube: { x: 2, y: -6, z: 4 }, terrain: "Brambles", elevation: 0, borders: [] },
        { label: "D6", x: 3, y: 0, cube: { x: 3, y: -2, z: -1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D5", x: 3, y: 1, cube: { x: 3, y: -3, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D4", x: 3, y: 2, cube: { x: 3, y: -4, z: 1 }, terrain: "Brambles", elevation: 0, borders: [] },
        { label: "D3", x: 3, y: 3, cube: { x: 3, y: -5, z: 2 }, terrain: "Tree", elevation: 1, borders: [] },
        { label: "D2", x: 3, y: 4, cube: { x: 3, y: -6, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D1", x: 3, y: 5, cube: { x: 3, y: -7, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E5", x: 4, y: 1, cube: { x: 4, y: -3, z: -1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E4", x: 4, y: 2, cube: { x: 4, y: -4, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E3", x: 4, y: 3, cube: { x: 4, y: -5, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E2", x: 4, y: 4, cube: { x: 4, y: -6, z: 2 }, terrain: "Brambles", elevation: 0, borders: [] },
        { label: "E1", x: 4, y: 5, cube: { x: 4, y: -7, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F4", x: 5, y: 1, cube: { x: 5, y: -4, z: -1 }, terrain: "Brambles", elevation: 0, borders: [] },
        { label: "F3", x: 5, y: 2, cube: { x: 5, y: -5, z: 0 }, terrain: "Tree", elevation: 1, borders: [] },
        { label: "F2", x: 5, y: 3, cube: { x: 5, y: -6, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F1", x: 5, y: 4, cube: { x: 5, y: -7, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
    ],
  },
  Marsh: {
    terrain: "Marsh",
    tower: false,
    startlist: [],
    hexes: [
        { label: "A3", x: 0, y: 2, cube: { x: 0, y: -2, z: 2 }, terrain: "Bog", elevation: 0, borders: [] },
        { label: "A2", x: 0, y: 3, cube: { x: 0, y: -3, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "A1", x: 0, y: 4, cube: { x: 0, y: -4, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B4", x: 1, y: 1, cube: { x: 1, y: -2, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B3", x: 1, y: 2, cube: { x: 1, y: -3, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B2", x: 1, y: 3, cube: { x: 1, y: -4, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B1", x: 1, y: 4, cube: { x: 1, y: -5, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C5", x: 2, y: 1, cube: { x: 2, y: -2, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C4", x: 2, y: 2, cube: { x: 2, y: -3, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C3", x: 2, y: 3, cube: { x: 2, y: -4, z: 2 }, terrain: "Bog", elevation: 0, borders: [] },
        { label: "C2", x: 2, y: 4, cube: { x: 2, y: -5, z: 3 }, terrain: "Bog", elevation: 0, borders: [] },
        { label: "C1", x: 2, y: 5, cube: { x: 2, y: -6, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D6", x: 3, y: 0, cube: { x: 3, y: -2, z: -1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D5", x: 3, y: 1, cube: { x: 3, y: -3, z: 0 }, terrain: "Bog", elevation: 0, borders: [] },
        { label: "D4", x: 3, y: 2, cube: { x: 3, y: -4, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D3", x: 3, y: 3, cube: { x: 3, y: -5, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D2", x: 3, y: 4, cube: { x: 3, y: -6, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D1", x: 3, y: 5, cube: { x: 3, y: -7, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E5", x: 4, y: 1, cube: { x: 4, y: -3, z: -1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E4", x: 4, y: 2, cube: { x: 4, y: -4, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E3", x: 4, y: 3, cube: { x: 4, y: -5, z: 1 }, terrain: "Bog", elevation: 0, borders: [] },
        { label: "E2", x: 4, y: 4, cube: { x: 4, y: -6, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E1", x: 4, y: 5, cube: { x: 4, y: -7, z: 3 }, terrain: "Bog", elevation: 0, borders: [] },
        { label: "F4", x: 5, y: 1, cube: { x: 5, y: -4, z: -1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F3", x: 5, y: 2, cube: { x: 5, y: -5, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F2", x: 5, y: 3, cube: { x: 5, y: -6, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F1", x: 5, y: 4, cube: { x: 5, y: -7, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
    ],
  },
  Mountains: {
    terrain: "Mountains",
    tower: false,
    startlist: [],
    hexes: [
        { label: "A3", x: 0, y: 2, cube: { x: 0, y: -2, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "A2", x: 0, y: 3, cube: { x: 0, y: -3, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "A1", x: 0, y: 4, cube: { x: 0, y: -4, z: 4 }, terrain: "Plains", elevation: 1, borders: [{ dir: 0, type: "s" }] },
        { label: "B4", x: 1, y: 1, cube: { x: 1, y: -2, z: 1 }, terrain: "Plains", elevation: 1, borders: [{ dir: 3, type: "s" }, { dir: 4, type: "s" }] },
        { label: "B3", x: 1, y: 2, cube: { x: 1, y: -3, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B2", x: 1, y: 3, cube: { x: 1, y: -4, z: 3 }, terrain: "Plains", elevation: 1, borders: [{ dir: 0, type: "s" }, { dir: 1, type: "s" }, { dir: 2, type: "s" }, { dir: 5, type: "s" }] },
        { label: "B1", x: 1, y: 4, cube: { x: 1, y: -5, z: 4 }, terrain: "Plains", elevation: 2, borders: [{ dir: 0, type: "s" }, { dir: 1, type: "c" }, { dir: 2, type: "s" }, { dir: 5, type: "s" }] },
        { label: "C5", x: 2, y: 1, cube: { x: 2, y: -2, z: 0 }, terrain: "Plains", elevation: 2, borders: [{ dir: 2, type: "s" }, { dir: 3, type: "s" }, { dir: 4, type: "s" }] },
        { label: "C4", x: 2, y: 2, cube: { x: 2, y: -3, z: 1 }, terrain: "Plains", elevation: 1, borders: [{ dir: 3, type: "s" }, { dir: 4, type: "s" }] },
        { label: "C3", x: 2, y: 3, cube: { x: 2, y: -4, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C2", x: 2, y: 4, cube: { x: 2, y: -5, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C1", x: 2, y: 5, cube: { x: 2, y: -6, z: 4 }, terrain: "Plains", elevation: 1, borders: [{ dir: 0, type: "s" }, { dir: 1, type: "s" }, { dir: 2, type: "s" }] },
        { label: "D6", x: 3, y: 0, cube: { x: 3, y: -2, z: -1 }, terrain: "Plains", elevation: 2, borders: [{ dir: 2, type: "s" }, { dir: 3, type: "s" }] },
        { label: "D5", x: 3, y: 1, cube: { x: 3, y: -3, z: 0 }, terrain: "Plains", elevation: 1, borders: [] },
        { label: "D4", x: 3, y: 2, cube: { x: 3, y: -4, z: 1 }, terrain: "Volcano", elevation: 2, borders: [{ dir: 0, type: "s" }, { dir: 1, type: "s" }, { dir: 2, type: "s" }, { dir: 3, type: "s" }, { dir: 4, type: "c" }, { dir: 5, type: "s" }] },
        { label: "D3", x: 3, y: 3, cube: { x: 3, y: -5, z: 2 }, terrain: "Plains", elevation: 1, borders: [{ dir: 2, type: "s" }, { dir: 3, type: "s" }, { dir: 4, type: "s" }, { dir: 5, type: "s" }] },
        { label: "D2", x: 3, y: 4, cube: { x: 3, y: -6, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D1", x: 3, y: 5, cube: { x: 3, y: -7, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E5", x: 4, y: 1, cube: { x: 4, y: -3, z: -1 }, terrain: "Plains", elevation: 1, borders: [] },
        { label: "E4", x: 4, y: 2, cube: { x: 4, y: -4, z: 0 }, terrain: "Plains", elevation: 1, borders: [] },
        { label: "E3", x: 4, y: 3, cube: { x: 4, y: -5, z: 1 }, terrain: "Plains", elevation: 1, borders: [{ dir: 3, type: "s" }] },
        { label: "E2", x: 4, y: 4, cube: { x: 4, y: -6, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E1", x: 4, y: 5, cube: { x: 4, y: -7, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F4", x: 5, y: 1, cube: { x: 5, y: -4, z: -1 }, terrain: "Plains", elevation: 2, borders: [{ dir: 3, type: "s" }, { dir: 4, type: "s" }, { dir: 5, type: "s" }] },
        { label: "F3", x: 5, y: 2, cube: { x: 5, y: -5, z: 0 }, terrain: "Plains", elevation: 1, borders: [] },
        { label: "F2", x: 5, y: 3, cube: { x: 5, y: -6, z: 1 }, terrain: "Plains", elevation: 2, borders: [{ dir: 0, type: "s" }, { dir: 3, type: "s" }, { dir: 4, type: "c" }, { dir: 5, type: "s" }] },
        { label: "F1", x: 5, y: 4, cube: { x: 5, y: -7, z: 2 }, terrain: "Plains", elevation: 1, borders: [{ dir: 4, type: "s" }, { dir: 5, type: "s" }] },
    ],
  },
  Swamp: {
    terrain: "Swamp",
    tower: false,
    startlist: [],
    hexes: [
        { label: "A3", x: 0, y: 2, cube: { x: 0, y: -2, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "A2", x: 0, y: 3, cube: { x: 0, y: -3, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "A1", x: 0, y: 4, cube: { x: 0, y: -4, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B4", x: 1, y: 1, cube: { x: 1, y: -2, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B3", x: 1, y: 2, cube: { x: 1, y: -3, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B2", x: 1, y: 3, cube: { x: 1, y: -4, z: 3 }, terrain: "Bog", elevation: 0, borders: [] },
        { label: "B1", x: 1, y: 4, cube: { x: 1, y: -5, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C5", x: 2, y: 1, cube: { x: 2, y: -2, z: 0 }, terrain: "Bog", elevation: 0, borders: [] },
        { label: "C4", x: 2, y: 2, cube: { x: 2, y: -3, z: 1 }, terrain: "Tree", elevation: 1, borders: [] },
        { label: "C3", x: 2, y: 3, cube: { x: 2, y: -4, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C2", x: 2, y: 4, cube: { x: 2, y: -5, z: 3 }, terrain: "Tree", elevation: 1, borders: [] },
        { label: "C1", x: 2, y: 5, cube: { x: 2, y: -6, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D6", x: 3, y: 0, cube: { x: 3, y: -2, z: -1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D5", x: 3, y: 1, cube: { x: 3, y: -3, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D4", x: 3, y: 2, cube: { x: 3, y: -4, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D3", x: 3, y: 3, cube: { x: 3, y: -5, z: 2 }, terrain: "Bog", elevation: 0, borders: [] },
        { label: "D2", x: 3, y: 4, cube: { x: 3, y: -6, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D1", x: 3, y: 5, cube: { x: 3, y: -7, z: 4 }, terrain: "Bog", elevation: 0, borders: [] },
        { label: "E5", x: 4, y: 1, cube: { x: 4, y: -3, z: -1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E4", x: 4, y: 2, cube: { x: 4, y: -4, z: 0 }, terrain: "Tree", elevation: 1, borders: [] },
        { label: "E3", x: 4, y: 3, cube: { x: 4, y: -5, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E2", x: 4, y: 4, cube: { x: 4, y: -6, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E1", x: 4, y: 5, cube: { x: 4, y: -7, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F4", x: 5, y: 1, cube: { x: 5, y: -4, z: -1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F3", x: 5, y: 2, cube: { x: 5, y: -5, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F2", x: 5, y: 3, cube: { x: 5, y: -6, z: 1 }, terrain: "Bog", elevation: 0, borders: [] },
        { label: "F1", x: 5, y: 4, cube: { x: 5, y: -7, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
    ],
  },
  Tower: {
    terrain: "Tower",
    tower: true,
    startlist: ["D4", "C4", "E4", "D3", "C3", "E3", "D5"],
    hexes: [
        { label: "A3", x: 0, y: 2, cube: { x: 0, y: -2, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "A2", x: 0, y: 3, cube: { x: 0, y: -3, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "A1", x: 0, y: 4, cube: { x: 0, y: -4, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B4", x: 1, y: 1, cube: { x: 1, y: -2, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B3", x: 1, y: 2, cube: { x: 1, y: -3, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B2", x: 1, y: 3, cube: { x: 1, y: -4, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B1", x: 1, y: 4, cube: { x: 1, y: -5, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C5", x: 2, y: 1, cube: { x: 2, y: -2, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C4", x: 2, y: 2, cube: { x: 2, y: -3, z: 1 }, terrain: "Tower", elevation: 1, borders: [{ dir: 0, type: "w" }, { dir: 4, type: "w" }, { dir: 5, type: "w" }] },
        { label: "C3", x: 2, y: 3, cube: { x: 2, y: -4, z: 2 }, terrain: "Tower", elevation: 1, borders: [{ dir: 3, type: "w" }, { dir: 4, type: "w" }, { dir: 5, type: "w" }] },
        { label: "C2", x: 2, y: 4, cube: { x: 2, y: -5, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C1", x: 2, y: 5, cube: { x: 2, y: -6, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D6", x: 3, y: 0, cube: { x: 3, y: -2, z: -1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D5", x: 3, y: 1, cube: { x: 3, y: -3, z: 0 }, terrain: "Tower", elevation: 1, borders: [{ dir: 0, type: "w" }, { dir: 1, type: "w" }, { dir: 5, type: "w" }] },
        { label: "D4", x: 3, y: 2, cube: { x: 3, y: -4, z: 1 }, terrain: "Tower", elevation: 2, borders: [{ dir: 0, type: "w" }, { dir: 1, type: "w" }, { dir: 2, type: "w" }, { dir: 3, type: "w" }, { dir: 4, type: "w" }, { dir: 5, type: "w" }] },
        { label: "D3", x: 3, y: 3, cube: { x: 3, y: -5, z: 2 }, terrain: "Tower", elevation: 1, borders: [{ dir: 2, type: "w" }, { dir: 3, type: "w" }, { dir: 4, type: "w" }] },
        { label: "D2", x: 3, y: 4, cube: { x: 3, y: -6, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D1", x: 3, y: 5, cube: { x: 3, y: -7, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E5", x: 4, y: 1, cube: { x: 4, y: -3, z: -1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E4", x: 4, y: 2, cube: { x: 4, y: -4, z: 0 }, terrain: "Tower", elevation: 1, borders: [{ dir: 0, type: "w" }, { dir: 1, type: "w" }, { dir: 2, type: "w" }] },
        { label: "E3", x: 4, y: 3, cube: { x: 4, y: -5, z: 1 }, terrain: "Tower", elevation: 1, borders: [{ dir: 1, type: "w" }, { dir: 2, type: "w" }, { dir: 3, type: "w" }] },
        { label: "E2", x: 4, y: 4, cube: { x: 4, y: -6, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E1", x: 4, y: 5, cube: { x: 4, y: -7, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F4", x: 5, y: 1, cube: { x: 5, y: -4, z: -1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F3", x: 5, y: 2, cube: { x: 5, y: -5, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F2", x: 5, y: 3, cube: { x: 5, y: -6, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F1", x: 5, y: 4, cube: { x: 5, y: -7, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
    ],
  },
  Tundra: {
    terrain: "Tundra",
    tower: false,
    startlist: [],
    hexes: [
        { label: "A3", x: 0, y: 2, cube: { x: 0, y: -2, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "A2", x: 0, y: 3, cube: { x: 0, y: -3, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "A1", x: 0, y: 4, cube: { x: 0, y: -4, z: 4 }, terrain: "Drift", elevation: 0, borders: [] },
        { label: "B4", x: 1, y: 1, cube: { x: 1, y: -2, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B3", x: 1, y: 2, cube: { x: 1, y: -3, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B2", x: 1, y: 3, cube: { x: 1, y: -4, z: 3 }, terrain: "Drift", elevation: 0, borders: [] },
        { label: "B1", x: 1, y: 4, cube: { x: 1, y: -5, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C5", x: 2, y: 1, cube: { x: 2, y: -2, z: 0 }, terrain: "Drift", elevation: 0, borders: [] },
        { label: "C4", x: 2, y: 2, cube: { x: 2, y: -3, z: 1 }, terrain: "Drift", elevation: 0, borders: [] },
        { label: "C3", x: 2, y: 3, cube: { x: 2, y: -4, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C2", x: 2, y: 4, cube: { x: 2, y: -5, z: 3 }, terrain: "Drift", elevation: 0, borders: [] },
        { label: "C1", x: 2, y: 5, cube: { x: 2, y: -6, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D6", x: 3, y: 0, cube: { x: 3, y: -2, z: -1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D5", x: 3, y: 1, cube: { x: 3, y: -3, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D4", x: 3, y: 2, cube: { x: 3, y: -4, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D3", x: 3, y: 3, cube: { x: 3, y: -5, z: 2 }, terrain: "Drift", elevation: 0, borders: [] },
        { label: "D2", x: 3, y: 4, cube: { x: 3, y: -6, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D1", x: 3, y: 5, cube: { x: 3, y: -7, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E5", x: 4, y: 1, cube: { x: 4, y: -3, z: -1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E4", x: 4, y: 2, cube: { x: 4, y: -4, z: 0 }, terrain: "Drift", elevation: 0, borders: [] },
        { label: "E3", x: 4, y: 3, cube: { x: 4, y: -5, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E2", x: 4, y: 4, cube: { x: 4, y: -6, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E1", x: 4, y: 5, cube: { x: 4, y: -7, z: 3 }, terrain: "Drift", elevation: 0, borders: [] },
        { label: "F4", x: 5, y: 1, cube: { x: 5, y: -4, z: -1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F3", x: 5, y: 2, cube: { x: 5, y: -5, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F2", x: 5, y: 3, cube: { x: 5, y: -6, z: 1 }, terrain: "Drift", elevation: 0, borders: [] },
        { label: "F1", x: 5, y: 4, cube: { x: 5, y: -7, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
    ],
  },
  Woods: {
    terrain: "Woods",
    tower: false,
    startlist: [],
    hexes: [
        { label: "A3", x: 0, y: 2, cube: { x: 0, y: -2, z: 2 }, terrain: "Tree", elevation: 1, borders: [] },
        { label: "A2", x: 0, y: 3, cube: { x: 0, y: -3, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "A1", x: 0, y: 4, cube: { x: 0, y: -4, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B4", x: 1, y: 1, cube: { x: 1, y: -2, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B3", x: 1, y: 2, cube: { x: 1, y: -3, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B2", x: 1, y: 3, cube: { x: 1, y: -4, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "B1", x: 1, y: 4, cube: { x: 1, y: -5, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C5", x: 2, y: 1, cube: { x: 2, y: -2, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C4", x: 2, y: 2, cube: { x: 2, y: -3, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C3", x: 2, y: 3, cube: { x: 2, y: -4, z: 2 }, terrain: "Tree", elevation: 1, borders: [] },
        { label: "C2", x: 2, y: 4, cube: { x: 2, y: -5, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "C1", x: 2, y: 5, cube: { x: 2, y: -6, z: 4 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D6", x: 3, y: 0, cube: { x: 3, y: -2, z: -1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D5", x: 3, y: 1, cube: { x: 3, y: -3, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D4", x: 3, y: 2, cube: { x: 3, y: -4, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D3", x: 3, y: 3, cube: { x: 3, y: -5, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D2", x: 3, y: 4, cube: { x: 3, y: -6, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "D1", x: 3, y: 5, cube: { x: 3, y: -7, z: 4 }, terrain: "Tree", elevation: 1, borders: [] },
        { label: "E5", x: 4, y: 1, cube: { x: 4, y: -3, z: -1 }, terrain: "Tree", elevation: 1, borders: [] },
        { label: "E4", x: 4, y: 2, cube: { x: 4, y: -4, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E3", x: 4, y: 3, cube: { x: 4, y: -5, z: 1 }, terrain: "Tree", elevation: 1, borders: [] },
        { label: "E2", x: 4, y: 4, cube: { x: 4, y: -6, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "E1", x: 4, y: 5, cube: { x: 4, y: -7, z: 3 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F4", x: 5, y: 1, cube: { x: 5, y: -4, z: -1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F3", x: 5, y: 2, cube: { x: 5, y: -5, z: 0 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F2", x: 5, y: 3, cube: { x: 5, y: -6, z: 1 }, terrain: "Plains", elevation: 0, borders: [] },
        { label: "F1", x: 5, y: 4, cube: { x: 5, y: -7, z: 2 }, terrain: "Plains", elevation: 0, borders: [] },
    ],
  },};

/** Lookup a battle map by masterboard terrain name. */
export function battleMapFor(masterTerrain: string): BattleMap | undefined {
  return BATTLE_MAPS[masterTerrain];
}
