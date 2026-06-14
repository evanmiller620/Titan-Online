import { describe, it } from "node:test";
import assert from "node:assert/strict";

// The engine is imported via a RELATIVE path here (not the "@titan/engine"
// alias) so this test runs under plain Node, the same way the engine's own
// tests do. The app code uses the alias, which the Vite bundler resolves to
// this same source.
import * as E from "../../engine/src/index.ts";
import { actionsFor, isViewersMove, moveDestinations } from "../src/app/actions.ts";

type AnyState = ReturnType<typeof E.createGame>;

function run(state: AnyState, cmd: any, rng = E.scriptedRng([])): AnyState {
  const v = cmd.validate(state);
  assert.ok(v.ok, !v.ok ? `${cmd.type} rejected: ${v.failure.message}` : "");
  return cmd.execute(state, rng).state;
}

function viewActions(state: AnyState, slot: string, sel = { legion: null, land: null }) {
  const view = E.viewFor(state, slot);
  return { view, list: actionsFor(view as any, slot, sel as any), myMove: isViewersMove(view as any, slot) };
}

describe("client action builder (playable command bar)", () => {
  it("offers exactly the legal action at each setup sub-phase", () => {
    let s = E.createGame({ gameId: "g", players: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }] });

    // RollingForOrder: a single roll action, available to the viewer.
    let a = viewActions(s, "p1");
    assert.deepEqual(a.list.map((x) => x.dto.type), ["RollTurnOrder"]);
    assert.ok(a.myMove);

    s = run(s, new E.RollTurnOrderCommand("p1", {}), E.scriptedRng([6, 2]));

    // TowerSelection: p1 picks first (rolled highest); p2 must wait.
    a = viewActions(s, "p1");
    assert.ok(a.list.every((x) => x.dto.type === "SelectTower"));
    assert.ok(a.list.length >= 2);
    assert.equal(viewActions(s, "p2").myMove, false, "non-picker must not act");

    s = run(s, new E.SelectTowerCommand("p1", { tower: 100 }));
    s = run(s, new E.SelectTowerCommand("p2", { tower: 400 }));

    // ColorSelection: p2 picks first (ascending order).
    a = viewActions(s, "p2");
    assert.ok(a.list.every((x) => x.dto.type === "SelectColor"));
    assert.ok(a.myMove);
    // Taken colors are not offered.
    s = run(s, new E.SelectColorCommand("p2", { color: "Red" }));
    const afterRed = viewActions(s, "p1");
    assert.ok(!afterRed.list.some((x) => (x.dto.payload as { color: string }).color === "Red"));
  });

  it("builds a LEGAL initial split DTO the engine accepts", () => {
    let s = setupTo(s0());
    const a = viewActions(s, "p1");
    const split = a.list.find((x) => x.dto.type === "SplitLegion");
    assert.ok(split, "the 4/4 split is offered on turn 1");
    // The offered DTO applies cleanly to the authoritative engine.
    s = run(s, new E.SplitLegionCommand("p1", split!.dto.payload as never));
    const black = Object.keys(s.legions).filter((k) => k.startsWith("Black"));
    assert.equal(black.length, 2, "the split produced a second legion");
  });

  it("gates End-splits until the 8-stack is divided", () => {
    let s = setupTo(s0());
    // Before splitting, End splits is offered but NOT primary (has a hint).
    const before = viewActions(s, "p1").list.find((x) => x.dto.type === "EndSplits");
    assert.ok(before && before.primary === false && typeof before.hint === "string");
    const split = viewActions(s, "p1").list.find((x) => x.dto.type === "SplitLegion")!;
    s = run(s, new E.SplitLegionCommand("p1", split.dto.payload as never));
    const after = viewActions(s, "p1").list.find((x) => x.dto.type === "EndSplits");
    assert.ok(after && after.primary === true, "End splits becomes primary once split");
  });

  it("offers movement actions and a concrete move once legion+destination are chosen", () => {
    let s = setupTo(s0());
    const split = viewActions(s, "p1").list.find((x) => x.dto.type === "SplitLegion")!;
    s = run(s, new E.SplitLegionCommand("p1", split.dto.payload as never));
    s = run(s, new E.EndSplitsCommand("p1", {}));

    // Pre-roll: only the roll action.
    let a = viewActions(s, "p1");
    assert.deepEqual(a.list.map((x) => x.dto.type), ["RollMovement"]);

    s = run(s, new E.RollMovementCommand("p1", {}), E.scriptedRng([3]));

    // Post-roll, no selection: End movement (+ turn-1 mulligan), no Move yet.
    a = viewActions(s, "p1");
    assert.ok(a.list.some((x) => x.dto.type === "EndMovement"));
    assert.ok(!a.list.some((x) => x.dto.type === "MoveLegion"));

    // With a legion + a legal destination selected, a Move action appears and
    // the engine accepts it.
    const view = E.viewFor(s, "p1");
    const leg = Object.values(view.legions).find((l) => l.ownerId === "p1")!;
    const dests = moveDestinations(view as any, leg.marker);
    assert.ok(dests.length > 0, "a rolled legion has destinations");
    const withSel = actionsFor(view as any, "p1", { legion: leg.marker, land: dests[0]! } as any);
    const move = withSel.find((x) => x.dto.type === "MoveLegion");
    assert.ok(move, "a concrete Move action is offered");
    const ns = run(s, new E.MoveLegionCommand("p1", move!.dto.payload as never));
    assert.equal(ns.legions[leg.marker]!.land, dests[0], "the engine moved the legion");
  });

  it("surfaces engagement resolution actions when legions meet", () => {
    let s = setupTo(s0());
    const split = viewActions(s, "p1").list.find((x) => x.dto.type === "SplitLegion")!;
    s = run(s, new E.SplitLegionCommand("p1", split.dto.payload as never));
    s = run(s, new E.EndSplitsCommand("p1", {}));
    s = run(s, new E.RollMovementCommand("p1", {}), E.scriptedRng([3]));
    // Force an engagement on Red's tower (p2 chose 400 in setupTo).
    s = {
      ...s,
      legions: {
        ...s.legions,
        "Black-01": { ...s.legions["Black-01"]!, land: 400, moved: true },
        "Black-02": { ...s.legions["Black-02"]!, land: 37, moved: true },
      },
    } as AnyState;
    s = run(s, new E.EndMovementCommand("p1", {}));
    assert.equal(s.fsm.path, "Turn.Engagement.Choosing");

    const choosing = viewActions(s, "p1").list;
    const select = choosing.find((x) => x.dto.type === "SelectEngagement");
    assert.ok(select, "the contested land is offered for resolution");
    assert.equal((select!.dto.payload as { land: number }).land, 400);
    s = run(s, new E.SelectEngagementCommand("p1", select!.dto.payload as never));

    const negotiating = viewActions(s, "p1").list;
    assert.ok(negotiating.some((x) => x.dto.type === "ResolveEngagement"), "resolution offered");
  });
});

// --- fixtures --------------------------------------------------------------

function s0() {
  return E.createGame({ gameId: "g", players: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }] });
}

/** Run setup so p1 is at Commencement (turn 1). */
function setupTo(s: AnyState): AnyState {
  s = run(s, new E.RollTurnOrderCommand("p1", {}), E.scriptedRng([6, 2]));
  s = run(s, new E.SelectTowerCommand("p1", { tower: 100 }));
  s = run(s, new E.SelectTowerCommand("p2", { tower: 400 }));
  s = run(s, new E.SelectColorCommand("p2", { color: "Red" }));
  s = run(s, new E.SelectColorCommand("p1", { color: "Black" }));
  return s;
}
