-- 0001_games_players.sql
-- Core game tables for the Titan backend.
--
-- ARCHITECTURE (constraint 5: PostgreSQL is the single source of truth).
-- The authoritative GameState produced by the pure engine is split across
-- tables so that Row Level Security can enforce hidden information at the row
-- level:
--
--   games            one row per game. Holds the PUBLIC, redactable portion of
--                    the engine GameState as JSONB (fsm, turn, players,
--                    caretaker, legion METADATA — markers, land, height — and
--                    battle state with combatant identities stripped while
--                    hidden). This column is what every client may read.
--   game_players     membership + seat. Maps an authenticated auth.uid() to a
--                    player slot ("p1"…"p6") in a game. RLS keys off this:
--                    "am I a player in this game, and which slot am I?".
--   legion_contents  (migration 0003) the hidden creature lists, one row per
--                    legion, readable only by the owner or once revealed.
--
-- The engine NEVER runs in the database. The submit-command Edge Function
-- loads the full state (public column + the caller-visible contents), runs the
-- engine, and writes back. Clients never write these tables directly; all RLS
-- write policies are deny-by-default (no policy = no access), and the Edge
-- Function uses the service role to persist.

create extension if not exists "pgcrypto";

create type game_status as enum ('lobby', 'active', 'finished', 'abandoned');

create table games (
  id            uuid primary key default gen_random_uuid(),
  status        game_status not null default 'lobby',
  -- The public, redactable engine state. Opponent legion contents are NOT in
  -- here; only metadata (marker, owner, land, height). See state_view.ts.
  public_state  jsonb not null,
  -- Monotonic version for optimistic concurrency / Realtime reconciliation.
  version       bigint not null default 0,
  created_by    uuid not null references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table game_players (
  game_id    uuid not null references games (id) on delete cascade,
  -- The engine player id / slot, e.g. "p1". Stable for the game's lifetime.
  slot       text not null,
  user_id    uuid not null references auth.users (id),
  seat_index int not null,
  joined_at  timestamptz not null default now(),
  primary key (game_id, slot),
  unique (game_id, user_id),
  unique (game_id, seat_index)
);

create index game_players_user_idx on game_players (user_id);

-- Realtime publishes row changes on `games` so clients reconcile on the
-- authoritative public_state after each command.
alter publication supabase_realtime add table games;
