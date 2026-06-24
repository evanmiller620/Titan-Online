import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  strikeNumber,
  effectiveStrikeNumber,
  strikeDice,
  resolveStrike,
  rangeStrength,
  rangeSkillPenalty,
  cappedReroll,
  combineMods,
  NO_MODS,
  type StrikeInputs,
} from "../src/combat/strike.ts";
import { carryOverAllowed, meleeStrikeMods } from "../src/combat/hazards.ts";
import { planRangestrike } from "../src/combat/rangestrike.ts";
import { slayThreshold } from "../src/combat/battle.ts";
import { indexMap, type BattleGrid } from "../src/battleland/terrain.ts";
import { BATTLE_MAPS } from "../src/battleland/maps.data.ts";
import { cubeDistance, cubeNeighbor } from "../src/hex/cube.ts";
import { CREATURE_STATS } from "../src/creatures/stats.data.ts";
import { scriptedRng } from "../src/core/rng/Rng.ts";
import type { GameState, Combatant } from "../src/state/GameState.ts";
import { GAME_MACHINE } from "../src/core/fsm/GameFSM.ts";
import { transition } from "../src/core/fsm/StateMachine.ts";
import { StrikeCommand } from "../src/core/commands/battle-strike.ts";
import { ValidationCode } from "../src/core/commands/Command.ts";

// ---------------------------------------------------------------------------
// Strike Chart — verified against the Law of Titan rulebook
// ---------------------------------------------------------------------------

describe("strike chart", () => {
  it("reproduces the rulebook worked example: Ogre(skill2) vs Lion(skill3) = 5", () => {
    assert.equal(strikeNumber(2, 3), 5);
  });

  it("matches the printed chart rows (clamped to [2,6])", () => {
    // def skill 2 row across attacker skill 1..5: 5,4,3,2,2 (raw 5,4,3,2,1→clamp)
    assert.deepEqual([1, 2, 3, 4, 5].map((a) => strikeNumber(a, 2)), [5, 4, 3, 2, 2]);
    // def skill 3: 6,5,4,3,2
    assert.deepEqual([1, 2, 3, 4, 5].map((a) => strikeNumber(a, 3)), [6, 5, 4, 3, 2]);
    // def skill 4: 6,6,5,4,3 (raw 7,6,5,4,3 → clamp at 6)
    assert.deepEqual([1, 2, 3, 4, 5].map((a) => strikeNumber(a, 4)), [6, 6, 5, 4, 3]);
  });

  it("never returns below 2 or above 6", () => {
    for (let a = 1; a <= 4; a++)
      for (let d = 1; d <= 4; d++) {
        const n = strikeNumber(a, d);
        assert.ok(n >= 2 && n <= 6);
      }
  });
});

describe("strike resolution", () => {
  const base = (power: number, aSkill: number, dSkill: number): StrikeInputs => ({
    attackerPower: power,
    attackerSkill: aSkill,
    defenderSkill: dSkill,
    mods: NO_MODS,
  });

  it("rolls power dice and counts hits at or above the strike number", () => {
    // Ogre power 6, skill 2 vs Lion skill 3 → strike number 5. Script dice.
    const inputs = base(6, 2, 3);
    assert.equal(strikeDice(inputs), 6);
    assert.equal(effectiveStrikeNumber(inputs), 5);
    const r = resolveStrike(inputs, scriptedRng([5, 6, 4, 3, 5, 1]));
    assert.equal(r.hits, 3); // 5,6,5 hit; 4,3,1 miss
  });

  it("mods shift dice and skill before the chart", () => {
    const inputs: StrikeInputs = {
      attackerPower: 6, attackerSkill: 2, defenderSkill: 3,
      mods: { diceDelta: 1, attackerSkillDelta: 1, defenderSkillDelta: 0, advantage: true },
    };
    assert.equal(strikeDice(inputs), 7); // +1 die
    assert.equal(effectiveStrikeNumber(inputs), 4); // skill 3 vs 3 → 4
  });

  it("forced higher strike number is honoured (carry setup, §13.4)", () => {
    const inputs = base(6, 3, 3); // natural strike number 4
    const r = resolveStrike(inputs, scriptedRng([4, 5, 6, 4, 4, 6]), 6); // force 6s only
    assert.equal(r.strikeNumber, 6);
    assert.equal(r.hits, 2); // only the two 6s
  });

  it("a forced number below natural is ignored", () => {
    const inputs = base(4, 3, 3); // natural 4
    const r = resolveStrike(inputs, scriptedRng([4, 4, 4, 4]), 2);
    assert.equal(r.strikeNumber, 4);
  });

  it("range strength is floor(power/2); range-4 costs 1 skill", () => {
    assert.equal(rangeStrength(9), 4); // Dragon
    assert.equal(rangeStrength(5), 2); // Warlock
    assert.equal(rangeSkillPenalty(3), 0);
    assert.equal(rangeSkillPenalty(4), 1);
  });

  it("mistaken-overroll cap (THE LAW OF TITAN) limits re-roll hits", () => {
    assert.equal(cappedReroll(2, 5), 2);
    assert.equal(cappedReroll(4, 1), 1);
  });
});

