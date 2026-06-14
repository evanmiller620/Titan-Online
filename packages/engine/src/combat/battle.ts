/**
 * Battle state helpers (Titan engine, module: combat).
 *
 * The BattleState/Combatant SHAPES live in state/GameState.ts (as
 * BattleContext/Combatant) because they are part of the persisted GameState.
 * This module provides the behaviour over them: slay thresholds, liveness,
 * and combatant queries. Plain functions, no mutation.
 */

import type { BattleContext, Combatant, BattleSide } from "../state/GameState.ts";
import type { CreatureName } from "../creatures/names.ts";
import { CREATURE_STATS } from "../creatures/stats.data.ts";

export type { BattleContext as BattleState, Combatant, BattleSide };

/**
 * Battles are capped at seven complete rounds (Law of Titan §7.4 / "The Law of
 * Titan" rulebook §15). If any defender is still alive at the END of round 7,
 * the attacker suffers a "Time Loss": the attacker's entire legion is
 * eliminated and the surviving defender scores NOTHING for anything slain
 * during the battle.
 */
export const MAX_BATTLE_ROUNDS = 7;

/**
 * Has the attacker incurred a Time Loss? True only when the round cap has been
 * reached AND defenders remain. `defendersRemaining` is the count of unslain
 * defending combatants; `round` is the just-completed round number.
 */
export function isTimeLoss(round: number, defendersRemaining: number): boolean {
  return round >= MAX_BATTLE_ROUNDS && defendersRemaining > 0;
}

const STATIC_POWER: Record<string, number> = Object.fromEntries(
  Object.values(CREATURE_STATS).map((st) => [st.name, st.power]),
);

/** Effective power for the slay threshold: Titan scales with owner score. */
export function slayThreshold(creature: CreatureName, ownerScore: number): number {
  if (creature === "Titan") return 6 + Math.floor(ownerScore / 100);
  return STATIC_POWER[creature] ?? 0;
}

/** A combatant is alive if not slain and damage below its slay threshold. */
export function isAlive(c: Combatant, threshold: number): boolean {
  return !c.slain && c.damage < threshold;
}

export function combatantsOf(battle: BattleContext, side: BattleSide): Combatant[] {
  return battle.combatants.filter((c) => c.side === side && !c.slain);
}

export function findCombatant(battle: BattleContext, id: string): Combatant | undefined {
  return battle.combatants.find((c) => c.id === id);
}

/**
 * Half-points for slain/forfeited characters (Law of Titan §8.1): the victor
 * scores half the COMBINED point value of the loser's characters, rounding the
 * final sum ONCE (not per character).
 */
export function halfPoints(creatures: readonly CreatureName[], ownerScore = 0): number {
  const total = creatures.reduce((sum, c) => sum + slayThreshold(c, ownerScore), 0);
  return Math.round(total / 2);
}

/**
 * Overstacked-legion correction (Law of Titan §8.2). A legion may briefly hold
 * eight only during the turn-1 split; if any other legion exceeds the cap it is
 * forcibly trimmed. Removal is strictly hierarchical:
 *
 *   1. ordinary Creatures first, then Guardians, Warlocks, Archangels, Angels;
 *      the Titan is NEVER culled.
 *   2. within a class, the HIGHEST point-value character dies first;
 *   3. ties break: rangestrikers die first, then flyers, then the highest Skill;
 *      a fully-identical tie falls to a stable order (the owner's choice).
 *
 * Returns the kept multiset (length ≤ cap) and the removed creatures.
 */
export function cullOverstack(
  creatures: readonly CreatureName[],
  cap = 7,
): { readonly kept: CreatureName[]; readonly removed: CreatureName[] } {
  if (creatures.length <= cap) return { kept: [...creatures], removed: [] };

  const classRank = (name: CreatureName): number => {
    if (name === "Titan") return Number.POSITIVE_INFINITY; // never removed
    const s = CREATURE_STATS[name];
    if (name === "Angel") return 4;
    if (name === "Archangel") return 3;
    if (name === "Warlock") return 2;
    if (name === "Guardian") return 1;
    void s;
    return 0; // ordinary creature
  };

  // Sort indices from MOST removable to LEAST removable.
  const indexed = creatures.map((name, idx) => ({ name, idx }));
  indexed.sort((a, b) => {
    const ra = classRank(a.name), rb = classRank(b.name);
    if (ra !== rb) return ra - rb; // lower class rank removed first
    const sa = CREATURE_STATS[a.name], sb = CREATURE_STATS[b.name];
    if (sa.power !== sb.power) return sb.power - sa.power; // higher value first
    if (sa.rangestrikes !== sb.rangestrikes) return sa.rangestrikes ? -1 : 1;
    if (sa.flies !== sb.flies) return sa.flies ? -1 : 1;
    if (sa.skill !== sb.skill) return sb.skill - sa.skill; // higher skill first
    return a.idx - b.idx; // stable (owner's choice)
  });

  const removeCount = creatures.length - cap;
  const removeIdx = new Set(indexed.slice(0, removeCount).map((e) => e.idx));
  const kept: CreatureName[] = [];
  const removed: CreatureName[] = [];
  creatures.forEach((c, i) => (removeIdx.has(i) ? removed : kept).push(c));
  return { kept, removed };
}
