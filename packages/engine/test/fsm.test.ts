import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  RESUME,
  createMachine,
  tryTransition,
  transition,
  can,
  legalEvents,
  matches,
  MachineDefinitionError,
  IllegalTransitionError,
  type FsmState,
  type Machine,
  type MachineDef,
} from "../src/core/fsm/StateMachine.ts";

import { BATTLE_MACHINE, BattleEvent } from "../src/core/fsm/BattleFSM.ts";
import { GAME_MACHINE, GameEvent, Scope } from "../src/core/fsm/GameFSM.ts";

// ---------------------------------------------------------------------------
// Generic machine mechanics, exercised on a toy machine
// ---------------------------------------------------------------------------

const TOY: MachineDef = {
  id: "Toy",
  initial: "Idle",
  states: {
    Idle: {},
    Work: {
      initial: "Stage",
      states: {
        Stage: {
          initial: "One",
          states: { One: {}, Two: {} },
        },
        Review: {},
        Interrupted: {},
      },
    },
    Done: {},
  },
  transitions: [
    { from: "Idle", event: "START", to: "Work" }, // compound target
    { from: "Work.Stage.One", event: "NEXT", to: "Work.Stage.Two" },
    { from: "Work.Stage.Two", event: "NEXT", to: "Work.Review" },
    { from: "Work", event: "ABORT", to: "Idle" }, // scope: bubbles to all of Work
    { from: "Work.Review", event: "ABORT", to: "Done" }, // shadows the Work-scope ABORT
    { from: "Work.Stage", event: "PAUSE", to: "Work.Interrupted", interrupt: true },
    { from: "Work.Interrupted", event: "RESUME_WORK", to: RESUME },
    { from: "", event: "KILL", to: "Done" }, // root scope
  ],
};

describe("generic FSM: definition validation", () => {
  it("rejects an unknown machine initial", () => {
    assert.throws(
      () => createMachine({ ...TOY, initial: "Nope" }),
      MachineDefinitionError,
    );
  });

  it("rejects a compound state without initial", () => {
    assert.throws(
      () =>
        createMachine({
          id: "Bad",
          initial: "A",
          states: { A: { states: { B: {} } } }, // compound, no initial
          transitions: [],
        }),
      MachineDefinitionError,
    );
  });

  it("rejects an initial that is not a child", () => {
    assert.throws(
      () =>
        createMachine({
          id: "Bad",
          initial: "A",
          states: { A: { initial: "Z", states: { B: {} } } },
          transitions: [],
        }),
      MachineDefinitionError,
    );
  });

  it("rejects transitions with unknown source or target", () => {
    assert.throws(
      () =>
        createMachine({
          ...TOY,
          transitions: [{ from: "Ghost", event: "X", to: "Idle" }],
        }),
      MachineDefinitionError,
    );
    assert.throws(
      () =>
        createMachine({
          ...TOY,
          transitions: [{ from: "Idle", event: "X", to: "Ghost" }],
        }),
      MachineDefinitionError,
    );
  });

  it("rejects duplicate (from, event) pairs — transitions must be unambiguous", () => {
    assert.throws(
      () =>
        createMachine({
          ...TOY,
          transitions: [
            { from: "Idle", event: "X", to: "Done" },
            { from: "Idle", event: "X", to: "Work" },
          ],
        }),
      MachineDefinitionError,
    );
  });

  it("rejects an interrupt that targets @resume", () => {
    assert.throws(
      () =>
        createMachine({
          ...TOY,
          transitions: [
            { from: "Idle", event: "X", to: RESUME, interrupt: true },
          ],
        }),
      MachineDefinitionError,
    );
  });

  it("rejects state names containing dots", () => {
    assert.throws(
      () =>
        createMachine({
          id: "Bad",
          initial: "A.B",
          states: { "A.B": {} },
          transitions: [],
        }),
      MachineDefinitionError,
    );
  });
});