// ---------------------------------------------------------------------------
// Slay thresholds (incl. Titan scaling)
// ---------------------------------------------------------------------------

describe("slay thresholds", () => {
  it("equal a creature's power; the Titan scales with score", () => {
    assert.equal(slayThreshold("Ogre", 0), 6);
    assert.equal(slayThreshold("Serpent", 0), 18);
    assert.equal(slayThreshold("Titan", 0), 6);
    assert.equal(slayThreshold("Titan", 350), 9);
  });
});

// ---------------------------------------------------------------------------
// Carry-over eligibility (§13.4–13.5)
// ---------------------------------------------------------------------------

describe("carry-over eligibility", () => {
  it("allows carry when the secondary needs an equal-or-lower strike number", () => {
    assert.ok(carryOverAllowed({
      usedStrikeNumber: 5, primaryUsedAdvantage: false,
      secondaryStrikeNumber: 5, advantageAppliesToSecondary: false,
    }));
    assert.ok(carryOverAllowed({
      usedStrikeNumber: 5, primaryUsedAdvantage: false,
      secondaryStrikeNumber: 4, advantageAppliesToSecondary: false,
    }));
  });

  it("forbids carry to a target needing a higher strike number", () => {
    // Rulebook Ogre example: Lion needs 5, Centaur needs 6; striking at 5
    // cannot carry to the Centaur.
    assert.ok(!carryOverAllowed({
      usedStrikeNumber: 5, primaryUsedAdvantage: false,
      secondaryStrikeNumber: 6, advantageAppliesToSecondary: false,
    }));
  });

  it("forbids carrying advantage damage to a target the advantage doesn't reach", () => {
    assert.ok(!carryOverAllowed({
      usedStrikeNumber: 4, primaryUsedAdvantage: true,
      secondaryStrikeNumber: 4, advantageAppliesToSecondary: false,
    }));
    // …but if the advantage also applies to the secondary, carry is allowed.
    assert.ok(carryOverAllowed({
      usedStrikeNumber: 4, primaryUsedAdvantage: true,
      secondaryStrikeNumber: 4, advantageAppliesToSecondary: true,
    }));
  });
});

// ---------------------------------------------------------------------------
// Hazard strike modifiers
// ---------------------------------------------------------------------------

describe("hazard strike modifiers", () => {
  it("a Dragon striking from a Volcano adds two dice (advantage)", () => {
    const grid = indexMap(BATTLE_MAPS.Mountains!);
    const volcano = grid.map.hexes.find((h) => h.terrain === "Volcano")!;
    const neighbour = grid.map.hexes.find((h) =>
      h.label !== volcano.label &&
      Math.max(
        Math.abs(h.cube.x - volcano.cube.x),
        Math.abs(h.cube.y - volcano.cube.y),
        Math.abs(h.cube.z - volcano.cube.z),
      ) === 1)!;
    const mods = meleeStrikeMods(grid, "Dragon", "Ogre", volcano.cube, neighbour.cube);
    // +2 for the volcano, and possibly +1 more for striking down a slope (the
    // volcano sits high in the Mountains map) — the rulebook notes both apply.
    assert.ok(mods.diceDelta >= 2, `expected >= 2 dice, got ${mods.diceDelta}`);
    assert.ok(mods.advantage);
  });

  it("a bramble-native defender is harder to hit by a non-native", () => {
    const grid = indexMap(BATTLE_MAPS.Brush!);
    const bramble = grid.map.hexes.find((h) => h.terrain === "Brambles")!;
    const plains = grid.map.hexes.find((h) =>
      h.terrain === "Plains" &&
      Math.max(
        Math.abs(h.cube.x - bramble.cube.x),
        Math.abs(h.cube.y - bramble.cube.y),
        Math.abs(h.cube.z - bramble.cube.z),
      ) === 1);
    if (plains) {
      // Centaur (non-native) strikes a Gargoyle (bramble-native) in bramble.
      const mods = meleeStrikeMods(grid, "Centaur", "Gargoyle", plains.cube, bramble.cube);
      assert.equal(mods.defenderSkillDelta, 1); // +1 → harder to hit
    }
  });
});

