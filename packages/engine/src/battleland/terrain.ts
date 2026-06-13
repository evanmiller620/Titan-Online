/**
 * Battleland terrain & hazard rules (Titan engine, module: battleland).
 *
 * Translates the static map data (in-hex terrain, hexside borders, elevation)
 * into the movement and combat effects the rules specify, and composes them
 * into the module-1 `MovementRules` so the pure cube pathfinder can compute a
 * creature's legal destinations on any battleland.
 *
 * The classic effects modelled here:
 *
 *  IN-HEX TERRAIN
 *   - Tree / Volcano:    block movement entry for everyone (impassable) and
 *                        block line of sight.
 *   - Bog:               only natives (Trolls, Ogres, …) may ENTER. Non-natives
 *                        cannot enter at all.
 *   - Brambles:          anyone may enter, but a non-native that enters must
 *                        STOP (slowed). Natives are unhindered. Also affects
 *                        strike skill (combat module 7) — flagged here.
 *   - Sand / Drift:      slowed for non-natives, like Brambles (Drift also
 *                        damages non-native non-flyers per round — combat-side).
 *   - Plains / Tower:    no movement penalty (Tower elevation handled by walls
 *                        & slopes on its hexsides).
 *
 *  HEXSIDE BORDERS (features on edges, consulted when CROSSING that edge)
 *   - "w" wall:          impassable to movement across that edge (Tower walls).
 *   - "c" cliff:         impassable to movement across that edge.
 *   - "s" slope:         passable; moving UP a slope (into higher elevation)
 *                        slows non-natives (must stop). Downhill/native free.
 *   - "d" dune:          passable; entering across a dune slows non-natives.
 *   - "r" river:         passable; slows non-natives (unused in Default maps).
 *
 * Flight overrides most ground penalties: a flyer ignores in-hex slowing and
 * hexside slope/dune/river for MOVEMENT (it still may not END on Tree/Volcano
 * or an occupied hex). Walls and cliffs still block even flyers crossing at
 * ground level in the classic rules? — In Titan, FLYERS ignore walls/cliffs
 * for movement (they fly over). We model that: flight bypasses wall/cliff/
 * slope/dune for traversal, but landing legality still respects impassable
 * in-hex terrain and occupancy.
 *
 * `isNativeTo` (creatures module) decides nativity per hazard. Occupancy is
 * injected by the caller (the battle has the live positions).
 */

import { directionBetween, cubeKey, type CubeCoord } from "../hex/cube.ts";
import type { MovementRules } from "../hex/pathfind.ts";
import type { BattleHex, BattleMap, BorderType, HexTerrain } from "./maps.data.ts";
import type { CreatureName } from "../creatures/names.ts";
import { isNativeTo, type BattleHazard } from "../creatures/stats.data.ts";

/** In-hex terrain that blocks movement entry and line of sight for everyone. */
export function isImpassableTerrain(t: HexTerrain): boolean {
  return t === "Tree" || t === "Volcano";
}

/** In-hex terrain that blocks line of sight (for rangestrike — module 7). */
export function blocksLineOfSight(t: HexTerrain): boolean {
  return t === "Tree" || t === "Volcano";
}

/** Map an in-hex terrain to the BattleHazard nativity key, if any. */
export function terrainHazard(t: HexTerrain): BattleHazard | null {
  switch (t) {
    case "Brambles": return "Brambles";
    case "Sand": return "Sand";
    case "Bog": return "Bog";
    case "Drift": return "Drift";
    case "Volcano": return "Volcano";
    case "Tree": return "Tree";
    case "Lake": return "Lake";
    case "Stone": return "Stone";
    default: return null; // Plains, Tower: no nativity hazard
  }
}

/** Map a hexside border to its BattleHazard nativity key, if any. */
export function borderHazard(b: BorderType): BattleHazard | null {
  switch (b) {
    case "s": return "slope";
    case "r": return "river";
    case "d": return "Drift"; // dunes are the Desert hazard; nativity via Sand? 
    default: return null; // walls/cliffs have no nativity — they just block
  }
}

/** Bog is enterable only by natives. */
export function bogEntryAllowed(name: CreatureName): boolean {
  return isNativeTo(name, "Bog");
}

/** A hex index for O(1) lookup by cube key. */
export interface BattleGrid {
  readonly map: BattleMap;
  readonly byKey: ReadonlyMap<string, BattleHex>;
}

