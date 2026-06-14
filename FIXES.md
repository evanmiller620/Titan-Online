# Bug fixes — playable gameplay pass

Found by simulating a full game through the engine and reading the deployed
client. Two classes of bug blocked real play; both are fixed and covered by
new tests.

## 1. Engine: the Engagement phase soft-locked the game (critical)

The Game FSM defined `Turn.Engagement.{Choosing, Negotiation}` and the events
to move through them, but **no command fired those events**. The instant two
enemy legions shared a Land, `EndMovement` stepped into
`Turn.Engagement.Choosing` and there was no legal command to continue — a hard
freeze. (The 207 existing engine tests never drove a real engagement to
completion, so it slipped through.)

**Fix:** added `SelectEngagementCommand` and `ResolveEngagementCommand`
(`packages/engine/src/core/commands/engagement.ts`):

- `SelectEngagement` — the moving player picks the next contested Land →
  `Negotiation`.
- `ResolveEngagement` — settles it (`flee` / `concede`): the defending legion is
  removed, its creatures return to the caretaker pool, the attacker scores the
  legion's point value and holds the ground. Losing a Titan-bearing legion
  eliminates the player; the last player standing ends the game.

Wired in: `turn.engagementLand` state, the `EngagementSelected` /
`EngagementResolved` / `PlayerEliminated` / `GameEnded` events, two validation
codes, and registry registration (so the Edge Function deserializes them).
Three new tests in `packages/engine/test/engagement.test.ts` prove a contested
Land resolves, play continues on a non-fatal loss, and the game ends on a Titan
loss. **Engine: 210/210 tests.**

A self-inflicted ordering bug was caught during the fix: firing `GAME_ENDED`
before the engagement transition threw `IllegalTransitionError` from the
terminal `GameOver` state. Reordered so the engagement FSM advances first, then
elimination/game-end is evaluated.

## 2. Client: the table was barely playable

The deployed multiplayer view had a single button — "Roll turn order" — and no
UI for any later phase. After the first roll the game dead-ended.

**Fix:** a pure, phase-driven action builder
(`packages/client/src/app/actions.ts`) returns the legal command DTOs for every
phase (tower/colour selection, the one-click 4/4 split, movement roll + a
two-tap legion→destination move, engagement resolution, recruit/end-turn). The
multiplayer view (`packages/client/src/app/multiplayer.ts`) now renders a full
command bar from it, with board taps selecting a legion then a destination.

The builder is unit-tested against the real engine
(`packages/client/test/actions.test.ts`) — every offered DTO is applied to the
authoritative engine to prove it's legal, not just plausible. **Client: 19/19
tests.**

## Verification

- Engine: `tsc` clean, 210 tests pass.
- Client: offline + logic `tsc` clean, 19 tests pass.
- Full 3-turn game simulation runs with zero rejected commands.
- The new commands flow through `deserializeCommand`, so the vendored-engine
  Edge Function accepts them with no backend changes.

## 3. More end-to-end tests + UX polish

**End-to-end gameplay tests** (`packages/engine/test/e2e.test.ts`, with a
reusable driver in `test/_harness.ts`): complete multi-turn games; games at
every player count 2–6 (setup, towers, colours, starting legions, one full
round each); turn rotation following the roll order with correct wrapping;
recruiting inside a real turn (height grows, caretaker pool decrements,
once-per-turn enforced); two engagements resolved in sequence within one turn;
losing the Titan ending the game; the turn-1 mulligan (re-rolls once, then
unavailable, and unavailable after turn 1); hidden-information redaction holding
from both viewpoints across a whole game; and negative paths (out-of-turn /
out-of-phase commands refused, not silently applied). **Engine: 225 tests**
(up from 210).

The harness reads the engine's own state (whose turn, which legions, legal
destinations, actual marker colours) rather than hard-coding, so a change in
board data can't silently invalidate a test. Two tests initially hard-coded a
"Red" opponent; fixed to read the opponent's real marker/tower from state.

**UX polish** (`multiplayer.ts`, `MasterboardRenderer.ts`):

- **Legal-target highlighting.** The board now haloes a selected legion's
  reachable lands during Movement and all contested lands during Engagement, in
  verdigris — so players see where they can go at a glance instead of guessing.
- **A live scoreboard** in the side panel: each player's banner-colour dot,
  score, active-turn ring, "(you)" marker, and a dimmed "— out" for eliminated
  players.
- **A clearer turn banner** ("Your move" in oxblood vs "<player>'s move",
  phase, turn number) and phase-specific help copy that points at the glowing
  targets.
- **A game-over treatment**: a "Victory" / "<player> wins" banner with flavour.
- **Action hints** surfaced beneath buttons (e.g. why End-splits is gated).

New client coverage asserts the highlight helpers match the engine's own legal
destinations and contested lands. **Client: 20 tests.**
