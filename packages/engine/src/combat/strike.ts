/**
 * Strike mathematics (Titan engine, module: combat).
 *
 * SOURCE OF TRUTH: the Law of Titan rulebook (Valley Games 3rd ed.), §13 and
 * the Strike Chart + Hazard Chart. Every formula here is verified against the
 * rulebook's worked examples and the printed chart in combat.test.ts.
 *
 * THE STRIKE CHART (§13.2). A striker rolls `power` dice; each die ≥ the
 * Strike-number is a hit; `power` hits slay the target. The Strike-number is
 *
 *     strikeNumber = clamp(4 - (attackerSkill - defenderSkill), 2, 6)
 *
 * which reproduces the printed chart exactly (e.g. Ogre skill 2 vs Lion skill
 * 3 → 5; def-skill-3 row → 6,5,4,3,2). A die can never hit on a 1 (floor 2)
 * and never needs more than 6 (ceiling 6).
 *
 * HAZARDS (§13.5, Hazard Chart) modify the *inputs* to that formula — extra
 * dice (power) or a shifted skill — depending on the hexside/hex between
 * striker and target and their nativity. These are computed as a StrikeMods
 * delta so the same chart math applies uniformly. Carry-over legality then
 * keys off whether the secondary target would face the *same* strike number
 * WITHOUT any advantage the attacker used (§13.4–13.5).
 *
 * Pure and deterministic. Dice come from the injected Rng (server-side only).
 */

import type { Rng } from "../core/rng/Rng.ts";

export const MIN_STRIKE_NUMBER = 2;
export const MAX_STRIKE_NUMBER = 6;

/**
 * The core chart. `attackerSkill`/`defenderSkill` are the EFFECTIVE skills
 * after hazard modifiers have been applied by the caller.
 */
export function strikeNumber(attackerSkill: number, defenderSkill: number): number {
  const raw = 4 - (attackerSkill - defenderSkill);
  return Math.max(MIN_STRIKE_NUMBER, Math.min(MAX_STRIKE_NUMBER, raw));
}

/** Per-die probability of a hit (used by AI/odds display, not resolution). */
export function hitChance(strikeNum: number): number {
  return (MAX_STRIKE_NUMBER - strikeNum + 1) / 6;
}

/**
 * Hazard-derived modifiers to a single strike, as deltas applied BEFORE the
 * chart. `diceDelta` adds/removes dice (power); `attackerSkillDelta` and
 * `defenderSkillDelta` shift the effective skills feeding strikeNumber.
 *
 * `advantage` marks that the attacker is using a positional benefit (striking
 * down a slope/dune/wall, or out of a volcano) that a carry-over target might
 * not share — this gates carry-over per §13.5.
 */
export interface StrikeMods {
  readonly diceDelta: number;
  readonly attackerSkillDelta: number;
  readonly defenderSkillDelta: number;
  readonly advantage: boolean;
}

export const NO_MODS: StrikeMods = Object.freeze({
  diceDelta: 0,
  attackerSkillDelta: 0,
  defenderSkillDelta: 0,
  advantage: false,
});

export function combineMods(a: StrikeMods, b: StrikeMods): StrikeMods {
  return {
    diceDelta: a.diceDelta + b.diceDelta,
    attackerSkillDelta: a.attackerSkillDelta + b.attackerSkillDelta,
    defenderSkillDelta: a.defenderSkillDelta + b.defenderSkillDelta,
    advantage: a.advantage || b.advantage,
  };
}

export interface StrikeInputs {
  readonly attackerPower: number;
  readonly attackerSkill: number;
  readonly defenderSkill: number;
  readonly mods: StrikeMods;
}

export interface ResolvedStrike {
  /** Number of dice actually rolled (power + diceDelta, floored at 0). */
  readonly dice: number;
  /** The strike number after skill modifiers. */
  readonly strikeNumber: number;
  /** Each die face rolled. */
  readonly rolls: readonly number[];
  /** Count of dice ≥ strikeNumber. */
  readonly hits: number;
}

/** The effective strike number for a strike given its inputs. */
export function effectiveStrikeNumber(inputs: StrikeInputs): number {
  return strikeNumber(
    inputs.attackerSkill + inputs.mods.attackerSkillDelta,
    inputs.defenderSkill + inputs.mods.defenderSkillDelta,
  );
}

/** The number of dice a strike rolls given its inputs. */
export function strikeDice(inputs: StrikeInputs): number {
  return Math.max(0, inputs.attackerPower + inputs.mods.diceDelta);
}

/**
 * Resolve a strike: roll the dice and count hits. Pure given the Rng.
 * Optionally force the Strike-number HIGHER than necessary (§13.4) so excess
 * hits can carry to a tougher secondary target — `forcedStrikeNumber` must be
 * ≥ the natural number or it is ignored.
 */
export function resolveStrike(
  inputs: StrikeInputs,
  rng: Rng,
  forcedStrikeNumber?: number,
): ResolvedStrike {
  const dice = strikeDice(inputs);
  const natural = effectiveStrikeNumber(inputs);
  const sn =
    forcedStrikeNumber !== undefined && forcedStrikeNumber >= natural
      ? Math.min(MAX_STRIKE_NUMBER, forcedStrikeNumber)
      : natural;
  const rolls = rng.roll(dice);
  let hits = 0;
  for (const r of rolls) if (r >= sn) hits += 1;
  return { dice, strikeNumber: sn, rolls, hits };
}

/**
 * Apply the "mistakenly rolled too many dice" rule (THE LAW OF TITAN): a
 * re-roll with the correct, smaller dice count may only count hits up to the
 * number achieved by the mistaken roll. Returns the capped hit count. This is
 * exposed for the server's anti-cheat path; normal play never triggers it.
 */
export function cappedReroll(mistakenHits: number, rerollHits: number): number {
  return Math.min(mistakenHits, rerollHits);
}

/**
 * Rangestrike strength: half the power, rounded down (§12.2). A Dragon
 * (power 9) rangestrikes with 4 dice.
 */
export function rangeStrength(power: number): number {
  return Math.floor(power / 2);
}

/**
 * Rangestrike skill penalty for distance (§12.3): range 2 or 3 → no penalty;
 * range 4 → −1 skill. Beyond 4 is illegal (caller validates). Warlock magic
 * missile ignores this (caller checks the flag first).
 */
export function rangeSkillPenalty(range: number): number {
  return range >= 4 ? 1 : 0;
}
