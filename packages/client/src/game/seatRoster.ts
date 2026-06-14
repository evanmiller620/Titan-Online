/**
 * Seat roster (Titan client, game) — the waiting-room model.
 *
 * A room has N seats (p1..pN). Each is empty until a player joins it, either
 * LOCALLY (a hot-seat player on this machine) or REMOTELY (another computer,
 * surfaced through Supabase presence). The roster is pure state + transitions,
 * so the menu's logic is unit-testable; the DOM only renders it.
 */

import type { Seat } from "./session.ts";

export type SeatStatus = "empty" | "local" | "remote";

export interface RosterSeat {
  readonly slot: string;
  readonly status: SeatStatus;
  readonly name: string;
}

export class SeatRoster {
  private seats: RosterSeat[];

  constructor(size: number) {
    this.seats = Array.from({ length: size }, (_, i) => ({ slot: `p${i + 1}`, status: "empty", name: "" }));
  }

  list(): readonly RosterSeat[] {
    return this.seats;
  }

  get size(): number {
    return this.seats.length;
  }

  private firstEmpty(): RosterSeat | undefined {
    return this.seats.find((s) => s.status === "empty");
  }

  /** Seat a local (hot-seat) player. Returns the slot taken, or null if full. */
  addLocal(name: string): string | null {
    const seat = this.firstEmpty();
    if (!seat) return null;
    this.set(seat.slot, "local", name || seat.slot);
    return seat.slot;
  }

  /** Mark a specific slot as locally controlled (e.g. the online host's seat). */
  claim(slot: string, status: SeatStatus, name: string): void {
    this.set(slot, status, name);
  }

  release(slot: string): void {
    this.set(slot, "empty", "");
  }

  /** Reconcile the remote-occupied slots from a presence roster. Local and
   *  empty seats are left untouched; everything else maps to remote/empty. */
  syncRemote(occupied: ReadonlyArray<{ slot: string; name: string }>): void {
    const bySlot = new Map(occupied.map((o) => [o.slot, o.name]));
    this.seats = this.seats.map((s) => {
      if (s.status === "local") return s;
      const name = bySlot.get(s.slot);
      return name !== undefined ? { ...s, status: "remote", name } : { ...s, status: "empty", name: "" };
    });
  }

  filledCount(): number {
    return this.seats.filter((s) => s.status !== "empty").length;
  }

  localSlots(): string[] {
    return this.seats.filter((s) => s.status === "local").map((s) => s.slot);
  }

  /** Ready to start: every seat filled and at least one is locally driven. */
  canStart(): boolean {
    return this.seats.every((s) => s.status !== "empty") && this.localSlots().length > 0;
  }

  /** The Seat[] a GameSession needs (empty seats coerced to remote-controlled). */
  toSeats(): Seat[] {
    return this.seats.map((s) => ({
      slot: s.slot,
      name: s.name || s.slot,
      control: s.status === "local" ? "local" : "remote",
    }));
  }

  private set(slot: string, status: SeatStatus, name: string): void {
    this.seats = this.seats.map((s) => (s.slot === slot ? { slot, status, name } : s));
  }
}
