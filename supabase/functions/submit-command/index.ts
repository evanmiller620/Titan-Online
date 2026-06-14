/**
 * submit-command — the single authoritative entry point for all game actions.
 *
 * Flow (constraint 5: authoritative server logic, server-side dice):
 *   1. Authenticate the caller (Supabase JWT → auth.uid()).
 *   2. Authorize: the caller must be a member of the game, and the command's
 *      playerId must equal the caller's slot (you can only act as yourself).
 *   3. Load the full, unredacted GameState (service role bypasses RLS).
 *   4. Deserialize the command via the engine registry and validate() it
 *      against the current state. Reject with a structured error if illegal.
 *   5. Execute with a FRESH, server-seeded Rng — the only place dice are ever
 *      rolled. The resulting rolls are captured in the domain events.
 *   6. Persist the new state (optimistic-locked on version), append the
 *      command log (public events), and let Realtime broadcast the new
 *      public_state to all clients for reconciliation.
 *
 * The client never sees a die until the server has rolled it; the engine code
 * here is byte-identical to the client's, so client-side "optimistic" runs can
 * never diverge from a legal authoritative outcome — and dice commands simply
 * have no client-side result to forge.
 */

// @ts-ignore — resolved by the Edge bundler to the monorepo engine source.
import {
  deserializeCommand,
  seededRng,
  visibleTo,
  CommandValidationError,
  UnknownCommandError,
  MalformedCommandError,
} from "@titan/engine";
import {
  loadGameState,
  persistGameState,
  VersionConflictError,
  type DbClient,
} from "../_shared/persistence.ts";

// These globals are provided by the Supabase Edge runtime (Deno).
declare const Deno: { env: { get(k: string): string | undefined } };
// @ts-ignore — supabase-js is available in the Edge runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface SubmitBody {
  readonly gameId: string;
  readonly command: { type: string; playerId: string; payload: unknown };
}

// Permissive CORS so the browser client can call this from any origin (the
// Vercel/Pages domain). Lowest-friction setting: allow all origins. Security
// is unaffected — this function still authenticates every request from the
// Authorization bearer token below; CORS only governs which web origins the
// browser will let issue the call.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

/** A cryptographically-seeded Rng seed for this command. */
function freshSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]!;
}

// @ts-ignore — Deno.serve is the Edge entrypoint.
Deno.serve(async (req: Request): Promise<Response> => {
  // Preflight: the browser sends OPTIONS (with no auth) before the real POST.
  // Answer it with the CORS headers and no body, or the actual call is blocked.
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  // --- 1. Authenticate ----------------------------------------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json(401, { error: "missing bearer token" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // A user-scoped client to resolve auth.uid() from the JWT…
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData, error: authErr } = await userClient.auth.getUser();
  if (authErr || !userData?.user) return json(401, { error: "invalid token" });
  const userId = userData.user.id;

  // …and a service-role client for the authoritative read/write (bypasses RLS).
  const db = createClient(supabaseUrl, serviceKey) as unknown as DbClient;

  // --- 2. Parse + authorize ----------------------------------------------
  let body: SubmitBody;
  try {
    body = (await req.json()) as SubmitBody;
  } catch {
    return json(400, { error: "malformed JSON body" });
  }
  if (!body?.gameId || !body?.command) {
    return json(400, { error: "gameId and command are required" });
  }

  // The caller's slot in this game.
  const { data: membership } = await db
    .from("game_players")
    .select("slot")
    .eq("game_id", body.gameId)
    .eq("user_id", userId)
    .single();
  if (!membership) return json(403, { error: "not a player in this game" });

  // You may only issue commands as yourself.
  if (body.command.playerId !== membership.slot) {
    return json(403, {
      error: `command.playerId (${body.command.playerId}) does not match your slot (${membership.slot})`,
    });
  }

  // --- 3. Load authoritative state ---------------------------------------
  let loaded;
  try {
    loaded = await loadGameState(db, body.gameId);
  } catch (e) {
    return json(404, { error: String((e as Error).message) });
  }

  // --- 4. Deserialize + validate -----------------------------------------
  let command;
  try {
    command = deserializeCommand(body.command);
  } catch (e) {
    if (e instanceof UnknownCommandError || e instanceof MalformedCommandError) {
      return json(400, { error: e.message });
    }
    throw e;
  }
  const validation = command.validate(loaded.state);
  if (!validation.ok) {
    return json(422, { error: "illegal command", failure: validation.failure });
  }

  // --- 5. Execute with server-seeded dice --------------------------------
  let result;
  try {
    result = command.execute(loaded.state, seededRng(freshSeed()));
  } catch (e) {
    if (e instanceof CommandValidationError) {
      return json(422, { error: "illegal command", failure: e.failure });
    }
    throw e;
  }

  // --- 6. Persist (optimistic-locked) + log ------------------------------
  const publicEvents = result.events.filter((ev: any) => ev.audience?.kind === "public");
  try {
    const { version } = await persistGameState(
      db,
      body.gameId,
      result.state,
      loaded.version,
      body.command,
      membership.slot,
      publicEvents,
    );
    // The caller gets the events they are entitled to see immediately; other
    // clients reconcile from the Realtime broadcast of public_state.
    const forCaller = visibleTo(result.events, membership.slot);
    return json(200, { version, events: forCaller });
  } catch (e) {
    if (e instanceof VersionConflictError) {
      // The client should refetch state and retry; another command raced.
      return json(409, { error: "version conflict; refetch and retry" });
    }
    throw e;
  }
});
