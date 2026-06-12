/**
 * Pathfinding / reachability over cube space (Titan engine, module: hex).
 *
 * Titan battle movement is not weighted-cost pathfinding; it is step-counted
 * BFS with three rule hooks the physical game actually uses:
 *
 *  - edgeBlocked(from, to): hexside features. Walls (Tower) and Dunes
 *    (Desert) live on hex EDGES, not in hexes — the pathfinder must consult
 *    the edge being crossed, not just the destination hex.
 *  - stopsOnEntry(from, to): "slowed" terrain. Non-natives entering Bramble,
 *    Drift or Sand — or moving up a Slope — must immediately stop. Such a
 *    hex is reachable but never expanded further.
 *  - canPass / canStop: flyers may pass over occupied hexes and hazards but
 *    may not END movement on occupied hexes, Trees, Bog, etc. Ground
 *    creatures generally cannot pass through what they cannot enter.
 *
 * The Masterboard does NOT use this module: masterboard movement follows a
 * directed exit graph (arrows/blocks/arches) implemented in masterboard/.
 * This module serves the 27-hex Battlelands, where cube math is exact.
 *
 * Pure and deterministic. Rules are injected; no Titan terrain names appear
 * here — the battleland module composes these hooks from its hazard tables.
 */

import { cubeKey, cubeNeighbors, type CubeCoord } from "./cube.ts";

export interface MovementRules {
  /** Maximum number of steps (a creature's Skill factor in Titan). */
  readonly maxSteps: number;
  /** Is this hex part of the board at all? */
  readonly inBounds: (hex: CubeCoord) => boolean;
  /** May the mover travel THROUGH this hex (not necessarily stop)? */
  readonly canPass: (hex: CubeCoord) => boolean;
  /** May the mover END its movement on this hex? */
  readonly canStop: (hex: CubeCoord) => boolean;
  /** Is the hexside between these adjacent hexes impassable (wall/cliff)? */
  readonly edgeBlocked: (from: CubeCoord, to: CubeCoord) => boolean;
  /** Does entering `to` from `from` force an immediate stop (slowed)? */
  readonly stopsOnEntry: (from: CubeCoord, to: CubeCoord) => boolean;
}

export interface ReachableHex {
  readonly hex: CubeCoord;
  /** Steps spent to arrive by the earliest (BFS) route found. */
  readonly steps: number;
  /** Predecessor hex key on that route (null for the start hex). */
  readonly cameFrom: string | null;
}

export interface ReachabilityResult {
  /**
   * Hexes the mover may legally END movement on, keyed by cubeKey. Includes
   * the start hex (steps 0) iff rules.canStop(start) — in Titan a creature
   * may always elect not to move, so battleland callers make the start hex
   * stoppable.
   */
  readonly destinations: Map<string, ReachableHex>;
  /**
   * One legal route (start..destination inclusive) for a destination key,
   * or null if the key is not a legal destination. Intermediate hexes on
   * the route are passable but need not be stoppable (flyer overflight).
   */
  readonly routeTo: (destinationKey: string) => CubeCoord[] | null;
}

/**
 * Breadth-first reachability under the injected MovementRules.
 * Deterministic: neighbors expand in DIRECTIONS order and each hex is
 * finalized at its first (lowest-step) arrival.
 */
export function reachable(
  start: CubeCoord,
  rules: MovementRules,
): ReachabilityResult {
  const visited = new Map<string, ReachableHex>();
  visited.set(cubeKey(start), { hex: start, steps: 0, cameFrom: null });

  let frontier: CubeCoord[] = [start];
  let steps = 0;

  while (frontier.length > 0 && steps < rules.maxSteps) {
    steps += 1;
    const next: CubeCoord[] = [];
    for (const from of frontier) {
      const fromKey = cubeKey(from);
      for (const to of cubeNeighbors(from)) {
        const toKey = cubeKey(to);
        if (visited.has(toKey)) continue;
        if (!rules.inBounds(to)) continue;
        if (rules.edgeBlocked(from, to)) continue;
        if (!rules.canPass(to)) continue;

        visited.set(toKey, { hex: to, steps, cameFrom: fromKey });

        // Slowed terrain: reachable, but movement ends here — never expand.
        if (!rules.stopsOnEntry(from, to)) next.push(to);
      }
    }
    frontier = next;
  }

  const destinations = new Map<string, ReachableHex>();
  for (const [key, r] of visited) {
    if (rules.canStop(r.hex)) destinations.set(key, r);
  }

  const routeTo = (destinationKey: string): CubeCoord[] | null => {
    if (!destinations.has(destinationKey)) return null;
    const path: CubeCoord[] = [];
    let cursor: string | null = destinationKey;
    while (cursor !== null) {
      const node: ReachableHex | undefined = visited.get(cursor);
      if (!node) return null;
      path.push(node.hex);
      cursor = node.cameFrom;
    }
    return path.reverse();
  };

  return { destinations, routeTo };
}
