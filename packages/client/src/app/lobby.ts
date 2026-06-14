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
 * The engine fixes the roster at creation (it needs 2–6 players for the
 * caretaker Titan count and the order roll), so the founder chooses how many
 * seats the table has. The founder takes slot p1 with their name; the rest are
 * placeholder seats p2..pN that real users claim via join_game in seat order.
 * Their display names ride Presence, not the engine roster.
 */
export async function createTable(
  client: SupabaseClient,
  founder: { name: string },
  seats: number,
): Promise<string> {
  if (seats < 2 || seats > 6) throw new Error("a table has 2 to 6 seats");
  const players = Array.from({ length: seats }, (_, i) =>
    i === 0 ? { id: "p1", name: founder.name } : { id: `p${i + 1}`, name: `Player ${i + 1}` },
  );
  const state = createGame({ gameId: crypto.randomUUID(), players });
  const initial = publicState(state);
  const { data, error } = await client.rpc("create_game", { initial_public_state: initial });
  if (error) throw new Error(`could not create table: ${describe(error)}`);
  return String(data);
}


/**
 * Take the next free seat in a lobby game, or RESUME the seat you already hold.
 * Returns the assigned slot.
 *
 * join_game raises "already joined" if this user is already at the table (the
 * founder, a page reload, or a rejoin). That isn't an error from the player's
 * point of view — they just want back into their game — so we look up their
 * existing slot via my_slot() and resume it instead of failing.
 */
export async function joinTable(client: SupabaseClient, gameId: string): Promise<string> {
  const { data, error } = await client.rpc("join_game", { p_game_id: gameId });
  if (!error) return String(data);

  if (/already joined/i.test(describe(error))) {
    const slot = await mySlot(client, gameId);
    if (slot) return slot;
  }
  throw new Error(`could not join: ${describe(error)}`);
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
