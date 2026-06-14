import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { GAME_MACHINE } from "@titan/engine";
import { transition } from "@titan/engine";
import { BATTLE_MAPS } from "@titan/engine";
import { DeployLegionCommand } from "@titan/engine";
import { initialStore, reduce, type StoreState } from "../src/store/gameStore.ts";
import {
  availableActions,
  autoDeployPlacements,
  deployZoneLabels,
  planBattleClick,
  battleBanner,
} from "../src/app/battleUi.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const plains = BATTLE_MAPS.Plains as any;
const cubeOf = (label: string) => plains.hexes.find((h: any) => h.label === label).cube;

function fsmPath(phase: string): any {
  const seq = [
    "TURN_ORDER_DETERMINED", "TOWERS_SELECTED", "COLORS_SELECTED",
    "SPLITS_COMPLETED", "MOVEMENT_COMPLETED", "ENGAGEMENT_SELECTED", "BATTLE_JOINED",
  ];
  if (phase !== "DefenderDeployment") seq.push("DEFENDER_DEPLOYED");
  if (phase !== "DefenderDeployment" && phase !== "AttackerDeployment") seq.push("ATTACKER_DEPLOYED");
  if (phase === "Strike" || phase === "Strikeback") seq.push("MANEUVERS_COMPLETED");
  if (phase === "Strikeback") seq.push("STRIKES_COMPLETED");
  let fsm = (GAME_MACHINE as any).initialState;
  for (const e of seq) fsm = transition(GAME_MACHINE as any, fsm, e);
  return fsm;
}

interface Unit { id: string; side: "attacker" | "defender"; creature: string; label?: string; slain?: boolean }
function battleView(phase: string, opts: {
  activeSide?: "attacker" | "defender"; round?: number; units: Unit[];
  summonPending?: boolean; reinforcementUsed?: boolean; legions?: any;
}): any {
  return {
    gameId: "g", fsm: fsmPath(phase), playerOrder: ["A", "B"],
    players: {
      A: { id: "A", name: "A", color: "Black", tower: 100, score: 0, eliminated: false, markersAvailable: [] },
      B: { id: "B", name: "B", color: "Red", tower: 400, score: 0, eliminated: false, markersAvailable: [] },
    },
    setup: null,
    turn: { number: 2, activeIndex: 0, movementRoll: 3, mulliganUsed: false, engagementLand: 1 },
    caretaker: Object.fromEntries(["Lion", "Centaur", "Ranger"].map((c) => [c, 9])),
    legions: opts.legions ?? {},
    revealedMarkers: [],
    battle: {
      land: 1, terrain: "Plains",
      attackerLegion: "Black-01", defenderLegion: "Red-01",
      attackerPlayerId: "A", defenderPlayerId: "B",
      attackerSide: "BOTTOM", round: opts.round ?? 1, activeSide: opts.activeSide ?? "defender",
      summonUsed: false, firstKillHappened: false, reinforcementUsed: opts.reinforcementUsed ?? false,
      summonPending: opts.summonPending ?? false,
      combatants: opts.units.map((u) => ({
        id: u.id, side: u.side, creature: u.creature,
        hex: u.label ? cubeOf(u.label) : null,
        damage: 0, movedThisPhase: false, struckThisPhase: false, slain: u.slain ?? false,
      })),
    },
  };
}

function store(view: any, viewer: string | null): StoreState {
  let s: StoreState = reduce(initialStore, { type: "setViewer", slot: viewer });
  return reduce(s, { type: "snapshot", version: 0, view });
}

// ---------------------------------------------------------------------------
// availableActions across the flow
// ---------------------------------------------------------------------------

describe("availableActions — turn-level phases", () => {
  function turnView(path: string, extra: Partial<any> = {}): any {
    return {
      gameId: "g", fsm: { path, returnStack: [] }, playerOrder: ["A", "B"],
      players: {}, setup: null,
      turn: { number: 2, activeIndex: 0, movementRoll: extra.movementRoll ?? null, mulliganUsed: false },
      caretaker: {}, legions: extra.legions ?? {}, battle: null, revealedMarkers: [],
    };
  }

  it("offers Roll then End movement", () => {
    assert.deepEqual(availableActions(store(turnView("Turn.Movement"), "A")).map((a) => a.type), ["RollMovement"]);
    assert.deepEqual(
      availableActions(store(turnView("Turn.Movement", { movementRoll: 3 }), "A")).map((a) => a.type),
      ["EndMovement"],
    );
  });

  it("offers fight / flee / concede during negotiation", () => {
    const acts = availableActions(store(turnView("Turn.Engagement.Negotiation"), "A"));
    assert.deepEqual(acts.map((a) => a.payload?.outcome), ["fight", "flee", "concede"]);
  });

  it("lists each pending clash to resolve during Choosing", () => {
    const legions = {
      "Black-01": { marker: "Black-01", ownerId: "A", land: 5, height: 2 },
      "Red-01": { marker: "Red-01", ownerId: "B", land: 5, height: 1 },
    };
    const acts = availableActions(store(turnView("Turn.Engagement.Choosing", { legions }), "A"));
    assert.deepEqual(acts.map((a) => a.payload?.land), [5]);
  });

  it("shows nothing when it is not your turn", () => {
    assert.equal(availableActions(store(turnView("Turn.Movement"), "B")).length, 0);
  });
});

