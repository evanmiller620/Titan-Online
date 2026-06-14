import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  E, newGame, runSetup, playTurn, initialSplit, ok, rejects,
  active, legionsOf, type State,
} from "./_harness.ts";

// ---------------------------------------------------------------------------
// Full games, start to finish
// ---------------------------------------------------------------------------

describe("e2e: a complete two-player game runs to a clean state", () => {
  it("plays setup + several full turns with zero rejected commands", () => {
    let s = runSetup(newGame(2), [6, 2]);
    assert.equal(s.fsm.path, "Turn.Commencement");
    assert.equal(s.turn.number, 1);

    // Turn 1: both players split their 8-stack and play a full turn.
    s = playTurn(s, { split: true, roll: 3, muster: true });
    assert.equal(active(s), "p2", "play passes to p2 after p1's turn");
    s = playTurn(s, { split: true, roll: 4, muster: true });
    assert.equal(s.turn.number, 2, "wrapping to p1 increments the turn number");

    // A few more turns to exercise the steady-state loop.
    for (let i = 0; i < 4; i++) s = playTurn(s, { roll: ((i % 6) + 1), muster: true });
    assert.ok(s.turn.number >= 3);
    assert.ok(["Turn.Commencement", "GameOver"].includes(s.fsm.path));
  });
});

describe("e2e: games at every supported player count (2–6)", () => {
  for (const n of [2, 3, 4, 5, 6]) {
    it(`sets up and plays a full round with ${n} players`, () => {
      const rolls = [6, 5, 4, 3, 2, 1].slice(0, n);
      let s = runSetup(newGame(n), rolls);
      assert.equal(s.playerOrder.length, n);
      assert.equal(s.fsm.path, "Turn.Commencement");

      // Each player has a tower, a colour, and a starting legion.
      for (const pid of s.playerOrder) {
        assert.ok(s.players[pid]!.tower !== null, `${pid} has a tower`);
        assert.ok(s.players[pid]!.color !== null, `${pid} has a colour`);
        assert.equal(legionsOf(s, pid).length, 1, `${pid} starts with one legion`);
      }

      // Play one full round (every player takes turn 1).
      const seen = new Set<string>();
      for (let i = 0; i < n; i++) {
        seen.add(active(s));
        s = playTurn(s, { split: true, roll: 2 });
      }
      assert.equal(seen.size, n, "every player took a turn in the first round");
      assert.equal(s.turn.number, 2, "the round wrapped exactly once");
    });
  }
});

// ---------------------------------------------------------------------------
// Turn rotation & ordering
// ---------------------------------------------------------------------------

describe("e2e: turn order follows the roll, descending", () => {
  it("a 4-player game rotates in roll order and wraps correctly", () => {
    // Rolls p1..p4 = 3,6,4,5 → order should be p2(6), p4(5), p3(4), p1(3).
    let s = runSetup(newGame(4), [3, 6, 4, 5]);
    assert.deepEqual(s.playerOrder, ["p2", "p4", "p3", "p1"]);
    assert.equal(active(s), "p2");

    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      order.push(active(s));
      s = playTurn(s, { split: true, roll: 2 });
    }
    assert.deepEqual(order, ["p2", "p4", "p3", "p1"]);
    assert.equal(active(s), "p2", "wraps back to the first player");
  });
});

// ---------------------------------------------------------------------------
// Mustering inside a real turn
// ---------------------------------------------------------------------------

