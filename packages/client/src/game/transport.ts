/**
 * Transport (Titan client, game) — the seam between the UI and the network.
 *
 * Both transports run the SAME client-authoritative GameEngine. The difference
 * is only how commands travel:
 *   - LocalTransport: hot-seat, no network. Apply immediately. Dev-capable.
 *   - RelayTransport: the server is a dumb relay + store (no rule checking). A
 *     command is broadcast; every client applies it in sequence order to its
 *     own engine. Determinism (shared seed + ordered log) keeps peers identical,
 *     and the persisted log restores state on reconnect.
 */

import type { GameStateView, CommandDTO, DomainEvent } from "@titan/engine";
import { GameEngine, type EngineSnapshot } from "./engine.ts";

export type SubmitResult = { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string };

/** Optional developer controls a transport may expose (local authority only). */
export interface DevControls {
  undo(): void;
  setSeed(seed: number): void;
  forceRolls(faces: number[]): void;
  revealedView(): GameStateView;
  snapshot(): EngineSnapshot;
  /** Persist / restore the whole game to a localStorage slot for quick debugging. */
  save(slot?: string): void;
  load(slot?: string): boolean;
}

const SAVE_PREFIX = "titan.save.";

export interface Transport {
  readonly mode: "local" | "relay";
  viewFor(seat: string | null): GameStateView | null;
  submit(dto: CommandDTO): Promise<SubmitResult>;
  onChange(cb: () => void): () => void;
  readonly lastEvents: readonly DomainEvent[];
  /** Present when this client owns the rules (always, now) and may debug. */
  readonly dev?: DevControls;
}

// ---------------------------------------------------------------------------
// Local: engine in the browser, apply immediately.
// ---------------------------------------------------------------------------

export class LocalTransport implements Transport {
  readonly mode = "local" as const;
  lastEvents: readonly DomainEvent[] = [];
  private engine: GameEngine;
  private readonly listeners = new Set<() => void>();

  constructor(engine: GameEngine) {
    this.engine = engine;
  }

  static newGame(seats: number, seed = Date.now() >>> 0): LocalTransport {
    return new LocalTransport(GameEngine.fresh(seats, seed));
  }

  viewFor(seat: string | null): GameStateView {
    return this.engine.view(seat);
  }

  submit(dto: CommandDTO): Promise<SubmitResult> {
    const r = this.engine.apply(dto);
    if (!r.ok) return Promise.resolve({ ok: false, code: r.code, message: r.message });
    this.lastEvents = r.events;
    this.emit();
    return Promise.resolve({ ok: true });
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  readonly dev: DevControls = {
    undo: () => { this.engine.undo(); this.lastEvents = []; this.emit(); },
    setSeed: (seed) => this.engine.setSeed(seed),
    forceRolls: (faces) => this.engine.forceRolls(faces),
    revealedView: () => this.engine.view(null, true),
    snapshot: () => this.engine.snapshot(),
    save: (slot = "quick") => { try { localStorage.setItem(SAVE_PREFIX + slot, this.engine.serialize()); } catch { /* unavailable */ } },
    load: (slot = "quick") => {
      let text: string | null = null;
      try { text = localStorage.getItem(SAVE_PREFIX + slot); } catch { /* unavailable */ }
      if (!text) return false;
      this.engine = GameEngine.deserialize(text);
      this.lastEvents = [];
      this.emit();
      return true;
    },
  };

  private emit(): void { for (const cb of this.listeners) cb(); }
}

// ---------------------------------------------------------------------------
// Relay: the server only broadcasts + stores commands. Each client executes.
// ---------------------------------------------------------------------------

export interface RelayDeps {
  /** Append a command to the shared, ordered log (server assigns the seq). */
  send(dto: CommandDTO): Promise<{ ok: boolean; message?: string }>;
  /** Receive every command in sequence order (own + peers'). */
  subscribe(onCommand: (dto: CommandDTO, seq: number) => void): () => void;
  /** Load the persisted log + seed to rebuild state on (re)connect. */
  load(): Promise<EngineSnapshot>;
}

export class RelayTransport implements Transport {
  readonly mode = "relay" as const;
  lastEvents: readonly DomainEvent[] = [];
  private engine: GameEngine | null = null;
  private readonly deps: RelayDeps;
  private readonly listeners = new Set<() => void>();
  private unsub: (() => void) | null = null;
  private nextSeq = 0;
  private readonly pending = new Map<number, CommandDTO>(); // buffer out-of-order

  constructor(deps: RelayDeps) {
    this.deps = deps;
  }

  async start(): Promise<void> {
    // Subscribe FIRST (buffering inbound), then load the persisted log, so a
    // command inserted during the load isn't missed. command_log.seq is
    // 1-based and equals the post-apply sequence number.
    this.unsub = this.deps.subscribe((dto, seq) => this.ingest(dto, seq));
    const snap = await this.deps.load();
    this.engine = GameEngine.restore(snap);
    this.nextSeq = this.engine.sequence + 1;
    this.drain();
    this.emit();
  }

  stop(): void { this.unsub?.(); this.unsub = null; }

  private ingest(dto: CommandDTO, seq: number): void {
    if (this.engine && seq < this.nextSeq) return; // already applied
    this.pending.set(seq, dto);
    this.drain();
    this.emit();
  }

  /** Apply buffered commands strictly in sequence so every client matches. */
  private drain(): void {
    if (!this.engine) return;
    while (this.pending.has(this.nextSeq)) {
      const next = this.pending.get(this.nextSeq)!;
      this.pending.delete(this.nextSeq);
      const r = this.engine.apply(next);
      if (r.ok) this.lastEvents = r.events;
      this.nextSeq++;
    }
  }

  viewFor(seat: string | null): GameStateView | null {
    return this.engine ? this.engine.view(seat) : null;
  }

  async submit(dto: CommandDTO): Promise<SubmitResult> {
    // Validate locally for instant feedback; the authoritative apply happens
    // when the command echoes back in order (keeps every peer in lockstep).
    const probe = GameEngine.restore(this.engine!.snapshot());
    const local = probe.apply(dto);
    if (!local.ok) return { ok: false, code: local.code, message: local.message };
    const r = await this.deps.send(dto);
    return r.ok ? { ok: true } : { ok: false, code: "RELAY", message: r.message ?? "relay failed" };
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void { for (const cb of this.listeners) cb(); }
}
