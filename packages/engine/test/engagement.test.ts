import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createGame, type GameState } from "../src/state/GameState.ts";
import { scriptedRng } from "../src/core/rng/Rng.ts";
import { pendingEngagements } from "../src/state/selectors.ts";
import type { GameCommand } from "../src/core/commands/Command.ts";
import {
  RollTurnOrderCommand,
  SelectColorCommand,
  SelectTowerCommand,
} from "../src/core/commands/setup.ts";
import {
  EndMovementCommand,
  EndSplitsCommand,
  EndTurnCommand,
  RollMovementCommand,
  SplitLegionCommand,
} from "../src/core/commands/turn.ts";
import {
  SelectEngagementCommand,
  ResolveEngagementCommand,
} from "../src/core/commands/engagement.ts";
import { activePlayerId } from "../src/state/selectors.ts";

function exec(state: GameState, c: GameCommand, rng = scriptedRng([])) {
  const v = c.validate(state);
  assert.ok(v.ok, !v.ok ? `${c.type} rejected: ${v.failure.message}` : "");
  return c.execute(state, rng).state;
}

/** Drive a 2-player game to the start of p1's Movement, post-split. */
function toMovement(): GameState {
  let s = createGame({ gameId: "g", players: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }] });
  s = exec(s, new RollTurnOrderCommand("p1", {}), scriptedRng([6, 2]));
  s = exec(s, new SelectTowerCommand("p1", { tower: 100 }));
  s = exec(s, new SelectTowerCommand("p2", { tower: 200 }));
  s = exec(s, new SelectColorCommand("p2", { color: "Red" }));
  s = exec(s, new SelectColorCommand("p1", { color: "Black" }));
  const blk = s.legions["Black-01"]!.creatures;
  const child = ["Titan", ...blk.filter((c) => c !== "Titan" && c !== "Angel").slice(0, 3)] as const;
  s = exec(s, new SplitLegionCommand("p1", {
    legionId: "Black-01",
    newMarker: s.players.p1!.markersAvailable[0]!,
    toNewLegion: [...child],
  }));
  s = exec(s, new EndSplitsCommand("p1", {}));
  s = exec(s, new RollMovementCommand("p1", {}), scriptedRng([3]));
  return s;
}