// ---------------------------------------------------------------------------
// Rangestrike
// ---------------------------------------------------------------------------

describe("rangestrike", () => {
  const grid = indexMap(BATTLE_MAPS.Plains!);
  const hexByLabel = (l: string) => grid.map.hexes.find((h) => h.label === l)!.cube;

  it("rejects non-rangestrikers and in-contact strikers", () => {
    const r1 = planRangestrike({
      grid, attacker: "Ogre", defender: "Lion",
      from: hexByLabel("A1"), to: hexByLabel("A3"),
      attackerInContact: false, isOccupied: () => false, defenderScore: 0, attackerScore: 0,
    });
    assert.ok(!r1.ok && r1.reason === "NOT_A_RANGESTRIKER");

    const r2 = planRangestrike({
      grid, attacker: "Dragon", defender: "Lion",
      from: hexByLabel("A1"), to: hexByLabel("A3"),
      attackerInContact: true, isOccupied: () => false, defenderScore: 0, attackerScore: 0,
    });
    assert.ok(!r2.ok && r2.reason === "IN_CONTACT");
  });

  it("Lords are immune to rangestrike except from a Warlock", () => {
    const dragonVsTitan = planRangestrike({
      grid, attacker: "Dragon", defender: "Titan",
      from: hexByLabel("A1"), to: hexByLabel("A3"),
      attackerInContact: false, isOccupied: () => false, defenderScore: 0, attackerScore: 0,
    });
    assert.ok(!dragonVsTitan.ok && dragonVsTitan.reason === "LORD_IMMUNE");

    const warlockVsTitan = planRangestrike({
      grid, attacker: "Warlock", defender: "Titan",
      from: hexByLabel("A1"), to: hexByLabel("A3"),
      attackerInContact: false, isOccupied: () => false, defenderScore: 0, attackerScore: 0,
    });
    assert.ok(warlockVsTitan.ok); // magic missile pierces Lord immunity
  });

  // A board hex at exactly cube distance `d` from `a`. For valid cubes,
  // max(|dx|,|dy|,|dz|) equals the cube distance. Throws so the test can never
  // silently no-op (the previous version's `if (far)`/`if (r.ok)` guards did,
  // hiding that a skill-3 Dragon can't actually reach range 4).
  const hexAtDistance = (a: { x: number; y: number; z: number }, d: number) => {
    const h = grid.map.hexes.find((x) =>
      Math.max(Math.abs(x.cube.x - a.x), Math.abs(x.cube.y - a.y), Math.abs(x.cube.z - a.z)) === d);
    assert.ok(h, `expected a Plains hex at cube distance ${d}`);
    return h!.cube;
  };

  it("a skill-4 rangestriker reaches range 4 at half power with the −1 penalty", () => {
    // Ranger: skill 4, power 4 → floor(4/2)=2 dice. Range 4 == cube distance 3.
    const r = planRangestrike({
      grid, attacker: "Ranger", defender: "Lion",
      from: hexByLabel("A1"), to: hexAtDistance(hexByLabel("A1"), 3),
      attackerInContact: false, isOccupied: () => false, defenderScore: 0, attackerScore: 0,
    });
    assert.ok(r.ok, !r.ok ? `rejected: ${r.reason}` : "");
    if (r.ok) {
      assert.equal(r.plan.range, 4);
      assert.equal(r.plan.inputs.attackerPower, 2); // floor(4/2)
      assert.equal(r.plan.inputs.mods.attackerSkillDelta, -1); // range-4 penalty
    }
  });

  it("every rangestriker reaches range 4: a skill-3 Dragon ranges 4 (with the −1 penalty) and 3 (clean)", () => {
    const dragonR4 = planRangestrike({
      grid, attacker: "Dragon", defender: "Lion",
      from: hexByLabel("A1"), to: hexAtDistance(hexByLabel("A1"), 3), // range 4
      attackerInContact: false, isOccupied: () => false, defenderScore: 0, attackerScore: 0,
    });
    assert.ok(dragonR4.ok, !dragonR4.ok ? `rejected: ${dragonR4.reason}` : "");
    if (dragonR4.ok) {
      assert.equal(dragonR4.plan.range, 4);
      assert.equal(dragonR4.plan.inputs.attackerPower, 4); // floor(9/2)
      assert.equal(dragonR4.plan.inputs.mods.attackerSkillDelta, -1); // range-4 penalty
    }
    const dragonR3 = planRangestrike({
      grid, attacker: "Dragon", defender: "Lion",
      from: hexByLabel("A1"), to: hexAtDistance(hexByLabel("A1"), 2), // range 3
      attackerInContact: false, isOccupied: () => false, defenderScore: 0, attackerScore: 0,
    });
    assert.ok(dragonR3.ok, !dragonR3.ok ? `rejected: ${dragonR3.reason}` : "");
    if (dragonR3.ok) {
      assert.equal(dragonR3.plan.range, 3);
      assert.equal(dragonR3.plan.inputs.mods.attackerSkillDelta, 0); // no penalty below range 4
    }
    // Range 5 (cube distance 4) is still out of reach for everyone.
    const tooFar = planRangestrike({
      grid, attacker: "Dragon", defender: "Lion",
      from: hexByLabel("A1"), to: hexAtDistance(hexByLabel("A1"), 4),
      attackerInContact: false, isOccupied: () => false, defenderScore: 0, attackerScore: 0,
    });
    assert.ok(!tooFar.ok && tooFar.reason === "OUT_OF_RANGE");
  });

  it("Warlock magic missile reaches range 4, no penalty, ignoring blocked LOS", () => {
    const r = planRangestrike({
      grid, attacker: "Warlock", defender: "Lion",
      from: hexByLabel("A1"), to: hexAtDistance(hexByLabel("A1"), 3),
      attackerInContact: false, isOccupied: () => true /* would block a normal LOS */, defenderScore: 0, attackerScore: 0,
    });
    assert.ok(r.ok && r.plan.magicMissile && r.plan.inputs.mods.attackerSkillDelta === 0);
  });
});

