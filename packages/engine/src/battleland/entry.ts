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
 * The three 4-hex-wide attacker entry sides, as label sets — EXACTLY the
 * deployment geometry in The Law of Titan §6.1 (docs/The_Law_of_Titan_Context.md):
 *   Bottom attack: attacker A1 B1 C1 D1 · defender D6 E5 F4
 *   Left attack:   attacker A3 B4 C5 D6 · defender D1 E1 F1
 *   Right attack:  attacker F1 F2 F3 F4 · defender A1 A2 A3
 */
export const ATTACKER_SIDES: Readonly<Record<EntrySide, readonly string[]>> = {
  BOTTOM: ["A1", "B1", "C1", "D1"],
  LEFT: ["A3", "B4", "C5", "D6"],
  RIGHT: ["F1", "F2", "F3", "F4"],
};

/** The 3-hex-wide defender side opposite each attacker side (§6.1). */
export const DEFENDER_SIDES: Readonly<Record<EntrySide, readonly string[]>> = {
  BOTTOM: ["D6", "E5", "F4"],
  LEFT: ["D1", "E1", "F1"],
  RIGHT: ["A1", "A2", "A3"],
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

/** The attacker's entry hex labels for a side. Tower battles funnel the
 *  attacker through the bottom row A1 B1 C1 D1 regardless of approach (§6.1). */
export function attackerEntryHexes(map: BattleMap, side: EntrySide): readonly string[] {
  if (map.tower) return ATTACKER_SIDES.BOTTOM;
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
