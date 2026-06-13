/**
 * Hazard strike modifiers & carry-over (Titan engine, module: combat).
 *
 * Translates the Hazard Chart's "EFFECT ON STRIKING" rules into StrikeMods,
 * and implements carry-over eligibility (§13.4–13.5).
 *
 * Striking hazard effects modelled (melee):
 *  - Bramble: a NATIVE defender in Bramble raises the strike-number to hit it
 *    by 1 vs a non-native (defenderSkillDelta +1 in the chart's terms — a
 *    higher strike number = harder). A NON-NATIVE striking OUT of Bramble
 *    loses 1 skill (attackerSkillDelta −1).
 *  - Slope: a native adds 1 die striking DOWN a slope (diceDelta +1, advantage);
 *    a non-native loses 1 skill striking UP a slope (attackerSkillDelta −1).
 *  - Dune: a native adds 2 dice striking DOWN across a dune (diceDelta +2,
 *    advantage); a non-native loses 1 die striking UP across a dune
 *    (diceDelta −1).
 *  - Wall: ANY character gains 1 skill striking DOWN across a wall (advantage),
 *    loses 1 skill striking UP across a wall.
 *  - Volcano: a Dragon adds 2 dice striking from the volcano (diceDelta +2,
 *    advantage).
 *  - Drift: no strike modifier (its effect is per-round damage, handled by the
 *    battle round, not here).
 *
 * "advantage" flags a positional benefit the attacker is using; it gates
 * carry-over. Penalties (losing dice/skill) are not advantages.
 *
 * Elevation drives up/down: striking from higher elevation to lower is
 * "down"; the hexside feature lives on the shared edge (we read it via the
 * battleland border lookup). Nativity comes from creature stats.
 */

import {
  NO_MODS,
  combineMods,
  effectiveStrikeNumber,
  strikeNumber,
  type StrikeMods,
} from "./strike.ts";
import type { CreatureName } from "../creatures/names.ts";
import { isNativeTo } from "../creatures/stats.data.ts";
import type { BattleGrid } from "../battleland/terrain.ts";
import { borderBetween, hexAt } from "../battleland/terrain.ts";
import type { CubeCoord } from "../hex/cube.ts";
import type { BorderType, HexTerrain } from "../battleland/maps.data.ts";

/**
 * Compute the melee StrikeMods for `attacker` in `attackerHex` striking
 * `defender` in `defenderHex` on `grid`. Reads elevation and the shared
 * hexside feature; nativity from creature stats.
 */
export function meleeStrikeMods(
  grid: BattleGrid,
  attacker: CreatureName,
  defender: CreatureName,
  attackerHex: CubeCoord,
  defenderHex: CubeCoord,
): StrikeMods {
  const aHex = hexAt(grid, attackerHex);
  const dHex = hexAt(grid, defenderHex);
  if (!aHex || !dHex) return NO_MODS;

  let mods = NO_MODS;

  // Shared hexside feature (check both sides — features may be on either hex).
  const border: BorderType | null =
    borderBetween(grid, attackerHex, defenderHex) ??
    borderBetween(grid, defenderHex, attackerHex);
  const strikingDown = aHex.elevation > dHex.elevation;
  const strikingUp = aHex.elevation < dHex.elevation;

  if (border === "s") {
    if (strikingDown && isNativeTo(attacker, "slope")) {
      mods = combineMods(mods, { diceDelta: 1, attackerSkillDelta: 0, defenderSkillDelta: 0, advantage: true });
    } else if (strikingUp && !isNativeTo(attacker, "slope")) {
      mods = combineMods(mods, { diceDelta: 0, attackerSkillDelta: -1, defenderSkillDelta: 0, advantage: false });
    }
  } else if (border === "d") {
    if (strikingDown && isNativeTo(attacker, "Sand")) {
      mods = combineMods(mods, { diceDelta: 2, attackerSkillDelta: 0, defenderSkillDelta: 0, advantage: true });
    } else if (strikingUp && !isNativeTo(attacker, "Sand")) {
      mods = combineMods(mods, { diceDelta: -1, attackerSkillDelta: 0, defenderSkillDelta: 0, advantage: false });
    }
  } else if (border === "w") {
    if (strikingDown) {
      mods = combineMods(mods, { diceDelta: 0, attackerSkillDelta: 1, defenderSkillDelta: 0, advantage: true });
    } else if (strikingUp) {
      mods = combineMods(mods, { diceDelta: 0, attackerSkillDelta: -1, defenderSkillDelta: 0, advantage: false });
    }
  }

  // In-hex hazards.
  // Bramble: native defender harder to hit vs non-native attacker.
  if (isBramble(dHex.terrain) && isNativeTo(defender, "Brambles") && !isNativeTo(attacker, "Brambles")) {
    // Harder to hit = higher strike number = +1 to defender's effective skill.
    mods = combineMods(mods, { diceDelta: 0, attackerSkillDelta: 0, defenderSkillDelta: 1, advantage: false });
  }
  // Non-native striking OUT of bramble loses 1 skill.
  if (isBramble(aHex.terrain) && !isNativeTo(attacker, "Brambles")) {
    mods = combineMods(mods, { diceDelta: 0, attackerSkillDelta: -1, defenderSkillDelta: 0, advantage: false });
  }
  // Volcano: Dragon adds 2 dice striking from it.
  if (aHex.terrain === "Volcano" && attacker === "Dragon") {
    mods = combineMods(mods, { diceDelta: 2, attackerSkillDelta: 0, defenderSkillDelta: 0, advantage: true });
  }

  return mods;
}

function isBramble(t: HexTerrain): boolean {
  return t === "Brambles";
}

/**
 * Carry-over eligibility (§13.4–13.5). Excess hits on a slain primary target
 * may carry to a secondary adjacent enemy ONLY IF the secondary would face a
 * strike-number no higher than the one actually used on the primary, AND the
 * attacker is not relying on a positional advantage that wouldn't apply to the
 * secondary (unless the advantage was waived).
 *
 * Returns the maximum hits that may carry to `secondary`, or 0 if carry is
 * illegal. `usedStrikeNumber` is the number the attacker actually rolled
 * against (possibly forced higher per §13.4).
 */
export function carryOverAllowed(args: {
  /** Strike number actually used against the primary target. */
  readonly usedStrikeNumber: number;
  /** Did the attacker use a positional advantage against the primary? */
  readonly primaryUsedAdvantage: boolean;
  /** Natural strike number vs the secondary (no advantage, its own hazards). */
  readonly secondaryStrikeNumber: number;
  /** Would the same advantage apply to the secondary? */
  readonly advantageAppliesToSecondary: boolean;
}): boolean {
  // No carrying advantage damage to a target the advantage wouldn't hit.
  if (args.primaryUsedAdvantage && !args.advantageAppliesToSecondary) {
    return false;
  }
  // Secondary must not require a HIGHER strike number than the one used.
  return args.secondaryStrikeNumber <= args.usedStrikeNumber;
}
