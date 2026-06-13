-- 0005_command_log.sql
-- Append-only command log: every command the engine accepted, in order.
--
-- Purpose:
--  * Replay — rebuild any game's state from createGame + the ordered log
--    (the engine is deterministic given the recorded dice; see below).
--  * Reconnection catch-up — a client that missed Realtime frames can fetch
--    log entries after its last-seen sequence.
--  * Audit / anti-cheat — the authoritative record of who did what.
--
-- Determinism note: the engine's only nondeterminism is the injected Rng. The
-- Edge Function seeds a fresh Rng per command and records the resulting rolls
-- inside `events` (the engine surfaces them in domain events like
-- StrikeResolved / MovementRolled). Replaying therefore reads dice from the
-- log rather than re-rolling, so a replay reproduces the exact game.

create table command_log (
  game_id   uuid not null references games (id) on delete cascade,
  -- Per-game monotonic sequence; matches games.version after applying.
  seq       bigint not null,
  -- The command DTO exactly as the engine registry (de)serializes it.
  command   jsonb not null,
  -- The player slot that issued it (already authorized by the function).
  issued_by text not null,
  -- The domain events the engine emitted (the dice live here for replay).
  events    jsonb not null,
  created_at timestamptz not null default now(),
  primary key (game_id, seq)
);

alter table command_log enable row level security;
alter table command_log force row level security;

-- Members may read their game's log. NOTE: events may contain owner-scoped
-- entries (e.g. LegionSplitDetail). The Edge Function stores only the
-- PUBLIC-audience events here; owner-only detail is delivered to the owner via
-- the public_state redaction and direct legion_contents queries, never logged
-- in a member-readable table. (A separate, service-role-only private log could
-- retain full detail for audit; omitted in v1.)
create policy command_log_select_members on command_log
  for select using (is_game_member(game_id));

alter publication supabase_realtime add table command_log;
