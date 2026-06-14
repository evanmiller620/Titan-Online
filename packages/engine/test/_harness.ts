/**
 * End-to-end game harness (Titan engine tests).
 *
 * A thin driver that plays a game the way the client + server do — building and
 * executing real commands against the authoritative engine, asserting every
 * command is accepted. It exists so the e2e tests read as "play a turn", "play
 * a whole game" rather than thirty lines of command plumbing each.
 *
 * Determinism: all dice are scripted. Helpers prefer reading the engine's own
 * state (whose turn, which legions, legal destinations) over hard-coding, so a
 * change in board data can't silently invalidate a test's assumptions.
 */

import assert from "node:assert/strict";
import * as E from "../src/index.ts";

export type State = ReturnType<typeof E.createGame>;
type Cmd = { type: string; validate(s: State): { ok: boolean; failure?: { code: string; message: string } }; execute(s: State, rng: ReturnType<typeof E.scriptedRng>): { state: State } };

const EMPTY = E.scriptedRng([]);

/** Execute a command, asserting it is accepted. Returns the new state. */
export function ok(s: State, cmd: Cmd, rng = EMPTY): State {
  const v = cmd.validate(s);
  assert.ok(v.ok, !v.ok ? `${cmd.type} rejected: [${v.failure!.code}] ${v.failure!.message}` : "");
  return cmd.execute(s, rng).state;
}

/** Assert a command is REJECTED with a specific code (negative-path tests). */
export function rejects(s: State, cmd: Cmd, code: string): void {
  const v = cmd.validate(s);
  assert.ok(!v.ok, `${cmd.type} should have been rejected`);
  if (!v.ok) assert.equal(v.failure!.code, code, `expected ${code}, got ${v.failure!.code}`);
}

export interface PlayerSpec { id: string; name: string }

/** Create a game with N players (p1..pN). */
export function newGame(n: number, gameId = "e2e"): State {
  const players: PlayerSpec[] = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
  return E.createGame({ gameId, players });
}

/**
 * Run the full Setup phase deterministically. `rolls` must be distinct so the
 * order is unambiguous; towers and colors are assigned in canonical order.
 * Returns the state at the start of turn 1 (player order[0]'s Commencement).
 */
export function runSetup(s: State, rolls: number[]): State {
  const n = s.playerOrder.length || Object.keys(s.players).length;
  s = ok(s, new E.RollTurnOrderCommand("p1", {}), E.scriptedRng(rolls));
  const order = s.setup!.order;
  const towers = [100, 200, 300, 400, 500, 600];
  // Tower picks proceed in setup.order (highest roller first).
  for (let i = 0; i < n; i++) {
    const picker = s.setup!.order[s.setup!.towerPickIndex]!;
    s = ok(s, new E.SelectTowerCommand(picker, { tower: towers[i]! }));
  }
  // Color picks proceed in reverse (lowest roller first).
  const colors = ["Black", "Brown", "Blue", "Gold", "Green", "Red"] as const;
  for (let i = 0; i < n; i++) {
    const picker = s.setup!.order[s.setup!.colorPickIndex]!;
    s = ok(s, new E.SelectColorCommand(picker, { color: colors[i]! }));
  }
  void order;
  return s;
}

/** The active player's id. */
export function active(s: State): string {
  return E.activePlayerId(s)!;
}

/** All of a player's legions as [marker, legion] pairs. */
export function legionsOf(s: State, pid: string): Array<[string, State["legions"][string]]> {
  return Object.entries(s.legions).filter(([, l]) => l.ownerId === pid);
}

/**
 * Perform the mandatory turn-1 initial split for the active player: Titan + 3
 * into a new legion, leaving the Angel + 3. Returns the new state.
 */
export function initialSplit(s: State): State {
  const pid = active(s);
  const eight = legionsOf(s, pid).find(([, l]) => l.creatures.length === 8);
  assert.ok(eight, "active player should have an 8-stack on turn 1");
  const [marker, leg] = eight!;
  const others = leg.creatures.filter((c) => c !== "Titan" && c !== "Angel");
  const child = ["Titan", ...others.slice(0, 3)];
  return ok(s, new E.SplitLegionCommand(pid, {
    legionId: marker,
    newMarker: s.players[pid]!.markersAvailable[0]!,
    toNewLegion: child as never,
  }));
}

export interface TurnOptions {
  /** Movement die value to script (default 3). */
  roll?: number;
  /** If true, perform the turn-1 initial split first. */
  split?: boolean;
  /** Resolve any engagements that arise via this outcome (default "flee"). */
  resolveWith?: "flee" | "concede";
  /** Muster with every eligible legion (first option) before ending. */
  muster?: boolean;
}

/**
 * Play a full, legal turn for the active player: optional split → roll → move
 * every legion to a distinct legal destination → resolve engagements → optional
 * muster → end turn. Returns the state after EndTurn (or after the game ends).
 */
export function playTurn(s: State, opts: TurnOptions = {}): State {
  const pid = active(s);
  const roll = opts.roll ?? 3;

  if (opts.split && s.turn.number === 1) s = initialSplit(s);
  s = ok(s, new E.EndSplitsCommand(pid, {}));

  s = ok(s, new E.RollMovementCommand(pid, {}), E.scriptedRng([roll]));

  // Move each legion to a distinct legal destination (split halves must part).
  const used = new Set<number>();
  for (const [marker, leg] of legionsOf(s, pid)) {
    const dests = E.destinationsForRoll(leg.land, s.turn.movementRoll!)
      .map((d) => d.destination)
      .filter((d) => !used.has(d));
    if (dests.length > 0) {
      s = ok(s, new E.MoveLegionCommand(pid, { legionId: marker, destination: dests[0]! }));
      used.add(dests[0]!);
    }
  }

  s = ok(s, new E.EndMovementCommand(pid, {}));

  // Resolve any engagements that arose.
  while (s.fsm.path === "Turn.Engagement.Choosing") {
    const land = E.pendingEngagements(s)[0]!;
    s = ok(s, new E.SelectEngagementCommand(pid, { land }));
    s = ok(s, new E.ResolveEngagementCommand(pid, { outcome: opts.resolveWith ?? "flee" }));
  }

  // The game may have ended mid-engagement.
  if (s.fsm.path === "GameOver") return s;

  if (opts.muster && s.fsm.path === "Turn.Mustering") {
    for (const [marker, leg] of legionsOf(s, pid)) {
      const land = E.getLand(leg.land);
      if (!land) continue;
      const containsOwnTitan = leg.creatures.includes("Titan");
      const options = E.eligibleRecruits(land.terrain, leg.creatures, s.caretaker, { containsOwnTitan });
      if (options.length > 0 && leg.moved && leg.creatures.length < 7) {
        s = ok(s, new E.MusterCommand(pid, { legionId: marker, creature: options[0]!.creature }));
      }
    }
  }

  if (s.fsm.path === "Turn.Mustering") s = ok(s, new E.EndTurnCommand(pid, {}));
  return s;
}

export { E };