describe("generic FSM: transitions", () => {
  const toy: Machine = createMachine(TOY);

  it("initial state resolves nested initial chains to a leaf", () => {
    assert.equal(toy.initialState.path, "Idle");
    const started = transition(toy, toy.initialState, "START");
    // Work → Stage → One: two levels of initial resolution
    assert.equal(started.path, "Work.Stage.One");
  });

  it("only one state is active at a time (a single leaf path)", () => {
    const s = transition(toy, toy.initialState, "START");
    assert.equal(typeof s.path, "string");
    assert.ok(!s.path.includes(","));
  });

  it("explicit transitions move between leaves", () => {
    let s = transition(toy, toy.initialState, "START");
    s = transition(toy, s, "NEXT");
    assert.equal(s.path, "Work.Stage.Two");
    s = transition(toy, s, "NEXT");
    assert.equal(s.path, "Work.Review");
  });

  it("unhandled events are rejected with structured errors, never no-ops", () => {
    const r = tryTransition(toy, toy.initialState, "NEXT");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error.kind, "UNHANDLED_EVENT");
      assert.equal(r.error.path, "Idle");
      assert.equal(r.error.event, "NEXT");
    }
    assert.throws(() => transition(toy, toy.initialState, "NEXT"), IllegalTransitionError);
  });

  it("scope transitions bubble: ABORT works from any leaf inside Work", () => {
    const s = transition(toy, toy.initialState, "START"); // Work.Stage.One
    assert.equal(transition(toy, s, "ABORT").path, "Idle");
  });

  it("deeper declarations shadow ancestor scopes", () => {
    let s = transition(toy, toy.initialState, "START");
    s = transition(toy, s, "NEXT");
    s = transition(toy, s, "NEXT"); // Work.Review
    // Work-scope ABORT goes to Idle, but Work.Review declares ABORT → Done.
    assert.equal(transition(toy, s, "ABORT").path, "Done");
  });

  it("root-scope transitions apply everywhere", () => {
    assert.equal(transition(toy, toy.initialState, "KILL").path, "Done");
    const deep = transition(toy, toy.initialState, "START");
    assert.equal(transition(toy, deep, "KILL").path, "Done");
  });

  it("interrupt pushes the current leaf; resume pops back to it", () => {
    let s = transition(toy, toy.initialState, "START");
    s = transition(toy, s, "NEXT"); // Work.Stage.Two
    s = transition(toy, s, "PAUSE");
    assert.equal(s.path, "Work.Interrupted");
    assert.deepEqual(s.returnStack, ["Work.Stage.Two"]);
    s = transition(toy, s, "RESUME_WORK");
    assert.equal(s.path, "Work.Stage.Two");
    assert.deepEqual(s.returnStack, []);
  });

  it("resume with an empty stack is a structured error", () => {
    // Force a state sitting in Interrupted with no stack (e.g. deserialized
    // from corrupted persistence) — the machine must refuse, not guess.
    const bogus: FsmState = { path: "Work.Interrupted", returnStack: [] };
    const r = tryTransition(toy, bogus, "RESUME_WORK");
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.kind, "EMPTY_RETURN_STACK");
  });

  it("a normal transition abandons any pending interrupt stack", () => {
    let s = transition(toy, toy.initialState, "START");
    s = transition(toy, s, "PAUSE"); // stack: [Work.Stage.One]
    s = transition(toy, s, "KILL"); // normal transition out of the interrupt
    assert.equal(s.path, "Done");
    assert.deepEqual(s.returnStack, []);
  });

  it("transitions are pure — input state objects are never mutated", () => {
    const before = transition(toy, toy.initialState, "START");
    const snapshot = JSON.stringify(before);
    transition(toy, before, "PAUSE");
    transition(toy, before, "NEXT");
    assert.equal(JSON.stringify(before), snapshot);
  });

  it("FsmState survives JSON round-trips (persistence contract)", () => {
    let s = transition(toy, toy.initialState, "START");
    s = transition(toy, s, "PAUSE");
    const revived = JSON.parse(JSON.stringify(s)) as FsmState;
    assert.equal(transition(toy, revived, "RESUME_WORK").path, "Work.Stage.One");
  });

  it("can() and legalEvents() report exactly the live options", () => {
    const s = transition(toy, toy.initialState, "START"); // Work.Stage.One
    assert.ok(can(toy, s, "NEXT"));
    assert.ok(can(toy, s, "ABORT"));
    assert.ok(!can(toy, s, "START"));
    assert.deepEqual(legalEvents(toy, s).sort(), ["ABORT", "KILL", "NEXT", "PAUSE"]);
    // RESUME-targeting events are only legal when the stack is non-empty:
    const paused = transition(toy, s, "PAUSE");
    assert.ok(legalEvents(toy, paused).includes("RESUME_WORK"));
    const bogus: FsmState = { path: "Work.Interrupted", returnStack: [] };
    assert.ok(!legalEvents(toy, bogus).includes("RESUME_WORK"));
  });

  it("matches() answers scope queries", () => {
    const s = transition(toy, toy.initialState, "START");
    assert.ok(matches(s, "Work"));
    assert.ok(matches(s, "Work.Stage"));
    assert.ok(matches(s, "Work.Stage.One"));
    assert.ok(!matches(s, "Work.Review"));
    assert.ok(matches(s, "")); // root matches everything
  });
});

