/**
 * Creature stat blocks (Titan engine, module: creatures).
 *
 * SOURCE OF TRUTH: the Colossus Default variant `DefaultCre.xml`, mechanically
 * converted (not hand-typed). Cross-checked at build time against the
 * caretaker limits already in names.ts (zero mismatch). The invariants in
 * creatures.test.ts re-verify the conversion.
 *
 * Power/skill drive combat (module 7). `nativeTerrain` lists the BATTLE hazard
 * types a creature is native to (Brambles, Drift, Bog, Sand, slope, Volcano,
 * river, Stone, Tree, Lake) — used both for battle movement/strike modifiers
 * and as the basis for "is this creature native to this Masterboard terrain"
 * recruitment checks (recruitment.ts maps masterboard terrain → hazard).
 *
 * TITAN POWER IS VARIABLE: stored as the sentinel -1. A Titan's actual power
 * is 6 + floor(playerScore / 100) (its strength grows with the player's
 * score). Always read power via `powerOf()`, never the raw field.
 */

import type { CreatureName } from "./names.ts";

/** Battle hazard / hexside terrain a creature can be native to. */
export type BattleHazard =
  | "Brambles"
  | "Drift"
  | "Bog"
  | "Sand"
  | "slope"
  | "Volcano"
  | "river"
  | "Stone"
  | "Tree"
  | "Lake";

export interface CreatureStats {
  readonly name: CreatureName;
  /** Base power (strike factor). -1 = variable (Titan); use powerOf(). */
  readonly power: number;
  /** Skill factor (movement allowance and strike-die target math). */
  readonly skill: number;
  readonly rangestrikes: boolean;
  readonly flies: boolean;
  /** Warlock's special: rangestrike that ignores terrain/LOS (magic missile). */
  readonly magicMissile: boolean;
  /** Summonable as the post-first-kill Angel/Archangel. */
  readonly summonable: boolean;
  readonly lord: boolean;
  readonly demilord: boolean;
  /** Caretaker stack limit (shared pool). */
  readonly count: number;
  readonly pluralName: string;
  readonly nativeTerrain: readonly BattleHazard[];
}

/** Titan base power before the score bonus. */
export const TITAN_BASE_POWER = 6;

