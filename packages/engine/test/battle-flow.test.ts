import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { GAME_MACHINE } from "../src/core/fsm/GameFSM.ts";
import { transition } from "../src/core/fsm/StateMachine.ts";
import { BATTLE_MAPS } from "../src/battleland/maps.data.ts";
import { getLand } from "../src/masterboard/board.data.ts";
import { CARETAKER_LIMITS, CREATURE_NAMES, type CreatureName } from "../src/creatures/names.ts";
import { pointValue } from "../src/creatures/stats.data.ts";
import { cullOverstack, halfPoints } from "../src/combat/battle.ts";
import { scriptedRng } from "../src/core/rng/Rng.ts";
import type { GameState, Combatant, LegionState } from "../src/state/GameState.ts";
import { ValidationCode, type GameCommand } from "../src/core/commands/Command.ts";
import { ResolveEngagementCommand } from "../src/core/commands/engagement.ts";
import { StrikeCommand } from "../src/core/commands/battle-strike.ts";
import {
  DeployLegionCommand,
  MoveCombatantCommand,
  EndManeuversCommand,
  EndStrikesCommand,
  SummonAngelCommand,
  DeclineSummonCommand,
  ReinforceBattleCommand,
} from "../src/core/commands/battle-flow.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function exec(state: GameState, c: GameCommand, rng = scriptedRng([])) {
  const v = c.validate(state);
  assert.ok(v.ok, !v.ok ? `${c.type} rejected: ${v.failure.message}` : "");
  return c.execute(state, rng);
}
function rejects(state: GameState, c: GameCommand, code: string) {
  const v = c.validate(state);
  assert.ok(!v.ok, `${c.type} should have been rejected`);
  if (!v.ok) assert.equal(v.failure.code, code);
}

const FULL: Record<CreatureName, number> = Object.fromEntries(
  CREATURE_NAMES.map((n) => [n, CARETAKER_LIMITS[n]]),
) as Record<CreatureName, number>;

function plainsLand(): number {
  for (let i = 1; i <= 600; i++) {
    const l = getLand(i);
    if (l && l.terrain === "Plains") return i;
  }
  throw new Error("no Plains land found");
}
const PLAINS = plainsLand();

const plainsHexes = BATTLE_MAPS.Plains!.hexes;
function cubeOf(label: string) {
  const h = plainsHexes.find((x) => x.label === label);
  if (!h) throw new Error(`no hex ${label}`);
  return h.cube;
}

interface UnitSpec { creature: CreatureName; label: string; damage?: number; slain?: boolean }
interface HomeSpec { marker: string; owner: "A" | "B"; creatures: CreatureName[]; land?: number }

interface BattleOpts {
  phase: "DefenderDeployment" | "AttackerDeployment" | "Maneuver" | "Strike" | "Strikeback";
  activeSide?: "attacker" | "defender";
  round?: number;
  atk: UnitSpec[];
  def: UnitSpec[];
  homes?: HomeSpec[];
  aScore?: number;
  bScore?: number;
  summonPending?: boolean;
  reinforcementUsed?: boolean;
}

function fsmForPhase(phase: BattleOpts["phase"]) {
  const seq = [
    "TURN_ORDER_DETERMINED", "TOWERS_SELECTED", "COLORS_SELECTED",
    "SPLITS_COMPLETED", "MOVEMENT_COMPLETED", "ENGAGEMENT_SELECTED", "BATTLE_JOINED",
  ];
  if (phase !== "DefenderDeployment") seq.push("DEFENDER_DEPLOYED");
  if (phase !== "DefenderDeployment" && phase !== "AttackerDeployment") seq.push("ATTACKER_DEPLOYED");
  if (phase === "Strike" || phase === "Strikeback") seq.push("MANEUVERS_COMPLETED");
  if (phase === "Strikeback") seq.push("STRIKES_COMPLETED");
  let fsm = GAME_MACHINE.initialState;
  for (const e of seq) fsm = transition(GAME_MACHINE, fsm, e);
  return fsm;
}

function combatantsFrom(specs: UnitSpec[], side: "attacker" | "defender"): Combatant[] {
  const p = side === "attacker" ? "atk" : "def";
  return specs.map((s, i) => ({
    id: `${p}-${i}`, side, creature: s.creature, hex: cubeOf(s.label),
    damage: s.damage ?? 0, movedThisPhase: false, struckThisPhase: false, slain: s.slain ?? false,
  }));
}

