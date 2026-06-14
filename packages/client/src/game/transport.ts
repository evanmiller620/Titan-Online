/**
 * Transport (Titan client, game) — the seam that decouples the UI from WHERE
 * the game authority lives.
 *
 * First principle: a game is a stream of commands applied to authoritative
 * state. A Transport owns that authority and the redaction boundary:
 *
 *   - LocalTransport runs the pure engine IN THE BROWSER. Commands validate +
 *     execute immediately; every seat is driven from this machine (hot-seat /
 *     debugging). No backend required, so it always works.
 *   - RemoteTransport defers to the Supabase server: submit() posts to the edge
 *     function and the authoritative snapshot returns over Realtime (strict-
 *     wait). The same UI drives it unchanged.
 *
 * The UI asks the transport for `viewFor(seat)` and calls `submit(dto)`; it
 * never knows or cares which transport it holds.
 */

import {
  createGame,
  deserializeCommand,
  viewFor,
  fromMathRandom,
  type GameState,
  type GameStateView,
  type CommandDTO,
  type DomainEvent,
} from "@titan/engine";

export type SubmitResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string; readonly message: string };

export interface Transport {
  readonly mode: "local" | "remote";
  /** The redacted view for a seat (null = public/spectator). */
  viewFor(seat: string | null): GameStateView | null;
  /** Issue a command. Resolves accept/reject; never throws on a rule violation. */
  submit(dto: CommandDTO): Promise<SubmitResult>;
  /** Subscribe to authoritative state changes. Returns an unsubscribe fn. */
  onChange(cb: () => void): () => void;
  /** Domain events from the most recent accepted command (for the event log). */
  readonly lastEvents: readonly DomainEvent[];
}

// ---------------------------------------------------------------------------
// Local: the engine runs here. Authoritative, synchronous, no backend.
// ---------------------------------------------------------------------------

export class LocalTransport implements Transport {
  readonly mode = "local" as const;
  private state: GameState;
  private listeners = new Set<() => void>();
  lastEvents: readonly DomainEvent[] = [];

  constructor(initial: GameState) {
    this.state = initial;
  }

  /** Build a fresh local game with N seats (p1..pN). */
  static newGame(seats: number, gameId = "local"): LocalTransport {
    const players = Array.from({ length: seats }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));
    return new LocalTransport(createGame({ gameId, players }));
  }

  /** Direct read of the unredacted state (debug/inspection only). */
  rawState(): GameState {
    return this.state;
  }

  viewFor(seat: string | null): GameStateView {
    return viewFor(this.state, seat);
  }

  submit(dto: CommandDTO): Promise<SubmitResult> {
    let cmd;
    try {
      cmd = deserializeCommand(dto);
    } catch (e) {
      return Promise.resolve({ ok: false, code: "MALFORMED", message: msg(e) });
    }
    const v = cmd.validate(this.state);
    if (!v.ok) return Promise.resolve({ ok: false, code: v.failure.code, message: v.failure.message });
    const { state, events } = cmd.execute(this.state, fromMathRandom());
    this.state = state;
    this.lastEvents = events;
    this.emit();
    return Promise.resolve({ ok: true });
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }
}

// ---------------------------------------------------------------------------
// Remote: the Supabase server is authoritative (strict-wait).
// ---------------------------------------------------------------------------

export interface RemoteDeps {
  submitCommand(gameId: string, dto: CommandDTO): Promise<SubmitResult>;
  /** Subscribe to authoritative snapshots; returns unsubscribe. */
  subscribe(onSnapshot: (view: GameStateView, version: number) => void): () => void;
  /** One-shot initial snapshot (join / reconnect). */
  fetchSnapshot(): Promise<{ view: GameStateView; version: number } | null>;
}

export class RemoteTransport implements Transport {
  readonly mode = "remote" as const;
  private view: GameStateView | null = null;
  private version = -1;
  private listeners = new Set<() => void>();
  private unsub: (() => void) | null = null;
  lastEvents: readonly DomainEvent[] = []; // server doesn't stream events to the UI here
  private readonly gameId: string;
  private readonly deps: RemoteDeps;

  constructor(gameId: string, deps: RemoteDeps) {
    this.gameId = gameId;
    this.deps = deps;
  }

  async start(): Promise<void> {
    this.unsub = this.deps.subscribe((view, version) => this.adopt(view, version));
    const snap = await this.deps.fetchSnapshot();
    if (snap) this.adopt(snap.view, snap.version);
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
  }

  private adopt(view: GameStateView, version: number): void {
    if (version <= this.version) return; // ignore stale / duplicate frames
    this.view = view;
    this.version = version;
    for (const cb of this.listeners) cb();
  }

  viewFor(_seat: string | null): GameStateView | null {
    return this.view; // server already redacted to this client's seat
  }

  submit(dto: CommandDTO): Promise<SubmitResult> {
    return this.deps.submitCommand(this.gameId, dto);
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : "error";
}