// ---------------------------------------------------------------------------
// Titan game machine
// ---------------------------------------------------------------------------

/** Fire a sequence of events, asserting each is legal. */
function run(machine: Machine, events: readonly string[], from?: FsmState): FsmState {
  let s = from ?? machine.initialState;
  for (const e of events) {
    const r = tryTransition(machine, s, e);
    assert.ok(r.ok, `expected "${e}" to be legal in "${s.path}"`);
    s = r.state;
  }
  return s;
}

describe("GameFSM: setup and the four-phase turn loop", () => {
  it("starts in Setup.RollingForOrder", () => {
    assert.equal(GAME_MACHINE.initialState.path, "Setup.RollingForOrder");
  });

  it("setup proceeds order → towers → colors → first Commencement", () => {
    const s = run(GAME_MACHINE, [
      GameEvent.TURN_ORDER_DETERMINED,
      GameEvent.TOWERS_SELECTED,
      GameEvent.COLORS_SELECTED,
    ]);
    assert.equal(s.path, "Turn.Commencement");
    assert.ok(matches(s, Scope.Turn));
  });

  it("a quiet turn: split → move → (no engagements) → muster → next player", () => {
    const s = run(GAME_MACHINE, [
      GameEvent.TURN_ORDER_DETERMINED,
      GameEvent.TOWERS_SELECTED,
      GameEvent.COLORS_SELECTED,
      GameEvent.SPLITS_COMPLETED,
      GameEvent.MOVEMENT_COMPLETED, // lands in Engagement.Choosing
      GameEvent.ALL_ENGAGEMENTS_RESOLVED, // empty engagement list: skip to muster
      GameEvent.TURN_ENDED,
    ]);
    assert.equal(s.path, "Turn.Commencement"); // next player's turn, same topology
  });

  it("phases cannot be taken out of order", () => {
    const atCommencement = run(GAME_MACHINE, [
      GameEvent.TURN_ORDER_DETERMINED,
      GameEvent.TOWERS_SELECTED,
      GameEvent.COLORS_SELECTED,
    ]);
    // Movement before splits: rejected.
    assert.ok(!can(GAME_MACHINE, atCommencement, GameEvent.MOVEMENT_COMPLETED));
    // Mustering before engagements resolved: rejected.
    const atMovement = transition(GAME_MACHINE, atCommencement, GameEvent.SPLITS_COMPLETED);
    assert.ok(!can(GAME_MACHINE, atMovement, GameEvent.TURN_ENDED));
    // Joining a battle without selecting an engagement: rejected.
    const atChoosing = transition(GAME_MACHINE, atMovement, GameEvent.MOVEMENT_COMPLETED);
    assert.ok(!can(GAME_MACHINE, atChoosing, GameEvent.BATTLE_JOINED));
  });

  it("negotiation can resolve an engagement without battle (flee/concede/settle)", () => {
    const toChoosing = [
      GameEvent.TURN_ORDER_DETERMINED,
      GameEvent.TOWERS_SELECTED,
      GameEvent.COLORS_SELECTED,
      GameEvent.SPLITS_COMPLETED,
      GameEvent.MOVEMENT_COMPLETED,
    ];
    for (const outcome of [
      GameEvent.DEFENDER_FLED,
      GameEvent.LEGION_CONCEDED,
      GameEvent.SETTLEMENT_AGREED,
    ]) {
      const s = run(GAME_MACHINE, [
        ...toChoosing,
        GameEvent.ENGAGEMENT_SELECTED,
        outcome,
      ]);
      assert.equal(s.path, "Turn.Engagement.Choosing");
    }
  });
});

