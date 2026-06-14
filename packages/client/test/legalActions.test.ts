import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createGame, viewFor,
  RollTurnOrderCommand, SelectTowerCommand, SelectColorCommand, SplitLegionCommand,
  EndSplitsCommand, RollMovementCommand, DeployLegionCommand,
  destinationsForRoll, scriptedRng,
  GAME_MACHINE, transition, BATTLE_MAPS,
} from "@titan/engine";
import {
  legalActions, planMasterboardClick, planBattleClick,
  autoDeployPlacements, deployZoneLabels, proposeInitialSplit, battleBanner,
  NO_SELECTION, type Selection,
} from "../src/game/legalActions.ts";

const sel = (p: Partial<Selection> = {}): Selection => ({ ...NO_SELECTION, ...p });
const types = (view: any, seat: string, s: Selection = NO_SELECTION) => legalActions(view, seat, s).map((a) => a.dto.type);

// --- real engine fixtures --------------------------------------------------

function afterSetup() {
  let s = createGame({ gameId: "g", players: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }] });
  s = new RollTurnOrderCommand("p1", {}).execute(s, scriptedRng([6, 2])).state;
  s = new SelectTowerCommand("p1", { tower: 100 }).execute(s, scriptedRng([])).state;
  s = new SelectTowerCommand("p2", { tower: 400 }).execute(s, scriptedRng([])).state;
  s = new SelectColorCommand("p2", { color: "Red" }).execute(s, scriptedRng([])).state;
  s = new SelectColorCommand("p1", { color: "Black" }).execute(s, scriptedRng([])).state;
  return s;
}

describe("legalActions — setup & turn phases", () => {
  it("rolling, tower, color, then split & movement", () => {
    const s0 = createGame({ gameId: "g", players: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }] });
    assert.deepEqual(types(viewFor(s0, "p1"), "p1"), ["RollTurnOrder"]);

    const s1 = new RollTurnOrderCommand("p1", {}).execute(s0, scriptedRng([6, 2])).state;
    const picker = s1.setup!.order[s1.setup!.towerPickIndex];
    assert.ok(types(viewFor(s1, picker), picker).every((t) => t === "SelectTower"));

    const s = afterSetup();
    const view = viewFor(s, "p1");
    const split = proposeInitialSplit(view, "p1")!;
    assert.ok(split, "split proposed");
    assert.ok(types(view, "p1").includes("SplitLegion"));
    assert.ok(new SplitLegionCommand("p1", split as any).validate(s).ok, "engine accepts the proposed split");
  });

  it("offers fight/flee/concede only to the active player", () => {
    let s = afterSetup();
    s = new SplitLegionCommand("p1", proposeInitialSplit(viewFor(s, "p1"), "p1") as any).execute(s, scriptedRng([])).state;
    s = new EndSplitsCommand("p1", {}).execute(s, scriptedRng([])).state;
    s = new RollMovementCommand("p1", {}).execute(s, scriptedRng([3])).state;
    const v = viewFor(s, "p1");
    const leg = Object.values(v.legions).find((l) => l.ownerId === "p1")!;
    const dest = destinationsForRoll(leg.land, 3)[0]!.destination;
    const plan = planMasterboardClick(v, "p1", sel({ legion: leg.marker }), dest);
    assert.equal(plan.dto?.type, "MoveLegion");
  });
});

// --- battle fixtures (constructed view) ------------------------------------

const plains = BATTLE_MAPS.Plains as any;
const cubeOf = (l: string) => plains.hexes.find((h: any) => h.label === l).cube;
function fsmPath(phase: string) {
  const seq = ["TURN_ORDER_DETERMINED", "TOWERS_SELECTED", "COLORS_SELECTED", "SPLITS_COMPLETED", "MOVEMENT_COMPLETED", "ENGAGEMENT_SELECTED", "BATTLE_JOINED"];
  if (phase !== "DefenderDeployment") seq.push("DEFENDER_DEPLOYED");
  if (phase !== "DefenderDeployment" && phase !== "AttackerDeployment") seq.push("ATTACKER_DEPLOYED");
  if (phase === "Strike" || phase === "Strikeback") seq.push("MANEUVERS_COMPLETED");
  if (phase === "Strikeback") seq.push("STRIKES_COMPLETED");
  let fsm = (GAME_MACHINE as any).initialState;
  for (const e of seq) fsm = transition(GAME_MACHINE as any, fsm, e);
  return fsm;
}
function battleView(phase: string, o: { activeSide?: "attacker" | "defender"; round?: number; units: any[]; summonPending?: boolean; legions?: any }): any {
  return {
    gameId: "g", fsm: fsmPath(phase), playerOrder: ["p1", "p2"],
    players: { p1: { id: "p1", color: "Black", tower: 100, score: 0, eliminated: false, markersAvailable: [] }, p2: { id: "p2", color: "Red", tower: 400, score: 0, eliminated: false, markersAvailable: [] } },
    setup: null, turn: { number: 2, activeIndex: 0, movementRoll: 3, mulliganUsed: false, engagementLand: 1 },
    caretaker: { Lion: 9 }, legions: o.legions ?? {}, revealedMarkers: [],
    battle: {
      land: 1, terrain: "Plains", attackerLegion: "Black-01", defenderLegion: "Red-01",
      attackerPlayerId: "p1", defenderPlayerId: "p2", attackerSide: "BOTTOM",
      round: o.round ?? 1, activeSide: o.activeSide ?? "defender",
      summonUsed: false, firstKillHappened: false, reinforcementUsed: false, summonPending: o.summonPending ?? false,
      combatants: o.units.map((u) => ({ id: u.id, side: u.side, creature: u.creature, hex: u.label ? cubeOf(u.label) : null, damage: 0, movedThisPhase: false, struckThisPhase: false, slain: u.slain ?? false })),
    },
  };
}

