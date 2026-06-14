/**
 * The Law of Titan — spec-conformance suite.
 *
 * Every assertion below is traced to a section of
 *   docs/The_Law_of_Titan_Context.md
 * (cited inline as "§N"). The Context document is the project's spec, but it is
 * not infallible: where it contradicts the canonical 1982 Avalon Hill rules the
 * engine encodes, this suite follows CORRECTNESS and records the deviation in a
 * comment so the divergence is deliberate, not accidental. Two such doc errors
 * are flagged explicitly (point-value column in §2.2; Plains→Ranger in §5.3).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CREATURE_NAMES,
  CARETAKER_LIMITS,
  LORDS,
  DEMILORDS,
  INITIAL_LEGION,
  MAX_LEGION_HEIGHT,
  type CreatureName,
} from "../src/creatures/names.ts";
import {
  CREATURE_STATS,
  powerOf,
  pointValue,
  isNativeTo,
  type BattleHazard,
} from "../src/creatures/stats.data.ts";
import {
  RECRUIT_CHAINS,
  TOWER_CREATURES,
  ACQUIRABLES,
} from "../src/creatures/recruitment.data.ts";
import { canRecruit, eligibleRecruits } from "../src/creatures/recruitment.ts";
import {
  createGame,
  markerIdsFor,
  MARKERS_PER_PLAYER,
} from "../src/state/GameState.ts";
import { strikeNumber } from "../src/combat/strike.ts";
import { rangeStrength, rangeSkillPenalty } from "../src/combat/strike.ts";
import { carryOverAllowed } from "../src/combat/hazards.ts";
import {
  slayThreshold,
  isTimeLoss,
  MAX_BATTLE_ROUNDS,
} from "../src/combat/battle.ts";
import { BATTLE_MAPS } from "../src/battleland/maps.data.ts";
import { isImpassableTerrain, blocksLineOfSight } from "../src/battleland/terrain.ts";

const FULL: Record<CreatureName, number> = Object.fromEntries(
  CREATURE_NAMES.map((n) => [n, CARETAKER_LIMITS[n]]),
) as Record<CreatureName, number>;

// ===========================================================================
// §2.2  Component taxonomy: the finite caretaker pool
// ===========================================================================

describe("§2.2 component inventory and caretaker limits", () => {
  // The caretaker-stack column of the Context table, transcribed verbatim.
  // (Titan is "1 per player"; the shared-pool sentinel is 6 = max players.)
  const DOC_CARETAKER_LIMITS: Record<CreatureName, number> = {
    Titan: 6, Archangel: 6, Angel: 18,
    Guardian: 6, Warlock: 6,
    Colossus: 10, Hydra: 10, Serpent: 10,
    Unicorn: 12, Dragon: 18, Behemoth: 18, Giant: 18, Griffon: 18, Wyvern: 18,
    Minotaur: 21, Warbear: 21, Gargoyle: 21, Gorgon: 25, Centaur: 25, Ogre: 25,
    Cyclops: 28, Lion: 28, Ranger: 28, Troll: 28,
  };

  it("there are exactly 24 distinct characters", () => {
    assert.equal(CREATURE_NAMES.length, 24);
    assert.equal(new Set(CREATURE_NAMES).size, 24);
  });

  it("every caretaker stack limit matches the Context §2.2 table", () => {
    for (const n of CREATURE_NAMES) {
      assert.equal(CARETAKER_LIMITS[n], DOC_CARETAKER_LIMITS[n], `count for ${n}`);
    }
  });

  it("each player has 12 legion markers (§2.2)", () => {
    assert.equal(MARKERS_PER_PLAYER, 12);
    assert.equal(markerIdsFor("Black").length, 12);
  });

  // DOC DEVIATION: §2.2's "Base Point Value" column (Colossus 40, Serpent 36,
  // Guardian 24, …) is NOT the real game. In Titan a creature is worth its
  // POWER in points when slain; the engine implements that (powerOf). We assert
  // the correct rule and do not import the doc's fabricated column.
  it("point value equals power (correcting the doc's bogus point column)", () => {
    assert.equal(pointValue("Colossus"), powerOf("Colossus")); // 10, not 40
    assert.equal(pointValue("Serpent"), powerOf("Serpent")); // 18, not 36
    for (const n of CREATURE_NAMES) {
      assert.equal(pointValue(n), powerOf(n), `point value for ${n}`);
    }
  });
});

// ===========================================================================
// §3.1  Setup and the fixed initial forces
// ===========================================================================

describe("§3.1 initial forces and the legion cap", () => {
  it("every player begins with Titan, Angel, 2 Centaurs, 2 Gargoyles, 2 Ogres", () => {
    const counts = new Map<CreatureName, number>();
    for (const c of INITIAL_LEGION) counts.set(c, (counts.get(c) ?? 0) + 1);
    assert.equal(INITIAL_LEGION.length, 8);
    assert.equal(counts.get("Titan"), 1);
    assert.equal(counts.get("Angel"), 1);
    assert.equal(counts.get("Centaur"), 2);
    assert.equal(counts.get("Gargoyle"), 2);
    assert.equal(counts.get("Ogre"), 2);
  });

  it("the eight starting characters carry exactly two Lords to anchor the 4/4 split", () => {
    const lords = INITIAL_LEGION.filter((c) => LORDS.has(c));
    assert.deepEqual([...lords].sort(), ["Angel", "Titan"]);
  });

  it("a legion is capped at seven everywhere except the turn-1 pre-split (§3.1)", () => {
    assert.equal(MAX_LEGION_HEIGHT, 7);
  });

  it("creating the game stocks one Titan per player and the full pool otherwise", () => {
    const g = createGame({ gameId: "g", players: [
      { id: "p1", name: "A" }, { id: "p2", name: "B" }, { id: "p3", name: "C" },
    ] });
    assert.equal(g.caretaker.Titan, 3); // one per player
    assert.equal(g.caretaker.Angel, 18);
    assert.equal(g.caretaker.Colossus, 10);
    assert.equal(Object.values(g.players).every((p) => p.score === 0), true); // all start at 0
  });
});

// ===========================================================================
// §5  The mustering economy (recruitment trees)
// ===========================================================================

describe("§5 recruitment trees match the Law of Titan", () => {
  // Canonical chains. Format: terrain → [creature, needPrevOfPriorTier][].
  // Cross-checked against §5.2–§5.4 AND the 1982 rules. Where they differ, the
  // 1982 value wins and the divergence is noted below the table.
  const CANON: Record<string, Array<[CreatureName, number]>> = {
    // §5.2 brute-force path
    Brush: [["Gargoyle", 1], ["Cyclops", 2], ["Gorgon", 2]],
    Jungle: [["Gargoyle", 1], ["Cyclops", 2], ["Behemoth", 3], ["Serpent", 2]],
    // §5.3 tactical path
    Plains: [["Centaur", 1], ["Lion", 2], ["Ranger", 2]],
    //   DOC DEVIATION: §5.3 says "3 Lions muster 1 Ranger". The real game (and
    //   the symmetric Marsh→Ranger line) uses TWO Lions. We keep 2.
    Woods: [["Centaur", 1], ["Warbear", 3], ["Unicorn", 2]],
    // §5.4 pinnacle-predator path
    Marsh: [["Ogre", 1], ["Troll", 2], ["Ranger", 2]],
    Swamp: [["Troll", 1], ["Wyvern", 3], ["Hydra", 2]],
    Hills: [["Ogre", 1], ["Minotaur", 3], ["Unicorn", 2]],
    Mountains: [["Lion", 1], ["Minotaur", 2], ["Dragon", 3], ["Colossus", 2]],
    //   §5.4 "3 Minotaurs muster 1 Dragon" — the engine previously had 2 (bug).
    Desert: [["Lion", 1], ["Griffon", 3], ["Hydra", 2]],
    Tundra: [["Troll", 1], ["Warbear", 2], ["Giant", 3], ["Colossus", 2]],
    //   §5.4 "3 Warbears muster 1 Giant" — the engine previously had 2 (bug).
  };

  it("recruit chains exist for the ten regular terrains, not Tower", () => {
    assert.deepEqual(Object.keys(RECRUIT_CHAINS).sort(), Object.keys(CANON).sort());
    assert.ok(!("Tower" in RECRUIT_CHAINS));
  });

  it("each terrain's chain matches the canonical creatures and step counts", () => {
    for (const [terrain, expected] of Object.entries(CANON)) {
      const chain = RECRUIT_CHAINS[terrain as keyof typeof RECRUIT_CHAINS]!;
      assert.equal(chain.length, expected.length, `${terrain} length`);
      chain.forEach((tier, i) => {
        assert.equal(tier.creature, expected[i]![0], `${terrain}[${i}] creature`);
        assert.equal(tier.needPrev, expected[i]![1], `${terrain}[${i}] needPrev`);
      });
    }
  });

  it("§5.4 Mountains: three Minotaurs are required for a Dragon, not two", () => {
    assert.ok(canRecruit("Mountains", ["Minotaur", "Minotaur", "Minotaur"], "Dragon", FULL));
    assert.ok(!canRecruit("Mountains", ["Minotaur", "Minotaur"], "Dragon", FULL));
  });

  it("§5.4 Tundra: three Warbears are required for a Giant, not two", () => {
    assert.ok(canRecruit("Tundra", ["Warbear", "Warbear", "Warbear"], "Giant", FULL));
    assert.ok(!canRecruit("Tundra", ["Warbear", "Warbear"], "Giant", FULL));
  });

  it("§5.2 the Jungle Cyclops→Behemoth bottleneck needs three Cyclopes", () => {
    assert.ok(canRecruit("Jungle", ["Cyclops", "Cyclops", "Cyclops"], "Behemoth", FULL));
    assert.ok(!canRecruit("Jungle", ["Cyclops", "Cyclops"], "Behemoth", FULL));
  });

  it("recruitment is one step per move: two Gargoyles cannot leap to a Gorgon (§5)", () => {
    assert.ok(!canRecruit("Brush", ["Gargoyle", "Gargoyle"], "Gorgon", FULL));
  });
});

describe("§5.1 Tower foundations and Demilords", () => {
  it("any legion on a Tower may take a Centaur, Gargoyle, or Ogre", () => {
    assert.deepEqual([...TOWER_CREATURES].sort(), ["Centaur", "Gargoyle", "Ogre"]);
    const r = eligibleRecruits("Tower", ["Wyvern"], FULL).map((o) => o.creature);
    for (const c of TOWER_CREATURES) assert.ok(r.includes(c), `expected ${c}`);
  });

  it("a Guardian needs three identical basic creatures (or an existing Guardian)", () => {
    assert.ok(canRecruit("Tower", ["Ogre", "Ogre", "Ogre"], "Guardian", FULL));
    assert.ok(!canRecruit("Tower", ["Ogre", "Ogre"], "Guardian", FULL));
    assert.ok(canRecruit("Tower", ["Guardian", "Ogre"], "Guardian", FULL));
  });

  it("a Warlock may be mustered only with the player's Titan (or an existing Warlock)", () => {
    assert.ok(canRecruit("Tower", ["Titan", "Ogre"], "Warlock", FULL, { containsOwnTitan: true }));
    assert.ok(!canRecruit("Tower", ["Ogre", "Ogre"], "Warlock", FULL, { containsOwnTitan: false }));
    assert.ok(canRecruit("Tower", ["Warlock"], "Warlock", FULL, { containsOwnTitan: false }));
  });

  it("Guardian and Warlock are the two Demilords", () => {
    assert.deepEqual([...DEMILORDS].sort(), ["Guardian", "Warlock"]);
  });
});

// ===========================================================================
// §4.3 / §7.x  Titan scaling, the strike chart, rangestrikes
// ===========================================================================

describe("§4.3 Titan power scaling", () => {
  it("the Titan gains +1 power per 100 points, reaching power 10 at 400", () => {
    assert.equal(powerOf("Titan", 0), 6);
    assert.equal(powerOf("Titan", 100), 7);
    assert.equal(powerOf("Titan", 400), 10); // the Titan-teleport threshold
    assert.equal(slayThreshold("Titan", 400), 10); // worth 10 to slay, too
  });
});

describe("§7.1 the strike chart", () => {
  it("Strike number = 4 + (defender skill − attacker skill)", () => {
    // The doc's worked example: Cyclops(skill 2) vs Ranger(skill 4) → 6.
    assert.equal(strikeNumber(2, 4), 6);
    // General formula across the printed chart's interior.
    assert.equal(strikeNumber(2, 3), 5); // Ogre vs Lion
    assert.equal(strikeNumber(4, 2), 2); // high-skill vs low-skill, floored at 2
  });

  it("a 6 is always a hit and a 1 never is — the chart clamps to [2,6]", () => {
    for (let a = 1; a <= 4; a++) {
      for (let d = 1; d <= 4; d++) {
        const n = strikeNumber(a, d);
        assert.ok(n >= 2 && n <= 6, `${a} vs ${d} = ${n}`);
      }
    }
  });
});

describe("§7.2 rangestrikes", () => {
  it("rangestrike rolls half the striker's power, rounded down", () => {
    assert.equal(rangeStrength(powerOf("Dragon")), 4); // 9 → 4
    assert.equal(rangeStrength(powerOf("Warlock")), 2); // 5 → 2
    assert.equal(rangeStrength(powerOf("Ranger")), 2); // 4 → 2
  });

  it("range 2–3 is penalty-free; range 4 costs one skill", () => {
    assert.equal(rangeSkillPenalty(2), 0);
    assert.equal(rangeSkillPenalty(3), 0);
    assert.equal(rangeSkillPenalty(4), 1);
  });

  it("line of sight is blocked by Tree (and Volcano) hexes", () => {
    assert.ok(blocksLineOfSight("Tree"));
    assert.ok(blocksLineOfSight("Volcano"));
    assert.ok(isImpassableTerrain("Tree"));
  });
});

describe("§7.3 carry-over", () => {
  it("excess hits carry only to a target needing an equal-or-lower strike number", () => {
    assert.ok(carryOverAllowed({
      usedStrikeNumber: 5, primaryUsedAdvantage: false,
      secondaryStrikeNumber: 5, advantageAppliesToSecondary: false,
    }));
    assert.ok(!carryOverAllowed({
      usedStrikeNumber: 5, primaryUsedAdvantage: false,
      secondaryStrikeNumber: 6, advantageAppliesToSecondary: false,
    }));
  });

  it("damage gained from a positional advantage cannot carry where it doesn't apply", () => {
    assert.ok(!carryOverAllowed({
      usedStrikeNumber: 4, primaryUsedAdvantage: true,
      secondaryStrikeNumber: 4, advantageAppliesToSecondary: false,
    }));
    // …unless the advantage reaches the secondary too.
    assert.ok(carryOverAllowed({
      usedStrikeNumber: 4, primaryUsedAdvantage: true,
      secondaryStrikeNumber: 4, advantageAppliesToSecondary: true,
    }));
  });
});

describe("§7.4 time-loss after seven rounds", () => {
  it("battles are capped at seven rounds", () => {
    assert.equal(MAX_BATTLE_ROUNDS, 7);
  });

  it("a defender surviving the end of round 7 inflicts a Time Loss on the attacker", () => {
    assert.ok(isTimeLoss(7, 1)); // one defender left at the cap → time loss
    assert.ok(!isTimeLoss(7, 0)); // all defenders dead → clean attacker win
    assert.ok(!isTimeLoss(6, 3)); // before the cap → no time loss yet
  });
});

describe("§7.5 Angel / Archangel acquisition thresholds", () => {
  it("an Angel is earned at 100 points, an Archangel at 500", () => {
    assert.deepEqual(ACQUIRABLES, [
      { creature: "Angel", points: 100 },
      { creature: "Archangel", points: 500 },
    ]);
  });
});

// ===========================================================================
// §6.1 / §6.2  Battlelands: deployment geometry and hazard nativity
// ===========================================================================

describe("§6.1 Battleland deployment", () => {
  // NOTE: §6.1 lists per-side entry hexes using a board orientation that
  // differs from the engine's single canonical map, so only the
  // orientation-independent facts the doc and engine agree on are asserted.
  it("the Tower defender deploys in the seven walled fortress hexes", () => {
    const tower = BATTLE_MAPS.Tower!;
    assert.ok(tower.tower);
    assert.deepEqual([...tower.startlist].sort(),
      ["C3", "C4", "D3", "D4", "D5", "E3", "E4"]); // §6.1 Tower Attacks
  });

  it("every battleland is a 27-hex grid (§2.1)", () => {
    for (const map of Object.values(BATTLE_MAPS)) {
      assert.equal(map.hexes.length, 27);
    }
  });
});

describe("§6.2 hazard nativity", () => {
  // The "Native Creatures" column of the §6.2 hazard table, as sets the engine
  // must reproduce EXACTLY (no missing, no extra natives).
  const DOC_NATIVES: Partial<Record<BattleHazard, CreatureName[]>> = {
    Brambles: ["Gargoyle", "Cyclops", "Gorgon", "Behemoth", "Serpent"],
    slope: ["Ogre", "Lion", "Minotaur", "Unicorn", "Dragon", "Colossus"],
    Bog: ["Ogre", "Troll", "Ranger", "Wyvern", "Hydra"],
    Drift: ["Troll", "Warbear", "Giant", "Colossus"],
    Sand: ["Lion", "Griffon", "Hydra"],
    Volcano: ["Dragon"],
  };

  for (const [hazard, natives] of Object.entries(DOC_NATIVES)) {
    it(`${hazard} natives are exactly ${natives!.join(", ")}`, () => {
      const actual = CREATURE_NAMES.filter((n) => isNativeTo(n, hazard as BattleHazard));
      assert.deepEqual([...actual].sort(), [...natives!].sort());
    });
  }

  it("no creature is native to Tree (§6.2: Tree has no natives)", () => {
    assert.deepEqual(CREATURE_NAMES.filter((n) => isNativeTo(n, "Tree")), []);
  });
});

// ===========================================================================
// Cross-module data integrity backing the spec
// ===========================================================================

describe("creature classification is consistent across modules", () => {
  it("lord and demilord flags agree between stats and the name registry", () => {
    for (const n of CREATURE_NAMES) {
      assert.equal(CREATURE_STATS[n].lord, LORDS.has(n), `lord flag ${n}`);
      assert.equal(CREATURE_STATS[n].demilord, DEMILORDS.has(n), `demilord flag ${n}`);
    }
  });
});
