/**
 * Shared persistence adapters for the Titan Edge Functions (Deno runtime).
 *
 * The engine is imported as source from the monorepo: these functions run the
 * SAME `@titan/engine` code that the browser and the Node tests run, so there
 * is exactly one implementation of the rules. (In deployment the engine is
 * vendored/bundled next to the function; the import path below is resolved by
 * the bundler. Logic, not the import mechanics, is what this module owns.)
 *
 * Responsibilities:
 *  - load(): rebuild the FULL, unredacted GameState for the engine from the
 *    normalized tables — public_state JSONB plus every legion's contents from
 *    legion_contents (the function uses the service role, so RLS does not hide
 *    contents from it; the server is allowed to see everything).
 *  - persist(): write the new authoritative state back atomically — bump
 *    version, replace the public_state, upsert legion metadata + contents,
 *    append the command-log row (public events only). Caller wraps in a tx.
 *
 * No game rules live here. This is pure marshalling between the engine's
 * GameState shape and the relational tables.
 */

// @ts-ignore — resolved by the Edge bundler to the monorepo engine source.
import type { GameState } from "@titan/engine";
// @ts-ignore
import { publicState } from "@titan/engine";

export interface DbClient {
  // Minimal surface we need; in deployment this is the supabase-js client
  // created with the service-role key.
  from(table: string): any;
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: any; error: any }>;
}

/**
 * Rebuild the engine's full GameState from storage. public_state already has
 * the correct shape MINUS hidden contents; we re-attach every legion's
 * creatures from legion_contents (ordered by slot_index) to restore the
 * authoritative truth the engine needs.
 */
export async function loadGameState(db: DbClient, gameId: string): Promise<{
  state: GameState;
  version: number;
}> {
  const { data: game, error: gErr } = await db
    .from("games")
    .select("public_state, version")
    .eq("id", gameId)
    .single();
  if (gErr || !game) throw new Error(`game ${gameId} not found: ${gErr?.message}`);

  const { data: contents, error: cErr } = await db
    .from("legion_contents")
    .select("marker, slot_index, creature")
    .eq("game_id", gameId)
    .order("marker", { ascending: true })
    .order("slot_index", { ascending: true });
  if (cErr) throw new Error(`contents load failed: ${cErr.message}`);

  // public_state.legions has metadata but redacted/absent creatures; re-attach.
  const state = game.public_state as GameState;
  const byMarker = new Map<string, string[]>();
  for (const row of contents ?? []) {
    const arr = byMarker.get(row.marker) ?? [];
    arr[row.slot_index] = row.creature;
    byMarker.set(row.marker, arr);
  }
  const legions: Record<string, any> = {};
  for (const [marker, legion] of Object.entries(state.legions)) {
    legions[marker] = {
      ...(legion as object),
      creatures: (byMarker.get(marker) ?? []).filter((c) => c !== undefined),
    };
  }
  return { state: { ...state, legions }, version: game.version };
}

/**
 * Persist the new authoritative state. Caller must run inside a transaction
 * (the deploy wrapper uses a Postgres function `apply_command_tx`; here we
 * express the steps). `expectedVersion` guards optimistic concurrency.
 */
export async function persistGameState(
  db: DbClient,
  gameId: string,
  newState: GameState,
  expectedVersion: number,
  command: unknown,
  issuedBy: string,
  publicEvents: unknown[],
): Promise<{ version: number }> {
  const nextVersion = expectedVersion + 1;

  // 1. Compare-and-set the public state + version (optimistic lock).
  const redacted = publicState(newState);
  const { data: updated, error: uErr } = await db
    .from("games")
    .update({ public_state: redacted, version: nextVersion, updated_at: new Date().toISOString() })
    .eq("id", gameId)
    .eq("version", expectedVersion) // CAS: fails if another command raced us
    .select("version")
    .single();
  if (uErr || !updated) {
    throw new VersionConflictError(gameId, expectedVersion);
  }

  // 2. Re-sync legion metadata + contents from the authoritative state.
  await syncLegions(db, gameId, newState);

  // 3. Append the command-log row (public events only).
  const { error: lErr } = await db.from("command_log").insert({
    game_id: gameId,
    seq: nextVersion,
    command,
    issued_by: issuedBy,
    events: publicEvents,
  });
  if (lErr) throw new Error(`command_log insert failed: ${lErr.message}`);

  return { version: nextVersion };
}

/** Replace the legion metadata + contents rows to match `state`. */
async function syncLegions(db: DbClient, gameId: string, state: GameState): Promise<void> {
  // Upsert metadata rows.
  const legionRows = Object.values(state.legions).map((l: any) => ({
    game_id: gameId,
    marker: l.marker,
    owner_slot: l.ownerId,
    land: l.land,
    height: l.creatures.length,
    revealed: l.revealed === true,
  }));
  // Delete legions no longer present (eliminated), then upsert the rest.
  const markers = legionRows.map((r) => r.marker);
  await db.from("legions").delete().eq("game_id", gameId).not("marker", "in", `(${markers.map((m) => `"${m}"`).join(",")})`);
  if (legionRows.length > 0) {
    await db.from("legions").upsert(legionRows, { onConflict: "game_id,marker" });
  }

  // Rewrite contents for every legion (simple + correct; volumes are tiny:
  // at most 12 legions × 7 creatures per player).
  await db.from("legion_contents").delete().eq("game_id", gameId);
  const contentRows: Array<Record<string, unknown>> = [];
  for (const l of Object.values(state.legions) as any[]) {
    l.creatures.forEach((creature: string, slot_index: number) => {
      contentRows.push({ game_id: gameId, marker: l.marker, slot_index, creature });
    });
  }
  if (contentRows.length > 0) {
    await db.from("legion_contents").insert(contentRows);
  }
}

export class VersionConflictError extends Error {
  constructor(gameId: string, expected: number) {
    super(`version conflict on game ${gameId}: expected ${expected}`);
    this.name = "VersionConflictError";
  }
}
