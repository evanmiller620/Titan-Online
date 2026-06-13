/**
 * Lobby (Titan client, ui).
 *
 * Create or join a game and watch the roster fill via Realtime Presence. The
 * initial authoritative state is built by the ENGINE (createGame → publicState)
 * and handed to the create_game RPC, keeping the server's stored shape
 * identical to what the engine produces — one definition of a fresh game.
 *
 * Copy follows the design guidance: an empty roster is an invitation to act,
 * actions are named by what they do ("Create table", "Join").
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createGame, publicState } from "@titan/engine";

export interface LobbyMember {
  readonly userId: string;
  readonly slot: string;
  readonly displayName: string;
}

/**
 * Create a new table seated by the caller. Builds the initial state with the
 * engine so the DB stores exactly what the engine would produce, then calls
 * the create_game RPC. Returns the new game id.
 *
 * NOTE: createGame needs the eventual player roster for caretaker Titan counts,
 * but a lobby starts with one seat and fills over time. We create the engine
 * state with a single founder and the server reconciles the player set as
 * others join (the engine's RollTurnOrder command finalises the roster). For a
 * fixed-size table, pass the full expected roster here instead.
 */
export async function createTable(
  client: SupabaseClient,
  founder: { id: string; name: string },
): Promise<string> {
  const state = createGame({ gameId: crypto.randomUUID(), players: [{ id: "p1", name: founder.name }] });
  const initial = publicState(state);
  const { data, error } = await client.rpc("create_game", { initial_public_state: initial });
  if (error) throw new Error(`could not create table: ${describe(error)}`);
  return String(data);
}

/** Take the next free seat in a lobby game. Returns the assigned slot. */
export async function joinTable(client: SupabaseClient, gameId: string): Promise<string> {
  const { data, error } = await client.rpc("join_game", { p_game_id: gameId });
  if (error) throw new Error(`could not join: ${describe(error)}`);
  return String(data);
}

/** List joinable tables for the lobby browser. */
export async function openTables(
  client: SupabaseClient,
): Promise<Array<{ gameId: string; players: number; createdAt: string }>> {
  const { data, error } = await client.rpc("list_open_games");
  if (error) return [];
  return (data as Array<{ game_id: string; players: number; created_at: string }>).map((r) => ({
    gameId: r.game_id,
    players: r.players,
    createdAt: r.created_at,
  }));
}

function describe(error: unknown): string {
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "unknown error";
}
