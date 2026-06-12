/**
 * Cube-space line drawing and line of sight (Titan engine, module: hex).
 *
 * Rangestrikes in Titan trace LOS from attacker hex to target hex. LOS is
 * blocked by occupied hexes and by certain terrain (Trees always; Volcanoes,
 * walls and elevation per battleland rules). This module supplies the pure
 * geometry; *what blocks* is injected as a predicate by the combat/battleland
 * modules so the math stays rules-agnostic.
 *
 * Corner cases — literally: a line between hexes whose centers are exactly
 * aligned through hex corners is ambiguous (it grazes two alternative hex
 * chains). The standard resolution, used here, is to trace two rays nudged
 * by ±epsilon and treat LOS as clear if EITHER nudged chain is unblocked.
 * This matches how human players adjudicate "edge of sight" on the physical
 * board and how the long-standing Colossus implementation behaves.
 */

import {
  cube,
  cubeDistance,
  cubeEquals,
  type CubeCoord,
} from "./cube.ts";

/** Fractional cube point produced during interpolation. Not validated. */
export interface FracCube {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Linear interpolation between two cube coordinates at parameter t ∈ [0,1]. */
export function cubeLerp(a: CubeCoord, b: CubeCoord, t: number): FracCube {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

/**
 * Round a fractional cube point to the nearest valid hex, repairing the
 * component with the largest rounding error so x + y + z === 0 holds.
 */
export function cubeRound(f: FracCube): CubeCoord {
  let rx = Math.round(f.x);
  let ry = Math.round(f.y);
  let rz = Math.round(f.z);

  const dx = Math.abs(rx - f.x);
  const dy = Math.abs(ry - f.y);
  const dz = Math.abs(rz - f.z);

  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;

  return cube(rx, ry, rz);
}

/** Epsilon used to break exact corner ties. Small enough never to cross a hex. */
const EPS = 1e-6;

function lineWithNudge(
  a: CubeCoord,
  b: CubeCoord,
  nudge: number,
): CubeCoord[] {
  const n = cubeDistance(a, b);
  if (n === 0) return [a];
  // Nudge endpoints symmetrically in a direction that sums to zero so the
  // fractional points stay near the true cube plane before rounding.
  const ax = a.x + nudge;
  const ay = a.y - nudge;
  const bx = b.x + nudge;
  const by = b.y - nudge;
  const results: CubeCoord[] = [];
  let prev: CubeCoord | null = null;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const f: FracCube = {
      x: ax + (bx - ax) * t,
      y: ay + (by - ay) * t,
      z: a.z + (b.z - a.z) * t,
    };
    const h = cubeRound(f);
    if (prev === null || !cubeEquals(prev, h)) {
      results.push(h);
      prev = h;
    }
  }
  return results;
}

/**
 * The chain of hexes from a to b inclusive, using a +epsilon nudge for
 * deterministic tie-breaking. Length is cubeDistance(a,b) + 1.
 */
export function cubeLine(a: CubeCoord, b: CubeCoord): CubeCoord[] {
  return lineWithNudge(a, b, EPS);
}

/**
 * Both candidate chains from a to b (nudged +epsilon and −epsilon).
 * For most pairs the two chains are identical; they differ only when the
 * exact line passes through hex corners. Callers adjudicating LOS should
 * test both. Endpoints are always included.
 */
export function cubeLinesThrough(
  a: CubeCoord,
  b: CubeCoord,
): [CubeCoord[], CubeCoord[]] {
  return [lineWithNudge(a, b, EPS), lineWithNudge(a, b, -EPS)];
}

/**
 * True if at least one of the two nudged chains between a and b contains no
 * blocking hex strictly between the endpoints. The attacker's and target's
 * own hexes never block.
 *
 * `blocks` is supplied by the caller and encodes the rules in force:
 * occupied hexes, Trees (always block), Volcano/elevation per terrain, etc.
 */
export function hasLineOfSight(
  a: CubeCoord,
  b: CubeCoord,
  blocks: (hex: CubeCoord) => boolean,
): boolean {
  if (cubeDistance(a, b) <= 1) return true; // adjacent: melee range, trivially visible
  const [lineA, lineB] = cubeLinesThrough(a, b);
  const clear = (line: CubeCoord[]): boolean => {
    for (let i = 1; i < line.length - 1; i++) {
      if (blocks(line[i]!)) return false;
    }
    return true;
  };
  return clear(lineA) || clear(lineB);
}
