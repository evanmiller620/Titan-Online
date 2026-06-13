/**
 * Masterboard movement graph (Titan engine, module: masterboard).
 *
 * The Masterboard is a DIRECTED GRAPH, not a hex grid: legality is governed
 * by the painted boundary signs (exit types), the die roll (exact distance),
 * and the no-backtracking rule — never by cube adjacency. This module turns
 * the static board data into the queries the movement algorithm needs.
 *
 * Edge model: each directed edge (from → to) carries the exit's type. An edge
 * is TRAVERSABLE for a step if the destination may be ENTERED across it:
 *   - ARROWS / ARROW / ARCH: enterable
 *   - BLOCK: NOT enterable from this side. (A BLOCK exit means you may leave
 *     the source toward `to`, but the painted block forbids ENTERING `to`
 *     across that side. In the Default map every BLOCK guards a Tower-ring
 *     land against entry from the outer track, funneling legions the long
 *     way around — the strategic "you can't shortcut into the tower ring".)
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

/** Can a legion ENTER `to` when crossing an edge of this type? */
export function isEnterable(type: ExitType): boolean {
  return type !== "BLOCK";
}

/** Can a legion STOP in a land it reaches by crossing an edge of this type?
 *  All non-blocked entries allow stopping; the *continue-through* obligation
 *  (triple-arrow flow) is handled by the walker, not here. */
export function canStopVia(type: ExitType): boolean {
  return type !== "BLOCK";
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
