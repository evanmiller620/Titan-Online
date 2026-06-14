import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { LocalTransport } from "../src/game/transport.ts";
import { GameSession, makeSeats } from "../src/game/session.ts";

/** Drive setup to Turn.Commencement following the engine's own pick order
 *  (the local transport rolls real dice, so the order is not fixed). */
async function driveSetup(t: LocalTransport): Promise<void> {
  await t.submit({ type: "RollTurnOrder", playerId: "p1", payload: {} });
  const towers = [100, 400];
  for (let i = 0; i < 2; i++) {
    const s = t.viewFor(null)!.setup!;
    await t.submit({ type: "SelectTower", playerId: s.order[s.towerPickIndex]!, payload: { tower: towers[i] } });
  }
  const colors = ["Red", "Black"];
  for (let i = 0; i < 2; i++) {
    const s = t.viewFor(null)!.setup!;
    await t.submit({ type: "SelectColor", playerId: s.order[s.colorPickIndex]!, payload: { color: colors[i] } });
  }
}

describe("LocalTransport (engine in the browser)", () => {
  it("starts a fresh game and advances on an accepted command", async () => {
    const t = LocalTransport.newGame(2);
    assert.equal(t.viewFor("p1").fsm.path, "Setup.RollingForOrder");

    let changed = 0;
    t.onChange(() => changed++);
    const r = await t.submit({ type: "RollTurnOrder", playerId: "p1", payload: {} });
    assert.ok(r.ok, "roll accepted");
    assert.equal(t.viewFor("p1").fsm.path, "Setup.TowerSelection");
    assert.equal(changed, 1, "listeners notified once");
  });

  it("rejects an illegal command without mutating state", async () => {
    const t = LocalTransport.newGame(2);
    const before = t.viewFor("p1").fsm.path;
    const r = await t.submit({ type: "EndSplits", playerId: "p1", payload: {} });
    assert.ok(!r.ok && r.code === "WRONG_PHASE");
    assert.equal(t.viewFor("p1").fsm.path, before);
  });

  it("redacts per seat: each player sees only their own legion contents", async () => {
    const t = LocalTransport.newGame(2);
    await driveSetup(t);

    const p1view = t.viewFor("p1");
    const mine = Object.values(p1view.legions).find((l) => l.ownerId === "p1")!;
    const theirs = Object.values(p1view.legions).find((l) => l.ownerId === "p2")!;
    assert.ok(mine.creatures, "p1 sees own contents");
    assert.equal(theirs.creatures, undefined, "p1 cannot see p2's contents");
  });
});

describe("GameSession + seats", () => {
  it("exposes legal actions for the focused seat and submits through the transport", async () => {
    const t = LocalTransport.newGame(2);
    const session = new GameSession(t, makeSeats(2, ["p1", "p2"]));
    assert.equal(session.focusedSeat, "p1");

    const acts = session.actions();
    assert.deepEqual(acts.map((a) => a.dto.type), ["RollTurnOrder"]);
    const r = await session.submit(acts[0]!.dto);
    assert.ok(r.ok);
    assert.equal(session.view()!.fsm.path, "Setup.TowerSelection");
  });

  it("only local seats can take focus; remote seats are observed", () => {
    const t = LocalTransport.newGame(2);
    const session = new GameSession(t, makeSeats(2, ["p1"])); // p2 is remote
    assert.deepEqual(session.seats.map((s) => s.control), ["local", "remote"]);
    session.setFocus("p2"); // ignored — not local
    assert.equal(session.focusedSeat, "p1");
  });

  it("focusActiveSeat follows whichever local seat must move (hot-seat)", async () => {
    const t = LocalTransport.newGame(2);
    const session = new GameSession(t, makeSeats(2, ["p1", "p2"]));
    // Drive to ColorSelection following the engine's own pick order.
    await session.submit({ type: "RollTurnOrder", playerId: "p1", payload: {} });
    const towers = [100, 400];
    for (let i = 0; i < 2; i++) {
      const s = t.viewFor(null)!.setup!;
      await session.submit({ type: "SelectTower", playerId: s.order[s.towerPickIndex]!, payload: { tower: towers[i] } });
    }
    const picker = t.viewFor(null)!.setup!.order[t.viewFor(null)!.setup!.colorPickIndex]!;
    session.focusActiveSeat();
    assert.equal(session.focusedSeat, picker, "focus follows the colour picker");
  });
});
