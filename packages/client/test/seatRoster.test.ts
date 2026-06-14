import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { SeatRoster } from "../src/game/seatRoster.ts";

describe("SeatRoster (waiting room)", () => {
  it("seats local players into the first empty slots", () => {
    const r = new SeatRoster(3);
    assert.equal(r.addLocal("Ada"), "p1");
    assert.equal(r.addLocal("Bo"), "p2");
    assert.deepEqual(r.localSlots(), ["p1", "p2"]);
    assert.equal(r.filledCount(), 2);
    assert.equal(r.canStart(), false); // p3 still empty
  });

  it("returns null and refuses to overfill", () => {
    const r = new SeatRoster(2);
    r.addLocal("a");
    r.addLocal("b");
    assert.equal(r.addLocal("c"), null);
  });

  it("can start only when full and at least one seat is local", () => {
    const r = new SeatRoster(2);
    r.claim("p1", "local", "Host");
    r.syncRemote([{ slot: "p2", name: "Guest" }]);
    assert.equal(r.canStart(), true);
    assert.deepEqual(r.toSeats().map((s) => s.control), ["local", "remote"]);
  });

  it("a fully-remote room cannot be started from this machine", () => {
    const r = new SeatRoster(2);
    r.syncRemote([{ slot: "p1", name: "A" }, { slot: "p2", name: "B" }]);
    assert.equal(r.canStart(), false);
  });

  it("syncRemote preserves local seats and clears departed remotes", () => {
    const r = new SeatRoster(3);
    r.claim("p1", "local", "Host");
    r.syncRemote([{ slot: "p2", name: "Guest" }, { slot: "p3", name: "Other" }]);
    assert.deepEqual(r.list().map((s) => s.status), ["local", "remote", "remote"]);
    r.syncRemote([{ slot: "p2", name: "Guest" }]); // p3 left
    assert.deepEqual(r.list().map((s) => s.status), ["local", "remote", "empty"]);
  });

  it("release empties a seat", () => {
    const r = new SeatRoster(2);
    r.addLocal("a");
    r.release("p1");
    assert.equal(r.filledCount(), 0);
  });
});
