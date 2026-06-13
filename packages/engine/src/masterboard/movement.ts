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
import { canStopVia, landById, traversableSteps } from "./graph.ts";
import { TOWER_LANDS, isTower } from "./constants.ts";

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
 */
export function destinationsForRoll(
  start: LandId,
  roll: number,
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
    for (const edge of traversableSteps(current, cameFrom)) {
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
