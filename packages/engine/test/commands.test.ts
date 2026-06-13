import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { seededRng, scriptedRng, type Rng } from "../src/core/rng/Rng.ts";
import {
  createGame,
  GameCreationError,
  markerIdsFor,
  type GameState,
} from "../src/state/GameState.ts";
import {
  activePlayerId,
  legionsOf,
  pendingEngagements,
  isSubMultiset,
  subtractMultiset,
} from "../src/state/selectors.ts";
import {
  CommandValidationError,
  ValidationCode,
  type GameCommand,
} from "../src/core/commands/Command.ts";
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
  TakeMulliganCommand,
} from "../src/core/commands/turn.ts";
import {
  COMMAND_TYPES,
  deserializeCommand,
  MalformedCommandError,
  UnknownCommandError,
} from "../src/core/commands/registry.ts";
import { visibleTo, type DomainEvent } from "../src/core/events/DomainEvent.ts";
import { CARETAKER_LIMITS } from "../src/creatures/names.ts";
import { MoveLegionCommand } from "../src/core/commands/movement.ts";
import { destinationsForRoll } from "../src/masterboard/movement.ts";

/** Move every legion the active player owns to a distinct legal destination,
 *  satisfying the "must move if able" rule. Assumes movement already rolled. */
function moveAllActiveLegions(state: GameState): GameState {
  let s = state;
  const roll = s.turn.movementRoll!;
  const activeId = s.playerOrder[s.turn.activeIndex]!;
  const used = new Set<number>();
  for (const legion of Object.values(s.legions)) {
    if (legion.ownerId !== activeId || legion.moved) continue;
    const dest = destinationsForRoll(legion.land, roll)
      .map((r) => r.destination)
      .find((d) => !used.has(d));
    if (dest === undefined) continue;
    used.add(dest);
    s = exec(s, new MoveLegionCommand(activeId, { legionId: legion.marker, destination: dest })).state;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const THREE_PLAYERS = [
  { id: "p1", name: "Ann" },
  { id: "p2", name: "Bob" },
  { id: "p3", name: "Cal" },
];

/** Execute a command, asserting validity, returning the new state. */
function exec(
  state: GameState,
  command: GameCommand,
  rng: Rng = scriptedRng([]),
): { state: GameState; events: readonly DomainEvent[] } {
  const v = command.validate(state);
  assert.ok(v.ok, !v.ok ? `${command.type} rejected: ${v.failure.message}` : "");
  return command.execute(state, rng);
}

/** Assert a command is rejected with the given code. */
function rejects(state: GameState, command: GameCommand, code: string): void {
  const v = command.validate(state);
  assert.ok(!v.ok, `${command.type} should have been rejected (${code})`);
  if (!v.ok) assert.equal(v.failure.code, code);
}

/** Drive a fresh 3-player game to the start of p1's turn 1 Commencement.
 *  Order roll scripted 6,4,2 → p1, p2, p3 (no ties). */
function gameAtFirstCommencement(): GameState {
  let s = createGame({ gameId: "g1", players: THREE_PLAYERS });
  s = exec(s, new RollTurnOrderCommand("p1", {}), scriptedRng([6, 4, 2])).state;
  s = exec(s, new SelectTowerCommand("p1", { tower: 100 })).state;
  s = exec(s, new SelectTowerCommand("p2", { tower: 300 })).state;
  s = exec(s, new SelectTowerCommand("p3", { tower: 500 })).state;
  // Ascending order picks colors: p3, p2, p1.
  s = exec(s, new SelectColorCommand("p3", { color: "Red" })).state;
  s = exec(s, new SelectColorCommand("p2", { color: "Blue" })).state;
  s = exec(s, new SelectColorCommand("p1", { color: "Black" })).state;
  return s;
}

/** A legal 4/4 initial split for the given player color. */
function initialSplit(player: string, color: string): SplitLegionCommand {
  return new SplitLegionCommand(player, {
    legionId: `${color}-01`,
    newMarker: `${color}-02`,
    toNewLegion: ["Angel", "Gargoyle", "Centaur", "Ogre"],
  });
}

// ---------------------------------------------------------------------------
// Rng
// ---------------------------------------------------------------------------

describe("rng", () => {
  it("seededRng is deterministic and in-range", () => {
    const a = seededRng(42);
    const b = seededRng(42);
    const seqA = a.roll(200);
    const seqB = b.roll(200);
    assert.deepEqual(seqA, seqB);
    for (const v of seqA) assert.ok(v >= 1 && v <= 6);
    // Different seed, different sequence (overwhelmingly likely; fixed seeds).
    assert.notDeepEqual(seededRng(43).roll(200), seqA);
  });

  it("scriptedRng returns exactly the queue and fails loudly past the end", () => {
    const r = scriptedRng([3, 6]);
    assert.equal(r.d6(), 3);
    assert.equal(r.d6(), 6);
    assert.throws(() => r.d6());
    assert.throws(() => scriptedRng([7]).d6());
  });
});

// ---------------------------------------------------------------------------
// Game creation & multiset selectors
// ---------------------------------------------------------------------------

describe("createGame", () => {
  it("starts in Setup.RollingForOrder with a full caretaker pool", () => {
    const s = createGame({ gameId: "g", players: THREE_PLAYERS });
    assert.equal(s.fsm.path, "Setup.RollingForOrder");
    assert.equal(s.caretaker.Titan, 3); // one per actual player
    assert.equal(s.caretaker.Angel, CARETAKER_LIMITS.Angel);
    assert.equal(s.caretaker.Troll, 28);
    assert.equal(Object.keys(s.legions).length, 0);
    assert.equal(activePlayerId(s), null); // no order yet
  });

  it("rejects bad player counts and duplicate ids", () => {
    assert.throws(
      () => createGame({ gameId: "g", players: [{ id: "p1", name: "solo" }] }),
      GameCreationError,
    );
    assert.throws(
      () =>
        createGame({
          gameId: "g",
          players: [
            { id: "x", name: "a" },
            { id: "x", name: "b" },
          ],
        }),
      GameCreationError,
    );
  });
});

describe("multiset helpers", () => {
  it("respects multiplicity (two Ogres are not one Ogre)", () => {
    assert.ok(isSubMultiset(["Ogre", "Ogre"], ["Ogre", "Ogre", "Titan"]));
    assert.ok(!isSubMultiset(["Ogre", "Ogre"], ["Ogre", "Titan"]));
    assert.deepEqual(
      subtractMultiset(["Ogre", "Ogre", "Titan"], ["Ogre"]),
      ["Ogre", "Titan"],
    );
  });
});

// ---------------------------------------------------------------------------
// Setup commands
// ---------------------------------------------------------------------------

describe("setup: turn order roll", () => {
  it("orders by descending roll and re-rolls ties among the tied only", () => {
    const s0 = createGame({ gameId: "g", players: THREE_PLAYERS });
    // p1=4, p2=4, p3=2 → p1/p2 re-roll: p1=1, p2=5 → order p2, p1, p3.
    const { state, events } = exec(
      s0,
      new RollTurnOrderCommand("p1", {}),
      scriptedRng([4, 4, 2, 1, 5]),
    );
    assert.deepEqual(state.playerOrder, ["p2", "p1", "p3"]);
    assert.equal(state.fsm.path, "Setup.TowerSelection");
    const rolled = events.find((e) => e.type === "TurnOrderRolled");
    assert.ok(rolled && rolled.type === "TurnOrderRolled");
    assert.equal(rolled.rounds.length, 2); // main round + one tie-break round
    assert.deepEqual(rolled.rounds[1], { p1: 1, p2: 5 });
  });

  it("cannot be rolled twice", () => {
    let s = createGame({ gameId: "g", players: THREE_PLAYERS });
    s = exec(s, new RollTurnOrderCommand("p1", {}), scriptedRng([6, 4, 2])).state;
    rejects(s, new RollTurnOrderCommand("p1", {}), ValidationCode.WRONG_PHASE);
  });
});

describe("setup: tower and color selection", () => {
  function afterOrder(): GameState {
    const s = createGame({ gameId: "g", players: THREE_PLAYERS });
    return exec(s, new RollTurnOrderCommand("p1", {}), scriptedRng([6, 4, 2])).state;
  }

  it("towers are picked in descending roll order", () => {
    const s = afterOrder(); // order p1, p2, p3
    rejects(s, new SelectTowerCommand("p2", { tower: 100 }), ValidationCode.NOT_YOUR_TURN_TO_PICK);
    const s1 = exec(s, new SelectTowerCommand("p1", { tower: 100 })).state;
    rejects(s1, new SelectTowerCommand("p3", { tower: 200 }), ValidationCode.NOT_YOUR_TURN_TO_PICK);
  });

  it("rejects non-towers and already-claimed towers", () => {
    const s = afterOrder();
    rejects(s, new SelectTowerCommand("p1", { tower: 42 }), ValidationCode.BAD_PAYLOAD);
    const s1 = exec(s, new SelectTowerCommand("p1", { tower: 100 })).state;
    rejects(s1, new SelectTowerCommand("p2", { tower: 100 }), ValidationCode.TOWER_UNAVAILABLE);
  });

  it("colors are picked in ASCENDING order, and each pick musters the starting eight", () => {
    let s = afterOrder();
    s = exec(s, new SelectTowerCommand("p1", { tower: 100 })).state;
    s = exec(s, new SelectTowerCommand("p2", { tower: 300 })).state;
    s = exec(s, new SelectTowerCommand("p3", { tower: 500 })).state;
    assert.equal(s.fsm.path, "Setup.ColorSelection");
    // p1 rolled highest → picks color LAST.
    rejects(s, new SelectColorCommand("p1", { color: "Black" }), ValidationCode.NOT_YOUR_TURN_TO_PICK);
    const r3 = exec(s, new SelectColorCommand("p3", { color: "Red" }));
    s = r3.state;
    // The initial legion exists at p3's tower with the fixed eight:
    const legions = legionsOf(s, "p3");
    assert.equal(legions.length, 1);
    assert.equal(legions[0]!.marker, "Red-01");
    assert.equal(legions[0]!.land, 500);
    assert.equal(legions[0]!.creatures.length, 8);
    assert.ok(legions[0]!.creatures.includes("Titan"));
    // Marker 01 consumed; 11 remain.
    assert.equal(s.players["p3"]!.markersAvailable.length, 11);
    // Caretaker pool decremented (one Titan, one Angel, 2 each of the rest).
    assert.equal(s.caretaker.Titan, 2);
    assert.equal(s.caretaker.Angel, CARETAKER_LIMITS.Angel - 1);
    assert.equal(s.caretaker.Gargoyle, CARETAKER_LIMITS.Gargoyle - 2);

    rejects(s, new SelectColorCommand("p1", { color: "Blue" }), ValidationCode.NOT_YOUR_TURN_TO_PICK);
    s = exec(s, new SelectColorCommand("p2", { color: "Blue" })).state;
    rejects(s, new SelectColorCommand("p1", { color: "Blue" }), ValidationCode.COLOR_UNAVAILABLE);
    s = exec(s, new SelectColorCommand("p1", { color: "Black" })).state;
    // Setup done: turn 1, highest roller active, in Commencement.
    assert.equal(s.fsm.path, "Turn.Commencement");
    assert.equal(s.setup, null);
    assert.equal(s.turn.number, 1);
    assert.equal(activePlayerId(s), "p1");
  });

  it("markerIdsFor formats twelve zero-padded markers", () => {
    const ids = markerIdsFor("Gold");
    assert.equal(ids.length, 12);
    assert.equal(ids[0], "Gold-01");
    assert.equal(ids[11], "Gold-12");
  });
});

// ---------------------------------------------------------------------------
// Commencement: splits
// ---------------------------------------------------------------------------

describe("commencement: the initial split", () => {
  it("must be exactly 4/4 with the Titan and Angel separated", () => {
    const s = gameAtFirstCommencement();
    // 3/5 split rejected:
    rejects(
      s,
      new SplitLegionCommand("p1", {
        legionId: "Black-01",
        newMarker: "Black-02",
        toNewLegion: ["Angel", "Gargoyle", "Centaur"],
      }),
      ValidationCode.ILLEGAL_SPLIT,
    );
    // Lords together rejected:
    rejects(
      s,
      new SplitLegionCommand("p1", {
        legionId: "Black-01",
        newMarker: "Black-02",
        toNewLegion: ["Titan", "Angel", "Gargoyle", "Centaur"],
      }),
      ValidationCode.ILLEGAL_SPLIT,
    );
    // Legal 4/4:
    const { state, events } = exec(s, initialSplit("p1", "Black"));
    const mine = legionsOf(state, "p1");
    assert.equal(mine.length, 2);
    for (const l of mine) assert.equal(l.creatures.length, 4);
    // Public event has heights only; owner event has the creature lists.
    const pub = events.find((e) => e.type === "LegionSplit");
    const detail = events.find((e) => e.type === "LegionSplitDetail");
    assert.ok(pub && pub.type === "LegionSplit");
    assert.equal(pub.childHeight, 4);
    assert.ok(!("childCreatures" in pub));
    assert.ok(detail && detail.audience.kind === "player");
  });

  it("requires owning the legion, the marker, and the creatures", () => {
    const s = gameAtFirstCommencement();
    rejects(
      s,
      new SplitLegionCommand("p1", {
        legionId: "Red-01", // p3's legion
        newMarker: "Black-02",
        toNewLegion: ["Angel", "Gargoyle", "Centaur", "Ogre"],
      }),
      ValidationCode.NOT_LEGION_OWNER,
    );
    rejects(
      s,
      new SplitLegionCommand("p1", {
        legionId: "Black-01",
        newMarker: "Red-05", // not p1's marker
        toNewLegion: ["Angel", "Gargoyle", "Centaur", "Ogre"],
      }),
      ValidationCode.MARKER_UNAVAILABLE,
    );
    rejects(
      s,
      new SplitLegionCommand("p1", {
        legionId: "Black-01",
        newMarker: "Black-02",
        toNewLegion: ["Angel", "Ogre", "Ogre", "Ogre"], // only two Ogres exist
      }),
      ValidationCode.ILLEGAL_SPLIT,
    );
  });

  it("EndSplits is blocked until the eight-stack is split, then advances", () => {
    const s = gameAtFirstCommencement();
    rejects(s, new EndSplitsCommand("p1", {}), ValidationCode.SPLIT_REQUIRED);
    const split = exec(s, initialSplit("p1", "Black")).state;
    const after = exec(split, new EndSplitsCommand("p1", {})).state;
    assert.equal(after.fsm.path, "Turn.Movement");
  });

  it("a legion may split only once per turn", () => {
    const s = exec(gameAtFirstCommencement(), initialSplit("p1", "Black")).state;
    rejects(
      s,
      new SplitLegionCommand("p1", {
        legionId: "Black-02",
        newMarker: "Black-03",
        toNewLegion: ["Angel", "Gargoyle"],
      }),
      ValidationCode.ILLEGAL_SPLIT,
    );
  });

  it("only the active player splits, and only during Commencement", () => {
    const s = gameAtFirstCommencement();
    rejects(s, initialSplit("p2", "Blue"), ValidationCode.NOT_ACTIVE_PLAYER);
    const moved = exec(
      exec(s, initialSplit("p1", "Black")).state,
      new EndSplitsCommand("p1", {}),
    ).state;
    rejects(moved, initialSplit("p1", "Black"), ValidationCode.WRONG_PHASE);
  });
});

// ---------------------------------------------------------------------------
// Movement / phase flow / rotation
// ---------------------------------------------------------------------------

describe("movement phase and turn rotation", () => {
  function atMovement(): GameState {
    let s = gameAtFirstCommencement();
    s = exec(s, initialSplit("p1", "Black")).state;
    return exec(s, new EndSplitsCommand("p1", {})).state;
  }

  it("rolls once; re-rolling without a mulligan is rejected", () => {
    const s = atMovement();
    rejects(s, new EndMovementCommand("p1", {}), ValidationCode.MOVEMENT_NOT_ROLLED);
    const { state, events } = exec(s, new RollMovementCommand("p1", {}), scriptedRng([5]));
    assert.equal(state.turn.movementRoll, 5);
    const ev = events.find((e) => e.type === "MovementRolled");
    assert.ok(ev && ev.type === "MovementRolled" && ev.roll === 5 && !ev.mulligan);
    rejects(state, new RollMovementCommand("p1", {}), ValidationCode.ALREADY_ROLLED);
  });

  it("the turn-1 mulligan re-rolls exactly once", () => {
    let s = atMovement();
    rejects(s, new TakeMulliganCommand("p1", {}), ValidationCode.NOTHING_TO_REROLL);
    s = exec(s, new RollMovementCommand("p1", {}), scriptedRng([1])).state;
    const { state } = exec(s, new TakeMulliganCommand("p1", {}), scriptedRng([6]));
    assert.equal(state.turn.movementRoll, 6);
    assert.ok(state.turn.mulliganUsed);
    rejects(state, new TakeMulliganCommand("p1", {}), ValidationCode.MULLIGAN_UNAVAILABLE);
  });

  it("ending movement with no engagements auto-skips to Mustering", () => {
    let s = atMovement();
    s = exec(s, new RollMovementCommand("p1", {}), scriptedRng([4])).state;
    s = moveAllActiveLegions(s);
    assert.deepEqual(pendingEngagements(s), []);
    const { state, events } = exec(s, new EndMovementCommand("p1", {}));
    assert.equal(state.fsm.path, "Turn.Mustering");
    // Two FSM hops, both narrated:
    const phases = events.filter((e) => e.type === "PhaseChanged");
    assert.equal(phases.length, 2);
  });

  it("ending the turn rotates the active player and resets per-turn flags", () => {
    let s = atMovement();
    s = exec(s, new RollMovementCommand("p1", {}), scriptedRng([4])).state;
    s = moveAllActiveLegions(s);
    s = exec(s, new EndMovementCommand("p1", {})).state;
    const { state } = exec(s, new EndTurnCommand("p1", {}));
    assert.equal(state.fsm.path, "Turn.Commencement");
    assert.equal(activePlayerId(state), "p2");
    assert.equal(state.turn.number, 1); // no wrap yet
    assert.equal(state.turn.movementRoll, null);
    for (const l of Object.values(state.legions)) {
      assert.ok(!l.splitThisTurn);
      assert.ok(!l.moved);
    }
  });

  it("wrapping back to the first player increments the game-turn number", () => {
    // p1 full quiet turn, then p2, then p3 — p2/p3 still hold their 8-stacks
    // so each must split first (turn.number is still 1 for them).
    let s = atMovement();
    s = exec(s, new RollMovementCommand("p1", {}), scriptedRng([4])).state;
    s = moveAllActiveLegions(s);
    s = exec(s, new EndMovementCommand("p1", {})).state;
    s = exec(s, new EndTurnCommand("p1", {})).state;
    for (const [pid, color] of [["p2", "Blue"], ["p3", "Red"]] as const) {
      s = exec(s, initialSplit(pid, color)).state;
      s = exec(s, new EndSplitsCommand(pid, {})).state;
      s = exec(s, new RollMovementCommand(pid, {}), scriptedRng([3])).state;
      s = moveAllActiveLegions(s);
      s = exec(s, new EndMovementCommand(pid, {})).state;
      s = exec(s, new EndTurnCommand(pid, {})).state;
    }
    assert.equal(activePlayerId(s), "p1");
    assert.equal(s.turn.number, 2);
  });

  it("turn-2 splits follow the general rule: both halves at least two", () => {
    // Get p1 to turn 2 commencement via the wrap above.
    let s = atMovement();
    s = exec(s, new RollMovementCommand("p1", {}), scriptedRng([4])).state;
    s = moveAllActiveLegions(s);
    s = exec(s, new EndMovementCommand("p1", {})).state;
    s = exec(s, new EndTurnCommand("p1", {})).state;
    for (const [pid, color] of [["p2", "Blue"], ["p3", "Red"]] as const) {
      s = exec(s, initialSplit(pid, color)).state;
      s = exec(s, new EndSplitsCommand(pid, {})).state;
      s = exec(s, new RollMovementCommand(pid, {}), scriptedRng([3])).state;
      s = moveAllActiveLegions(s);
      s = exec(s, new EndMovementCommand(pid, {})).state;
      s = exec(s, new EndTurnCommand(pid, {})).state;
    }
    // Splitting a 4-stack 1/3 is illegal; 2/2 is legal.
    rejects(
      s,
      new SplitLegionCommand("p1", {
        legionId: "Black-02",
        newMarker: "Black-03",
        toNewLegion: ["Angel"],
      }),
      ValidationCode.ILLEGAL_SPLIT,
    );
    const { state } = exec(
      s,
      new SplitLegionCommand("p1", {
        legionId: "Black-02",
        newMarker: "Black-03",
        toNewLegion: ["Angel", "Gargoyle"],
      }),
    );
    assert.equal(legionsOf(state, "p1").length, 3);
  });
});

// ---------------------------------------------------------------------------
// Purity, defense-in-depth, registry, audiences
// ---------------------------------------------------------------------------

describe("command contract", () => {
  it("execute never mutates the input state", () => {
    const s = gameAtFirstCommencement();
    const snapshot = JSON.stringify(s);
    exec(s, initialSplit("p1", "Black"));
    assert.equal(JSON.stringify(s), snapshot);
  });

  it("execute re-validates: an invalid command throws even if validate was skipped", () => {
    const s = gameAtFirstCommencement();
    const bad = new EndTurnCommand("p1", {}); // wrong phase entirely
    assert.throws(() => bad.execute(s, scriptedRng([])), CommandValidationError);
  });

  it("DTO round-trip: deserialize(toDTO(c)) behaves identically", () => {
    const s = gameAtFirstCommencement();
    const original = initialSplit("p1", "Black");
    const revived = deserializeCommand(JSON.parse(JSON.stringify(original.toDTO())));
    const a = original.execute(s, scriptedRng([]));
    const b = revived.execute(s, scriptedRng([]));
    assert.deepEqual(JSON.parse(JSON.stringify(a.state)), JSON.parse(JSON.stringify(b.state)));
    assert.deepEqual(a.events, b.events);
  });

  it("registry rejects unknown and malformed DTOs", () => {
    assert.throws(() => deserializeCommand({ type: "Nuke", playerId: "p1", payload: {} }), UnknownCommandError);
    assert.throws(() => deserializeCommand({ playerId: "p1" }), MalformedCommandError);
    assert.throws(() => deserializeCommand(null), MalformedCommandError);
    assert.ok(COMMAND_TYPES.includes("SplitLegion"));
  });

  it("audience filtering hides split details from opponents", () => {
    const s = gameAtFirstCommencement();
    const { events } = exec(s, initialSplit("p1", "Black"));
    const forOwner = visibleTo(events, "p1");
    const forOpponent = visibleTo(events, "p2");
    assert.ok(forOwner.some((e) => e.type === "LegionSplitDetail"));
    assert.ok(!forOpponent.some((e) => e.type === "LegionSplitDetail"));
    assert.ok(forOpponent.some((e) => e.type === "LegionSplit")); // heights are public
  });
});
