# Deploying Titan

This guide takes you from a fresh clone to a deployed game: the **Supabase
backend** (database, security policies, and the authoritative command function)
and the **web client** (hosted on Vercel or GitHub Pages).

There are two things to deploy, and they are independent:

| Piece | What it is | Where it runs |
| --- | --- | --- |
| **Backend** | Postgres schema + RLS + the `submit-command` edge function | Your Supabase project |
| **Client** | The React + PixiJS app (and the zero-config live preview) | Vercel, GitHub Pages, or any static host |

You can deploy the client on its own to see the **live board preview** with no
backend at all. Online multiplayer needs the backend wired up too.

---

## Prerequisites

- **Node 22+** and **pnpm 9+** (`npm install -g pnpm`)
- A **Supabase** account (free tier is fine) and the
  [Supabase CLI](https://supabase.com/docs/guides/cli) for backend deploys
- A **Vercel** account *or* a GitHub repository with Pages enabled

Install dependencies once from the repo root:

```bash
pnpm install
```

Commit the generated `pnpm-lock.yaml` — it makes CI and host builds
reproducible.

---

## 1. Set up the Supabase backend

### 1a. Create the project

1. In the Supabase dashboard, create a new project. Note its **project URL**
   (e.g. `https://abcd1234.supabase.co`) and **project ref** (the `abcd1234`
   subdomain).
2. From **Project Settings → API**, copy the **anon public** key. This key is
   meant to ship in client apps; Row Level Security protects your data. Do **not**
   copy the `service_role` key into anything client-side — it bypasses RLS and
   belongs only in the edge function's server environment, which Supabase sets
   for you automatically.

### 1b. Apply the database schema

The migrations in `supabase/migrations/` create the games, players, legions,
hidden `legion_contents`, command log, RLS policies, and lobby RPCs.

```bash
supabase login                       # opens a browser to authenticate
supabase link --project-ref <your-project-ref>
supabase db push                     # applies all migrations in order
```

### 1c. Deploy the command function

All game actions flow through one authoritative edge function,
`submit-command`. Because the edge runtime is Deno (which can't resolve the
pnpm workspace package by name), vendor the engine source first — it's written
with Deno-compatible `.ts` imports, so this is a copy, not a build:

```bash
bash scripts/vendor-engine-for-deno.sh
supabase functions deploy submit-command --import-map supabase/functions/import_map.json
```

That's the whole backend. Dice and combat resolution run here, server-side; the
client never rolls authoritative dice.

> **Automate it.** The included `.github/workflows/supabase.yml` runs all of the
> above on any push that touches `supabase/**` or `packages/engine/**`. Add two
> repository **secrets** under *Settings → Secrets and variables → Actions*:
> `SUPABASE_ACCESS_TOKEN` (a personal access token from your Supabase account)
> and `SUPABASE_PROJECT_REF`.

---

## 2. Configure the client environment

The client reads two **public** build-time variables. Copy the example and fill
them in for local development:

```bash
cp packages/client/.env.example packages/client/.env.local
```

```ini
VITE_SUPABASE_URL=https://abcd1234.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...   # the anon public key from step 1a
```

Leaving these **unset** is valid: the app then serves the zero-config **live
preview** (the Masterboard rendered locally from the engine). Setting them
enables the multiplayer client.

---

## 3. Deploy the client

### Option A — Vercel (recommended)

Vercel serves at the domain root, so there's no base-path configuration.

1. Import the repository in Vercel. The root [`vercel.json`](../vercel.json)
   already sets the build:
   - Install: `pnpm install`
   - Build: `pnpm --filter @titan/client build`
   - Output: `packages/client/dist`
2. Under **Settings → Environment Variables**, add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (from step 1a) for the Production environment.
3. Deploy. Every push to the default branch redeploys automatically.

### Option B — GitHub Pages

Pages project sites are served under `/<repo>/`, which the build accounts for
via `VITE_BASE`.

1. In the repository, go to **Settings → Pages** and set **Source** to
   *GitHub Actions*.
2. *(Optional, for multiplayer)* add repository **variables** under *Settings →
   Secrets and variables → Actions → Variables*: `SUPABASE_URL` and
   `SUPABASE_ANON_KEY`. Leave them out to publish the preview only.
3. Push to `main`. The [`pages.yml`](../.github/workflows/pages.yml) workflow
   builds with the correct base path and publishes. Your site appears at
   `https://<user>.github.io/<repo>/`.

### Option C — any static host

```bash
pnpm --filter @titan/client build      # → packages/client/dist
```

Serve `packages/client/dist` from any static host. Set `VITE_BASE` at build
time if the site is served from a sub-path.

---

## 4. Testing online

**The live preview** — open the deployed URL. You should see the Masterboard
wheel with six legions as wax-seal markers (banner colour + height pips, never
contents). This needs no backend and confirms the client built and shipped
correctly.

**The backend** — with the client env configured against your Supabase project:

- Open the app in two browsers (or a normal and a private window) and sign in as
  two different users, so each holds a distinct seat.
- Create a table in one, join from the other. The lobby roster updates live via
  Realtime Presence.
- Take an action. It posts to `submit-command`; the authoritative result
  broadcasts back and both clients reconcile to the same version. Because the
  client is **strict-wait**, the board only advances when the server's snapshot
  arrives — there's no optimistic local state to diverge.
- Confirm hidden information holds: a legion you don't own shows its height but
  never its contents, because the `legion_contents` RLS policy returns zero rows
  to non-owners. (You can verify directly in the Supabase SQL editor: querying
  `legion_contents` as another user returns nothing for unrevealed legions.)

**Health checks if something's off:**

- *Preview is blank* — check the host build log; confirm the output directory is
  `packages/client/dist` and (for Pages) that `VITE_BASE` matches the repo name.
- *"Set VITE_SUPABASE_URL…" message* — the client built without env vars; add
  them in the host settings and redeploy.
- *Commands rejected with 401/403* — the user isn't authenticated or isn't a
  member of that game; check Supabase Auth is enabled and the player joined.
- *Commands time out / 500* — check the function logs in the Supabase dashboard;
  the most common cause is forgetting to vendor the engine before deploy.

---

## 5. Local development

```bash
pnpm install
pnpm --filter @titan/client dev        # Vite dev server at http://localhost:5173
```

Run the backend locally with the Supabase CLI if you want a full local loop:

```bash
supabase start                         # local Postgres + edge runtime in Docker
supabase db reset                      # apply migrations to the local db
bash scripts/vendor-engine-for-deno.sh
supabase functions serve submit-command --import-map supabase/functions/import_map.json
```

Point `packages/client/.env.local` at the local Supabase URL/anon key that
`supabase start` prints.

### Tests and type-checking

```bash
pnpm -r test                           # engine + client test suites
pnpm --filter @titan/engine typecheck  # strict engine type-check
pnpm --filter @titan/client typecheck  # full client type-check (needs deps installed)
```

CI (`.github/workflows/ci.yml`) runs the engine type-check and tests, the
client's pure-logic type-check and tests, and a client build on every push and
PR.

---

## How it fits together (and why it's safe)

- **One rules engine, two runtimes.** `@titan/engine` is pure TypeScript with no
  I/O. The browser imports it for rendering and input validation; the edge
  function imports the *same source* for authoritative execution. They cannot
  drift because there is one implementation.
- **The server owns truth and dice.** Clients never write the database directly
  — there are no client write policies. Every action goes through
  `submit-command`, which validates against the engine, rolls dice with a
  server-seeded RNG, and writes the new state under an optimistic version lock.
- **Hidden information is enforced, not just hidden in the UI.** A legion's
  creatures live one row per creature in `legion_contents`, and the RLS policy
  returns those rows only to the owner or once a legion is revealed in battle.
  The engine mirrors the exact same redaction before any state is broadcast, so
  the public snapshot the client renders already has opponents' contents
  stripped.
- **Realtime is layered.** Authoritative state rides Postgres changes; lobby
  presence and disconnects ride Presence; ephemeral cues (hover, targeting) ride
  Broadcast and are never persisted. `legion_contents` is deliberately kept off
  the realtime publication so stack sizes never leak.

---

## Deployment checklist

- [ ] `pnpm install` succeeds; `pnpm-lock.yaml` committed
- [ ] Supabase project created; URL, ref, and anon key noted
- [ ] `supabase db push` applied all migrations
- [ ] `submit-command` deployed (engine vendored first)
- [ ] Client env vars set in the host (Vercel env / Pages variables)
- [ ] Deployed URL shows the live board preview
- [ ] Two-user multiplayer test passes; hidden contents stay hidden
