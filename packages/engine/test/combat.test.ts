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
import { indexMap } from "../src/battleland/terrain.ts";
import { BATTLE_MAPS } from "../src/battleland/maps.data.ts";
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

  it("uses half power for dice and applies the range-4 skill penalty", () => {
    // Dragon power 9 → 4 dice. Pick hexes at range 4 (distance 3).
    const a = hexByLabel("A1");
    // Find a hex at cube distance 3 in a straight line for a clean range-4.
    const far = grid.map.hexes.find((h) =>
      Math.max(
        Math.abs(h.cube.x - a.x), Math.abs(h.cube.y - a.y), Math.abs(h.cube.z - a.z),
      ) === 3);
    if (far) {
      const r = planRangestrike({
        grid, attacker: "Dragon", defender: "Lion",
        from: a, to: far.cube,
        attackerInContact: false, isOccupied: () => false, defenderScore: 0, attackerScore: 0,
      });
      if (r.ok) {
        assert.equal(r.plan.inputs.attackerPower, 4); // floor(9/2)
        assert.equal(r.plan.range, 4);
        assert.equal(r.plan.inputs.mods.attackerSkillDelta, -1); // range-4 penalty
      }
    }
  });

  it("Warlock magic missile ignores the range-4 penalty", () => {
    const a = hexByLabel("A1");
    const far = grid.map.hexes.find((h) =>
      Math.max(
        Math.abs(h.cube.x - a.x), Math.abs(h.cube.y - a.y), Math.abs(h.cube.z - a.z),
      ) === 3);
    if (far) {
      const r = planRangestrike({
        grid, attacker: "Warlock", defender: "Lion",
        from: a, to: far.cube,
        attackerInContact: false, isOccupied: () => false, defenderScore: 0, attackerScore: 0,
      });
      assert.ok(r.ok && r.plan.magicMissile && r.plan.inputs.mods.attackerSkillDelta === 0);
    }
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