describe("engagement resolution (the soft-lock fix)", () => {
  it("a contested Land can be selected and resolved, advancing the phase", () => {
    let s = toMovement();
    // Synthetic engagement: p1's Black-01 lands on the Red tower (200).
    s = {
      ...s,
      legions: {
        ...s.legions,
        "Black-01": { ...s.legions["Black-01"]!, land: 200, moved: true },
        "Black-02": { ...s.legions["Black-02"]!, land: 37, moved: true },
      },
    };
    assert.deepEqual(pendingEngagements(s), [200]);

    s = exec(s, new EndMovementCommand("p1", {}));
    assert.equal(s.fsm.path, "Turn.Engagement.Choosing", "engagement must not soft-lock");

    s = exec(s, new SelectEngagementCommand("p1", { land: 200 }));
    assert.equal(s.fsm.path, "Turn.Engagement.Negotiation");

    const before = s.players.p1!.score;
    s = exec(s, new ResolveEngagementCommand("p1", { outcome: "settle", attackerShare: 1 }));
    // p2 lost their only (Titan) legion → eliminated → game over.
    assert.equal(s.fsm.path, "GameOver");
    assert.ok(s.players.p1!.score > before, "winner scores the eliminated legion's value");
    assert.ok(!s.legions["Red-01"], "the defeated legion is removed");
    assert.ok(s.players.p2!.eliminated, "the player who lost their Titan is eliminated");
  });

  it("a non-fatal engagement resolves and play continues to the next turn", () => {
    let s = toMovement();
    // Give p2 a Titan-less defender at 200, keep their Titan safe elsewhere.
    const red = s.legions["Red-01"]!.creatures;
    const defender = red.filter((c) => c !== "Titan").slice(0, 3);
    const keepTitan: typeof red = ["Titan", ...red.filter((c) => c !== "Titan").slice(3)];
    s = {
      ...s,
      legions: {
        ...s.legions,
        "Red-01": { ...s.legions["Red-01"]!, creatures: keepTitan, land: 300 },
        "Red-02": {
          marker: "Red-02", ownerId: "p2", land: 200, creatures: defender,
          moved: false, splitThisTurn: false, recruitedThisTurn: false, revealed: false,
        },
        "Black-01": { ...s.legions["Black-01"]!, land: 200, moved: true },
        "Black-02": { ...s.legions["Black-02"]!, land: 37, moved: true },
      },
    };
    assert.deepEqual(pendingEngagements(s), [200]);

    s = exec(s, new EndMovementCommand("p1", {}));
    s = exec(s, new SelectEngagementCommand("p1", { land: 200 }));
    s = exec(s, new ResolveEngagementCommand("p1", { outcome: "settle", attackerShare: 1 }));

    assert.equal(s.fsm.path, "Turn.Mustering", "play advances to Mustering, not GameOver");
    assert.ok(!s.players.p2!.eliminated, "p2 keeps their Titan and stays in the game");
    assert.ok(!s.legions["Red-02"], "the defeated defender legion is removed");
    assert.ok(s.legions["Red-01"], "the Titan legion survives");

    s = exec(s, new EndTurnCommand("p1", {}));
    assert.equal(activePlayerId(s), "p2", "turn passes to the next player");
  });

  it("a negotiated settlement splits the removed legion's points (no concession)", () => {
    let s = toMovement();
    const red = s.legions["Red-01"]!.creatures;
    const keepTitan: typeof red = ["Titan", ...red.filter((c) => c !== "Titan").slice(0, 3)];
    s = {
      ...s,
      legions: {
        ...s.legions,
        "Red-01": { ...s.legions["Red-01"]!, creatures: keepTitan, land: 300 },
        "Red-02": {
          marker: "Red-02", ownerId: "p2", land: 200, creatures: ["Ogre", "Ogre"],
          moved: false, splitThisTurn: false, recruitedThisTurn: false, revealed: false,
        },
        "Black-01": { ...s.legions["Black-01"]!, land: 200, moved: true },
        "Black-02": { ...s.legions["Black-02"]!, land: 37, moved: true },
      },
    };
    s = exec(s, new EndMovementCommand("p1", {}));
    s = exec(s, new SelectEngagementCommand("p1", { land: 200 }));
    const p1Before = s.players.p1!.score;
    const p2Before = s.players.p2!.score;
    s = exec(s, new ResolveEngagementCommand("p1", { outcome: "settle", attackerShare: 0.5 }));
    // Two Ogres = 12 points, split evenly between attacker and defender.
    assert.equal(s.players.p1!.score - p1Before, 6, "attacker's half");
    assert.equal(s.players.p2!.score - p2Before, 6, "defender's half");
    assert.ok(!s.legions["Red-02"], "the settled legion withdraws");
    assert.ok(s.legions["Red-01"], "the Titan legion is untouched");
    assert.equal(s.fsm.path, "Turn.Mustering");
  });

  it("rejects a removed 'concede' outcome (settlements only)", () => {
    let s = toMovement();
    s = {
      ...s,
      legions: {
        ...s.legions,
        "Red-01": { ...s.legions["Red-01"]!, land: 300 },
        "Red-02": {
          marker: "Red-02", ownerId: "p2", land: 200, creatures: ["Ogre", "Ogre"],
          moved: false, splitThisTurn: false, recruitedThisTurn: false, revealed: false,
        },
        "Black-01": { ...s.legions["Black-01"]!, land: 200, moved: true },
        "Black-02": { ...s.legions["Black-02"]!, land: 37, moved: true },
      },
    };
    s = exec(s, new EndMovementCommand("p1", {}));
    s = exec(s, new SelectEngagementCommand("p1", { land: 200 }));
    const cmd = new ResolveEngagementCommand("p1", { outcome: "concede" as never });
    const v = cmd.validate(s);
    assert.ok(!v.ok && v.failure.code === "ILLEGAL_OUTCOME");
  });

  it("selecting an engagement that is not pending is rejected", () => {
    let s = toMovement();
    s = {
      ...s,
      legions: {
        ...s.legions,
        "Black-01": { ...s.legions["Black-01"]!, land: 200, moved: true },
        "Black-02": { ...s.legions["Black-02"]!, land: 37, moved: true },
      },
    };
    s = exec(s, new EndMovementCommand("p1", {}));
    const bad = new SelectEngagementCommand("p1", { land: 999 });
    const v = bad.validate(s);
    assert.ok(!v.ok && v.failure.code === "NO_SUCH_ENGAGEMENT");
  });
});
