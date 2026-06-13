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