describe("availableActions — battle phases", () => {
  it("defender then attacker get a Deploy action gated to the right player", () => {
    const v = battleView("DefenderDeployment", { units: [
      { id: "atk-0", side: "attacker", creature: "Ogre" },
      { id: "def-0", side: "defender", creature: "Centaur" },
    ] });
    assert.deepEqual(availableActions(store(v, "B")).map((a) => a.type), ["DeployLegion"]);
    assert.equal(availableActions(store(v, "A")).length, 0); // attacker waits
  });

  it("the acting side ends its strike phase", () => {
    const v = battleView("Strike", { activeSide: "attacker", units: [
      { id: "atk-0", side: "attacker", creature: "Ogre", label: "C3" },
      { id: "def-0", side: "defender", creature: "Centaur", label: "C4" },
    ] });
    assert.deepEqual(availableActions(store(v, "A")).map((a) => a.type), ["EndStrikes"]);
  });

  it("a pending summon offers source legions + decline (attacker only)", () => {
    const legions = { "Black-05": { marker: "Black-05", ownerId: "A", land: 100, height: 1, creatures: ["Angel"] } };
    const v = battleView("Strike", { activeSide: "attacker", summonPending: true, legions, units: [
      { id: "atk-0", side: "attacker", creature: "Ogre", label: "C3" },
      { id: "def-0", side: "defender", creature: "Centaur", label: "C4" },
    ] });
    const acts = availableActions(store(v, "A"));
    assert.deepEqual(acts.map((a) => a.type), ["SummonAngel", "DeclineSummon"]);
    assert.equal(acts[0].payload?.fromLegion, "Black-05");
  });

  it("offers a round-4 reinforcement to the defender", () => {
    const v = battleView("Maneuver", { activeSide: "defender", round: 4, units: [
      { id: "def-0", side: "defender", creature: "Centaur", label: "C5" },
      { id: "def-1", side: "defender", creature: "Centaur", label: "D6" },
      { id: "atk-0", side: "attacker", creature: "Ogre", label: "C1" },
    ] });
    const types = availableActions(store(v, "B")).map((a) => a.type);
    assert.ok(types.includes("ReinforceBattle"));
    assert.ok(types.includes("EndManeuvers"));
  });

  it("produces a readable banner", () => {
    const v = battleView("Strike", { activeSide: "attacker", round: 3, units: [
      { id: "atk-0", side: "attacker", creature: "Ogre", label: "C3" },
    ] });
    assert.equal(battleBanner(store(v, "A")), "Round 3 · attacker strike · your move");
  });
});

// ---------------------------------------------------------------------------
// Auto-deploy: placements the engine actually accepts
// ---------------------------------------------------------------------------

describe("autoDeployPlacements", () => {
  it("places every defender on a distinct legal hex the engine accepts", () => {
    const v = battleView("DefenderDeployment", { units: [
      { id: "atk-0", side: "attacker", creature: "Ogre" },
      { id: "def-0", side: "defender", creature: "Centaur" },
      { id: "def-1", side: "defender", creature: "Centaur" },
      { id: "def-2", side: "defender", creature: "Titan" },
    ] });
    const placements = autoDeployPlacements(v, "defender");
    assert.equal(placements.length, 3);
    const hexes = placements.map((p) => p.hex);
    assert.equal(new Set(hexes).size, 3, "distinct hexes");
    const zone = new Set(deployZoneLabels("Plains", "defender"));
    assert.ok(hexes.every((h) => zone.has(h)));
    // The engine's own validator must accept them.
    const v2 = new DeployLegionCommand("B", { placements }).validate(v as any);
    assert.ok(v2.ok, !v2.ok ? v2.failure.message : "");
  });
});

// ---------------------------------------------------------------------------
// planBattleClick: select / move / strike
// ---------------------------------------------------------------------------

describe("planBattleClick", () => {
  it("selecting one of your own active-side characters", () => {
    const v = battleView("Maneuver", { activeSide: "defender", units: [
      { id: "def-0", side: "defender", creature: "Centaur", label: "C4" },
      { id: "atk-0", side: "attacker", creature: "Ogre", label: "C3" },
    ] });
    const plan = planBattleClick(v, "B", null, cubeOf("C4"));
    assert.equal(plan.select, "def-0");
  });

  it("moving a selected character to a reachable empty hex", () => {
    const v = battleView("Maneuver", { activeSide: "defender", units: [
      { id: "def-0", side: "defender", creature: "Centaur", label: "C4" },
    ] });
    const plan = planBattleClick(v, "B", "def-0", cubeOf("C3"));
    assert.equal(plan.command?.type, "MoveCombatant");
    assert.equal((plan.command?.payload as any).hex, "C3");
  });

  it("striking an adjacent enemy in the strike phase", () => {
    const v = battleView("Strike", { activeSide: "attacker", units: [
      { id: "atk-0", side: "attacker", creature: "Ogre", label: "C3" },
      { id: "def-0", side: "defender", creature: "Centaur", label: "C4" },
    ] });
    const plan = planBattleClick(v, "A", "atk-0", cubeOf("C4"));
    assert.equal(plan.command?.type, "Strike");
    assert.deepEqual(plan.command?.payload, { strikerId: "atk-0", targetId: "def-0" });
  });

  it("ignores clicks from the player who is not acting", () => {
    const v = battleView("Strike", { activeSide: "attacker", units: [
      { id: "atk-0", side: "attacker", creature: "Ogre", label: "C3" },
      { id: "def-0", side: "defender", creature: "Centaur", label: "C4" },
    ] });
    assert.deepEqual(planBattleClick(v, "B", "atk-0", cubeOf("C4")), {});
  });
});
