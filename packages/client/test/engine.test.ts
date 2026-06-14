import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { GameEngine, deriveSeed } from "../src/game/engine.ts";
import type { CommandDTO } from "@titan/engine";

const json = (o: unknown) => JSON.parse(JSON.stringify(o));

/** Drive setup on an engine, following its own (dice-determined) pick order. */
function driveSetup(e: GameEngine): void {
  e.apply({ type: "RollTurnOrder", playerId: "p1", payload: {} });
  const towers = [100, 400];
  for (let i = 0; i < 2; i++) {
    const s = e.state.setup!;
    e.apply({ type: "SelectTower", playerId: s.order[s.towerPickIndex]!, payload: { tower: towers[i] } });
  }
  const colors = ["Red", "Black"];
  for (let i = 0; i < 2; i++) {
    const s = e.state.setup!;
    e.apply({ type: "SelectColor", playerId: s.order[s.colorPickIndex]!, payload: { color: colors[i] } });
  }
}

describe("GameEngine — client authority", () => {
  it("validates locally and rejects illegal commands", () => {
    const e = GameEngine.fresh(2, 1);
    const bad = e.apply({ type: "EndSplits", playerId: "p1", payload: {} });
    assert.ok(!bad.ok && bad.code === "WRONG_PHASE");
    const ok = e.apply({ type: "RollTurnOrder", playerId: "p1", payload: {} });
    assert.ok(ok.ok);
  });

  it("is DETERMINISTIC: replaying the same seed + log reproduces exact state", () => {
    const e1 = GameEngine.fresh(2, 0xc0ffee);
    driveSetup(e1);
    const e2 = GameEngine.restore(e1.snapshot()); // same seed + log
    assert.deepEqual(json(e2.state), json(e1.state));
  });

  it("two engines with the same seed + commands stay byte-identical (peer sync)", () => {
    const log: CommandDTO[] = [{ type: "RollTurnOrder", playerId: "p1", payload: {} }];
    const a = GameEngine.fresh(3, 42);
    const b = GameEngine.fresh(3, 42);
    for (const dto of log) { a.apply(dto); b.apply(dto); }
    assert.deepEqual(json(a.state), json(b.state));
    // The roll-off used dice; identical seed ⇒ identical order.
    assert.deepEqual(a.state.setup!.order, b.state.setup!.order);
  });

  it("undo replays the log without the last command", () => {
    const e = GameEngine.fresh(2, 7);
    e.apply({ type: "RollTurnOrder", playerId: "p1", payload: {} });
    const afterRoll = json(e.state);
    const order = e.state.setup!.order;
    e.apply({ type: "SelectTower", playerId: order[0]!, payload: { tower: 100 } });
    assert.notDeepEqual(json(e.state), afterRoll);
    assert.ok(e.undo());
    assert.deepEqual(json(e.state), afterRoll, "undo restored the prior state");
    assert.equal(e.sequence, 1);
  });

  it("forceRolls overrides the dice for the next command (testing aid)", () => {
    const e = GameEngine.fresh(2, 999);
    e.forceRolls([6, 2]); // p1 rolls 6, p2 rolls 2 → p1 first regardless of seed
    e.apply({ type: "RollTurnOrder", playerId: "p1", payload: {} });
    assert.deepEqual(e.state.setup!.order, ["p1", "p2"]);
  });

  it("reveal-all view exposes every legion's contents", () => {
    const e = GameEngine.fresh(2, 5);
    driveSetup(e);
    const all = e.view(null, true);
    assert.ok(Object.values(all.legions).every((l) => Array.isArray(l.creatures)));
  });

  it("serialize → deserialize round-trips to identical state (save/load)", () => {
    const e = GameEngine.fresh(2, 0xabc);
    driveSetup(e);
    const restored = GameEngine.deserialize(e.serialize());
    assert.deepEqual(json(restored.state), json(e.state));
    assert.equal(restored.sequence, e.sequence);
    // and it keeps playing from there identically
    const a = e.apply({ type: "EndSplits", playerId: e.state.playerOrder[0]!, payload: {} });
    const b = restored.apply({ type: "EndSplits", playerId: restored.state.playerOrder[0]!, payload: {} });
    assert.equal(a.ok, b.ok);
    assert.deepEqual(json(restored.state), json(e.state));
  });

  it("deriveSeed is stable per (seed,seq) and varies across seq", () => {
    assert.equal(deriveSeed(10, 3), deriveSeed(10, 3));
    assert.notEqual(deriveSeed(10, 3), deriveSeed(10, 4));
  });
});