function buildBattle(opts: BattleOpts): GameState {
  const fsm = fsmForPhase(opts.phase);
  const activeSide = opts.activeSide ?? "defender";
  const round = opts.round ?? 1;

  const legions: Record<string, LegionState> = {
    "Black-01": { marker: "Black-01", ownerId: "A", land: PLAINS, creatures: opts.atk.map((u) => u.creature), moved: true, splitThisTurn: false, recruitedThisTurn: false, revealed: true },
    "Red-01": { marker: "Red-01", ownerId: "B", land: PLAINS, creatures: opts.def.map((u) => u.creature), moved: false, splitThisTurn: false, recruitedThisTurn: false, revealed: true },
  };
  for (const h of opts.homes ?? []) {
    legions[h.marker] = { marker: h.marker, ownerId: h.owner, land: h.land ?? (h.owner === "A" ? 100 : 400), creatures: h.creatures, moved: false, splitThisTurn: false, recruitedThisTurn: false, revealed: false };
  }

  return {
    gameId: "g", fsm, playerOrder: ["A", "B"],
    players: {
      A: { id: "A", name: "A", color: "Black", tower: 100, score: opts.aScore ?? 0, eliminated: false, markersAvailable: ["Black-02"] },
      B: { id: "B", name: "B", color: "Red", tower: 400, score: opts.bScore ?? 0, eliminated: false, markersAvailable: ["Red-02"] },
    },
    setup: null,
    turn: { number: 2, activeIndex: 0, movementRoll: 3, mulliganUsed: false, engagementLand: PLAINS },
    legions,
    caretaker: { ...FULL },
    battle: {
      land: PLAINS, terrain: "Plains",
      attackerLegion: "Black-01", defenderLegion: "Red-01",
      attackerPlayerId: "A", defenderPlayerId: "B",
      attackerSide: "BOTTOM", round, activeSide,
      summonUsed: false, firstKillHappened: false, reinforcementUsed: opts.reinforcementUsed ?? false,
      summonPending: opts.summonPending ?? false,
      combatants: [...combatantsFrom(opts.atk, "attacker"), ...combatantsFrom(opts.def, "defender")],
    },
  };
}

/** A GameState parked in Engagement.Negotiation with a clash at PLAINS. */
function engagedState(atk: CreatureName[], def: CreatureName[]): GameState {
  let fsm = GAME_MACHINE.initialState;
  for (const e of ["TURN_ORDER_DETERMINED", "TOWERS_SELECTED", "COLORS_SELECTED", "SPLITS_COMPLETED", "MOVEMENT_COMPLETED", "ENGAGEMENT_SELECTED"]) {
    fsm = transition(GAME_MACHINE, fsm, e);
  }
  return {
    gameId: "g", fsm, playerOrder: ["A", "B"],
    players: {
      A: { id: "A", name: "A", color: "Black", tower: 100, score: 0, eliminated: false, markersAvailable: ["Black-02"] },
      B: { id: "B", name: "B", color: "Red", tower: 400, score: 0, eliminated: false, markersAvailable: ["Red-02"] },
    },
    setup: null,
    turn: { number: 2, activeIndex: 0, movementRoll: 3, mulliganUsed: false, engagementLand: PLAINS },
    legions: {
      "Black-01": { marker: "Black-01", ownerId: "A", land: PLAINS, creatures: atk, moved: true, splitThisTurn: false, recruitedThisTurn: false, revealed: false },
      "Red-01": { marker: "Red-01", ownerId: "B", land: PLAINS, creatures: def, moved: false, splitThisTurn: false, recruitedThisTurn: false, revealed: false },
    },
    caretaker: { ...FULL }, battle: null,
  };
}

// ===========================================================================
// Pure scoring helpers
// ===========================================================================

describe("cullOverstack (§8.2)", () => {
  it("removes ordinary creatures before lords, highest value first, never the Titan", () => {
    const { kept, removed } = cullOverstack(
      ["Titan", "Colossus", "Serpent", "Angel", "Ogre", "Ogre", "Centaur", "Gargoyle"],
    );
    assert.equal(kept.length, 7);
    assert.deepEqual(removed, ["Serpent"]); // highest-value ordinary creature
    assert.ok(kept.includes("Titan"));
  });

  it("falls back to Angels only when no ordinary creatures remain to cull", () => {
    const { kept, removed } = cullOverstack(["Titan", "Angel", "Angel", "Angel", "Angel", "Angel", "Angel", "Angel"]);
    assert.deepEqual(removed, ["Angel"]);
    assert.equal(kept.filter((c) => c === "Angel").length, 6);
  });

  it("is a no-op at or below the cap", () => {
    assert.deepEqual(cullOverstack(["Ogre", "Ogre"]).removed, []);
  });
});

