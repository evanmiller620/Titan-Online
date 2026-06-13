/**
 * Game store (Titan client, state layer).
 *
 * Strict-wait model (project decision, v1): the client NEVER mutates game
 * state locally. It holds the latest AUTHORITATIVE redacted snapshot received
 * from Supabase Realtime and re-renders from it. Submitting a command does not
 * change the store; the store changes only when the reconciled broadcast
 * arrives. This module is the pure reducer behind that — versioned
 * reconciliation that ignores stale/out-of-order frames — plus selectors the
 * UI reads. No Pixi, no React, no network here; testable under Node.
 *
 * The snapshot type is the engine's GameStateView (already redacted by the
 * server). The store layers on transient, client-only UI concerns: which
 * command is in flight (so the UI can show "waiting…" and disable inputs),
 * the last rejection, and ephemeral selection.
 */

import type { GameStateView } from "@titan/engine";

export type CommandPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "submitting"; readonly commandType: string }
  | { readonly kind: "rejected"; readonly commandType: string; readonly message: string };

export interface UiSelection {
  /** Currently selected legion marker (masterboard) or combatant id (battle). */
  readonly selected: string | null;
  /** Hovered land id or hex key, for highlight + broadcast. */
  readonly hovered: string | null;
}

export interface StoreState {
  /** Latest authoritative redacted snapshot, or null before first load. */
  readonly snapshot: GameStateView | null;
  /** Version of `snapshot`; frames with a lower/equal version are ignored. */
  readonly version: number;
  /** The viewing player's slot (e.g. "p1"), or null for spectator. */
  readonly viewerSlot: string | null;
  readonly command: CommandPhase;
  readonly selection: UiSelection;
}

export const initialStore: StoreState = {
  snapshot: null,
  version: -1,
  viewerSlot: null,
  command: { kind: "idle" },
  selection: { selected: null, hovered: null },
};

export type StoreEvent =
  | { readonly type: "setViewer"; readonly slot: string | null }
  | {
      readonly type: "snapshot";
      readonly version: number;
      readonly view: GameStateView;
    }
  | { readonly type: "submitStart"; readonly commandType: string }
  | { readonly type: "submitReject"; readonly commandType: string; readonly message: string }
  | { readonly type: "select"; readonly id: string | null }
  | { readonly type: "hover"; readonly id: string | null };

/**
 * Pure reducer. The reconciliation rule is the important part: a snapshot is
 * adopted ONLY if its version is strictly greater than the current one, so
 * late or duplicated Realtime frames can never roll the board backward. When a
 * newer snapshot lands, any in-flight command UI is cleared (the authoritative
 * result has arrived).
 */
export function reduce(state: StoreState, event: StoreEvent): StoreState {
  switch (event.type) {
    case "setViewer":
      return { ...state, viewerSlot: event.slot };

    case "snapshot": {
      if (event.version <= state.version) return state; // stale / out-of-order
      return {
        ...state,
        snapshot: event.view,
        version: event.version,
        command: { kind: "idle" }, // authoritative result arrived
      };
    }

    case "submitStart":
      return { ...state, command: { kind: "submitting", commandType: event.commandType } };

    case "submitReject":
      return {
        ...state,
        command: { kind: "rejected", commandType: event.commandType, message: event.message },
      };

    case "select":
      return { ...state, selection: { ...state.selection, selected: event.id } };

    case "hover":
      return { ...state, selection: { ...state.selection, hovered: event.id } };

    default:
      return state;
  }
}

// --- selectors (pure reads over the snapshot) ------------------------------

export function isMyTurn(state: StoreState): boolean {
  const v = state.snapshot;
  if (!v || state.viewerSlot === null) return false;
  return v.playerOrder[v.turn.activeIndex] === state.viewerSlot;
}

export function inputsLocked(state: StoreState): boolean {
  // Strict-wait: lock inputs while a command is in flight, and whenever it is
  // not the viewer's turn.
  return state.command.kind === "submitting" || !isMyTurn(state);
}

export function activeSlot(state: StoreState): string | null {
  const v = state.snapshot;
  if (!v) return null;
  return v.playerOrder[v.turn.activeIndex] ?? null;
}

/** Legions the viewer owns, from the redacted snapshot. */
export function myLegions(state: StoreState): GameStateView["legions"][string][] {
  const v = state.snapshot;
  if (!v || state.viewerSlot === null) return [];
  return Object.values(v.legions).filter((l) => l.ownerId === state.viewerSlot);
}

/** Human-readable current phase, derived from the FSM path. */
export function phaseLabel(state: StoreState): string {
  const path = state.snapshot?.fsm.path ?? "";
  if (path.startsWith("Setup")) return "Setup";
  if (path.includes("Battle")) return "Battle";
  if (path.endsWith("Commencement")) return "Split";
  if (path.endsWith("Movement")) return "Movement";
  if (path.includes("Engagement")) return "Engagement";
  if (path.endsWith("Mustering")) return "Muster";
  if (path === "GameOver") return "Game over";
  return path || "—";
}
