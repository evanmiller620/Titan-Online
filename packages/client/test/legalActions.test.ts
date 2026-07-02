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
  seatLegions, reachableLands, autoAction,
  NO_SELECTION, type Selection,
} from "@titan/engine";

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

  it("selecting a legion then a legal destination issues MoveLegion", () => {
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

  it("seatLegions lists a seat's legions with terrain, height, and contents", () => {
    const s = afterSetup();
    const info = seatLegions(viewFor(s, "p1"), "p1");
    assert.equal(info.length, 1);
    assert.equal(info[0]!.height, 8);
    assert.ok(info[0]!.creatures?.includes("Titan"));
    assert.equal(typeof info[0]!.terrain, "string");
  });

  it("seatLegions surfaces recruit options during Mustering (so muster is findable)", () => {
    // Build a Mustering view with a moved Centaur legion on the Plains (can breed a Lion).
    const v: any = {
      gameId: "g", fsm: { path: "Turn.Mustering", returnStack: [] }, playerOrder: ["p1", "p2"],
      players: { p1: { id: "p1", color: "Black", tower: 100, score: 0, eliminated: false, markersAvailable: [] }, p2: {} },
      setup: null, turn: { number: 2, activeIndex: 0, movementRoll: 3, mulliganUsed: false },
      caretaker: Object.fromEntries(["Lion", "Centaur"].map((c) => [c, 9])),
      legions: { "Black-01": { marker: "Black-01", ownerId: "p1", land: 1, height: 2, moved: true, splitThisTurn: false, recruitedThisTurn: false, revealed: false, creatures: ["Centaur", "Centaur"] } },
      battle: null, revealedMarkers: [],
    };
    const info = seatLegions(v, "p1")[0]!;
    assert.ok(info.recruits.includes("Lion"), "a moved Centaur legion on Plains can recruit a Lion");
  });

  it("reachableLands reports a movable legion's destinations during Movement", () => {
    let s = afterSetup();
    s = new SplitLegionCommand("p1", proposeInitialSplit(viewFor(s, "p1"), "p1") as any).execute(s, scriptedRng([])).state;
    s = new EndSplitsCommand("p1", {}).execute(s, scriptedRng([])).state;
    s = new RollMovementCommand("p1", {}).execute(s, scriptedRng([3])).state;
    const v = viewFor(s, "p1");
    const leg = Object.values(v.legions).find((l) => l.ownerId === "p1")!;
    assert.ok(reachableLands(v, "p1", leg.marker).length > 0);
    assert.deepEqual(reachableLands(v, "p1", "nope"), []);
  });

  it("negotiation offers fight and point-split settlements (no concession)", () => {
    const v: any = {
      gameId: "g", fsm: { path: "Turn.Engagement.Negotiation", returnStack: [] }, playerOrder: ["p1", "p2"],
      players: {}, setup: null, turn: { number: 2, activeIndex: 0, movementRoll: null, mulliganUsed: false },
      caretaker: {}, legions: {}, battle: null, revealedMarkers: [],
    };
    const acts = legalActions(v, "p1", NO_SELECTION);
    assert.deepEqual(acts.map((a) => a.dto.payload), [
      { outcome: "fight" }, { outcome: "settle", attackerShare: 0.5 }, { outcome: "settle", attackerShare: 1 },
    ]);
    assert.ok(!acts.some((a) => JSON.stringify(a.dto.payload).includes("concede")));
  });
});

