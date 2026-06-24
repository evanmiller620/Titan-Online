/**
 * Rangestrike (Titan engine, module: combat).
 *
 * §12. Only the MOVING player may rangestrike, only with creatures bearing the
 * rangestrike ability, never while in contact with an enemy, never with
 * carry-over.
 *
 * Rules modelled:
 *  - Dice = floor(power/2) (rangeStrength).
 *  - Range = cube distance + 1 (counting both endpoints); "range 3" means one
 *    empty hex between. Legal range is 2..4 for EVERY rangestriker; the longest
 *    shot (range 4) costs −1 skill. The Warlock's magic missile also reaches 4
 *    but ignores the penalty (and LOS/terrain).
 *  - LOS must be clear (battleland los.ts): Trees/Volcano and occupied hexes
 *    block. Warlock magic missile ignores LOS, terrain, and the skill penalty,
 *    and can strike 4 hexes at full skill.
 *  - Lords (Titan/Angel/Archangel) are immune to rangestrike from anything
 *    except a Warlock.
 *  - Bramble: a non-native rangestriker loses 1 skill per intervening bramble
 *    hex; a native defender in bramble raises the strike-number by 1.
 *
 * Returns the StrikeInputs to feed the shared strike resolver, or a structured
 * reason the rangestrike is illegal.
 */

import {
  rangeSkillPenalty,
  rangeStrength,
  NO_MODS,
  combineMods,
  type StrikeInputs,
  type StrikeMods,
} from "./strike.ts";
import type { CreatureName } from "../creatures/names.ts";
import { CREATURE_STATS, isNativeTo } from "../creatures/stats.data.ts";
import { LORDS } from "../creatures/names.ts";
import { cubeDistance, cubeKey, type CubeCoord } from "../hex/cube.ts";
import { cubeLinesThrough } from "../hex/line.ts";
import { battleLineOfSight } from "../battleland/los.ts";
import { hexAt, type BattleGrid } from "../battleland/terrain.ts";

export type RangestrikeRejection =
  | "NOT_A_RANGESTRIKER"
  | "IN_CONTACT"
  | "OUT_OF_RANGE"
  | "NO_LINE_OF_SIGHT"
  | "LORD_IMMUNE";

export interface RangestrikePlan {
  readonly inputs: StrikeInputs;
  readonly range: number;
  readonly magicMissile: boolean;
}

export type RangestrikeResult =
  | { readonly ok: true; readonly plan: RangestrikePlan }
  | { readonly ok: false; readonly reason: RangestrikeRejection };

/** Range in Titan's counting: cube distance + 1 (both endpoints counted). */
export function rangestrikeRange(a: CubeCoord, b: CubeCoord): number {
  return cubeDistance(a, b) + 1;
}

/**
 * Plan a rangestrike from `attacker` at `from` against `defender` at `to`.
 * `isOccupied`/`isContact` are injected from the live battle. Pure.
 */
