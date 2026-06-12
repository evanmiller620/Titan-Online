/**
 * Cube coordinates for hex grids (Titan engine, module: hex).
 *
 * Every hex is identified by (x, y, z) with the invariant x + y + z === 0.
 * Offset coordinates are forbidden everywhere in this codebase; if an external
 * labelling scheme exists (e.g. the community A1–F6 Battleland notation, or
 * Masterboard land numbers), the owning module maps it to a CubeCoord exactly
 * once at its data boundary and never lets the label participate in math.
 *
 * Orientation note: cube math is orientation-agnostic. The direction *names*
 * exported here (N, NE, SE, S, SW, NW) follow flat-top hexes arranged in
 * vertical columns, which matches the physical Titan Battlelands (columns
 * A–F left to right, rows 1–6 bottom to top). Rendering modules own the
 * cube → pixel projection; this module never thinks in pixels.
 *
 * This file is pure and deterministic: no I/O, no Date, no Math.random.
 */

/** Immutable cube coordinate. x + y + z === 0 always holds. */
export interface CubeCoord {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Thrown when a coordinate violating x + y + z === 0 enters the system. */
export class InvalidCubeError extends Error {
  constructor(x: number, y: number, z: number) {
    super(`Invalid cube coordinate (${x}, ${y}, ${z}): x + y + z must equal 0`);
    this.name = "InvalidCubeError";
  }
}

/** Construct a validated, frozen cube coordinate. */
export function cube(x: number, y: number, z: number): CubeCoord {
  if (x + y + z !== 0) throw new InvalidCubeError(x, y, z);
  return Object.freeze({ x, y, z });
}

/** Convenience: construct from axial (q, r); y is derived. */
export function cubeFromAxial(q: number, r: number): CubeCoord {
  return cube(q, -q - r, r);
}

/** Stable string key for Map/Set usage, e.g. "1,-1,0". */
export function cubeKey(c: CubeCoord): string {
  return `${c.x},${c.y},${c.z}`;
}

/** Inverse of cubeKey. Validates. */
export function cubeFromKey(key: string): CubeCoord {
  const parts = key.split(",").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Malformed cube key: "${key}"`);
  }
  return cube(parts[0]!, parts[1]!, parts[2]!);
}

export function cubeEquals(a: CubeCoord, b: CubeCoord): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

export function cubeAdd(a: CubeCoord, b: CubeCoord): CubeCoord {
  return cube(a.x + b.x, a.y + b.y, a.z + b.z);
}

export function cubeSubtract(a: CubeCoord, b: CubeCoord): CubeCoord {
  return cube(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function cubeScale(a: CubeCoord, k: number): CubeCoord {
  return cube(a.x * k, a.y * k, a.z * k);
}

/**
 * The six unit direction vectors, ordered clockwise starting at North,
 * named for flat-top hexes in vertical columns (the Battleland layout).
 * Index order is part of the public contract — hexside data (walls, dunes,
 * cliffs) will be stored per-direction-index by the battleland module.
 */
export const DIRECTION_NAMES = ["N", "NE", "SE", "S", "SW", "NW"] as const;
export type DirectionName = (typeof DIRECTION_NAMES)[number];

export const DIRECTIONS: readonly CubeCoord[] = Object.freeze([
  cube(0, 1, -1), // N
  cube(1, 0, -1), // NE
  cube(1, -1, 0), // SE
  cube(0, -1, 1), // S
  cube(-1, 0, 1), // SW
  cube(-1, 1, 0), // NW
]);

export const DIRECTION_BY_NAME: Readonly<Record<DirectionName, CubeCoord>> =
  Object.freeze({
    N: DIRECTIONS[0]!,
    NE: DIRECTIONS[1]!,
    SE: DIRECTIONS[2]!,
    S: DIRECTIONS[3]!,
    SW: DIRECTIONS[4]!,
    NW: DIRECTIONS[5]!,
  });

/** Neighbor in direction index 0..5 (see DIRECTIONS order). */
export function cubeNeighbor(c: CubeCoord, direction: number): CubeCoord {
  const d = DIRECTIONS[((direction % 6) + 6) % 6]!;
  return cubeAdd(c, d);
}

/** All six neighbors, in DIRECTIONS order. */
export function cubeNeighbors(c: CubeCoord): CubeCoord[] {
  return DIRECTIONS.map((d) => cubeAdd(c, d));
}

/**
 * If b is a unit-distance neighbor of a, return the direction index 0..5,
 * else null. Used to look up hexside hazards (walls, dunes, slopes-as-edges).
 */
export function directionBetween(a: CubeCoord, b: CubeCoord): number | null {
  const d = cubeSubtract(b, a);
  for (let i = 0; i < 6; i++) {
    if (cubeEquals(DIRECTIONS[i]!, d)) return i;
  }
  return null;
}

/** Hex (Manhattan-on-cube) distance: max of the absolute deltas. */
export function cubeDistance(a: CubeCoord, b: CubeCoord): number {
  return Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs(a.z - b.z),
  );
}

/**
 * Rotate a coordinate 60° clockwise about the origin.
 * (x, y, z) → (-z, -x, -y).
 * The Battleland module uses this to orient one canonical map definition
 * for the three possible Masterboard entry sides instead of storing three
 * copies of every map.
 */
export function cubeRotateCW(c: CubeCoord): CubeCoord {
  return cube(-c.z, -c.x, -c.y);
}

/** Rotate 60° counter-clockwise about the origin: (x, y, z) → (-y, -z, -x). */
export function cubeRotateCCW(c: CubeCoord): CubeCoord {
  return cube(-c.y, -c.z, -c.x);
}

/** Rotate `steps` × 60° clockwise about an arbitrary center. */
export function cubeRotateAround(
  c: CubeCoord,
  center: CubeCoord,
  steps: number,
): CubeCoord {
  let v = cubeSubtract(c, center);
  const n = ((steps % 6) + 6) % 6;
  for (let i = 0; i < n; i++) v = cubeRotateCW(v);
  return cubeAdd(center, v);
}

/**
 * The ring of hexes at exactly `radius` from center, clockwise from the
 * northern vertex. radius 0 yields [center]. Ring size is 6 × radius.
 */
export function cubeRing(center: CubeCoord, radius: number): CubeCoord[] {
  if (radius < 0) throw new Error(`Ring radius must be >= 0, got ${radius}`);
  if (radius === 0) return [center];
  const results: CubeCoord[] = [];
  // Start at center + N * radius, then walk each of the six sides.
  let h = cubeAdd(center, cubeScale(DIRECTION_BY_NAME.N, radius));
  // Walking order producing a clockwise ring from the N starting point:
  const walk: DirectionName[] = ["SE", "S", "SW", "NW", "N", "NE"];
  for (const dir of walk) {
    for (let i = 0; i < radius; i++) {
      results.push(h);
      h = cubeAdd(h, DIRECTION_BY_NAME[dir]);
    }
  }
  return results;
}

/**
 * All hexes within `radius` of center (a filled hexagon), center included.
 * Count is 1 + 3·r·(r+1).
 */
export function cubeRange(center: CubeCoord, radius: number): CubeCoord[] {
  if (radius < 0) throw new Error(`Range radius must be >= 0, got ${radius}`);
  const results: CubeCoord[] = [];
  for (let x = -radius; x <= radius; x++) {
    const yMin = Math.max(-radius, -x - radius);
    const yMax = Math.min(radius, -x + radius);
    for (let y = yMin; y <= yMax; y++) {
      results.push(cubeAdd(center, cube(x, y, -x - y)));
    }
  }
  return results;
}