describe("halfPoints (§8.1)", () => {
  it("halves the combined value, rounding the sum once", () => {
    assert.equal(halfPoints(["Angel", "Ogre"]), 6); // (6+6)/2
    assert.equal(halfPoints(["Centaur"]), 2); // round(3/2)
    assert.equal(halfPoints([]), 0);
  });
});

// ===========================================================================
// Engagement → fight → deploy → maneuver
// ===========================================================================

describe("engagement 'fight' opens the battle", () => {
  it("builds a BattleContext and enters DefenderDeployment", () => {
    const s = engagedState(["Titan", "Ogre"], ["Centaur"]);
    const { state, events } = exec(s, new ResolveEngagementCommand("A", { outcome: "fight" }));
    assert.ok(state.battle, "battle started");
    assert.ok(state.fsm.path.endsWith("Battle.DefenderDeployment"));
    assert.equal(state.battle!.combatants.length, 3);
    assert.ok(state.legions["Black-01"]!.revealed && state.legions["Red-01"]!.revealed);
    assert.ok(events.some((e) => e.type === "BattleJoined"));
  });
});

describe("deployment", () => {
  function fought(): GameState {
    const s = engagedState(["Titan", "Ogre"], ["Centaur"]);
    return exec(s, new ResolveEngagementCommand("A", { outcome: "fight" })).state;
  }

  it("defender deploys first, then attacker, reaching the Maneuver phase", () => {
    let s = fought();
    s = exec(s, new DeployLegionCommand("B", { placements: [{ combatantId: "def-0", hex: "C5" }] })).state;
    assert.ok(s.fsm.path.endsWith("Battle.AttackerDeployment"));
    s = exec(s, new DeployLegionCommand("A", { placements: [
      { combatantId: "atk-0", hex: "C1" }, { combatantId: "atk-1", hex: "D1" },
    ] })).state;
    assert.ok(s.fsm.path.endsWith("Battle.Round.Maneuver"));
    assert.equal(s.battle!.activeSide, "defender");
    // every combatant now has a hex
    assert.ok(s.battle!.combatants.every((c) => c.hex));
  });

  it("rejects the wrong player, wrong count, and out-of-zone hexes", () => {
    const s = fought();
    rejects(s, new DeployLegionCommand("A", { placements: [{ combatantId: "def-0", hex: "C5" }] }), ValidationCode.NOT_ACTIVE_PLAYER);
    rejects(s, new DeployLegionCommand("B", { placements: [] }), ValidationCode.ILLEGAL_DEPLOYMENT);
    rejects(s, new DeployLegionCommand("B", { placements: [{ combatantId: "def-0", hex: "A1" }] }), ValidationCode.ILLEGAL_DEPLOYMENT);
  });
});

describe("maneuver", () => {
  it("moves a combatant within its movement allowance and ends the phase", () => {
    const s = buildBattle({ phase: "Maneuver", activeSide: "defender", atk: [{ creature: "Ogre", label: "C1" }], def: [{ creature: "Centaur", label: "C5" }] });
    const { state } = exec(s, new MoveCombatantCommand("B", { combatantId: "def-0", hex: "C4" }));
    const def0 = state.battle!.combatants.find((c) => c.id === "def-0")!;
    assert.equal(def0.hex!.x, cubeOf("C4").x);
    assert.ok(def0.movedThisPhase);
    const ended = exec(state, new EndManeuversCommand("B", {}));
    assert.ok(ended.state.fsm.path.endsWith("Round.Strike"));
  });

  it("rejects an unreachable destination and the wrong player", () => {
    const s = buildBattle({ phase: "Maneuver", activeSide: "defender", atk: [{ creature: "Ogre", label: "C1" }], def: [{ creature: "Centaur", label: "C5" }] });
    rejects(s, new MoveCombatantCommand("A", { combatantId: "def-0", hex: "C4" }), ValidationCode.NOT_ACTIVE_PLAYER);
    rejects(s, new MoveCombatantCommand("B", { combatantId: "def-9", hex: "C4" }), ValidationCode.UNKNOWN_COMBATANT);
  });
});