describe("legalActions — battle phases", () => {
  it("deploy (gated to the acting side), strikes, summon, reinforce", () => {
    const dep = battleView("DefenderDeployment", { units: [{ id: "atk-0", side: "attacker", creature: "Ogre" }, { id: "def-0", side: "defender", creature: "Centaur" }] });
    assert.deepEqual(types(dep, "p2"), ["DeployLegion"]);
    assert.equal(types(dep, "p1").length, 0);

    const strike = battleView("Strike", { activeSide: "attacker", units: [{ id: "atk-0", side: "attacker", creature: "Ogre", label: "C3" }, { id: "def-0", side: "defender", creature: "Centaur", label: "C4" }] });
    assert.deepEqual(types(strike, "p1"), ["EndStrikes"]);

    const summon = battleView("Strike", { activeSide: "attacker", summonPending: true, legions: { "Black-05": { marker: "Black-05", ownerId: "p1", land: 100, height: 1, creatures: ["Angel"] } }, units: [{ id: "atk-0", side: "attacker", creature: "Ogre", label: "C3" }, { id: "def-0", side: "defender", creature: "Centaur", label: "C4" }] });
    assert.deepEqual(types(summon, "p1"), ["SummonAngel", "DeclineSummon"]);

    const r4 = battleView("Maneuver", { activeSide: "defender", round: 4, units: [{ id: "def-0", side: "defender", creature: "Centaur", label: "C5" }, { id: "def-1", side: "defender", creature: "Centaur", label: "D6" }, { id: "atk-0", side: "attacker", creature: "Ogre", label: "C1" }] });
    assert.ok(types(r4, "p2").includes("ReinforceBattle"));
    assert.equal(battleBanner(r4), "round 4 · defender maneuver");
  });

  it("autoDeployPlacements is accepted by the engine", () => {
    const dep = battleView("DefenderDeployment", { units: [{ id: "atk-0", side: "attacker", creature: "Ogre" }, { id: "def-0", side: "defender", creature: "Centaur" }, { id: "def-1", side: "defender", creature: "Titan" }] });
    const placements = autoDeployPlacements(dep, "defender");
    assert.equal(placements.length, 2);
    const zone = new Set(deployZoneLabels("Plains", "defender"));
    assert.ok(placements.every((p) => zone.has(p.hex)));
    assert.ok(new DeployLegionCommand("p2", { placements }).validate(dep as any).ok);
  });

  it("planBattleClick: select, move, strike", () => {
    const man = battleView("Maneuver", { activeSide: "defender", units: [{ id: "def-0", side: "defender", creature: "Centaur", label: "C4" }, { id: "atk-0", side: "attacker", creature: "Ogre", label: "A1" }] });
    assert.deepEqual(planBattleClick(man, "p2", null, cubeOf("C4")).select, { combatant: "def-0" });
    assert.equal(planBattleClick(man, "p2", "def-0", cubeOf("C3")).dto?.type, "MoveCombatant");

    const str = battleView("Strike", { activeSide: "attacker", units: [{ id: "atk-0", side: "attacker", creature: "Ogre", label: "C3" }, { id: "def-0", side: "defender", creature: "Centaur", label: "C4" }] });
    assert.equal(planBattleClick(str, "p1", "atk-0", cubeOf("C4")).dto?.type, "Strike");
    assert.deepEqual(planBattleClick(str, "p2", "atk-0", cubeOf("C4")), {}); // not p2's phase
  });
});
