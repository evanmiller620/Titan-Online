/**
 * Recruitment trees (Titan engine, module: creatures).
 *
 * SOURCE OF TRUTH: the Colossus Default variant `DefaultTer.xml`, mechanically
 * converted. Re-verified by creatures.test.ts.
 *
 * REGULAR TERRAIN MODEL: each terrain has an ordered chain of tiers
 * (weakest → strongest). `needPrev` is how many of the IMMEDIATELY PRECEDING
 * tier's creature a legion must already contain to muster one of this tier.
 * The first tier's `needPrev` is 1 (one native musters another of its kind).
 * A legion may also always muster more of any tier it already has enough of.
 *
 * Worked example — Brush [Gargoyle×1, Cyclops×2, Gorgon×2]:
 *   1 Gargoyle  → recruit a Gargoyle
 *   2 Gargoyles → recruit a Cyclops      (or another Gargoyle)
 *   2 Cyclops   → recruit a Gorgon       (or another Cyclops)
 * Recruitment is ONE STEP PER MOVE: two Gargoyles cannot jump straight to a
 * Gorgon in a single muster.
 *
 * TOWER is special and handled procedurally in recruitment.ts, not as a chain:
 *   - any legion may muster a Centaur, Gargoyle, or Ogre (the Tower creatures);
 *   - a legion with the player's Titan, or already containing a Warlock, may
 *     muster a Warlock;
 *   - a legion containing any three identical creatures, or already containing
 *     a Guardian, may muster a Guardian.
 *
 * ACQUIRABLES: Angels (every 100 pts) and Archangels (at 500 pts) are gained
 * through scoring, not terrain mustering; thresholds live here for module 7.
 */

import type { CreatureName } from "./names.ts";
import type { MasterTerrain } from "../masterboard/board.data.ts";

export interface RecruitTier {
  readonly creature: CreatureName;
  /** Count of the PREVIOUS tier's creature required to muster this one. */
  readonly needPrev: number;
}

/** Regular-terrain recruit chains. Tower is intentionally absent (procedural). */
export const RECRUIT_CHAINS: Readonly<
  Partial<Record<MasterTerrain, readonly RecruitTier[]>>
> = {
  Brush: [{ creature: "Gargoyle", needPrev: 1 }, { creature: "Cyclops", needPrev: 2 }, { creature: "Gorgon", needPrev: 2 }],
  Desert: [{ creature: "Lion", needPrev: 1 }, { creature: "Griffon", needPrev: 3 }, { creature: "Hydra", needPrev: 2 }],
  Hills: [{ creature: "Ogre", needPrev: 1 }, { creature: "Minotaur", needPrev: 3 }, { creature: "Unicorn", needPrev: 2 }],
  Jungle: [{ creature: "Gargoyle", needPrev: 1 }, { creature: "Cyclops", needPrev: 2 }, { creature: "Behemoth", needPrev: 3 }, { creature: "Serpent", needPrev: 2 }],
  Marsh: [{ creature: "Ogre", needPrev: 1 }, { creature: "Troll", needPrev: 2 }, { creature: "Ranger", needPrev: 2 }],
  Mountains: [{ creature: "Lion", needPrev: 1 }, { creature: "Minotaur", needPrev: 2 }, { creature: "Dragon", needPrev: 3 }, { creature: "Colossus", needPrev: 2 }],
  Plains: [{ creature: "Centaur", needPrev: 1 }, { creature: "Lion", needPrev: 2 }, { creature: "Ranger", needPrev: 2 }],
  Swamp: [{ creature: "Troll", needPrev: 1 }, { creature: "Wyvern", needPrev: 3 }, { creature: "Hydra", needPrev: 2 }],
  Tundra: [{ creature: "Troll", needPrev: 1 }, { creature: "Warbear", needPrev: 2 }, { creature: "Giant", needPrev: 3 }, { creature: "Colossus", needPrev: 2 }],
  Woods: [{ creature: "Centaur", needPrev: 1 }, { creature: "Warbear", needPrev: 3 }, { creature: "Unicorn", needPrev: 2 }],};

/** The three Tower creatures any legion may muster on a Tower land. */
export const TOWER_CREATURES: readonly CreatureName[] = ["Centaur", "Gargoyle", "Ogre"];

/** Acquirable lords gained by scoring, with their point thresholds. */
export const ACQUIRABLES: ReadonlyArray<{ readonly creature: CreatureName; readonly points: number }> = [
  { creature: "Angel", points: 100 },
  { creature: "Archangel", points: 500 },
];

/** Three-identical or owns-a-Guardian → may muster a Guardian. */
export const GUARDIAN: CreatureName = "Guardian";
/** Contains-Titan or owns-a-Warlock → may muster a Warlock. */
export const WARLOCK: CreatureName = "Warlock";
