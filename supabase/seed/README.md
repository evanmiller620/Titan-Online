# Seed data

The Titan backend needs no static seed: all game content (the 96 Masterboard
lands, 24 creatures, recruit trees, 11 battlelands) lives in the engine as
code-level data (`@titan/engine`), not in the database. The database stores
only per-GAME state.

A fresh game is created by calling the `create_game(initial_public_state)` RPC
(see migration 0006) with the JSON produced by the engine's `createGame()` then
`publicState()`. There is therefore nothing to seed here; this directory is a
placeholder so the migration tooling layout is complete.
