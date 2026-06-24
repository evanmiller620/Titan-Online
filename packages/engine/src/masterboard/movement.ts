/**
 * Masterboard movement (Titan engine, module: masterboard).
 *
 * Given a starting land and a die roll, enumerate the lands a legion may
 * legally END on, following Titan's rules faithfully:
 *
 *  1. A legion moves EXACTLY the number rolled — no fewer, no more.
 *  2. No backtracking: a step may not return to the land just departed.
 *  3. BLOCK sides cannot be entered (graph.traversableSteps enforces this).
 *  4. A legion that ROLLS a path looping back to its own start is a legal
 *     destination (e.g. leaving and returning to a land on a 6); the
 *     no-backtrack rule forbids only the immediate reverse, not a full loop.
 *  5. A legion may not END on a land it cannot legally occupy for movement
 *     purposes. Friendly stacking and engagement detection are handled by
 *     the command layer (it has the full game state); this module answers
 *     the pure topological question "where can `roll` steps take me?".
 *
 * Tower/Titan teleportation bypass the graph entirely and are separate
 * entry points, mirroring the rules (they are not "movement" in the
 * step-counting sense).
 *
 * Pure and deterministic. No game state, no dice — the caller supplies the
 * already-rolled value (the server rolled it via Rng in RollMovementCommand).
 */

import type { LandId } from "../core/events/DomainEvent.ts";
import { MASTER_LANDS } from "./board.data.ts";
import { canStopVia, exitsOf, landById, traversableSteps } from "./graph.ts";
import { TOWER_LANDS, isTower } from "./constants.ts";

/** Central summit lands are numbered 1000+ (1000…6000). */
const SUMMIT_MIN_ID = 1000;

/** One legal route to a destination: the land sequence including start & end. */
export interface MovementRoute {
  readonly destination: LandId;
  readonly path: readonly LandId[];
  /** The exit type crossed to ENTER the destination (governs stop legality). */
  readonly finalExitType: string;
}

/**
 * All distinct destinations reachable in exactly `roll` steps from `start`,
 * each with one representative legal route. A land reachable by multiple
 * routes appears once (first route found, depth-first in board order).
 *
 * `roll` must be 1..6. The start land's own contents/ownership are the
 * command layer's concern; here `start` is just a graph node.
 *
 * `enemyAt` (optional) marks lands occupied by an ENEMY legion. Per the Law of
 * Titan a legion may not move THROUGH an enemy legion — it may only END its move
 * on one (declaring an engagement). So an enemy land is pruned as an INTERMEDIATE
 * step but allowed as the final land. When omitted, movement is pure topology
 * (used by data-integrity tests and as the base graph query).
 */