describe("planMasterboardClick — enemy legions stop movement (and start battles)", () => {
  // Real setup state, then legions hand-placed on the track: p1 at land 1,
  // rolled 2, so the only graph destination is land 3 (1→2→3).
  function movementState(legions: Record<string, { owner: string; land: number; creatures: string[] }>) {
    const s = afterSetup();
    const fsm = transition(GAME_MACHINE, (s as any).fsm, "SPLITS_COMPLETED");
    const mk = ([marker, l]: [string, { owner: string; land: number; creatures: string[] }]) =>
      [marker, { marker, ownerId: l.owner, land: l.land, creatures: l.creatures, moved: false, splitThisTurn: false, recruitedThisTurn: false, revealed: false }] as const;
    return {
      ...s, fsm,
      turn: { ...s.turn, number: 2, movementRoll: 2 },
      legions: Object.fromEntries(Object.entries(legions).map(mk)),
    } as any;
  }
  const base = {
    "Bk01": { owner: "p1", land: 1, creatures: ["Titan", "Ogre"] },
    "Rd09": { owner: "p2", land: 400, creatures: ["Titan", "Angel"] },
  };

  it("clicking an enemy-occupied destination IS a move (the attack that forces an engagement)", () => {
    const s = movementState({ ...base, "Rd01": { owner: "p2", land: 3, creatures: ["Centaur"] } });
    const v = viewFor(s, "p1");
    assert.deepEqual(reachableLands(v, "p1", "Bk01"), [3], "the enemy land itself is reachable");
    const plan = planMasterboardClick(v, "p1", sel({ legion: "Bk01" }), 3);
    assert.equal(plan.dto?.type, "MoveLegion");
    assert.equal((plan.dto?.payload as any).destination, 3);
  });

  it("never issues a move THROUGH an enemy legion (movement stops at the enemy)", () => {
    const s = movementState({ ...base, "Rd01": { owner: "p2", land: 2, creatures: ["Centaur"] } });
    const v = viewFor(s, "p1");
    assert.deepEqual(reachableLands(v, "p1", "Bk01"), [], "no destination beyond the blocker");
    const plan = planMasterboardClick(v, "p1", sel({ legion: "Bk01" }), 3);
    assert.equal(plan.dto, undefined, "click must not submit a doomed MoveLegion");
  });

  it("never issues a move onto your OWN legion", () => {
    const s = movementState({ ...base, "Bk02": { owner: "p1", land: 3, creatures: ["Gargoyle", "Gargoyle"] } });
    const v = viewFor(s, "p1");
    const plan = planMasterboardClick(v, "p1", sel({ legion: "Bk01" }), 3);
    assert.equal(plan.dto, undefined);
    // Clicking your own legion's land selects that legion instead.
    assert.equal(plan.select?.legion, "Bk02");
  });

  it("the click-plan agrees with the engine: every clickable move validates", () => {
    const s = movementState({ ...base, "Rd01": { owner: "p2", land: 3, creatures: ["Centaur"] } });
    const v = viewFor(s, "p1");
    const dests = reachableLands(v, "p1", "Bk01");
    assert.ok(dests.length > 0);
    for (const land of dests) {
      const plan = planMasterboardClick(v, "p1", sel({ legion: "Bk01" }), land);
      assert.equal(plan.dto?.type, "MoveLegion");
    }
  });

  it("during Engagement.Choosing, clicking the contested land opens that clash", () => {
    const s = movementState({ ...base, "Rd01": { owner: "p2", land: 1, creatures: ["Centaur"] } });
    // Advance the FSM into the Engagement phase (both legions now share land 1).
    const fsm = transition(GAME_MACHINE, (s as any).fsm, "MOVEMENT_COMPLETED");
    const v = viewFor({ ...s, fsm } as any, "p1");
    assert.equal(v.fsm.path, "Turn.Engagement.Choosing");
    const plan = planMasterboardClick(v, "p1", NO_SELECTION, 1);
    assert.equal(plan.dto?.type, "SelectEngagement");
    assert.deepEqual(plan.dto?.payload, { land: 1 });
    // An uncontested land is NOT an engagement.
    assert.equal(planMasterboardClick(v, "p1", NO_SELECTION, 400).dto, undefined);
  });
});