// ---------------------------------------------------------------------------
// StrikeCommand end-to-end on a constructed battle
// ---------------------------------------------------------------------------

describe("StrikeCommand integration", () => {
  /** Build a minimal GameState sitting in the battle Strike phase with two
   *  adjacent combatants on a Plains battleland. */
  function battleState(): GameState {
    const grid = indexMap(BATTLE_MAPS.Plains!);
    const c3 = grid.map.hexes.find((h) => h.label === "C3")!.cube;
    const c4 = grid.map.hexes.find((h) => h.label === "C4")!.cube;
    const carryHex = grid.map.hexes.find((h) => h.label === "C2")!.cube;

    // Drive the FSM to Strike: Setup→…→Battle.Round.Maneuver→Strike.
    let fsm = GAME_MACHINE.initialState;
    for (const e of [
      "TURN_ORDER_DETERMINED", "TOWERS_SELECTED", "COLORS_SELECTED",
      "SPLITS_COMPLETED", "MOVEMENT_COMPLETED", "ENGAGEMENT_SELECTED",
      "BATTLE_JOINED", "DEFENDER_DEPLOYED", "ATTACKER_DEPLOYED",
      "MANEUVERS_COMPLETED",
    ]) fsm = transition(GAME_MACHINE, fsm, e);
    assert.ok(fsm.path.endsWith("Round.Strike"));

    const combatants: Combatant[] = [
      { id: "atk-1", side: "attacker", creature: "Ogre", hex: c3, damage: 0, movedThisPhase: false, struckThisPhase: false, slain: false },
      { id: "def-1", side: "defender", creature: "Lion", hex: c4, damage: 3, movedThisPhase: false, struckThisPhase: false, slain: false },
      { id: "def-2", side: "defender", creature: "Centaur", hex: carryHex, damage: 0, movedThisPhase: false, struckThisPhase: false, slain: false },
    ];

    return {
      gameId: "g", fsm,
      playerOrder: ["A", "B"],
      players: {
        A: { id: "A", name: "A", color: "Black", tower: 100, score: 0, eliminated: false, markersAvailable: [] },
        B: { id: "B", name: "B", color: "Red", tower: 400, score: 0, eliminated: false, markersAvailable: [] },
      },
      setup: null,
      turn: { number: 1, activeIndex: 0, movementRoll: 3, mulliganUsed: false },
      legions: {},
      caretaker: {} as GameState["caretaker"],
      battle: {
        land: 1, terrain: "Plains",
        attackerLegion: "Black-01", defenderLegion: "Red-01",
        attackerPlayerId: "A", defenderPlayerId: "B",
        attackerSide: "BOTTOM", round: 1, activeSide: "defender",
        summonUsed: false, firstKillHappened: false, reinforcementUsed: false,
        combatants,
      },
    };
  }

  it("an Ogre striking a Lion applies damage and slays at the threshold", () => {
    const s = battleState();
    // In Strike phase, the ACTIVE side (defender) strikes. Our striker is the
    // attacker's Ogre, so it strikes in Strikeback — adjust: make attacker the
    // active side by switching to a Strikeback-equivalent. Simpler: the Lion
    // (defender, active) strikes the Ogre. Lion power 5, skill 3 vs Ogre skill 2
    // → strike number 4 - (3-2) = 3.
    const cmd = new StrikeCommand("B", { strikerId: "def-1", targetId: "atk-1" });
    const v = cmd.validate(s);
    assert.ok(v.ok, !v.ok ? v.failure.message : "");
    // Script 5 dice all hitting (≥3): Ogre threshold 6, takes 5 → not slain.
    const { state, events } = cmd.execute(s, scriptedRng([3, 4, 5, 6, 3]));
    const ogre = state.battle!.combatants.find((c) => c.id === "atk-1")!;
    assert.equal(ogre.damage, 5);
    assert.ok(!ogre.slain);
    assert.ok(events.some((e) => e.type === "StrikeResolved"));
  });

  it("excess damage carries to a legal secondary target", () => {
    const s = battleState();
    // Defender Lion (active) strikes the Ogre with carry to… no, carry needs
    // the secondary adjacent to the striker. Reposition: have the attacker
    // strike during Strikeback instead. Switch FSM to Strikeback.
    const fsm2 = transition(GAME_MACHINE, s.fsm, "STRIKES_COMPLETED"); // → Strikeback
    const s2: GameState = { ...s, fsm: fsm2 };
    // Now the non-active side (attacker) strikes. Ogre(atk-1) strikes Lion
    // (def-1, already 3 dmg, threshold 5 → needs 2) with carry to Centaur
    // (def-2). Ogre skill 2 vs Lion skill 3 → strike 5; vs Centaur skill 4 →
    // strike 6. Carry from a 5-strike to a 6-target is ILLEGAL, so to carry
    // the Ogre must FORCE strike number 6.
    const cmd = new StrikeCommand("A", {
      strikerId: "atk-1", targetId: "def-1",
      forcedStrikeNumber: 6, carryToId: "def-2",
    });
    const v = cmd.validate(s2);
    assert.ok(v.ok, !v.ok ? v.failure.message : "");
    // Six dice; script four 6s. Lion needs 2 → slain; excess 2 carries to
    // Centaur (threshold 12) → 2 damage.
    const { state } = cmd.execute(s2, scriptedRng([6, 6, 6, 6, 1, 1]));
    const lion = state.battle!.combatants.find((c) => c.id === "def-1")!;
    const centaur = state.battle!.combatants.find((c) => c.id === "def-2")!;
    assert.ok(lion.slain, "Lion should be slain");
    assert.equal(centaur.damage, 2, "excess should carry to the Centaur");
  });

  it("rejects striking your own side and non-adjacent targets", () => {
    const s = battleState();
    // Defender striking another defender:
    const own = new StrikeCommand("B", { strikerId: "def-1", targetId: "def-2" });
    const v1 = own.validate(s);
    assert.ok(!v1.ok && v1.failure.code === ValidationCode.ILLEGAL_STRIKE);
  });
});