export const CREATURE_STATS: Readonly<Record<CreatureName, CreatureStats>> = {
  Angel: { name: "Angel", power: 6, skill: 4, rangestrikes: false, flies: true, magicMissile: false, summonable: true, lord: true, demilord: false, count: 18, pluralName: "Angels", nativeTerrain: [] },
  Archangel: { name: "Archangel", power: 9, skill: 4, rangestrikes: false, flies: true, magicMissile: false, summonable: true, lord: true, demilord: false, count: 6, pluralName: "Archangels", nativeTerrain: [] },
  Behemoth: { name: "Behemoth", power: 8, skill: 3, rangestrikes: false, flies: false, magicMissile: false, summonable: false, lord: false, demilord: false, count: 18, pluralName: "Behemoths", nativeTerrain: ["Brambles"] },
  Centaur: { name: "Centaur", power: 3, skill: 4, rangestrikes: false, flies: false, magicMissile: false, summonable: false, lord: false, demilord: false, count: 25, pluralName: "Centaurs", nativeTerrain: ["river"] },
  Colossus: { name: "Colossus", power: 10, skill: 4, rangestrikes: false, flies: false, magicMissile: false, summonable: false, lord: false, demilord: false, count: 10, pluralName: "Colossi", nativeTerrain: ["Drift", "slope"] },
  Cyclops: { name: "Cyclops", power: 9, skill: 2, rangestrikes: false, flies: false, magicMissile: false, summonable: false, lord: false, demilord: false, count: 28, pluralName: "Cyclopes", nativeTerrain: ["Brambles"] },
  Dragon: { name: "Dragon", power: 9, skill: 3, rangestrikes: true, flies: true, magicMissile: false, summonable: false, lord: false, demilord: false, count: 18, pluralName: "Dragons", nativeTerrain: ["slope", "Volcano"] },
  Gargoyle: { name: "Gargoyle", power: 4, skill: 3, rangestrikes: false, flies: true, magicMissile: false, summonable: false, lord: false, demilord: false, count: 21, pluralName: "Gargoyles", nativeTerrain: ["Brambles"] },
  Giant: { name: "Giant", power: 7, skill: 4, rangestrikes: true, flies: false, magicMissile: false, summonable: false, lord: false, demilord: false, count: 18, pluralName: "Giants", nativeTerrain: ["Drift"] },
  Gorgon: { name: "Gorgon", power: 6, skill: 3, rangestrikes: true, flies: true, magicMissile: false, summonable: false, lord: false, demilord: false, count: 25, pluralName: "Gorgons", nativeTerrain: ["Brambles"] },
  Griffon: { name: "Griffon", power: 5, skill: 4, rangestrikes: false, flies: true, magicMissile: false, summonable: false, lord: false, demilord: false, count: 18, pluralName: "Griffons", nativeTerrain: ["Sand"] },
  Guardian: { name: "Guardian", power: 12, skill: 2, rangestrikes: false, flies: true, magicMissile: false, summonable: false, lord: false, demilord: true, count: 6, pluralName: "Guardians", nativeTerrain: [] },
  Hydra: { name: "Hydra", power: 10, skill: 3, rangestrikes: true, flies: false, magicMissile: false, summonable: false, lord: false, demilord: false, count: 10, pluralName: "Hydrae", nativeTerrain: ["Bog", "Sand"] },
  Lion: { name: "Lion", power: 5, skill: 3, rangestrikes: false, flies: false, magicMissile: false, summonable: false, lord: false, demilord: false, count: 28, pluralName: "Lions", nativeTerrain: ["Sand", "slope", "river"] },
  Minotaur: { name: "Minotaur", power: 4, skill: 4, rangestrikes: true, flies: false, magicMissile: false, summonable: false, lord: false, demilord: false, count: 21, pluralName: "Minotaurs", nativeTerrain: ["slope"] },
  Ogre: { name: "Ogre", power: 6, skill: 2, rangestrikes: false, flies: false, magicMissile: false, summonable: false, lord: false, demilord: false, count: 25, pluralName: "Ogres", nativeTerrain: ["Bog", "slope"] },
  Ranger: { name: "Ranger", power: 4, skill: 4, rangestrikes: true, flies: true, magicMissile: false, summonable: false, lord: false, demilord: false, count: 28, pluralName: "Rangers", nativeTerrain: ["Bog", "river"] },
  Serpent: { name: "Serpent", power: 18, skill: 2, rangestrikes: false, flies: false, magicMissile: false, summonable: false, lord: false, demilord: false, count: 10, pluralName: "Serpents", nativeTerrain: ["Brambles"] },
  Titan: { name: "Titan", power: -1, skill: 4, rangestrikes: false, flies: false, magicMissile: false, summonable: false, lord: true, demilord: false, count: 6, pluralName: "Titans", nativeTerrain: [] },
  Troll: { name: "Troll", power: 8, skill: 2, rangestrikes: false, flies: false, magicMissile: false, summonable: false, lord: false, demilord: false, count: 28, pluralName: "Trolls", nativeTerrain: ["Drift", "Bog"] },
  Unicorn: { name: "Unicorn", power: 6, skill: 4, rangestrikes: false, flies: false, magicMissile: false, summonable: false, lord: false, demilord: false, count: 12, pluralName: "Unicorns", nativeTerrain: ["slope", "river"] },
  Warbear: { name: "Warbear", power: 6, skill: 3, rangestrikes: false, flies: false, magicMissile: false, summonable: false, lord: false, demilord: false, count: 21, pluralName: "Warbears", nativeTerrain: ["Drift", "river"] },
  Warlock: { name: "Warlock", power: 5, skill: 4, rangestrikes: true, flies: false, magicMissile: true, summonable: false, lord: false, demilord: true, count: 6, pluralName: "Warlocks", nativeTerrain: [] },
  Wyvern: { name: "Wyvern", power: 7, skill: 3, rangestrikes: false, flies: true, magicMissile: false, summonable: false, lord: false, demilord: false, count: 18, pluralName: "Wyverns", nativeTerrain: ["Bog"] },};

/**
 * A creature's effective power. For the Titan this is 6 + floor(score/100);
 * for everyone else it is the static base power. `ownerScore` is ignored for
 * non-Titans and may be omitted.
 */
export function powerOf(name: CreatureName, ownerScore = 0): number {
  if (name === "Titan") return TITAN_BASE_POWER + Math.floor(ownerScore / 100);
  return CREATURE_STATS[name].power;
}

/** Point value awarded for slaying one of these (= effective power). For the
 *  Titan this also scales with score at time of death. */
export function pointValue(name: CreatureName, ownerScore = 0): number {
  return powerOf(name, ownerScore);
}

export function statsOf(name: CreatureName): CreatureStats {
  return CREATURE_STATS[name];
}

export function isNativeTo(name: CreatureName, hazard: BattleHazard): boolean {
  return CREATURE_STATS[name].nativeTerrain.includes(hazard);
}
