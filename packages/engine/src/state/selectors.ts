/**
 * Selectors (Titan engine, module: state).
 *
 * Pure read-side queries over GameState. Commands use these for validation;
 * the client uses them for rendering. Nothing here mutates or rolls dice.
 */

import type { GameState, LegionState } from "./GameState.ts";
import type { LandId, PlayerId } from "../core/events/DomainEvent.ts";
import type { CreatureName } from "../creatures/names.ts";

export function activePlayerId(state: GameState): PlayerId | null {
  const id = state.playerOrder[state.turn.activeIndex];
  return id ?? null;
}

export function legionsOf(state: GameState, playerId: PlayerId): LegionState[] {
  return Object.values(state.legions).filter((l) => l.ownerId === playerId);
}

export function legionsAt(state: GameState, land: LandId): LegionState[] {
  return Object.values(state.legions).filter((l) => l.land === land);
}

export function legionHeight(legion: LegionState): number {
  return legion.creatures.length;
}

/**
 * Lands containing legions of two (or more — transiently possible only by
 * illegal states) different owners: the engagements the active player must
 * resolve this turn.
 */
export function pendingEngagements(state: GameState): LandId[] {
  const ownersByLand = new Map<LandId, Set<PlayerId>>();
  for (const legion of Object.values(state.legions)) {
    let owners = ownersByLand.get(legion.land);
    if (!owners) {
      owners = new Set();
      ownersByLand.set(legion.land, owners);
    }
    owners.add(legion.ownerId);
  }
  const lands: LandId[] = [];
  for (const [land, owners] of ownersByLand) {
    if (owners.size >= 2) lands.push(land);
  }
  return lands.sort((a, b) => a - b);
}

/** Towers already claimed during setup. */
export function claimedTowers(state: GameState): Set<LandId> {
  const set = new Set<LandId>();
  for (const p of Object.values(state.players)) {
    if (p.tower !== null) set.add(p.tower);
  }
  return set;
}

// ---------------------------------------------------------------------------
// Multiset helpers — legion contents are multisets (two Ogres ≠ one Ogre).
// ---------------------------------------------------------------------------

export function toCounts(
  creatures: readonly CreatureName[],
): Map<CreatureName, number> {
  const m = new Map<CreatureName, number>();
  for (const c of creatures) m.set(c, (m.get(c) ?? 0) + 1);
  return m;
}

/** Is `part` a sub-multiset of `whole`? */
export function isSubMultiset(
  part: readonly CreatureName[],
  whole: readonly CreatureName[],
): boolean {
  const have = toCounts(whole);
  for (const [name, needed] of toCounts(part)) {
    if ((have.get(name) ?? 0) < needed) return false;
  }
  return true;
}

/** whole minus part, as a new array. Caller must check isSubMultiset first. */
export function subtractMultiset(
  whole: readonly CreatureName[],
  part: readonly CreatureName[],
): CreatureName[] {
  const remove = toCounts(part);
  const out: CreatureName[] = [];
  for (const c of whole) {
    const left = remove.get(c) ?? 0;
    if (left > 0) remove.set(c, left - 1);
    else out.push(c);
  }
  return out;
}
