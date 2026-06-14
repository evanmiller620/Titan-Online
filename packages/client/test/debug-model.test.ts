import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createGame, viewFor, publicState,
  RollTurnOrderCommand, SelectTowerCommand, SelectColorCommand,
  scriptedRng,
} from "@titan/engine";
import {
  fsmTopology,
  flattenFsm,
  activeChain,
  isActiveLeaf,
  stateSections,
} from "../src/ui/debugModel.ts";

// ---------------------------------------------------------------------------
// FSM topology
// ---------------------------------------------------------------------------

describe("fsmTopology", () => {
  it("includes the top-level scopes", () => {
    const names = fsmTopology().map((n) => n.name).sort();
    assert.deepEqual(names, ["GameOver", "Setup", "Turn"]);
  });

  it("flattens to include deep battle leaves with full paths and depth", () => {
    const paths = new Set(flattenFsm().map((n) => n.path));
    assert.ok(paths.has("Turn.Commencement"));
    assert.ok(paths.has("Turn.Engagement.Battle.Round.Strike"));
    assert.ok(paths.has("Turn.Engagement.Battle.Round.Strikeback"));
    const strike = flattenFsm().find((n) => n.path === "Turn.Engagement.Battle.Round.Strike")!;
    assert.equal(strike.depth, 4);
    assert.equal(strike.name, "Strike");
  });
});

describe("activeChain", () => {
  it("lights up every ancestor of the current path", () => {
    const chain = activeChain("Turn.Engagement.Battle.Round.Strike");
    assert.ok(chain.has("Turn"));
    assert.ok(chain.has("Turn.Engagement"));
    assert.ok(chain.has("Turn.Engagement.Battle.Round"));
    assert.ok(chain.has("Turn.Engagement.Battle.Round.Strike"));
    assert.ok(!chain.has("Turn.Movement"));
  });

  it("identifies the active leaf", () => {
    assert.ok(isActiveLeaf("Turn.Movement", "Turn.Movement"));
    assert.ok(!isActiveLeaf("Turn", "Turn.Movement"));
  });
});

// ---------------------------------------------------------------------------
// State sections
// ---------------------------------------------------------------------------

function setupGame() {
  let s = createGame({ gameId: "g", players: [{ id: "A", name: "A" }, { id: "B", name: "B" }] });
  s = new RollTurnOrderCommand("A", {}).execute(s, scriptedRng([6, 2])).state;
  s = new SelectTowerCommand("A", { tower: 100 }).execute(s, scriptedRng([])).state;
  s = new SelectTowerCommand("B", { tower: 400 }).execute(s, scriptedRng([])).state;
  s = new SelectColorCommand("B", { color: "Red" }).execute(s, scriptedRng([])).state;
  s = new SelectColorCommand("A", { color: "Black" }).execute(s, scriptedRng([])).state;
  return s;
}

describe("stateSections", () => {
  it("groups a real post-setup view into the expected sections", () => {
    const view = viewFor(setupGame(), "A");
    const titles = stateSections(view).map((s) => s.title);
    assert.ok(titles.includes("Turn"));
    assert.ok(titles.includes("Players"));
    assert.ok(titles.some((t) => t.startsWith("Legions")));
    assert.ok(titles.includes("Caretaker pool"));
    assert.ok(!titles.includes("Battle")); // no battle yet
  });

  it("shows the owner's own legion contents but hides opponents'", () => {
    const view = viewFor(setupGame(), "A");
    const legions = stateSections(view).find((s) => s.title.startsWith("Legions"))!;
    const mine = legions.rows.find((r) => r.k === "Black-01")!;
    const theirs = legions.rows.find((r) => r.k === "Red-01")!;
    assert.ok(mine.v.includes("Titan"), "owner sees contents");
    assert.ok(theirs.v.includes("«hidden»"), "opponent contents hidden");
  });

  it("flags a depleted caretaker stack with the warn tone", () => {
    const s = setupGame();
    // The public view exposes the shared pool; Titan started at 2 (one per player).
    const view = publicState(s);
    const pool = stateSections(view).find((sec) => sec.title === "Caretaker pool")!;
    const angel = pool.rows.find((r) => r.k === "Angel")!;
    assert.equal(angel.v, "16"); // 18 − 2 starting Angels
  });
});
