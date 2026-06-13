# Realtime: Presence & Broadcast (constraint 5d)

Realtime in this project carries three kinds of traffic, deliberately separated
so that authoritative state never travels on an ephemeral channel and vice
versa.

## 1. Authoritative state — Postgres Changes (not in this file)

Clients subscribe to row changes on `games`, `legions`, and `command_log`
(the tables added to the `supabase_realtime` publication in the migrations).
After the `submit-command` Edge Function writes the new `public_state`, the
change is broadcast and every client reconciles its local snapshot. This is the
**only** source of truth for game state on the client. `legion_contents` is
intentionally **excluded** from the publication so per-creature changes never
leak timing/size signals about hidden stacks.

## 2. Presence — lobbies & disconnect detection

Each game uses a Presence channel keyed by game id:

```
channel: `game:{gameId}:presence`
state:   { userId, slot, displayName, lastSeen }
```

- Joining the lobby tracks the player's presence; leaving (or a dropped socket)
  fires a Realtime `leave` event so the UI can show "Brown disconnected".
- Presence is **advisory only** — it never gates game rules. A disconnected
  player's turn is still governed by the FSM and the (future) turn-timer; the
  authoritative state in Postgres is unaffected by presence.

## 3. Broadcast — ephemeral UI (never persisted)

Transient interaction hints ride a Broadcast channel and are **never** written
to the database:

```
channel: `game:{gameId}:ui`
events:
  - "hover"        { slot, hex|land }        a player hovering a hex/land
  - "targeting"    { slot, from, to }        a targeting arrow being dragged
  - "ping"         { slot, hex|land }         a map ping
```

These are pure presence-of-attention signals for a livelier table feel. They
carry no hidden information (a hover over your own legion reveals only the hex,
which is already public) and are dropped on disconnect with no state impact.

## Why the split matters

- **Security:** hidden information lives only behind RLS (`legion_contents`),
  reconciled via the redacted `public_state`. Ephemeral channels can be noisy
  and lossy without ever risking a leak, because nothing secret is on them.
- **Correctness:** because the client only ever *applies* the authoritative
  `public_state` (strict-wait v1, per the project decision), a missed Broadcast
  message is cosmetic, and a missed Postgres-change frame is recovered by
  refetching `public_state` + replaying `command_log` from the last seen `seq`.