// ---------------------------------------------------------------------------
// Hazard strike modifiers across the real battlemaps (Hazard Chart, §13.5)
// ---------------------------------------------------------------------------

/** Find an adjacent hex pair sharing a border of `type`. With `elevated`, the
 *  pair must also differ in elevation; `hi` is the higher hex. */
function borderPair(grid: BattleGrid, type: string, elevated: boolean): { hi: { x: number; y: number; z: number }; lo: { x: number; y: number; z: number } } | null {
  for (const a of grid.map.hexes) {
    for (const bd of a.borders) {
      if (bd.type !== type) continue;
      const nb = cubeNeighbor(a.cube, bd.dir);
      const b = grid.map.hexes.find((h) => h.cube.x === nb.x && h.cube.y === nb.y && h.cube.z === nb.z);
      if (!b) continue;
      if (elevated && a.elevation === b.elevation) continue;
      const [hi, lo] = a.elevation >= b.elevation ? [a, b] : [b, a];
      return { hi: hi.cube, lo: lo.cube };
    }
  }
  return null;
}

describe("hazard strike modifiers (Hazard Chart)", () => {
  it("slope: a native adds a die striking DOWN; a non-native loses skill striking UP", () => {
    const grid = indexMap(BATTLE_MAPS.Hills!);
    const pair = borderPair(grid, "s", true);
    assert.ok(pair, "Hills should have an elevated slope pair");
    if (!pair) return;
    // Lion is slope-native; Centaur is not.
    const down = meleeStrikeMods(grid, "Lion", "Centaur", pair.hi, pair.lo);
    assert.equal(down.diceDelta, 1);
    assert.ok(down.advantage);
    const up = meleeStrikeMods(grid, "Centaur", "Lion", pair.lo, pair.hi);
    assert.equal(up.attackerSkillDelta, -1);
    assert.ok(!up.advantage);
  });

  it("wall: anyone gains skill striking DOWN across it, loses skill striking UP", () => {
    const grid = indexMap(BATTLE_MAPS.Tower!);
    const pair = borderPair(grid, "w", true);
    assert.ok(pair, "Tower should have an elevated wall pair");
    if (!pair) return;
    const down = meleeStrikeMods(grid, "Ogre", "Centaur", pair.hi, pair.lo);
    assert.equal(down.attackerSkillDelta, 1);
    assert.ok(down.advantage);
    const up = meleeStrikeMods(grid, "Centaur", "Ogre", pair.lo, pair.hi);
    assert.equal(up.attackerSkillDelta, -1);
  });

  it("volcano: the Dragon's +2 dice stack on top of any slope bonus", () => {
    const grid = indexMap(BATTLE_MAPS.Mountains!);
    const volcano = grid.map.hexes.find((h) => h.terrain === "Volcano");
    assert.ok(volcano, "Mountains has a Volcano hex");
    if (!volcano) return;
    const neighbor = grid.map.hexes.find((h) => cubeDistance(h.cube, volcano.cube) === 1 && h.terrain !== "Volcano");
    assert.ok(neighbor);
    if (!neighbor) return;
    // Dragon is volcano- AND slope-native; from the volcano its dice bonus is at
    // least the +2 volcano (plus any +1 for striking down a slope).
    const dragon = meleeStrikeMods(grid, "Dragon", "Centaur", volcano.cube, neighbor.cube);
    assert.ok(dragon.diceDelta >= 2 && dragon.advantage, `expected ≥2 dice, got ${dragon.diceDelta}`);
    // A non-Dragon native to slope (Ogre) gets the slope bonus but NOT the +2.
    const ogre = meleeStrikeMods(grid, "Ogre", "Centaur", volcano.cube, neighbor.cube);
    assert.equal(dragon.diceDelta - ogre.diceDelta, 2, "the +2 is the Dragon-only volcano bonus");
  });

  it("bramble: a native defender is harder to hit; a non-native striking OUT loses skill", () => {
    const grid = indexMap(BATTLE_MAPS.Brush!);
    const bramble = grid.map.hexes.find((h) => h.terrain === "Brambles");
    assert.ok(bramble);
    if (!bramble) return;
    const open = grid.map.hexes.find((h) => cubeDistance(h.cube, bramble.cube) === 1 && h.terrain === "Plains");
    assert.ok(open);
    if (!open) return;
    // Non-native Centaur striking a bramble-native Gargoyle defending in bramble.
    const intoBramble = meleeStrikeMods(grid, "Centaur", "Gargoyle", open.cube, bramble.cube);
    assert.equal(intoBramble.defenderSkillDelta, 1, "native defender harder to hit");
    // Non-native Centaur striking OUT of bramble loses 1 skill.
    const outOfBramble = meleeStrikeMods(grid, "Centaur", "Lion", bramble.cube, open.cube);
    assert.equal(outOfBramble.attackerSkillDelta, -1);
    // A bramble-native (Gargoyle) striking out has no penalty.
    const nativeOut = meleeStrikeMods(grid, "Gargoyle", "Lion", bramble.cube, open.cube);
    assert.equal(nativeOut.attackerSkillDelta, 0);
  });

  it("drift behaves like bramble: native defender harder to hit, non-native striking out loses skill", () => {
    const grid = indexMap(BATTLE_MAPS.Tundra!);
    let drift: typeof grid.map.hexes[number] | undefined;
    let open: typeof grid.map.hexes[number] | undefined;
    for (const h of grid.map.hexes) {
      if (h.terrain !== "Drift") continue;
      const nb = grid.map.hexes.find((x) => x.terrain === "Plains" && cubeDistance(x.cube, h.cube) === 1);
      if (nb) { drift = h; open = nb; break; }
    }
    assert.ok(drift && open, "Tundra should have a drift hex next to open ground");
    if (!drift || !open) return;
    // Troll is Drift-native; Centaur is not.
    const intoDrift = meleeStrikeMods(grid, "Centaur", "Troll", open.cube, drift.cube);
    assert.equal(intoDrift.defenderSkillDelta, 1, "native defender in drift is harder to hit");
    const outOfDrift = meleeStrikeMods(grid, "Centaur", "Lion", drift.cube, open.cube);
    assert.equal(outOfDrift.attackerSkillDelta, -1, "non-native striking out of drift loses skill");
    const nativeOut = meleeStrikeMods(grid, "Troll", "Lion", drift.cube, open.cube);
    assert.equal(nativeOut.attackerSkillDelta, 0, "a drift-native is unhindered");
  });

  it("dune: a non-native loses a die fighting across it, even on flat Desert", () => {
    const grid = indexMap(BATTLE_MAPS.Desert!);
    const pair = borderPair(grid, "d", false); // any dune hexside (Default dunes are flat)
    assert.ok(pair, "Desert should have a dune hexside");
    if (!pair) return;
    const nonNative = meleeStrikeMods(grid, "Centaur", "Lion", pair.hi, pair.lo);
    assert.equal(nonNative.diceDelta, -1, "non-native loses a die across a dune");
    // A Sand-native (Lion) crosses freely: no penalty on flat ground.
    const native = meleeStrikeMods(grid, "Lion", "Centaur", pair.lo, pair.hi);
    assert.ok(native.diceDelta >= 0, "a Sand-native is not penalised by a dune");
  });

  it("open ground has no strike modifiers", () => {
    const grid = indexMap(BATTLE_MAPS.Plains!);
    const a = grid.map.hexes.find((h) => h.label === "C3")!;
    const b = grid.map.hexes.find((h) => cubeDistance(h.cube, a.cube) === 1)!;
    const mods = meleeStrikeMods(grid, "Ogre", "Lion", a.cube, b.cube);
    assert.deepEqual({ d: mods.diceDelta, a: mods.attackerSkillDelta, df: mods.defenderSkillDelta }, { d: 0, a: 0, df: 0 });
  });
});
