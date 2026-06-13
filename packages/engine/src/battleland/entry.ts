/**
 * Battleland entry (Titan engine, module: battleland).
 *
 * Where each legion's characters enter the Battleland (Law of Titan §10):
 *
 *  - The ATTACKER enters along a 4-hex-wide side, the one matching the RELATIVE
 *    direction from which their legion entered the masterboard land.
 *  - The DEFENDER enters along the 3-hex-wide side OPPOSITE the attacker's.
 *  - TOWER exception (§10.2): the attacker's side is always the lower-left
 *    4-wide side; the defender is DEPLOYED inside the walled center (the
 *    startlist) rather than entering from an edge, and may not move on the
 *    first Maneuver Phase.
 *  - TITAN-TELEPORT (§10.4): the attacker may choose any of the three 4-wide
 *    sides.
 *
 * The board has three opposite edge-pairs. Each pair = one 4-wide side
 * (attacker) and the 3-wide side opposite (defender). We label the three
 * attacker sides by compass-ish names tied to the masterboard approach:
 *   BOTTOM      entered from the land's "down" exit
 *   LEFT        entered from the land's "up-left" exit
 *   RIGHT       entered from the land's "up-right" exit
 * and pair each with its opposite 3-wide defender side. These hex sets are the
 * classic Titan entry edges; one canonical map serves all orientations because
 * the ENTRY SIDE is chosen here rather than by rotating the map (module 1's
 * cubeRotate is still available for rendering the board from the entrant's
 * perspective, but the rules only need the correct hex set).
 *
 * Pure data + lookups; no state.
 */

import type { BattleMap } from "./maps.data.ts";

export type EntrySide = "BOTTOM" | "LEFT" | "RIGHT";

/**
 * The three 4-hex-wide attacker entry sides, as label sets. These are the
 * three outer edges of the 27-hex board:
 *   BOTTOM = the number-1 row across the four central-bottom columns C,D,E + B
 *   LEFT   = the upper-left diagonal edge
 *   RIGHT  = the upper-right diagonal edge
 * (Faithful to the physical board's three wide sides.)
 */
export const ATTACKER_SIDES: Readonly<Record<EntrySide, readonly string[]>> = {
  BOTTOM: ["B1", "C1", "D1", "E1"],
  LEFT: ["A1", "A2", "A3", "B4"],
  RIGHT: ["F1", "F2", "F3", "F4"],
};

/** The 3-hex-wide defender side opposite each attacker side. */
export const DEFENDER_SIDES: Readonly<Record<EntrySide, readonly string[]>> = {
  // Opposite BOTTOM is the top edge (3 of the tall upper hexes).
  BOTTOM: ["C5", "D6", "E5"],
  // Opposite LEFT is the lower-right edge.
  LEFT: ["E1", "F1", "F2"],
  // Opposite RIGHT is the lower-left edge.
  RIGHT: ["A1", "B1", "C1"],
};

/**
 * Map a masterboard approach (the exit index 0..2 of the land the legion came
 * through, or a teleport) to the attacker entry side. The three ARROW exits of
 * a land correspond to the three wide sides in board order; this is the hook
 * the engagement/battle command uses. For a Titan teleport the attacker
 * chooses, so the command passes the chosen side directly.
 */
export function attackerSideForApproach(approachIndex: number): EntrySide {
  const sides: EntrySide[] = ["BOTTOM", "LEFT", "RIGHT"];
  return sides[((approachIndex % 3) + 3) % 3]!;
}

/** The attacker's entry hex labels for a side (or Tower lower-left). */
export function attackerEntryHexes(map: BattleMap, side: EntrySide): readonly string[] {
  if (map.tower) return ATTACKER_SIDES.LEFT; // §10.2 lower-left
  return ATTACKER_SIDES[side];
}

/**
 * The defender's entry/deployment hex labels. On the Tower the defender is
 * deployed into the walled center (the map's startlist); elsewhere the 3-wide
 * side opposite the attacker.
 */
export function defenderEntryHexes(map: BattleMap, side: EntrySide): readonly string[] {
  if (map.tower) return map.startlist; // deployed inside the walls
  return DEFENDER_SIDES[side];
}

/** Validate that a set of chosen hexes is a subset of the legal entry hexes. */
export function entryHexesLegal(
  legal: readonly string[],
  chosen: readonly string[],
): boolean {
  const set = new Set(legal);
  return chosen.every((h) => set.has(h));
}
