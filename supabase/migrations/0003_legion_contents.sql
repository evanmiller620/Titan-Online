-- 0003_legion_contents.sql
-- THE HIDDEN-INFORMATION BOUNDARY (constraint 5b).
--
-- One row per creature in a legion. This is the ONLY place a legion's actual
-- composition is stored. RLS on this table (migration 0004) is what physically
-- prevents a client from fetching an opponent's creatures: the rows simply are
-- not returned by the database unless the requester owns the legion or the
-- legion has been revealed by an engagement.
--
-- Storing one row per creature (rather than an array column) matters for
-- security: array-level column privileges can't express "you may see the
-- count but not the elements", whereas row-level security trivially returns
-- the rows you may see and withholds the rest. The public height lives in
-- legions.height (0002), which everyone may read; the elements live here,
-- behind RLS.
--
-- `slot_index` keeps creature rows stable/ordered within a legion so the Edge
-- Function can diff precisely on muster/split/strike without ambiguity when a
-- legion holds duplicates (two Ogres).

create table legion_contents (
  game_id    uuid not null references games (id) on delete cascade,
  marker     text not null,
  slot_index int not null,
  creature   text not null,   -- CreatureName, validated by the engine, not SQL
  primary key (game_id, marker, slot_index),
  foreign key (game_id, marker) references legions (game_id, marker) on delete cascade
);

create index legion_contents_game_marker_idx on legion_contents (game_id, marker);

-- NOTE: legion_contents is intentionally NOT added to the realtime
-- publication. Broadcasting per-creature row changes would leak timing/size
-- signals about opponents' hidden stacks. Clients learn contents only by
-- querying (gated by RLS) when they are entitled to, and the public_state /
-- legions height changes they receive over Realtime are sufficient to render.