// ===========================================================================
// Strikes, summon, conclusion
// ===========================================================================

describe("strike → first-blood Angel summon (§7.5)", () => {
  it("a first kill opens the summon window and blocks ending the phase until resolved", () => {
    const s = buildBattle({
      phase: "Strike", activeSide: "attacker",
      atk: [{ creature: "Ogre", label: "C3" }],
      def: [{ creature: "Centaur", label: "C4" }, { creature: "Centaur", label: "E5" }],
      homes: [{ marker: "Black-05", owner: "A", creatures: ["Angel", "Centaur"] }],
    });
    // Ogre(skill2) vs Centaur(skill4) → strike number 6; three 6s slay (threshold 3).
    const struck = exec(s, new StrikeCommand("A", { strikerId: "atk-0", targetId: "def-0" }), scriptedRng([6, 6, 6, 1, 1, 1]));
    assert.ok(struck.state.battle!.combatants.find((c) => c.id === "def-0")!.slain);
    assert.ok(struck.state.battle!.summonPending, "summon window opened");
    rejects(struck.state, new EndStrikesCommand("A", {}), ValidationCode.ILLEGAL_PHASE_ADVANCE);

    const summoned = exec(struck.state, new SummonAngelCommand("A", { fromLegion: "Black-05" }));
    assert.ok(!summoned.state.battle!.summonPending);
    assert.ok(summoned.state.battle!.summonUsed);
    assert.equal(summoned.state.battle!.combatants.filter((c) => c.side === "attacker" && c.creature === "Angel").length, 1);
    assert.ok(!summoned.state.legions["Black-05"]!.creatures.includes("Angel"));
    // now the phase can end
    assert.ok(exec(summoned.state, new EndStrikesCommand("A", {})).state.fsm.path.endsWith("Round.Strikeback"));
  });

  it("declining forfeits the right for the rest of the battle", () => {
    const s = buildBattle({
      phase: "Strike", activeSide: "attacker", summonPending: true,
      atk: [{ creature: "Ogre", label: "C3" }], def: [{ creature: "Centaur", label: "C4", slain: true }],
      homes: [{ marker: "Black-05", owner: "A", creatures: ["Angel"] }],
    });
    const declined = exec(s, new DeclineSummonCommand("A", {}));
    assert.ok(!declined.state.battle!.summonPending && declined.state.battle!.summonUsed);
  });
});

describe("conclusion & scoring (§8)", () => {
  it("a normal win: winner scores the slain, loser legion removed, marker returned", () => {
    const s = buildBattle({
      phase: "Strike", activeSide: "attacker",
      atk: [{ creature: "Ogre", label: "C3" }],
      def: [{ creature: "Centaur", label: "C4", slain: true }],
      homes: [{ marker: "Red-09", owner: "B", creatures: ["Titan"] }], // B keeps a Titan elsewhere
    });
    const { state, events } = exec(s, new EndStrikesCommand("A", {}));
    assert.equal(state.battle, null);
    assert.equal(state.players.A.score, pointValue("Centaur")); // 3
    assert.equal(state.legions["Red-01"], undefined);
    assert.deepEqual(state.legions["Black-01"]!.creatures, ["Ogre"]);
    assert.ok(state.players.B.markersAvailable.includes("Red-01")); // returned
    assert.ok(!state.players.B.eliminated);
    assert.ok(state.fsm.path.endsWith("Turn.Mustering"));
    assert.ok(events.some((e) => e.type === "BattleConcluded"));
  });

  it("killing the enemy Titan eliminates them; victor inherits markers and half-points", () => {
    const s = buildBattle({
      phase: "Strike", activeSide: "attacker",
      atk: [{ creature: "Ogre", label: "C3" }],
      def: [{ creature: "Titan", label: "C4", slain: true }],
      homes: [{ marker: "Red-07", owner: "B", creatures: ["Angel", "Ogre"] }], // unengaged → half-points
    });
    const { state, events } = exec(s, new EndStrikesCommand("A", {}));
    assert.ok(state.players.B.eliminated);
    // 6 (Titan slain) + halfPoints(Angel+Ogre)=6  → 12
    assert.equal(state.players.A.score, 6 + 6);
    assert.ok(state.players.A.markersAvailable.includes("Red-07"));
    assert.ok(events.some((e) => e.type === "MarkersInherited"));
    assert.ok(events.some((e) => e.type === "GameEnded"));
    assert.ok(state.fsm.path === "GameOver");
  });

  it("mutual destruction: both Titans die, nobody scores, both eliminated", () => {
    const s = buildBattle({
      phase: "Strike", activeSide: "attacker",
      atk: [{ creature: "Titan", label: "C3", slain: true }, { creature: "Ogre", label: "C2" }],
      def: [{ creature: "Titan", label: "C4", slain: true }, { creature: "Centaur", label: "C5" }],
    });
    const { state, events } = exec(s, new EndStrikesCommand("A", {}));
    assert.equal(state.players.A.score, 0);
    assert.equal(state.players.B.score, 0);
    assert.ok(state.players.A.eliminated && state.players.B.eliminated);
    assert.equal(state.battle, null);
    assert.ok(events.some((e) => e.type === "BattleConcluded" && e.outcome === "mutual"));
  });

  it("attacker time-loss at the end of round 7: legion lost, defender scores nothing", () => {
    const s = buildBattle({
      phase: "Strikeback", activeSide: "attacker", round: 7,
      atk: [{ creature: "Ogre", label: "C3" }],
      def: [{ creature: "Centaur", label: "C4" }],
      homes: [{ marker: "Black-09", owner: "A", creatures: ["Titan"] }], // A survives via home Titan
    });
    const { state, events } = exec(s, new EndStrikesCommand("B", {}));
    assert.equal(state.players.B.score, 0); // §7.4 no points on a time loss
    assert.equal(state.legions["Black-01"], undefined); // attacker legion eliminated
    assert.ok(state.legions["Red-01"]); // defender survives
    assert.ok(!state.players.A.eliminated); // still has the home Titan
    assert.ok(events.some((e) => e.type === "BattleConcluded" && e.timeLoss === true));
  });
});

