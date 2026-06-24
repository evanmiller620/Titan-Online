/**
 * Masterboard movement graph (Titan engine, module: masterboard).
 *
 * The Masterboard is a DIRECTED GRAPH, not a hex grid: legality is governed
 * by the painted boundary signs (exit types), the die roll (exact distance),
 * and the no-backtracking rule — never by cube adjacency. This module turns
 * the static board data into the queries the movement algorithm needs.
 *
 * Edge model: each directed edge (from → to) carries the exit's type.
 *   - ARROWS / ARROW / ARCH: normal mid-move steps (enterable).
 *   - BLOCK: a FORCED EXIT, not a barrier. A block binds only the land a legion
 *     is SITTING ON at the start of its move: such a legion must make its FIRST
 *     step across the block. Mid-move a block is inert, so it is not a normal
 *     traversal step — `isEnterable` reports false for it and the movement walker
 *     (movement.ts) applies the forced-first-step directly. In the Default map
 *     the six summit lands drop out via a block, and several outer lands are
 *     pushed into the Tower ring.
 *
 * The no-backtracking rule needs the immediately-previous land, so the
 * movement walker (movement.ts) threads the visited path and refuses to step
 * back to the land it just came from.
 */

import type { LandId } from "../core/events/DomainEvent.ts";
import {
  LAND_BY_ID,
  MASTER_LANDS,
  type ExitType,
  type MasterLand,
} from "./board.data.ts";

export interface MasterEdge {
  readonly from: LandId;
  readonly to: LandId;
  readonly type: ExitType;
}

/** Can a legion ENTER `to` as a NORMAL (mid-move) step across this edge? Blocks
 *  are excluded here: they are forced-first-step exits, applied by the walker. */
export function isEnterable(type: ExitType): boolean {
  return type !== "BLOCK";
}

/** Can a legion STOP in a land it reaches by crossing an edge of this type?
 *  Yes for every type — a legion may always halt on a land it legally reached
 *  (including a block forced-exit destination). The *continue-through*
 *  obligations (triple-arrow flow, block forced-exit) constrain the NEXT step,
 *  never the right to stop; they are enforced by the walker, not here. */
export function canStopVia(_type: ExitType): boolean {
  return true;
}

/** Outgoing edges of a land, in board order. */
export function exitsOf(land: LandId): readonly MasterEdge[] {
  const node = LAND_BY_ID.get(land);
  if (!node) return [];
  return node.exits.map((e) => ({ from: land, to: e.to, type: e.type }));
}

/**
 * Outgoing edges a legion may actually traverse as a movement step: those
 * whose destination is enterable (not BLOCK), excluding the land it just
 * came from (no backtracking). `cameFrom` is null on the first step.
 */
export function traversableSteps(
  land: LandId,
  cameFrom: LandId | null,
): MasterEdge[] {
  return exitsOf(land).filter(
    (e) => isEnterable(e.type) && e.to !== cameFrom,
  );
}

/** Full edge list (for diagnostics / rendering the board graph). */
export function allEdges(): MasterEdge[] {
  const edges: MasterEdge[] = [];
  for (const land of MASTER_LANDS) {
    for (const e of land.exits) {
      edges.push({ from: land.id, to: e.to, type: e.type });
    }
  }
  return edges;
}

export function landById(id: LandId): MasterLand | undefined {
  return LAND_BY_ID.get(id);
}
