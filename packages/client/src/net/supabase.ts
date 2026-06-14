/**
 * Network layer (Titan client, net).
 *
 * The ONLY module that talks to Supabase. It keeps three channels strictly
 * separated (mirroring supabase/functions/_shared/REALTIME.md):
 *
 *   - Authoritative state via Postgres-Changes on `games`: the new
 *     public_state is dispatched into the store as a versioned snapshot. This
 *     is the single source of truth the UI renders.
 *   - Presence on `game:{id}:presence`: lobby roster & disconnects.
 *   - Broadcast on `game:{id}:ui`: ephemeral hover / targeting, never persisted.
 *
 * Command submission is STRICT-WAIT (project decision): submitCommand() posts
 * to the submit-command Edge Function and resolves with accept/reject, but it
 * does NOT apply anything locally — the store updates only when the
 * authoritative Postgres-Changes frame arrives. The UI shows "submitting…"
 * between the two, and a rejection surfaces the engine's structured failure.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CommandDTO, GameStateView } from "@titan/engine";

export interface NetConfig {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
}

export function makeClient(cfg: NetConfig): SupabaseClient {
  return createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
}

export type SubmitResult =
  | { readonly ok: true; readonly version: number }
  | { readonly ok: false; readonly code: string; readonly message: string };

/**
 * Submit a command and wait for the server's accept/reject. Does NOT mutate
 * the store directly; the caller dispatches submitStart before and the
 * authoritative snapshot arrives over Realtime. On reject the caller
 * dispatches submitReject with the returned message.
 */
export async function submitCommand(
  client: SupabaseClient,
  gameId: string,
  command: CommandDTO,
): Promise<SubmitResult> {
  const { data, error } = await client.functions.invoke("submit-command", {
    body: { gameId, command },
  });
  if (error) {
    const message =
      typeof error === "object" && error && "message" in error
        ? String((error as { message: unknown }).message)
        : "command failed";
    // Edge Function returns 422 with a structured failure for illegal moves.
    const failure = (data as { failure?: { code?: string } } | null)?.failure;
    return { ok: false, code: failure?.code ?? "ERROR", message };
  }
  const version = (data as { version?: number } | null)?.version ?? 0;
  return { ok: true, version };
}

/**
 * Subscribe a game's three channels and route their traffic into the store via
 * `dispatch`. Returns an unsubscribe function. `onBroadcast` receives ephemeral
 * UI events (hover/targeting) so the renderer can show opponents' attention
 * without going through the authoritative store.
 */
export interface Subscriptions {
  readonly unsubscribe: () => void;
  readonly trackPresence: (state: Record<string, unknown>) => void;
  readonly sendUi: (event: string, payload: Record<string, unknown>) => void;
}

export function subscribeGame(
  client: SupabaseClient,
  gameId: string,
  onSnapshot: (view: GameStateView, version: number) => void,
  onPresence: (members: unknown[]) => void,
  onBroadcast: (event: string, payload: Record<string, unknown>) => void,
): Subscriptions {
  // Authoritative state: row changes on the game's `games` row.
  const stateChannel = client
    .channel(`game:${gameId}:state`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${gameId}` },
      (payload: unknown) => {
        const row = (payload as { new?: { public_state?: GameStateView; version?: number } }).new;
        if (row?.public_state && typeof row.version === "number") {
          onSnapshot(row.public_state, row.version);
        }
      },
    )
    .subscribe();

  // Presence: lobby roster & disconnect.
  const presenceChannel = client
    .channel(`game:${gameId}:presence`, { config: { presence: { key: gameId } } })
    .on("presence", { event: "sync" }, () => {
      const state = presenceChannel.presenceState();
      onPresence(Object.values(state).flat());
    })
    .subscribe();

  // Broadcast: ephemeral hover / targeting arrows.
  const uiChannel = client
    .channel(`game:${gameId}:ui`)
    .on("broadcast", { event: "*" }, (payload: unknown) => {
      const msg = payload as { event?: string; payload?: Record<string, unknown> };
      if (msg.event) onBroadcast(msg.event, msg.payload ?? {});
    })
    .subscribe();

  return {
    unsubscribe: () => {
      void stateChannel.unsubscribe();
      void presenceChannel.unsubscribe();
      void uiChannel.unsubscribe();
    },
    trackPresence: (state) => {
      void presenceChannel.track(state);
    },
    sendUi: (event, payload) => {
      void uiChannel.send({ type: "broadcast", event, payload });
    },
  };
}

/** Fetch the initial authoritative snapshot (e.g. on join / reconnect). */
export async function fetchSnapshot(
  client: SupabaseClient,
  gameId: string,
): Promise<{ version: number; view: GameStateView } | null> {
  const { data, error } = await client
    .from("games")
    .select("public_state, version")
    .eq("id", gameId)
    .single();
  if (error || !data) return null;
  const row = data as { public_state: GameStateView; version: number };
  return { version: row.version, view: row.public_state };
}