describe("e2e: recruiting during a real turn", () => {
  it("a legion that moved into recruiting terrain can muster, growing its height", () => {
    let s = runSetup(newGame(2), [6, 2]);
    s = initialSplit(s);
    s = ok(s, new E.EndSplitsCommand("p1", {}));
    s = ok(s, new E.RollMovementCommand("p1", {}), E.scriptedRng([3]));

    // Move both legions apart; record heights before muster.
    const used = new Set<number>();
    for (const [marker, leg] of legionsOf(s, "p1")) {
      const dests = E.destinationsForRoll(leg.land, 3).map((d) => d.destination).filter((d) => !used.has(d));
      s = ok(s, new E.MoveLegionCommand("p1", { legionId: marker, destination: dests[0]! }));
      used.add(dests[0]!);
    }
    s = ok(s, new E.EndMovementCommand("p1", {}));
    assert.equal(s.fsm.path, "Turn.Mustering");

    // Find a legion with an eligible recruit and muster it.
    let mustered = false;
    for (const [marker, leg] of legionsOf(s, "p1")) {
      const land = E.getLand(leg.land)!;
      const opts = E.eligibleRecruits(land.terrain, leg.creatures, s.caretaker, {
        containsOwnTitan: leg.creatures.includes("Titan"),
      });
      if (opts.length > 0 && leg.creatures.length < 7) {
        const before = leg.creatures.length;
        const caretakerBefore = s.caretaker[opts[0]!.creature]!;
        s = ok(s, new E.MusterCommand("p1", { legionId: marker, creature: opts[0]!.creature }));
        assert.equal(s.legions[marker]!.creatures.length, before + 1, "legion grew by one");
        assert.equal(s.caretaker[opts[0]!.creature], caretakerBefore - 1, "caretaker pool decremented");
        mustered = true;
        break;
      }
    }
    assert.ok(mustered, "at least one legion could recruit after moving into terrain");
  });

  it("a legion may recruit only once per turn", () => {
    let s = runSetup(newGame(2), [6, 2]);
    s = initialSplit(s);
    s = ok(s, new E.EndSplitsCommand("p1", {}));
    s = ok(s, new E.RollMovementCommand("p1", {}), E.scriptedRng([3]));
    const used = new Set<number>();
    let recruitMarker: string | null = null;
    for (const [marker, leg] of legionsOf(s, "p1")) {
      const dests = E.destinationsForRoll(leg.land, 3).map((d) => d.destination).filter((d) => !used.has(d));
      s = ok(s, new E.MoveLegionCommand("p1", { legionId: marker, destination: dests[0]! }));
      used.add(dests[0]!);
    }
    s = ok(s, new E.EndMovementCommand("p1", {}));
    for (const [marker, leg] of legionsOf(s, "p1")) {
      const land = E.getLand(leg.land)!;
      const opts = E.eligibleRecruits(land.terrain, leg.creatures, s.caretaker, { containsOwnTitan: leg.creatures.includes("Titan") });
      if (opts.length > 0 && leg.creatures.length < 7) { recruitMarker = marker; break; }
    }
    if (recruitMarker) {
      const land = E.getLand(s.legions[recruitMarker]!.land)!;
      const opt = E.eligibleRecruits(land.terrain, s.legions[recruitMarker]!.creatures, s.caretaker, {
        containsOwnTitan: s.legions[recruitMarker]!.creatures.includes("Titan"),
      })[0]!;
      s = ok(s, new E.MusterCommand("p1", { legionId: recruitMarker, creature: opt.creature }));
      rejects(s, new E.MusterCommand("p1", { legionId: recruitMarker, creature: opt.creature }), "ALREADY_RECRUITED");
    }
  });
});

// ---------------------------------------------------------------------------
// Engagements: multiple in one turn, scoring, and the game ending
// ---------------------------------------------------------------------------