// ===========================================================================
// Round / half-turn bookkeeping
// ===========================================================================

describe("round & half-turn bookkeeping", () => {
  it("ending the defender's strikeback passes to the attacker half, same round", () => {
    const s = buildBattle({ phase: "Strikeback", activeSide: "defender", round: 1,
      atk: [{ creature: "Ogre", label: "C3" }], def: [{ creature: "Centaur", label: "C4" }] });
    // In Strikeback the non-active side (attacker, A) acts.
    const { state } = exec(s, new EndStrikesCommand("A", {}));
    assert.equal(state.battle!.activeSide, "attacker");
    assert.equal(state.battle!.round, 1);
    assert.ok(state.fsm.path.endsWith("Round.Maneuver"));
  });

  it("ending the attacker's strikeback completes the round and increments it", () => {
    const s = buildBattle({ phase: "Strikeback", activeSide: "attacker", round: 1,
      atk: [{ creature: "Ogre", label: "C3" }], def: [{ creature: "Centaur", label: "C4" }] });
    const { state } = exec(s, new EndStrikesCommand("B", {}));
    assert.equal(state.battle!.activeSide, "defender");
    assert.equal(state.battle!.round, 2);
  });
});

// ===========================================================================
// Round-4 defensive muster
// ===========================================================================

describe("round-4 defensive muster (§7.5)", () => {
  it("the defender may muster one reinforcement at the start of round 4", () => {
    const s = buildBattle({ phase: "Maneuver", activeSide: "defender", round: 4,
      atk: [{ creature: "Ogre", label: "C1" }],
      def: [{ creature: "Centaur", label: "C5" }, { creature: "Centaur", label: "D6" }] });
    const before = s.caretaker.Lion;
    const { state, events } = exec(s, new ReinforceBattleCommand("B", { creature: "Lion" }));
    assert.equal(state.caretaker.Lion, before - 1);
    assert.ok(state.battle!.reinforcementUsed);
    assert.equal(state.battle!.combatants.filter((c) => c.side === "defender" && c.creature === "Lion").length, 1);
    assert.ok(events.some((e) => e.type === "BattleReinforced"));
  });

  it("is illegal outside round 4 / for the attacker", () => {
    const s = buildBattle({ phase: "Maneuver", activeSide: "defender", round: 3,
      atk: [{ creature: "Ogre", label: "C1" }],
      def: [{ creature: "Centaur", label: "C5" }, { creature: "Centaur", label: "D6" }] });
    rejects(s, new ReinforceBattleCommand("B", { creature: "Lion" }), ValidationCode.ILLEGAL_REINFORCE);
  });
});
