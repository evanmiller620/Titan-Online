/**
 * GameEngine (Titan client, game) — the CLIENT-SIDE authority.
 *
 * First principle (new): the rules live with the player, not the server. Each
 * client runs the engine, validates and executes its own commands, and keeps a
 * command log. The server's only jobs are to RELAY commands to every player and
 * PERSIST them so a game survives reconnects and days away.
 *
 * Determinism makes that safe: every command is executed with a seeded RNG
 * derived from the game seed + the command's sequence number. Two engines fed
 * the same seed and the same ordered log reach byte-identical state — so peers
 * never diverge and a reconnecting client rebuilds exact state by replaying the
 * log. (Tested in engine.test.ts.)
 */

import {
  createGame,
  deserializeCommand,
  seededRng,
  scriptedRng,
  viewFor,
  type GameState,
  type GameStateView,
  type CommandDTO,
  type DomainEvent,
} from "@titan/engine";

export type ApplyResult =
  | { readonly ok: true; readonly events: readonly DomainEvent[]; readonly seq: number }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** Per-command seed: stable for a given (gameSeed, seq), unique across commands. */
export function deriveSeed(gameSeed: number, seq: number): number {
  return (gameSeed + Math.imul(seq + 1, 0x9e3779b1)) >>> 0;
}

export interface EngineSnapshot {
  readonly seed: number;
  readonly seats: number;
  readonly gameId: string;
  readonly log: readonly CommandDTO[];
}

export class GameEngine {
  private readonly initial: GameState;
  private current: GameState;
  private readonly seats: number;
  private readonly gameId: string;
  private seed: number;
  private seq = 0;
  private readonly cmdLog: CommandDTO[] = [];
  private forced: number[] | null = null;

  constructor(initial: GameState, seats: number, seed: number) {
    this.initial = initial;
    this.current = initial;
    this.seats = seats;
    this.gameId = initial.gameId;
    this.seed = seed;
  }

  static fresh(seats: number, seed: number, gameId = "game"): GameEngine {
    const players = Array.from({ length: seats }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));
    return new GameEngine(createGame({ gameId, players }), seats, seed);
  }

  /** Rebuild an engine by replaying a persisted log (reconnect / load). */
  static restore(snap: EngineSnapshot): GameEngine {
    const e = GameEngine.fresh(snap.seats, snap.seed, snap.gameId);
    for (const dto of snap.log) e.apply(dto);
    return e;
  }

  get state(): GameState { return this.current; }
  get sequence(): number { return this.seq; }
  get log(): readonly CommandDTO[] { return this.cmdLog; }

  snapshot(): EngineSnapshot {
    return { seed: this.seed, seats: this.seats, gameId: this.gameId, log: [...this.cmdLog] };
  }

  /** Serialize to a compact string for save/load (round-trips via deserialize). */
  serialize(): string {
    return JSON.stringify(this.snapshot());
  }

  static deserialize(text: string): GameEngine {
    return GameEngine.restore(JSON.parse(text) as EngineSnapshot);
  }

  /** Validate + execute a command locally with the deterministic RNG. */
  apply(dto: CommandDTO): ApplyResult {
    let cmd;
    try { cmd = deserializeCommand(dto); }
    catch (e) { return { ok: false, code: "MALFORMED", message: e instanceof Error ? e.message : "bad command" }; }
    const v = cmd.validate(this.current);
    if (!v.ok) return { ok: false, code: v.failure.code, message: v.failure.message };
    const rng = this.forced ? scriptedRng(this.forced) : seededRng(deriveSeed(this.seed, this.seq));
    this.forced = null;
    const { state, events } = cmd.execute(this.current, rng);
    this.current = state;
    this.cmdLog.push(dto);
    this.seq++;
    return { ok: true, events, seq: this.seq };
  }

  /** A seat's redacted view, or the fully-revealed view for debugging. */
  view(seat: string | null, revealAll = false): GameStateView {
    return revealAll ? fullView(this.current) : viewFor(this.current, seat);
  }

  // --- dev / testing controls ----------------------------------------------

  /** Undo the last command by replaying the log without it. */
  undo(): boolean {
    if (this.cmdLog.length === 0) return false;
    const replay = this.cmdLog.slice(0, -1);
    this.current = this.initial;
    this.seq = 0;
    this.cmdLog.length = 0;
    this.forced = null;
    for (const dto of replay) this.apply(dto);
    return true;
  }

  setSeed(seed: number): void { this.seed = seed; }

  /** Force the dice for the NEXT command only (e.g. to test a specific roll). */
  forceRolls(faces: number[]): void { this.forced = faces.slice(); }
}

/** A GameStateView with EVERY legion's contents revealed — debugging only. */
export function fullView(state: GameState): GameStateView {
  const legions: GameStateView["legions"] = {};
  for (const [marker, l] of Object.entries(state.legions)) {
    legions[marker] = {
      marker: l.marker, ownerId: l.ownerId, land: l.land, height: l.creatures.length,
      moved: l.moved, splitThisTurn: l.splitThisTurn, recruitedThisTurn: l.recruitedThisTurn,
      revealed: true, creatures: [...l.creatures],
    };
  }
  return {
    gameId: state.gameId, fsm: state.fsm, playerOrder: state.playerOrder, players: state.players,
    setup: state.setup, turn: state.turn, caretaker: state.caretaker, legions, battle: state.battle,
    revealedMarkers: Object.keys(legions),
  };
}
