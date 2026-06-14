/**
 * Network layer (Titan client, net).
 *
 * The ONLY module that talks to Supabase. In the client-authoritative model
 * the server is a RELAY + STORE, not a referee:
 *
 *   - appendCommand(): hands a command to the relay function, which assigns the
 *     next sequence number and stores it in the append-only command_log.
 *   - subscribeCommands(): the ordered command stream (own + peers') via
 *     Postgres-Changes on command_log — every client replays it locally.
 *   - loadCommandLog(): the persisted log + shared seed to rebuild state on
 *     reconnect (a game survives days away).
 *   - Presence on `game:{id}:presence`: the waiting-room roster.
 *
 * No state is computed here and no rules are checked; the engine lives on each
 * client (game/engine.ts) and stays in sync via the shared seed + ordering.
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

/**
 * Append a command to the shared, ordered log via the relay function. The
 * server does NO rule checking — it only assigns the next sequence number,
 * stores the command (persistence), and lets Realtime broadcast it. Every
 * client validates + executes locally and deterministically.
 */
export async function appendCommand(
  client: SupabaseClient,
  gameId: string,
  command: CommandDTO,
): Promise<{ ok: boolean; seq?: number; message?: string }> {
  const { data, error } = await client.functions.invoke("submit-command", { body: { gameId, command } });
  if (error) {
    const message = typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : "relay failed";
    return { ok: false, message };
  }
  return { ok: true, seq: (data as { seq?: number } | null)?.seq };
}

/** Subscribe to the ordered command stream (own + peers'), in insert order. */
export function subscribeCommands(
  client: SupabaseClient,
  gameId: string,
  onCommand: (command: CommandDTO, seq: number) => void,
): () => void {
  const ch = client
    .channel(`game:${gameId}:log`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "command_log", filter: `game_id=eq.${gameId}` },
      (payload: unknown) => {
        const row = (payload as { new?: { command?: CommandDTO; seq?: number } }).new;
        if (row?.command && typeof row.seq === "number") onCommand(row.command, row.seq);
      },
    )
    .subscribe();
  return () => { void ch.unsubscribe(); };
}

/** Rebuild the inputs to replay a game: the shared seed (derived from the game
 *  id so every client agrees), seat count, and the ordered command log. */
export async function loadCommandLog(
  client: SupabaseClient,
  gameId: string,
): Promise<{ seed: number; seats: number; gameId: string; log: CommandDTO[] }> {
  const { data: game } = await client.from("games").select("public_state").eq("id", gameId).single();
  const players = (game as { public_state?: { players?: Record<string, unknown> } } | null)?.public_state?.players;
  const seats = players ? Object.keys(players).length : 2;
  const { data: rows } = await client.from("command_log").select("command, seq").eq("game_id", gameId).order("seq", { ascending: true });
  const log = ((rows as Array<{ command: CommandDTO }> | null) ?? []).map((r) => r.command);
  return { seed: seedFromGameId(gameId), seats, gameId, log };
}

/** A stable 32-bit seed derived from the game id (FNV-1a) — shared by all. */
export function seedFromGameId(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
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
