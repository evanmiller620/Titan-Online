/**
 * submit-command — the RELAY. The server does NO rule checking.
 *
 * New model (client-authoritative): the engine lives with each player. This
 * function's only jobs are to (a) authenticate the caller and confirm they are
 * acting as their own seat, (b) append the command to the ordered, append-only
 * command_log with the next sequence number, and (c) touch the game row so the
 * table stays alive. Realtime broadcasts the new log row; every client then
 * validates + executes it locally and deterministically (shared seed + order).
 *
 * No engine import, no validate(), no execute(), no server dice. Persistence is
 * the command_log itself — a reconnecting client replays it to exact state.
 */

declare const Deno: { env: { get(k: string): string | undefined } };
// @ts-ignore — supabase-js is available in the Edge runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });
}

interface SubmitBody {
  readonly gameId: string;
  readonly command: { type: string; playerId: string; payload: unknown };
}

// @ts-ignore — Deno.serve is the Edge entrypoint.
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json(401, { error: "missing bearer token" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: userData, error: authErr } = await userClient.auth.getUser();
  if (authErr || !userData?.user) return json(401, { error: "invalid token" });
  const userId = userData.user.id;

  const db = createClient(supabaseUrl, serviceKey);

  let body: SubmitBody;
  try { body = (await req.json()) as SubmitBody; } catch { return json(400, { error: "malformed JSON body" }); }
  if (!body?.gameId || !body?.command) return json(400, { error: "gameId and command are required" });

  // Identity only (NOT a rule check): you may act only as your own seat.
  const { data: membership } = await db
    .from("game_players").select("slot").eq("game_id", body.gameId).eq("user_id", userId).single();
  if (!membership) return json(403, { error: "not a player in this game" });
  if (body.command.playerId !== membership.slot) {
    return json(403, { error: `command.playerId (${body.command.playerId}) is not your seat (${membership.slot})` });
  }

  // Append to the ordered log. seq = max(seq)+1; retry once on a race.
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: last } = await db
      .from("command_log").select("seq").eq("game_id", body.gameId)
      .order("seq", { ascending: false }).limit(1).maybeSingle();
    const seq = ((last?.seq as number | undefined) ?? 0) + 1;
    const { error: insErr } = await db.from("command_log").insert({
      game_id: body.gameId, seq, command: body.command, issued_by: membership.slot, events: [],
    });
    if (!insErr) {
      await db.from("games").update({ updated_at: new Date().toISOString() }).eq("id", body.gameId);
      return json(200, { ok: true, seq });
    }
    // Unique-violation on (game_id, seq) means a peer raced us — recompute seq.
  }
  return json(409, { error: "could not assign a sequence; retry" });
});
