#!/usr/bin/env bash
# Vendor the @titan/engine TypeScript source into the Supabase functions tree so
# the Deno edge runtime can resolve `@titan/engine` via the import map.
#
# Why this is needed: Supabase Edge Functions run on Deno, which cannot resolve
# a pnpm workspace package by name. The engine is written with explicit ".ts"
# import extensions throughout, which Deno supports natively, so copying the
# source verbatim and mapping the bare specifier is sufficient — no bundling.
#
# Run from the repo root (the supabase.yml workflow runs it before deploy):
#   bash scripts/vendor-engine-for-deno.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/packages/engine/src"
DEST="$ROOT/supabase/functions/_shared/engine"

rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$SRC/." "$DEST/"
# Engine test files are not needed (and import node:test); never vendor them.
find "$DEST" -name '*.test.ts' -delete 2>/dev/null || true

echo "Vendored engine source → supabase/functions/_shared/engine"