export function planRangestrike(args: {
  readonly grid: BattleGrid;
  readonly attacker: CreatureName;
  readonly defender: CreatureName;
  readonly from: CubeCoord;
  readonly to: CubeCoord;
  readonly attackerInContact: boolean;
  readonly isOccupied: (c: CubeCoord) => boolean;
  readonly defenderScore: number;
  readonly attackerScore: number;
}): RangestrikeResult {
  const aStats = CREATURE_STATS[args.attacker];
  if (!aStats.rangestrikes && !aStats.magicMissile) {
    return { ok: false, reason: "NOT_A_RANGESTRIKER" };
  }
  if (args.attackerInContact) {
    return { ok: false, reason: "IN_CONTACT" };
  }

  const magicMissile = aStats.magicMissile; // Warlock
  // Lord immunity — except Warlock magic missile.
  if (LORDS.has(args.defender) && !magicMissile) {
    return { ok: false, reason: "LORD_IMMUNE" };
  }

  const range = rangestrikeRange(args.from, args.to);
  // Every rangestriker reaches up to range 4; the longest shot (range 4) costs
  // −1 skill (applied below). Magic missile also reaches 4, without the penalty.
  const maxRange = 4;
  if (range < 2 || range > maxRange) {
    return { ok: false, reason: "OUT_OF_RANGE" };
  }

  // Line of sight (magic missile ignores it).
  if (!magicMissile) {
    const clear = battleLineOfSight(args.grid, args.from, args.to, {
      isOccupied: (c) =>
        // endpoints never block
        cubeKey(c) !== cubeKey(args.from) &&
        cubeKey(c) !== cubeKey(args.to) &&
        args.isOccupied(c),
    });
    if (!clear) return { ok: false, reason: "NO_LINE_OF_SIGHT" };
  }

  // Skill penalty for range 4 (magic missile exempt).
  let mods: StrikeMods = NO_MODS;
  if (!magicMissile) {
    const pen = rangeSkillPenalty(range);
    if (pen) mods = combineMods(mods, { diceDelta: 0, attackerSkillDelta: -pen, defenderSkillDelta: 0, advantage: false });

    // Rough-terrain penalties (Bramble & Drift) along the path / on the
    // defender (non-magic only).
    mods = combineMods(mods, roughTerrainPenalties(args.grid, args.attacker, args.defender, args.from, args.to));
  }

  const inputs: StrikeInputs = {
    attackerPower: rangeStrength(effectivePower(args.attacker, args.attackerScore)),
    attackerSkill: attackerSkill(args.attacker),
    defenderSkill: defenderSkill(args.defender),
    mods,
  };
  return { ok: true, plan: { inputs, range, magicMissile } };
}

/** Bramble AND Drift behave alike for rangestrikes: a native defender sitting
 *  in the hazard is harder to hit (+1 strike number), and a non-native loses 1
 *  skill per intervening hazard hex it must shoot across (per hazard it isn't
 *  native to). The defender's own hex is not "intervening". */
function roughTerrainPenalties(
  grid: BattleGrid,
  attacker: CreatureName,
  defender: CreatureName,
  from: CubeCoord,
  to: CubeCoord,
): StrikeMods {
  let mods: StrikeMods = NO_MODS;
  const rough: ReadonlyArray<readonly ["Brambles" | "Drift", "Brambles" | "Drift"]> = [
    ["Brambles", "Brambles"],
    ["Drift", "Drift"],
  ];
  const dHex = hexAt(grid, to);
  for (const [terrain, hazard] of rough) {
    if (dHex?.terrain === terrain && isNativeTo(defender, hazard) && !isNativeTo(attacker, hazard)) {
      mods = combineMods(mods, { diceDelta: 0, attackerSkillDelta: 0, defenderSkillDelta: 1, advantage: false });
    }
  }
  // Count intervening hazard hexes the attacker is not native to (first clear
  // LOS chain). Attacker's own hex has no effect.
  const [chainA] = cubeLinesThrough(from, to);
  let penalty = 0;
  for (let i = 1; i < chainA.length - 1; i++) {
    const h = hexAt(grid, chainA[i]!);
    if (!h) continue;
    if (h.terrain === "Brambles" && !isNativeTo(attacker, "Brambles")) penalty += 1;
    else if (h.terrain === "Drift" && !isNativeTo(attacker, "Drift")) penalty += 1;
  }
  if (penalty > 0) mods = combineMods(mods, { diceDelta: 0, attackerSkillDelta: -penalty, defenderSkillDelta: 0, advantage: false });
  return mods;
}

function attackerSkill(name: CreatureName): number {
  return CREATURE_STATS[name].skill;
}
function defenderSkill(name: CreatureName): number {
  return CREATURE_STATS[name].skill;
}
function effectivePower(name: CreatureName, score: number): number {
  if (name === "Titan") return 6 + Math.floor(score / 100);
  return CREATURE_STATS[name].power;
}
