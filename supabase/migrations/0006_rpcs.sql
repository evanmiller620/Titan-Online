-- 0006_rpcs.sql
-- Client-callable RPCs for lobby actions that must NOT be raw table inserts
-- (clients have no write policies). These run SECURITY DEFINER with tight,
-- explicit logic. Game ACTIONS still go exclusively through the
-- submit-command Edge Function; these cover only lobby lifecycle.

-- create_game(initial_public_state): create a lobby game owned by the caller,
-- seating them as the first player (slot p1). The initial state is produced by
-- the engine's createGame() on the client/edge and passed in; the DB just
-- stores it. Returns the new game id.
create or replace function create_game(initial_public_state jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  insert into games (status, public_state, created_by)
  values ('lobby', initial_public_state, auth.uid())
  returning id into new_id;

  insert into game_players (game_id, slot, user_id, seat_index)
  values (new_id, 'p1', auth.uid(), 0);

  return new_id;
end;
$$;

-- join_game(game_id): take the next free seat in a lobby game. Slots are
-- p1..p6 by seat order. Rejects full games, non-lobby games, and double-joins.
create or replace function join_game(p_game_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_seat int;
  next_slot text;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  perform 1 from games where id = p_game_id and status = 'lobby' for update;
  if not found then
    raise exception 'game not joinable';
  end if;

  if exists (select 1 from game_players where game_id = p_game_id and user_id = auth.uid()) then
    raise exception 'already joined';
  end if;

  select coalesce(max(seat_index) + 1, 0) into next_seat
  from game_players where game_id = p_game_id;

  if next_seat > 5 then
    raise exception 'game full (max 6 players)';
  end if;

  next_slot := 'p' || (next_seat + 1)::text;
  insert into game_players (game_id, slot, user_id, seat_index)
  values (p_game_id, next_slot, auth.uid(), next_seat);

  return next_slot;
end;
$$;

-- Lobby discovery: list joinable lobby games (id + seat count) without
-- exposing their state. A narrow SECURITY DEFINER view-function so the games
-- SELECT policy can stay member-only.
create or replace function list_open_games()
returns table (game_id uuid, players int, created_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select g.id, count(gp.*)::int, g.created_at
  from games g
  left join game_players gp on gp.game_id = g.id
  where g.status = 'lobby'
  group by g.id
  having count(gp.*) < 6
  order by g.created_at desc;
$$;

grant execute on function create_game(jsonb) to authenticated;
grant execute on function join_game(uuid) to authenticated;
grant execute on function list_open_games() to authenticated;
