-- 0004_rls_policies.sql
-- Row Level Security: the enforcement layer for hidden information.
--
-- Principles:
--  * Enable RLS on every game table. With RLS on and no permissive policy for
--    an action, that action is DENIED. We therefore grant only SELECTs to
--    clients and grant NO direct insert/update/delete to them at all — every
--    mutation goes through the submit-command Edge Function, which connects
--    with the service role (which bypasses RLS) and is the sole writer.
--  * A user may read a game's public data iff they are a player in it (or, for
--    spectator support later, this is where a spectator policy would go).
--  * legion_contents rows are readable iff the requester OWNS the legion OR the
--    legion has been revealed. This is the line the whole design protects.
--
-- Helper: is the current auth.uid() a player in this game?

create or replace function is_game_member(p_game_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from game_players gp
    where gp.game_id = p_game_id
      and gp.user_id = auth.uid()
  );
$$;

-- Helper: the current user's slot in a game (null if not a member).
create or replace function my_slot(p_game_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select gp.slot from game_players gp
  where gp.game_id = p_game_id and gp.user_id = auth.uid()
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- games
-- ---------------------------------------------------------------------------
alter table games enable row level security;
alter table games force row level security;

-- Members may read the public state of their game. (Lobby discovery for games
-- the user has not yet joined is handled by a separate RPC, not blanket read.)
create policy games_select_members on games
  for select using (is_game_member(id));

-- No client INSERT/UPDATE/DELETE policies: all writes are service-role only.

-- ---------------------------------------------------------------------------
-- game_players
-- ---------------------------------------------------------------------------
alter table game_players enable row level security;
alter table game_players force row level security;

-- A user may see the roster of any game they belong to (to render the lobby /
-- turn order), and of course their own membership rows.
create policy game_players_select_members on game_players
  for select using (is_game_member(game_id));

-- ---------------------------------------------------------------------------
-- legions (public metadata)
-- ---------------------------------------------------------------------------
alter table legions enable row level security;
alter table legions force row level security;

-- Members may read all legion METADATA in their game (marker, owner, land,
-- height, revealed). Heights and positions are public information.
create policy legions_select_members on legions
  for select using (is_game_member(game_id));

-- ---------------------------------------------------------------------------
-- legion_contents (THE hidden boundary)
-- ---------------------------------------------------------------------------
alter table legion_contents enable row level security;
alter table legion_contents force row level security;

-- A creature row is visible only if the requester is a member of the game AND
-- (they own the legion OR the legion has been revealed by an engagement).
-- Non-owners querying an unrevealed opponent legion receive ZERO rows — they
-- cannot even count them here; the public count lives in legions.height.
create policy legion_contents_select_owner_or_revealed on legion_contents
  for select using (
    is_game_member(game_id)
    and exists (
      select 1 from legions l
      where l.game_id = legion_contents.game_id
        and l.marker  = legion_contents.marker
        and (
          l.owner_slot = my_slot(legion_contents.game_id)
          or l.revealed = true
        )
    )
  );

-- No client write policies on any table: the Edge Function (service role) is
-- the only writer, which keeps authoritative logic and dice server-side
-- (constraint 5c) and makes client-side cheating structurally impossible.