export function indexMap(map: BattleMap): BattleGrid {
  const byKey = new Map<string, BattleHex>();
  for (const h of map.hexes) byKey.set(cubeKey(h.cube), h);
  return { map, byKey };
}

export function hexAt(grid: BattleGrid, c: CubeCoord): BattleHex | undefined {
  return grid.byKey.get(cubeKey(c));
}

/** The border feature on `from`'s edge toward `to`, if any. */
export function borderBetween(
  grid: BattleGrid,
  from: CubeCoord,
  to: CubeCoord,
): BorderType | null {
  const fromHex = hexAt(grid, from);
  if (!fromHex) return null;
  const dir = directionBetween(from, to);
  if (dir === null) return null;
  const b = fromHex.borders.find((bd) => bd.dir === dir);
  return b ? b.type : null;
}

export interface MovementContext {
  /** Is this hex currently occupied by ANY creature? */
  readonly isOccupied: (c: CubeCoord) => boolean;
  /** The mover's movement allowance (skill factor). */
  readonly maxSteps: number;
}

/**
 * Build the module-1 MovementRules for `creature` on `grid`, given live
 * occupancy. Pure: all board facts come from the grid, all live facts from
 * ctx. Flight and nativity are read from the creature's stats.
 */
export function movementRulesFor(
  creature: CreatureName,
  grid: BattleGrid,
  ctx: MovementContext,
): MovementRules {
  const flies = creatureFlies(creature);
  const native = (hazard: BattleHazard) => isNativeTo(creature, hazard);

  const inBounds = (c: CubeCoord) => grid.byKey.has(cubeKey(c));

  const canPass = (c: CubeCoord): boolean => {
    const hex = hexAt(grid, c);
    if (!hex) return false;
    if (flies) return true; // flyers overfly anything mid-route
    if (isImpassableTerrain(hex.terrain)) return false; // Tree/Volcano block ground
    if (hex.terrain === "Bog" && !native("Bog")) return false;
    return true;
  };

  const canStop = (c: CubeCoord): boolean => {
    const hex = hexAt(grid, c);
    if (!hex) return false;
    if (isImpassableTerrain(hex.terrain)) return false; // nobody lands on Tree/Volcano
    if (hex.terrain === "Bog" && !native("Bog")) return false;
    if (ctx.isOccupied(c)) return false; // cannot end on an occupied hex
    return true;
  };

  const edgeBlocked = (from: CubeCoord, to: CubeCoord): boolean => {
    if (flies) return false; // flyers cross walls/cliffs/slopes freely
    // Walls and cliffs sit on a SHARED edge; the feature may be recorded on
    // either hex's border list. Check both directions so a wall on the
    // destination's facing edge blocks entry just as one on the source's does.
    const out = borderBetween(grid, from, to);
    const back = borderBetween(grid, to, from);
    const isBarrier = (b: string | null) => b === "w" || b === "c";
    return isBarrier(out) || isBarrier(back);
  };

  const stopsOnEntry = (from: CubeCoord, to: CubeCoord): boolean => {
    if (flies) return false; // flight ignores slowing terrain
    const toHex = hexAt(grid, to);
    if (!toHex) return false;

    // In-hex slowing: non-native entering Brambles/Sand/Drift must stop.
    const hz = terrainHazard(toHex.terrain);
    if (hz === "Brambles" || hz === "Sand" || hz === "Drift") {
      if (!native(hz)) return true;
    }

    // Hexside slowing: crossing a dune, or a river, or moving UP a slope.
    // The feature is on the shared edge; check both border lists.
    const b = borderBetween(grid, from, to) ?? borderBetween(grid, to, from);
    if (b === "d" || b === "r") {
      if (!native(b === "d" ? "Sand" : "river")) return true;
    }
    if (b === "s") {
      const fromHex = hexAt(grid, from);
      const goingUp = fromHex ? toHex.elevation > fromHex.elevation : false;
      if (goingUp && !native("slope")) return true;
    }
    return false;
  };

  return { maxSteps: ctx.maxSteps, inBounds, canPass, canStop, edgeBlocked, stopsOnEntry };
}

// Flight is a creature stat; re-expose locally to avoid a stats import cycle in
// callers. (stats.data.ts has no dependency on this module, so this is safe.)
import { CREATURE_STATS } from "../creatures/stats.data.ts";
function creatureFlies(name: CreatureName): boolean {
  return CREATURE_STATS[name].flies;
}
