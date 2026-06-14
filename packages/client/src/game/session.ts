/**
 * Session & seats (Titan client, game).
 *
 * First principle: each PLAYER is its own object — a Seat — with a control
 * mode. A `local` seat is driven from this machine (you can act as it); a
 * `remote` seat is driven by another computer and only observed here. The
 * GameSession binds the seats to a Transport and exposes, for whichever local
 * seat is "in focus", the legal actions and a submit path. Swapping the
 * transport (LocalTransport ↔ RelayTransport) changes nothing above it.
 */

import type { GameStateView, CommandDTO } from "@titan/engine";
import type { Transport, SubmitResult, DevControls } from "./transport.ts";
import { legalActions, NO_SELECTION, type Action, type Selection } from "./legalActions.ts";

export interface Seat {
  readonly slot: string; // "p1"
  readonly name: string;
  readonly control: "local" | "remote";
}

export class GameSession {
  readonly seats: readonly Seat[];
  private transport: Transport;
  private focus: string; // the local seat currently driving the screen
  private selection: Selection = NO_SELECTION;
  private revealAll = false;
  private listeners = new Set<() => void>();
  private offTransport: () => void;

  constructor(transport: Transport, seats: readonly Seat[], focus?: string) {
    this.transport = transport;
    this.seats = seats;
    const locals = seats.filter((s) => s.control === "local");
    this.focus = focus ?? locals[0]?.slot ?? seats[0]?.slot ?? "p1";
    this.offTransport = transport.onChange(() => this.emit());
  }

  // --- focus (which local seat acts) ---------------------------------------
  get focusedSeat(): string {
    return this.focus;
  }
  localSeats(): Seat[] {
    return this.seats.filter((s) => s.control === "local");
  }
  setFocus(slot: string): void {
    if (this.seats.some((s) => s.slot === slot && s.control === "local")) {
      this.focus = slot;
      this.selection = NO_SELECTION;
      this.emit();
    }
  }
  /** Convenience: focus whichever LOCAL seat must act now (hot-seat autopilot). */
  focusActiveSeat(): void {
    const view = this.view();
    if (!view) return;
    for (const s of this.localSeats()) {
      if (legalActions(view, s.slot, this.selection).length > 0) {
        if (s.slot !== this.focus) { this.focus = s.slot; this.selection = NO_SELECTION; }
        return;
      }
    }
  }

  // --- reads ----------------------------------------------------------------
  view(): GameStateView | null {
    if (this.revealAll && this.transport.dev) return this.transport.dev.revealedView();
    return this.transport.viewFor(this.focus);
  }
  /** Developer controls, if this client owns the rules (local authority). */
  dev(): DevControls | undefined {
    return this.transport.dev;
  }
  isRevealAll(): boolean {
    return this.revealAll;
  }
  setRevealAll(on: boolean): void {
    this.revealAll = on;
    this.emit();
  }
  actions(): Action[] {
    const v = this.view();
    return v ? legalActions(v, this.focus, this.selection) : [];
  }
  getSelection(): Selection {
    return this.selection;
  }
  lastEvents() {
    return this.transport.lastEvents;
  }

  // --- writes ---------------------------------------------------------------
  select(patch: Partial<Selection>): void {
    this.selection = { ...this.selection, ...patch };
    this.emit();
  }
  async submit(dto: CommandDTO): Promise<SubmitResult> {
    const r = await this.transport.submit(dto);
    if (r.ok) this.selection = NO_SELECTION;
    return r;
  }

  // --- change notification --------------------------------------------------
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  dispose(): void {
    this.offTransport();
    this.listeners.clear();
  }
  private emit(): void {
    for (const cb of this.listeners) cb();
  }
}

/** Build seats: locals are this machine's; everyone else is remote. */
export function makeSeats(count: number, localSlots: readonly string[], names: Record<string, string> = {}): Seat[] {
  const local = new Set(localSlots);
  return Array.from({ length: count }, (_, i) => {
    const slot = `p${i + 1}`;
    return { slot, name: names[slot] ?? `Player ${i + 1}`, control: local.has(slot) ? "local" : "remote" } as Seat;
  });
}
