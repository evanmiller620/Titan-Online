/**
 * Masterboard constants needed ahead of the full board data (module 4).
 * Classic land numbering: the six Towers are lands 100, 200, … 600.
 */
import type { LandId } from "../core/events/DomainEvent.ts";

export const TOWER_LANDS: readonly LandId[] = Object.freeze([
  100, 200, 300, 400, 500, 600,
]);

export function isTower(land: LandId): boolean {
  return TOWER_LANDS.includes(land);
}
