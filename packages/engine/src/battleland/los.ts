/**
 * Battleland line of sight (Titan engine, module: battleland).
 *
 * Rangestrikes (module 7) trace LOS from striker hex to target hex. This
 * module composes module 1's pure dual-ray `hasLineOfSight` with the
 * battleland's blocking rules:
 *
 *  - Tree and Volcano hexes block LOS.
 *  - Any OCCUPIED intermediate hex blocks LOS (you cannot rangestrike through
 *    a creature). The striker's and target's own hexes never block.
 *  - Elevation: a strike from or to higher ground sees over one level of
 *    lower obstruction. v1 models the hard blockers (Tree/Volcano/occupancy);
 *    the finer elevation-vs-elevation LOS interaction is reserved and flagged
 *    so its absence is explicit — the combat module can layer it on without
 *    changing this signature.
 *
 *  - Warlock magic missile (creature stat `magicMissile`) IGNORES LOS and
 *    terrain entirely; the combat module checks that flag BEFORE calling here.
 *
 * Pure: board facts from the grid, live facts (occupancy) injected.
 */

import { hasLineOfSight, type CubeCoord } from "../hex/index.ts";
import { blocksLineOfSight } from "./terrain.ts";
import { hexAt, type BattleGrid } from "./terrain.ts";

export interface LosContext {
  readonly isOccupied: (c: CubeCoord) => boolean;
}

/**
 * Can `from` see `to` for rangestrike purposes? Intermediate hexes block if
 * they hold blocking terrain (Tree/Volcano) or are occupied. Endpoints never
 * block. Uses the dual ±epsilon rays so corner-grazing lines resolve as on
 * the physical board.
 */
export function battleLineOfSight(
  grid: BattleGrid,
  from: CubeCoord,
  to: CubeCoord,
  ctx: LosContext,
): boolean {
  const blocks = (hex: CubeCoord): boolean => {
    const h = hexAt(grid, hex);
    if (!h) return true; // off-board hexes block (shouldn't appear on a valid line)
    if (blocksLineOfSight(h.terrain)) return true;
    if (ctx.isOccupied(hex)) return true;
    return false;
  };
  return hasLineOfSight(from, to, blocks);
}
