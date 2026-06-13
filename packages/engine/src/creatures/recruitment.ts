/**
 * Recruitment logic (Titan engine, module: creatures).
 *
 * Pure functions answering "what may THIS legion muster on THIS terrain,
 * given the shared caretaker pool?". No dice, no state mutation. The Mustering
 * command (module: commands) calls eligibleRecruits() to validate and apply.
 *
 * Faithful to the Default-variant data converted in recruitment.data.ts and
 * the classic rules:
 *  - one recruit per legion per Mustering phase (enforced by the command, not
 *    here — this module just enumerates legal options);
 *  - only a legion that ENDED its move in the terrain and did not start the
 *    turn already 7 high may recruit (also command-level);
 *  - the creature mustered must be available in the caretaker pool (count > 0).
 *
 * Regular terrains use the linear chain (one-step-up). Tower uses the special
 * Centaur/Gargoyle/Ogre + Warlock + Guardian rules. The masterboard terrain
 * → battle-hazard map encodes which terrains are "native ground" for the
 * native-skill rules later; here we only need the recruit chains.
 */

import type { CreatureName } from "./names.ts";
import { toCounts } from "../state/selectors.ts";
import type { MasterTerrain } from "../masterboard/board.data.ts";
import {
  ACQUIRABLES,
  GUARDIAN,
  RECRUIT_CHAINS,
  TOWER_CREATURES,
  WARLOCK,
  type RecruitTier,
} from "./recruitment.data.ts";

export interface RecruitOption {
  /** The creature that could be mustered. */
  readonly creature: CreatureName;
  /**
   * Creatures in the legion that "pay" for the recruit by qualifying it
   * (e.g. the two Gargoyles that justify a Cyclops). Empty for Tower
   * creatures mustered by any legion. The classic game does not consume
   * these — they remain in the legion — so this is informational, used by
   * the UI to show why a recruit is offered.
   */
  readonly via: readonly CreatureName[];
}

/**
 * All creatures `legionCreatures` could legally muster on `terrain`, filtered
 * by caretaker availability. `terrain` is the masterboard terrain of the land
 * the legion occupies.
 */
export function eligibleRecruits(
  terrain: MasterTerrain,
  legionCreatures: readonly CreatureName[],
  caretaker: Readonly<Record<CreatureName, number>>,
  options: { readonly containsOwnTitan?: boolean } = {},
): RecruitOption[] {
  const available = (c: CreatureName) => (caretaker[c] ?? 0) > 0;
  const counts = toCounts(legionCreatures);

  if (terrain === "Tower") {
    return towerRecruits(counts, caretaker, options.containsOwnTitan ?? false).filter((o) =>
      available(o.creature),
    );
  }

  const chain = RECRUIT_CHAINS[terrain];
  if (!chain) return []; // non-recruiting terrain (none in Default besides Tower handled above)

  return chainRecruits(chain, counts).filter((o) => available(o.creature));
}

/** Regular-terrain chain: you may muster tier i if you hold needPrev[i] of
 *  tier i-1, OR (for any tier you already meet) another of that same tier. */
function chainRecruits(
  chain: readonly RecruitTier[],
  counts: Map<CreatureName, number>,
): RecruitOption[] {
  const out: RecruitOption[] = [];
  for (let i = 0; i < chain.length; i++) {
    const tier = chain[i]!;
    const have = counts.get(tier.creature) ?? 0;

    // Recruit another of the same tier if you already have at least one.
    if (have >= 1) {
      out.push({ creature: tier.creature, via: [tier.creature] });
      continue; // same-tier recruit already covers this creature; no dup
    }

    // Otherwise, recruit this tier using the previous tier's creatures.
    if (i === 0) {
      // First tier needs needPrev of ITSELF (always 1) — handled by have>=1
      // above; with zero on hand it cannot be recruited from nothing.
      continue;
    }
    const prev = chain[i - 1]!;
    const prevHave = counts.get(prev.creature) ?? 0;
    if (prevHave >= tier.needPrev) {
      out.push({
        creature: tier.creature,
        via: Array(tier.needPrev).fill(prev.creature),
      });
    }
  }
  return out;
}

/** Tower mustering: Tower creatures by anyone; Warlock/Guardian by qualifier. */
function towerRecruits(
  counts: Map<CreatureName, number>,
  _caretaker: Readonly<Record<CreatureName, number>>,
  containsOwnTitan: boolean,
): RecruitOption[] {
  const out: RecruitOption[] = [];
  // Any legion on a Tower may take a Centaur, Gargoyle, or Ogre.
  for (const c of TOWER_CREATURES) out.push({ creature: c, via: [] });

  // Warlock: legion contains the player's Titan, or already a Warlock.
  if (containsOwnTitan || (counts.get(WARLOCK) ?? 0) >= 1) {
    out.push({
      creature: WARLOCK,
      via: containsOwnTitan ? ["Titan"] : [WARLOCK],
    });
  }

  // Guardian: any three identical creatures, or already a Guardian.
  const tripleSource = [...counts.entries()].find(([, n]) => n >= 3);
  if ((counts.get(GUARDIAN) ?? 0) >= 1) {
    out.push({ creature: GUARDIAN, via: [GUARDIAN] });
  } else if (tripleSource) {
    const [creature] = tripleSource;
    out.push({ creature: GUARDIAN, via: [creature, creature, creature] });
  }
  return out;
}

/** Can `legionCreatures` muster `target` on `terrain`? (validation helper) */
export function canRecruit(
  terrain: MasterTerrain,
  legionCreatures: readonly CreatureName[],
  target: CreatureName,
  caretaker: Readonly<Record<CreatureName, number>>,
  options: { readonly containsOwnTitan?: boolean } = {},
): boolean {
  return eligibleRecruits(terrain, legionCreatures, caretaker, options).some(
    (o) => o.creature === target,
  );
}

/**
 * Acquirable lords (Angels/Archangels) a player crossing from `oldScore` to
 * `newScore` becomes entitled to. Returns the creatures earned by threshold
 * crossings, each as one entry. (How many Angels per 100 vs the single
 * Archangel-at-500 is resolved by module 7's scoring; this is the data hook.)
 */
export function acquirablesCrossed(oldScore: number, newScore: number): CreatureName[] {
  const earned: CreatureName[] = [];
  for (const a of ACQUIRABLES) {
    if (oldScore < a.points && newScore >= a.points) earned.push(a.creature);
  }
  return earned;
}