describe("e2e: engagements resolved within a turn", () => {
  /** Build a state where p1 attacks two different p2 legions in one turn. */
  function twoEngagements(): State {
    let s = runSetup(newGame(2), [6, 2]);
    s = initialSplit(s);
    s = ok(s, new E.EndSplitsCommand("p1", {}));
    s = ok(s, new E.RollMovementCommand("p1", {}), E.scriptedRng([3]));
    // Synthesise: p2 has two non-Titan legions on lands 30 and 40; p1's two
    // legions land on them. p2's Titan sits safely elsewhere. Read p2's actual
    // marker/colour from state rather than assuming a colour.
    const p1legs = legionsOf(s, "p1").map(([m]) => m);
    const p2id = s.playerOrder.find((p) => p !== "p1")!;
    const [p2marker, p2leg] = legionsOf(s, p2id)[0]!;
    const prefix = p2marker.split("-")[0]!; // e.g. "Black"
    const red = p2leg.creatures;
    const safeTitan = ["Titan", ...red.filter((c) => c !== "Titan").slice(0, 3)];
    const d1 = red.filter((c) => c !== "Titan").slice(3, 5);
    const d2 = red.filter((c) => c !== "Titan").slice(5);
    s = {
      ...s,
      legions: {
        ...s.legions,
        [p2marker]: { ...p2leg, creatures: safeTitan as never, land: 500 },
        [`${prefix}-02`]: { marker: `${prefix}-02`, ownerId: p2id, land: 30, creatures: d1 as never, moved: false, splitThisTurn: false, recruitedThisTurn: false, revealed: false },
        [`${prefix}-03`]: { marker: `${prefix}-03`, ownerId: p2id, land: 40, creatures: d2 as never, moved: false, splitThisTurn: false, recruitedThisTurn: false, revealed: false },
        [p1legs[0]!]: { ...s.legions[p1legs[0]!]!, land: 30, moved: true },
        [p1legs[1]!]: { ...s.legions[p1legs[1]!]!, land: 40, moved: true },
      },
    } as State;
    (s as { _p2prefix?: string })._p2prefix = prefix;
    return s;
  }

  it("two engagements resolve in sequence and play reaches Mustering", () => {
    let s = twoEngagements();
    const prefix = (s as { _p2prefix?: string })._p2prefix!;
    const p2id = s.playerOrder.find((p) => p !== "p1")!;
    assert.deepEqual(E.pendingEngagements(s).sort((a, b) => a - b), [30, 40]);
    s = ok(s, new E.EndMovementCommand("p1", {}));
    assert.equal(s.fsm.path, "Turn.Engagement.Choosing");

    const scoreBefore = s.players.p1!.score;
    // Resolve both.
    s = ok(s, new E.SelectEngagementCommand("p1", { land: 30 }));
    s = ok(s, new E.ResolveEngagementCommand("p1", { outcome: "settle", attackerShare: 1 }));
    assert.equal(s.fsm.path, "Turn.Engagement.Choosing", "more engagements remain");
    s = ok(s, new E.SelectEngagementCommand("p1", { land: 40 }));
    s = ok(s, new E.ResolveEngagementCommand("p1", { outcome: "settle", attackerShare: 1 }));

    assert.equal(s.fsm.path, "Turn.Mustering", "all engagements resolved → Mustering");
    assert.ok(s.players.p1!.score > scoreBefore, "attacker scored from both wins");
    assert.ok(!s.legions[`${prefix}-02`] && !s.legions[`${prefix}-03`], "both defenders removed");
    assert.ok(s.legions[`${prefix}-01`], "p2's Titan legion survived");
    assert.ok(!s.players[p2id]!.eliminated, "p2 stays in the game");
  });
});

describe("e2e: losing the Titan ends the game", () => {
  it("eliminating a 2-player opponent's Titan legion declares the winner", () => {
    let s = runSetup(newGame(2), [6, 2]);
    s = initialSplit(s);
    s = ok(s, new E.EndSplitsCommand("p1", {}));
    s = ok(s, new E.RollMovementCommand("p1", {}), E.scriptedRng([3]));
    // p1 lands on p2's only (Titan) legion at its actual tower. Read p2's
    // marker and land from state rather than assuming a colour/tower.
    const p2id = s.playerOrder.find((p) => p !== "p1")!;
    const [p2marker, p2leg] = legionsOf(s, p2id)[0]!;
    const targetLand = p2leg.land;
    const [m0, m1] = legionsOf(s, "p1").map(([m]) => m);
    const elsewhere = targetLand === 37 ? 38 : 37;
    s = {
      ...s,
      legions: {
        ...s.legions,
        [m0!]: { ...s.legions[m0!]!, land: targetLand, moved: true },
        [m1!]: { ...s.legions[m1!]!, land: elsewhere, moved: true },
      },
    } as State;
    assert.deepEqual(E.pendingEngagements(s), [targetLand]);
    s = ok(s, new E.EndMovementCommand("p1", {}));
    s = ok(s, new E.SelectEngagementCommand("p1", { land: targetLand }));
    s = ok(s, new E.ResolveEngagementCommand("p1", { outcome: "settle", attackerShare: 1 }));

    assert.equal(s.fsm.path, "GameOver");
    assert.ok(s.players[p2id]!.eliminated);
    assert.ok(!s.players.p1!.eliminated);
    void p2marker;
  });
});

