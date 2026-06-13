# Titan (digital)

A web adaptation of the Avalon Hill board game **Titan** (1982 ruleset). Built as a
strict-separation monorepo: a pure rules engine, a shared protocol package, a
React + PixiJS client, and a Supabase backend that is the single source of truth.

## Architectural constraints (non-negotiable)

1. **Separation of concerns** — `packages/engine` contains zero UI, zero I/O,
   zero dependencies. Its tsconfig has no DOM lib, so the compiler enforces this.
   It runs identically in the browser (optimistic validation) and in Deno
   (authoritative execution inside Supabase Edge Functions).
2. **Nested FSM** — game loop phases (Commencement → Movement → Engagement →
   Mustering) as the outer machine; the 7-round Battle FSM (Maneuver → Strike →
   Strikeback, with the round-4 defensive muster and post-first-kill Angel
   summon windows) nests under Engagement. One active state; explicit transitions.
3. **Command Pattern** — every player action is a serializable command with
   `validate(state)` and `execute(state, rng)`. Commands are logged append-only.
4. **3D cube coordinates** (`x + y + z = 0`) for all grid math. Offset
   coordinates are forbidden. External labels (community A1–F6 Battleland
   notation, Masterboard land numbers) are mapped to cube exactly once at a
   module's data boundary.
5. **Supabase** — PostgreSQL holds authoritative state; RLS hides opponent
   legion contents until a reveal; Edge Functions own dice and combat math;
   Realtime broadcasts authoritative state, Presence handles lobbies,
   Broadcast handles ephemeral UI (hover, targeting arrows).

## Decisions driven by the rules document

The reference document (`docs/` — see *The Law of Titan* context) forced or
confirmed these choices:

- **Masterboard ≠ hex grid for movement.** The 96 lands connect via directional
  boundary signs (arrows, triple arrows, blocks, thick solid/dotted lines with
  first-step and second-step constraints, and a hard no-backtracking rule).
  Movement therefore runs on a **directed graph with edge metadata and path
  memory** in `masterboard/`, while every land still carries a canonical cube
  coordinate for rendering and validation. Teleportation (Tower teleport,
  Titan-at-400-points teleport) bypasses the graph entirely.
- **Hexside hazards are first-class.** Dunes, Walls and Cliffs live on hex
  *edges*, not hexes — so the pathfinder takes an `edgeBlocked(from, to)`
  predicate, and `DIRECTIONS` order is a public contract used to index
  hexside data.
- **"Slowed" means must-stop.** Bramble/Drift/Sand entry and uphill Slope
  movement end a non-native's move immediately: the pathfinder models this as
  `stopsOnEntry(from, to)` — reachable but never expanded.
- **One canonical map per Battleland, rotated.** Entry side depends on the
  attacker's Masterboard trajectory (left/right/bottom, plus the special Tower
  funnel). `cubeRotateCW/cubeRotateAround` let one map definition serve all
  orientations; the test suite proves rotation is consistent with direction
  indexing so hexside hazards rotate correctly.
- **Corner-grazing LOS.** Rangestrike LOS uses dual ±ε nudged rays; sight is
  clear if either chain is unblocked (matches table practice and Colossus).
- **Carry-over legality** (can't carry damage gained from a positional
  advantage the secondary target doesn't suffer; attacker may *waive* the
  advantage to keep carry rights) is a combat-module concern — noted here so
  the strike command API reserves a `waiveAdvantage` flag from day one.
- **Caretaker stacks are global state.** Creature counts (e.g. 28 Trolls,
  6 Archangels) cap recruitment; the engine state must track the shared pool.
- **Errata source of truth:** Bruno Wolff III's errata (overstack culling
  hierarchy, mutual-Titan-destruction rules, half-point rounding *once* on the
  sum) are in scope for the engine's edge-case handling.
- **Future-proofing (not v1):** Lauer Powers, variant Battlelands (Concept
  I/III, Badlands, Rivers), and chit-based deterministic movement ("Mastery of
  the Board") shaped the data-file format — terrain/hazard tables and recruit
  trees are data, not code, so variants are new data files.

- **Masterboard data is sourced, not invented.** `masterboard/board.data.ts`
  was mechanically converted from the Colossus project's `DefaultMap.xml`
  (the community reference implementation), not transcribed by hand. Land ids
  follow that scheme: Towers 100–600, outer/middle tracks 1–42, tower-ring
  lands 101–142, central summit 1000–6000. Exit signs (ARROWS/ARROW/ARCH/
  BLOCK) are preserved verbatim and drive a directed movement graph; cube
  coordinates are a faithful spatial embedding used only for rendering, never
  for movement legality. The conversion is re-checked by invariant tests
  (96 lands, no dangling exits, distinct cubes, ring populations, summit is a
  one-way refuge), so a bad transcription would fail CI rather than ship.

- **Creatures and recruit trees are sourced from Colossus too.**
  `creatures/stats.data.ts` and `creatures/recruitment.data.ts` are mechanical
  conversions of `DefaultCre.xml` and `DefaultTer.xml`. The 24 creature stat
  blocks cross-check against the caretaker limits independently encoded in
  module 3 (zero mismatch), and the recruit chains are validated against the
  canonical masterchart relationships (e.g. Plains 2 Centaurs→Lion, Jungle
  3 Cyclops→Behemoth). Recruitment is one-step-per-move along each terrain's
  weakest→strongest chain; Tower mustering (Centaur/Gargoyle/Ogre by anyone,
  Warlock via Titan-or-Warlock, Guardian via three-identical-or-Guardian) and
  the Angel@100 / Archangel@500 acquirables are modelled per the rules. The
  Titan's power is stored as a -1 sentinel and computed as 6 + floor(score/100)
  via powerOf(), never read raw.

## Workspace layout

```
packages/engine     pure rules engine (this is where ~80% of tests live)
packages/protocol   zod schemas for commands, redacted views, broadcast msgs
packages/client     React + PixiJS; render/ reads state and draws, never mutates
supabase/           migrations (RLS boundary: legion_contents table),
                    submit-command edge function, seeds
```

## Module status

| # | Module | Status |
|---|--------|--------|
| 1 | `engine/hex` — cube math, line/LOS, movement BFS | ✅ done, 39 tests |
| 2 | `engine/core/fsm` — generic nested FSM + Game/Battle machines | ✅ done, 37 tests |
| 3 | `engine/state` + commands, events, rng — setup & turn flow playable | ✅ done, 27 tests |
| 4 | `engine/masterboard` — 96-land directed graph, movement, teleports | ✅ done, 24 tests |
| 5 | `engine/creatures` — stats, recruit trees, Muster command | ✅ done, 25 tests |
| 6 | `engine/battleland` — maps, hazards, entry | next |
| 7 | `engine/combat` — strikes, carry, rangestrike | planned |
| 8 | Supabase schema + RLS + submit-command | planned |
| 9 | Client | planned |

## Running

Requires Node ≥ 22.6 (the engine runs `.ts` directly via type stripping; no
build step, no test framework dependency).

```bash
cd packages/engine
npm run typecheck   # tsc, strict, no DOM lib
npm test            # node --experimental-strip-types --test
```

On a network-connected machine, `pnpm install` at the root and layer vitest /
@types/node in if preferred — sources don't change.
