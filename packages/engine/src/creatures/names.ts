/**
 * Creature name vocabulary and pool limits (Titan engine, module: creatures).
 *
 * Module 5 will add the full stat block (power, skill, flight, rangestrike,
 * point values, native terrains, recruitment trees). Module 3 needs only the
 * identity layer: the closed set of names, the caretaker stack limits that
 * cap the shared recruitment pool, classification of Lords/Demilords, and
 * the fixed initial-legion composition.
 *
 * Counts are the 1982 Avalon Hill caretaker limits per the project spec.
 */

export const CREATURE_NAMES = [
  // Lords
  "Titan",
  "Archangel",
  "Angel",
  // Demilords
  "Guardian",
  "Warlock",
  // Pinnacle
  "Colossus",
  "Hydra",
  "Serpent",
  // Upper tier
  "Unicorn",
  "Dragon",
  "Behemoth",
  "Giant",
  "Griffon",
  "Wyvern",
  // Mid tier
  "Minotaur",
  "Warbear",
  "Gargoyle",
  "Gorgon",
  "Centaur",
  "Ogre",
  // Core tier
  "Cyclops",
  "Lion",
  "Ranger",
  "Troll",
] as const;

export type CreatureName = (typeof CREATURE_NAMES)[number];

export function isCreatureName(s: string): s is CreatureName {
  return (CREATURE_NAMES as readonly string[]).includes(s);
}

/**
 * Caretaker stack limits — the finite shared pool. "Titan" is special: one
 * per player, so createGame overrides it with the player count.
 */
export const CARETAKER_LIMITS: Readonly<Record<CreatureName, number>> =
  Object.freeze({
    Titan: 6, // overridden to the actual player count at game creation
    Archangel: 6,
    Angel: 18,
    Guardian: 6,
    Warlock: 6,
    Colossus: 10,
    Hydra: 10,
    Serpent: 10,
    Unicorn: 12,
    Dragon: 18,
    Behemoth: 18,
    Giant: 18,
    Griffon: 18,
    Wyvern: 18,
    Minotaur: 21,
    Warbear: 21,
    Gargoyle: 21,
    Gorgon: 25,
    Centaur: 25,
    Ogre: 25,
    Cyclops: 28,
    Lion: 28,
    Ranger: 28,
    Troll: 28,
  });

/** Lords: may teleport; exactly one must anchor each initial legion half. */
export const LORDS: ReadonlySet<CreatureName> = new Set([
  "Titan",
  "Angel",
  "Archangel",
]);

export const DEMILORDS: ReadonlySet<CreatureName> = new Set([
  "Guardian",
  "Warlock",
]);

/** The fixed eight starting characters every player begins with. */
export const INITIAL_LEGION: readonly CreatureName[] = Object.freeze([
  "Titan",
  "Angel",
  "Gargoyle",
  "Gargoyle",
  "Centaur",
  "Centaur",
  "Ogre",
  "Ogre",
]);

/** Hard cap on legion height at all times except the turn-1 pre-split. */
export const MAX_LEGION_HEIGHT = 7;

/**
 * Avalon Hill legion definition: a standard legion is 2 to 7 characters plus a
 * marker. The ONLY legal single-character legion is a Titan's legion reduced to
 * the Titan alone by combat casualties — so splitting may never create a legion
 * smaller than this, and a legion may never be voluntarily reduced below it.
 */
export const MIN_LEGION_HEIGHT = 2;
