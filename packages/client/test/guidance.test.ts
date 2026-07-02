import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { currentGuidance, phaseLabel } from "../src/ui/guidance.ts";
import type { GameStateView, Selection } from "@titan/engine";

const NO_SEL: Selection = { legion: null, land: null, combatant: null, deploy: [], hex: null };
const withLegion: Selection = { ...NO_SEL, legion: "Black-01" };
const has = (s: string, sub: string) => assert.ok(s.includes(sub), `expected "${s}" to contain "${sub}"`);

function mkView(path: string, extra: Record<string, unknown> = {}): GameStateView {
  return {
    fsm: { path },
    playerOrder: ["p1", "p2"],
    players: { p1: { color: "Black" }, p2: { color: "Red" } },
    turn: { activeIndex: 0, movementRoll: null },
    legions: {},
    battle: null,
    ...extra,
  } as unknown as GameStateView;
}

describe("guidance — what to do now", () => {
  it("handles no state and game over", () => {
    assert.equal(currentGuidance(null, "p1", NO_SEL, false).title, "Loading…");
    const over = currentGuidance(mkView("GameOver", { players: { p1: { color: "Black" }, p2: { color: "Red", eliminated: true } } }), "p1", NO_SEL, false);
    has(over.title, "Black wins");
    assert.equal(over.tone, "info");
  });

  it("tells you to wait when it is not your move", () => {
    const g = currentGuidance(mkView("Turn.Movement", { turn: { activeIndex: 1, movementRoll: null } }), "p1", NO_SEL, false);
    has(g.title, "Waiting for Red");
    assert.equal(g.tone, "wait");
  });

  it("guides setup", () => {
    has(currentGuidance(mkView("Setup.RollingForOrder"), "p1", NO_SEL, true).title, "Roll for turn order");
    has(currentGuidance(mkView("Setup.TowerSelection"), "p1", NO_SEL, true).title, "starting Tower");
    has(currentGuidance(mkView("Setup.ColorSelection"), "p1", NO_SEL, true).title, "colour");
  });

  it("guides the split phase, with and without a selected legion", () => {
    has(currentGuidance(mkView("Turn.Commencement"), "p1", NO_SEL, true).title, "Split a legion");
    has(currentGuidance(mkView("Turn.Commencement"), "p1", withLegion, true).title, "Split this legion");
  });

  it("guides movement: roll, then select, then move", () => {
    has(currentGuidance(mkView("Turn.Movement"), "p1", NO_SEL, true).title, "Roll the movement die");
    const rolled = currentGuidance(mkView("Turn.Movement", { turn: { activeIndex: 0, movementRoll: 4 } }), "p1", NO_SEL, true);
    has(rolled.title, "rolled 4");
    const moving = currentGuidance(mkView("Turn.Movement", { turn: { activeIndex: 0, movementRoll: 4 } }), "p1", withLegion, true);
    has(moving.detail ?? "", "glowing land");
  });

  it("guides engagement and mustering", () => {
    has(currentGuidance(mkView("Turn.Engagement.Choosing"), "p1", NO_SEL, true).title, "Resolve the clash");
    has(currentGuidance(mkView("Turn.Mustering"), "p1", NO_SEL, true).title, "Recruit");
  });

  it("guides every battle phase", () => {
    const battle = (path: string, b: Record<string, unknown> = {}) =>
      currentGuidance(mkView(path, { battle: { summonPending: false, ...b } }), "p1", NO_SEL, true);
    has(battle("Turn.Engagement.Battle.DefenderDeployment").title, "Deploy");
    has(battle("Turn.Engagement.Battle.Round.Maneuver").title, "Maneuver");
    has(battle("Turn.Engagement.Battle.Round.Strike").title, "Strike!");
    has(battle("Turn.Engagement.Battle.Round.Strikeback").title, "Strike back");
    has(battle("Turn.Engagement.Battle.Round.Strike", { summonPending: true }).title, "First blood");
  });

  it("phaseLabel is a short summary", () => {
    assert.equal(phaseLabel(mkView("Turn.Movement")), "Move");
    assert.equal(phaseLabel(mkView("Turn.Engagement.Battle.Round.Strike", { battle: { summonPending: false } })), "Battle · strike");
  });

  it("an actionable phase reads as 'act'", () => {
    assert.equal(currentGuidance(mkView("Turn.Movement"), "p1", NO_SEL, true).tone, "act");
  });
});