describe("autoAction — fastplay forced-single-option", () => {
  it("auto-rolls turn order at game start (the only option)", () => {
    const s0 = createGame({ gameId: "g", players: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }] });
    assert.equal(autoAction(viewFor(s0, "p1"), "p1", NO_SELECTION)?.type, "RollTurnOrder");
  });

  it("auto-rolls movement before a roll, but never auto-ends a phase with moves left", () => {
    let s = afterSetup();
    s = new SplitLegionCommand("p1", proposeInitialSplit(viewFor(s, "p1"), "p1") as any).execute(s, scriptedRng([])).state;
    s = new EndSplitsCommand("p1", {}).execute(s, scriptedRng([])).state;
    // Pre-roll: RollMovement is forced → auto.
    assert.equal(autoAction(viewFor(s, "p1"), "p1", NO_SELECTION)?.type, "RollMovement");
    // After rolling, legions can still move → do NOT auto-end movement.
    s = new RollMovementCommand("p1", {}).execute(s, scriptedRng([3])).state;
    assert.equal(autoAction(viewFor(s, "p1"), "p1", NO_SELECTION), null);
  });

  it("does not auto-end Mustering when a legion can still recruit", () => {
    const v: any = {
      gameId: "g", fsm: { path: "Turn.Mustering", returnStack: [] }, playerOrder: ["p1", "p2"],
      players: { p1: { id: "p1", color: "Black", tower: 100, score: 0, eliminated: false, markersAvailable: [] }, p2: {} },
      setup: null, turn: { number: 2, activeIndex: 0, movementRoll: 3, mulliganUsed: false },
      caretaker: Object.fromEntries(["Lion", "Centaur"].map((c) => [c, 9])),
      legions: { "Black-01": { marker: "Black-01", ownerId: "p1", land: 1, height: 2, moved: true, splitThisTurn: false, recruitedThisTurn: false, revealed: false, creatures: ["Centaur", "Centaur"] } },
      battle: null, revealedMarkers: [],
    };
    assert.equal(autoAction(v, "p1", NO_SELECTION), null);
  });

  it("never auto-plays inside a battle (battles are all choices)", () => {
    const dep = battleView("Strike", { activeSide: "attacker", units: [{ id: "atk-0", side: "attacker", creature: "Ogre", label: "C3" }, { id: "def-0", side: "defender", creature: "Centaur", label: "C4" }] });
    assert.equal(autoAction(dep, "p1", NO_SELECTION), null);
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
    assert.deepEqual(planBattleClick(man, "p2", NO_SELECTION, cubeOf("C4")).select, { combatant: "def-0" });
    assert.equal(planBattleClick(man, "p2", sel({ combatant: "def-0" }), cubeOf("C3")).dto?.type, "MoveCombatant");

    const str = battleView("Strike", { activeSide: "attacker", units: [{ id: "atk-0", side: "attacker", creature: "Ogre", label: "C3" }, { id: "def-0", side: "defender", creature: "Centaur", label: "C4" }] });
    assert.equal(planBattleClick(str, "p1", sel({ combatant: "atk-0" }), cubeOf("C4")).dto?.type, "Strike");
    assert.deepEqual(planBattleClick(str, "p2", sel({ combatant: "atk-0" }), cubeOf("C4")), {}); // not p2's phase
  });

  it("manual deployment: clicks place each character; once all placed, Deploy submits them", () => {
    const dep = battleView("DefenderDeployment", { units: [
      { id: "atk-0", side: "attacker", creature: "Ogre" },
      { id: "def-0", side: "defender", creature: "Centaur" },
      { id: "def-1", side: "defender", creature: "Titan" },
    ] });
    // First click places def-0 on a legal zone hex (C5 is a defender entry hex).
    const p1 = planBattleClick(dep, "p2", NO_SELECTION, cubeOf("C5"));
    assert.deepEqual(p1.select?.deploy, [{ combatantId: "def-0", hex: "C5" }]);
    // Second click (with that placement carried in selection) places def-1.
    const after1 = sel({ deploy: p1.select!.deploy });
    const p2 = planBattleClick(dep, "p2", after1, cubeOf("D6"));
    assert.equal(p2.select?.deploy?.length, 2);
    // Re-clicking an occupied placement is a no-op.
    assert.deepEqual(planBattleClick(dep, "p2", sel({ deploy: p2.select!.deploy }), cubeOf("C5")), {});
    // With all placed, the action bar offers a Deploy carrying those placements.
    const acts = legalActions(dep, "p2", sel({ deploy: p2.select!.deploy }));
    const deploy = acts.find((a) => a.dto.type === "DeployLegion")!;
    assert.deepEqual((deploy.dto.payload as any).placements, p2.select!.deploy);
    assert.ok(new DeployLegionCommand("p2", deploy.dto.payload as any).validate(dep as any).ok);
  });
});