describe("GameFSM: the nested battle", () => {
  const intoBattle = [
    GameEvent.TURN_ORDER_DETERMINED,
    GameEvent.TOWERS_SELECTED,
    GameEvent.COLORS_SELECTED,
    GameEvent.SPLITS_COMPLETED,
    GameEvent.MOVEMENT_COMPLETED,
    GameEvent.ENGAGEMENT_SELECTED,
    GameEvent.BATTLE_JOINED,
  ];

  it("joining a battle enters the grafted subtree at DefenderDeployment", () => {
    const s = run(GAME_MACHINE, intoBattle);
    assert.equal(s.path, "Turn.Engagement.Battle.DefenderDeployment");
    assert.ok(matches(s, Scope.Battle));
    assert.ok(matches(s, Scope.Engagement)); // nesting: both facts are true
  });

  it("deployment order is defender first, then attacker, then round 1 maneuver", () => {
    const s = run(GAME_MACHINE, [
      ...intoBattle,
      BattleEvent.DEFENDER_DEPLOYED,
      BattleEvent.ATTACKER_DEPLOYED,
    ]);
    assert.equal(s.path, "Turn.Engagement.Battle.Round.Maneuver");
    // Attacker cannot deploy before the defender:
    const atDef = run(GAME_MACHINE, intoBattle);
    assert.ok(!can(GAME_MACHINE, atDef, BattleEvent.ATTACKER_DEPLOYED));
  });

  it("half-turns cycle Maneuver → Strike → Strikeback → Maneuver", () => {
    let s = run(GAME_MACHINE, [
      ...intoBattle,
      BattleEvent.DEFENDER_DEPLOYED,
      BattleEvent.ATTACKER_DEPLOYED,
    ]);
    for (let half = 0; half < 4; half++) {
      s = run(GAME_MACHINE, [
        BattleEvent.MANEUVERS_COMPLETED,
        BattleEvent.STRIKES_COMPLETED,
        BattleEvent.HALF_TURN_ENDED,
      ], s);
      assert.equal(s.path, "Turn.Engagement.Battle.Round.Maneuver");
    }
  });

  it("the round-4 reinforcement window interposes before the defender's maneuver", () => {
    const atStrikeback = run(GAME_MACHINE, [
      ...intoBattle,
      BattleEvent.DEFENDER_DEPLOYED,
      BattleEvent.ATTACKER_DEPLOYED,
      BattleEvent.MANEUVERS_COMPLETED,
      BattleEvent.STRIKES_COMPLETED,
    ]);
    const offered = transition(GAME_MACHINE, atStrikeback, BattleEvent.REINFORCEMENT_OFFERED);
    assert.equal(offered.path, "Turn.Engagement.Battle.Round.Reinforce");
    for (const decision of [BattleEvent.REINFORCEMENT_MUSTERED, BattleEvent.REINFORCEMENT_DECLINED]) {
      const next = transition(GAME_MACHINE, offered, decision);
      assert.equal(next.path, "Turn.Engagement.Battle.Round.Maneuver");
    }
  });

  it("the angel summon interrupts at the kill and resumes exactly there", () => {
    // First kill during the attacker's Strike phase:
    const atStrike = run(GAME_MACHINE, [
      ...intoBattle,
      BattleEvent.DEFENDER_DEPLOYED,
      BattleEvent.ATTACKER_DEPLOYED,
      BattleEvent.MANEUVERS_COMPLETED,
    ]);
    assert.equal(atStrike.path, "Turn.Engagement.Battle.Round.Strike");
    const window = transition(GAME_MACHINE, atStrike, BattleEvent.FIRST_KILL);
    assert.equal(window.path, "Turn.Engagement.Battle.Round.SummonAngel");
    assert.deepEqual(window.returnStack, ["Turn.Engagement.Battle.Round.Strike"]);
    // Use-it-or-lose-it: both choices return to the interrupted strike phase.
    assert.equal(
      transition(GAME_MACHINE, window, BattleEvent.ANGEL_SUMMONED).path,
      "Turn.Engagement.Battle.Round.Strike",
    );
    assert.equal(
      transition(GAME_MACHINE, window, BattleEvent.SUMMON_DECLINED).path,
      "Turn.Engagement.Battle.Round.Strike",
    );

    // The attacker's first kill can also land during a STRIKEBACK (the
    // attacker striking back in the defender's half-turn):
    const atStrikeback = run(GAME_MACHINE, [BattleEvent.STRIKES_COMPLETED], atStrike);
    const window2 = transition(GAME_MACHINE, atStrikeback, BattleEvent.FIRST_KILL);
    assert.equal(window2.path, "Turn.Engagement.Battle.Round.SummonAngel");
    assert.equal(
      transition(GAME_MACHINE, window2, BattleEvent.SUMMON_DECLINED).path,
      "Turn.Engagement.Battle.Round.Strikeback",
    );
  });

  it("battle conclusion bubbles from any round substate and exits via Resolution", () => {
    const base = [
      ...intoBattle,
      BattleEvent.DEFENDER_DEPLOYED,
      BattleEvent.ATTACKER_DEPLOYED,
    ];
    const fromManeuver = run(GAME_MACHINE, base);
    const fromStrike = run(GAME_MACHINE, [BattleEvent.MANEUVERS_COMPLETED], fromManeuver);
    const fromStrikeback = run(GAME_MACHINE, [BattleEvent.STRIKES_COMPLETED], fromStrike);
    for (const s of [fromManeuver, fromStrike, fromStrikeback]) {
      const done = transition(GAME_MACHINE, s, BattleEvent.BATTLE_CONCLUDED);
      assert.equal(done.path, "Turn.Engagement.Battle.Resolution");
      const out = transition(GAME_MACHINE, done, GameEvent.ENGAGEMENT_RESOLVED);
      assert.equal(out.path, "Turn.Engagement.Choosing");
    }
  });

  it("mid-battle concession routes to Resolution (shadowing the negotiation-scope event)", () => {
    const s = run(GAME_MACHINE, [
      ...intoBattle,
      BattleEvent.DEFENDER_DEPLOYED,
      BattleEvent.ATTACKER_DEPLOYED,
      BattleEvent.MANEUVERS_COMPLETED,
    ]);
    const done = transition(GAME_MACHINE, s, BattleEvent.LEGION_CONCEDED);
    assert.equal(done.path, "Turn.Engagement.Battle.Resolution");
  });

  it("a full turn with one fought battle returns to the next Commencement", () => {
    const s = run(GAME_MACHINE, [
      ...intoBattle,
      BattleEvent.DEFENDER_DEPLOYED,
      BattleEvent.ATTACKER_DEPLOYED,
      BattleEvent.MANEUVERS_COMPLETED,
      BattleEvent.STRIKES_COMPLETED,
      BattleEvent.HALF_TURN_ENDED,
      BattleEvent.MANEUVERS_COMPLETED,
      BattleEvent.FIRST_KILL,
      BattleEvent.ANGEL_SUMMONED,
      BattleEvent.STRIKES_COMPLETED,
      BattleEvent.BATTLE_CONCLUDED,
      GameEvent.ENGAGEMENT_RESOLVED,
      GameEvent.ALL_ENGAGEMENTS_RESOLVED,
      GameEvent.TURN_ENDED,
    ]);
    assert.equal(s.path, "Turn.Commencement");
    assert.deepEqual(s.returnStack, []);
  });

  it("GAME_ENDED reaches GameOver from anywhere, even mid-strike, and clears the stack", () => {
    const deep = run(GAME_MACHINE, [
      ...intoBattle,
      BattleEvent.DEFENDER_DEPLOYED,
      BattleEvent.ATTACKER_DEPLOYED,
      BattleEvent.MANEUVERS_COMPLETED,
      BattleEvent.FIRST_KILL, // sitting in the summon window with a stack
    ]);
    assert.equal(deep.returnStack.length, 1);
    const over = transition(GAME_MACHINE, deep, GameEvent.GAME_ENDED);
    assert.equal(over.path, "GameOver");
    assert.deepEqual(over.returnStack, []);
  });

  it("GameOver is terminal", () => {
    const over = transition(GAME_MACHINE, GAME_MACHINE.initialState, GameEvent.GAME_ENDED);
    assert.deepEqual(legalEvents(GAME_MACHINE, over), []);
  });
});

describe("standalone battle machine", () => {
  it("runs the same battle topology in isolation", () => {
    const s = run(BATTLE_MACHINE, [
      BattleEvent.DEFENDER_DEPLOYED,
      BattleEvent.ATTACKER_DEPLOYED,
      BattleEvent.MANEUVERS_COMPLETED,
      BattleEvent.FIRST_KILL,
      BattleEvent.SUMMON_DECLINED,
      BattleEvent.STRIKES_COMPLETED,
      BattleEvent.HALF_TURN_ENDED,
      BattleEvent.MANEUVERS_COMPLETED,
      BattleEvent.BATTLE_CONCLUDED,
    ]);
    assert.equal(s.path, "Resolution");
    assert.deepEqual(legalEvents(BATTLE_MACHINE, s), []); // terminal standalone
  });
});