export function destinationsForRoll(
  start: LandId,
  roll: number,
  enemyAt?: (land: LandId) => boolean,
): MovementRoute[] {
  if (!Number.isInteger(roll) || roll < 1 || roll > 6) {
    throw new Error(`Movement roll must be 1..6, got ${roll}`);
  }
  if (!landById(start)) {
    throw new Error(`Unknown start land ${start}`);
  }

  const found = new Map<LandId, MovementRoute>();

  const walk = (
    current: LandId,
    cameFrom: LandId | null,
    stepsLeft: number,
    path: LandId[],
    lastExitType: string,
  ): void => {
    if (stepsLeft === 0) {
      // Must be allowed to STOP here (always true for non-BLOCK entries, and
      // the start has no entry type). One route per destination.
      if (canStopVia(lastExitType as never) || lastExitType === "START") {
        if (!found.has(current)) {
          found.set(current, {
            destination: current,
            path: [...path],
            finalExitType: lastExitType,
          });
        }
      }
      return;
    }
    // Block forced-exit (Law of Titan §4.1): a block is NOT a barrier — it is a
    // forced exit. A legion that BEGINS its move on a land bearing a block must
    // make its FIRST step across that block (e.g. a legion sitting on land 4
    // must leave toward 103; the summit lands likewise drop out via their block).
    // A block binds only the land a legion is sitting on at the start of its move
    // — mid-move it is inert, so it is excluded from the normal step set.
    const firstStep = path.length === 1;
    const forcedBlocks = firstStep
      ? exitsOf(current).filter((e) => e.type === "BLOCK" && e.to !== cameFrom)
      : [];
    const steps = forcedBlocks.length > 0 ? forcedBlocks : traversableSteps(current, cameFrom);

    // Triple-arrow forced continuation (Law of Titan §4.1): once a legion has
    // MOVED INTO a land bearing a triple arrow (an ARROWS exit), it must keep
    // following that arrow if it moves on — it may not turn off onto a side
    // connector (ARCH) or single arrow. This only binds while CONTINUING through
    // the board: the legion's own start land (path.length === 1) is exempt, so a
    // legion may still leave its starting land — or a Tower — in any legal
    // direction. The sole mid-move exception is the second-step summit dive
    // below (an inward "thick dotted line").
    const continuing = path.length > 1;
    const onTripleArrow = steps.some((e) => e.type === "ARROWS");
    for (const edge of steps) {
      // Inner-ring summit gateways are "thick dotted lines": a legion may cross
      // into the central summit (lands ≥ 1000) ONLY on its SECOND step (Law of
      // Titan). `path.length` is the number of this step (1 = first step).
      const summitGateway = edge.type === "ARCH" && edge.to >= SUMMIT_MIN_ID;
      if (summitGateway && path.length !== 2) continue;
      // Forced continuation: a continuing legion on a triple-arrow land must take
      // the arrow, save for diving into the summit on the second step.
      if (continuing && onTripleArrow && edge.type !== "ARROWS") {
        const secondStepSummitDive = summitGateway && path.length === 2;
        if (!secondStepSummitDive) continue;
      }
      // No moving THROUGH an enemy legion: an enemy land is legal only as the
      // FINAL land (an engagement), never as a hex passed over en route.
      if (enemyAt && enemyAt(edge.to) && stepsLeft - 1 > 0) continue;
      path.push(edge.to);
      walk(edge.to, current, stepsLeft - 1, path, edge.type);
      path.pop();
    }
  };

  walk(start, null, roll, [start], "START");
  return [...found.values()];
}

/**
 * Tower Teleport: a legion containing a Lord that BEGINS its turn in a Tower
 * may teleport, regardless of the die roll, to any UNOCCUPIED Tower, OR to
 * any land within 6 of the Tower along the graph ignoring arrows. v1 scopes
 * this to the unoccupied-Tower set (the most common and rules-cleanest case);
 * the "within 6 ignoring arrows" variant is reserved for a later pass and
 * called out here so its absence is explicit.
 *
 * `occupiedTowers` is supplied by the command layer from game state.
 */
export function towerTeleportTargets(
  start: LandId,
  occupiedTowers: ReadonlySet<LandId>,
): LandId[] {
  if (!isTower(start)) return [];
  return TOWER_LANDS.filter((t) => t !== start && !occupiedTowers.has(t));
}

/**
 * Titan Teleport: once a player's Titan reaches power 10 (score ≥ 400) and
 * the player ROLLS A 6, the legion containing the Titan may teleport to ANY
 * land occupied by an enemy legion, forcing an engagement. The eligibility
 * (score, roll === 6, legion contains the Titan) is checked by the command
 * layer; this returns the candidate target lands given the enemy-occupied
 * set.
 */
export function titanTeleportTargets(
  enemyOccupiedLands: ReadonlySet<LandId>,
): LandId[] {
  return [...enemyOccupiedLands].sort((a, b) => a - b);
}

/** Convenience: all tower land ids (re-exported for the command layer). */
export const ALL_TOWERS: readonly LandId[] = TOWER_LANDS;

/** Convenience: every land id, sorted, for iteration/tests. */
export const ALL_LAND_IDS: readonly LandId[] = MASTER_LANDS.map((l) => l.id);
