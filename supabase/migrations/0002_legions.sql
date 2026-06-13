-- 0002_legions.sql
-- Public legion METADATA, one row per legion on the Masterboard.
--
-- This is the deliberately public face of a legion: its marker (identity),
-- owner, current Land, and HEIGHT (creature count) — everything an opponent is
-- entitled to see. The actual creature list is hidden in legion_contents
-- (0003) under RLS.
--
-- This table is partly redundant with the `legions` object inside
-- games.public_state, and that is intentional: the JSONB column is what the
-- engine round-trips, while these typed rows give the database (and RLS on
-- legion_contents) a normalized anchor — a foreign-key target and a place to
-- index/query legions without parsing JSON. The Edge Function keeps the two in
-- sync inside one transaction.

create table legions (
  game_id   uuid not null references games (id) on delete cascade,
  marker    text not null,                 -- e.g. "Black-01"; the legion id
  owner_slot text not null,                -- engine player slot, e.g. "p1"
  land      int not null,                  -- Masterboard land id
  height    int not null check (height between 0 and 7),
  -- Once an engagement forces a reveal, contents become public to both
  -- engaged players for the remainder of the game (slain creatures are public
  -- knowledge). This flag is read by the legion_contents RLS policy.
  revealed  boolean not null default false,
  primary key (game_id, marker),
  foreign key (game_id, owner_slot) references game_players (game_id, slot)
);

create index legions_game_idx on legions (game_id);
create index legions_land_idx on legions (game_id, land);

alter publication supabase_realtime add table legions;