// ---------------------------------------------------------------------------
// The turn-1 mulligan in a real flow
// ---------------------------------------------------------------------------

describe("e2e: the turn-1 mulligan", () => {
  it("re-rolls movement once and then cannot be used again", () => {
    let s = runSetup(newGame(2), [6, 2]);
    s = initialSplit(s);
    s = ok(s, new E.EndSplitsCommand("p1", {}));
    s = ok(s, new E.RollMovementCommand("p1", {}), E.scriptedRng([2]));
    assert.equal(s.turn.movementRoll, 2);
    s = ok(s, new E.TakeMulliganCommand("p1", {}), E.scriptedRng([5]));
    assert.equal(s.turn.movementRoll, 5, "mulligan re-rolled the die");
    assert.ok(s.turn.mulliganUsed);
    rejects(s, new E.TakeMulliganCommand("p1", {}), "MULLIGAN_UNAVAILABLE");
  });

  it("is unavailable after turn 1", () => {
    let s = runSetup(newGame(2), [6, 2]);
    s = playTurn(s, { split: true, roll: 3 });   // p1 turn 1
    s = playTurn(s, { split: true, roll: 3 });   // p2 turn 1 → turn 2, p1
    assert.equal(s.turn.number, 2);
    s = ok(s, new E.EndSplitsCommand("p1", {}));
    s = ok(s, new E.RollMovementCommand("p1", {}), E.scriptedRng([3]));
    rejects(s, new E.TakeMulliganCommand("p1", {}), "MULLIGAN_UNAVAILABLE");
  });
});

// ---------------------------------------------------------------------------
// Hidden-information integrity across a whole game
// ---------------------------------------------------------------------------

describe("e2e: redaction holds across a full game", () => {
  it("opponents never see contents but always see heights, every turn", () => {
    let s = runSetup(newGame(2), [6, 2]);
    for (let t = 0; t < 4; t++) {
      // Check redaction from BOTH viewpoints at the top of each turn.
      for (const viewer of ["p1", "p2"]) {
        const view = E.viewFor(s, viewer);
        for (const [marker, leg] of Object.entries(s.legions)) {
          const seen = view.legions[marker]!;
          assert.equal(seen.height, leg.creatures.length, `${marker} height is public`);
          if (leg.ownerId === viewer || leg.revealed) {
            assert.ok(seen.creatures, `${viewer} sees own/revealed ${marker} contents`);
          } else {
            assert.equal(seen.creatures, undefined, `${viewer} must NOT see ${marker} contents`);
          }
        }
      }
      s = playTurn(s, { split: s.turn.number === 1, roll: (t % 6) + 1, muster: true });
      if (s.fsm.path === "GameOver") break;
    }
  });
});

// ---------------------------------------------------------------------------
// Negative paths: out-of-turn and out-of-phase commands are refused
// ---------------------------------------------------------------------------

describe("e2e: illegal commands are refused, not silently applied", () => {
  it("a non-active player cannot act; commands are phase-gated", () => {
    let s = runSetup(newGame(2), [6, 2]);
    // p2 is not active during p1's Commencement.
    rejects(s, new E.EndSplitsCommand("p2", {}), "NOT_ACTIVE_PLAYER");
    // Cannot roll movement during Commencement.
    rejects(s, new E.RollMovementCommand("p1", {}), "WRONG_PHASE");
    // Cannot end the turn before reaching Mustering.
    rejects(s, new E.EndTurnCommand("p1", {}), "WRONG_PHASE");

    s = initialSplit(s);
    s = ok(s, new E.EndSplitsCommand("p1", {}));
    // Cannot end movement before rolling.
    rejects(s, new E.EndMovementCommand("p1", {}), "MOVEMENT_NOT_ROLLED");
  });
});
