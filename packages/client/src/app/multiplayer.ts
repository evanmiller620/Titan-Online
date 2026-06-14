/**
 * Multiplayer entry (Titan client, app).
 *
 * The database-backed client, booted by entry.ts when VITE_SUPABASE_URL and
 * VITE_SUPABASE_ANON_KEY are present. This is the "wire + minimal game view"
 * scope (see docs/DEPLOYMENT.md): a room-code + username lobby, then a live
 * Masterboard that renders the AUTHORITATIVE snapshot and advances over
 * Realtime. It reuses the same net / store / render layers as the full client,
 * driven imperatively in the proven style of preview.ts (no React mount).
 *
 * Auth note: there are no passwords. We sign in ANONYMOUSLY to mint the JWT the
 * RLS policies and lobby RPCs require (every seat needs a real auth.uid()); the
 * username is a display label carried on Presence, and the "room code" is the
 * game id returned by create_game. Enable Anonymous sign-ins in the Supabase
 * dashboard (Authentication → Providers) for this to work.
 */

import { Application } from "pixi.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommandDTO } from "@titan/engine";
import { makeClient, submitCommand, subscribeGame, fetchSnapshot } from "../net/supabase.ts";
import { createTable, joinTable } from "./lobby.ts";
import {
  initialStore,
  reduce,
  phaseLabel,
  activeSlot,
  type StoreState,
} from "../store/gameStore.ts";
import { MasterboardRenderer } from "../render/MasterboardRenderer.ts";
import { actionsFor, isViewersMove, terrainOf, moveDestinations, engagementLands, type Selection } from "./actions.ts";
import { createDebugPanel } from "../ui/DebugPanel.ts";
import { palette, tokensCss, type as typ, space } from "../ui/tokens.ts";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/** Banner colours for the scoreboard dots (mirrors the renderer's seals). */
const SLOT_HEX: Record<string, string> = {
  Black: "#26221E",
  Brown: "#6B4A2B",
  Blue: "#2C4A6B",
  Gold: "#B08D57",
  Green: "#3E6B45",
  Red: "#8E3247",
};

/** Inject the token :root block once (mirrors preview.ts). */
function injectTokens(): void {
  const style = document.createElement("style");
  style.textContent = tokensCss();
  document.head.appendChild(style);
}

/** Entry called by entry.ts when Supabase env vars are present. */
export function startMultiplayer(supabaseUrl: string, supabaseAnonKey: string): void {
  injectTokens();
  const client = makeClient({ supabaseUrl, supabaseAnonKey });
  renderLobby(client);
}

/**
 * Ensure we hold a Supabase session. With no email/password flow we use
 * anonymous auth, which yields a real `auth.uid()` so the lobby RPCs and RLS
 * accept us. A clear message points the operator at the one project setting
 * this needs if it's off.
 */
async function ensureAuth(client: SupabaseClient): Promise<void> {
  const { data } = await client.auth.getSession();
  if (data.session) return;
  const { error } = await client.auth.signInAnonymously();
  if (error) {
    throw new Error(
      `Sign-in failed: ${error.message}. Enable "Anonymous sign-ins" in ` +
        "Supabase → Authentication → Providers, then reload.",
    );
  }
}

// ---------------------------------------------------------------------------
// Lobby screen — username + room code
// ---------------------------------------------------------------------------

function renderLobby(client: SupabaseClient): void {
  const root = document.getElementById("root");
  if (!root) throw new Error("missing #root mount");
  root.innerHTML = "";
  root.style.cssText = `min-height:100vh;display:grid;place-items:center;background:${palette.vellum};`;

  const card = node(
    "div",
    [
      "width:min(440px,92vw)",
      "padding:32px 34px",
      `background:${palette.vellumDeep}`,
      `border:1px solid ${palette.brass}`,
      "border-radius:3px",
      `font-family:${typ.body}`,
      `color:${palette.ink}`,
      "box-shadow:0 8px 36px rgba(28,26,23,0.20)",
    ],
    [
      `<div style="font-family:${typ.mono};font-size:${typ.scale.xs};letter-spacing:.18em;text-transform:uppercase;color:${palette.verdigris}">Multiplayer table</div>`,
      `<h1 style="font-family:${typ.display};font-size:${typ.scale.xl};color:${palette.oxblood};margin:4px 0 18px;line-height:1.1">Titan</h1>`,
    ].join(""),
  );

  const name = field("Your name", "text", "e.g. Aurelia");
  const seats = seatSelect();
  const code = field("Room code", "text", "paste a code to join");
  const status = node("p", [
    `font-size:${typ.scale.sm}`,
    `color:${palette.inkSoft}`,
    "min-height:18px",
    "margin:14px 0 0",
    "line-height:1.4",
  ]);

  const createBtn = button("Create table", palette.oxblood);
  const joinBtn = button("Join", palette.verdigris);
  const row = node("div", ["display:flex", "gap:10px", "margin-top:20px"]);
  row.append(createBtn, joinBtn);

  card.append(name.wrap, seats.wrap, code.wrap, row, status);
  root.appendChild(card);

  const busy = (on: boolean, msg = "") => {
    createBtn.disabled = on;
    joinBtn.disabled = on;
    status.textContent = msg;
    status.style.color = palette.inkSoft;
  };
  const fail = (msg: string) => {
    createBtn.disabled = false;
    joinBtn.disabled = false;
    status.textContent = msg;
    status.style.color = palette.alarm;
  };

  createBtn.onclick = async () => {
    const username = name.input.value.trim();
    if (!username) return fail("Enter a name first.");
    busy(true, "Creating the table…");
    try {
      await ensureAuth(client);
      // The engine fixes the roster now, so the founder picks the seat count;
      // create_game seats the founder as slot p1 (migration 0006).
      const gameId = await createTable(client, { name: username }, seats.value());
      void startGame(client, gameId, "p1", username);
    } catch (e) {
      fail(message(e));
    }
  };

  joinBtn.onclick = async () => {
    const username = name.input.value.trim();
    const roomCode = code.input.value.trim();
    if (!username) return fail("Enter a name first.");
    if (!roomCode) return fail("Paste the room code you were given.");
    busy(true, "Joining…");
    try {
      await ensureAuth(client);
      const slot = await joinTable(client, roomCode);
      void startGame(client, roomCode, slot, username);
    } catch (e) {
      fail(message(e));
    }
  };
}

// ---------------------------------------------------------------------------
// Game view — live authoritative board + a minimal command bar
// ---------------------------------------------------------------------------

async function startGame(
  client: SupabaseClient,
  gameId: string,
  slot: string,
  username: string,
): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("missing #root mount");
  root.innerHTML = "";
  root.style.cssText = "position:absolute;inset:0;display:flex;";

  // Debug inspector docks on the LEFT; board centre; command panel right.
  const debug = createDebugPanel();
  const boardEl = node("div", ["position:relative", "flex:1", "min-width:0"]);
  const panel = node("aside", [
    "width:300px",
    "flex:0 0 300px",
    "padding:22px",
    `background:${palette.vellumDeep}`,
    `border-left:1px solid ${palette.brass}`,
    `font-family:${typ.body}`,
    `color:${palette.ink}`,
    "overflow:auto",
  ]);
  root.append(debug.el, boardEl, panel);

  // Persistent panel fields, updated on each dispatch (so the roll button keeps
  // its listener across re-renders).
  const roomLine = panel.appendChild(
    node("div", [`font-family:${typ.mono}`, `font-size:${typ.scale.xs}`, "word-break:break-all", "margin-bottom:14px"]),
  );
  roomLine.innerHTML =
    `<div style="letter-spacing:.16em;text-transform:uppercase;color:${palette.verdigris};margin-bottom:4px">Room code — share to invite</div>` +
    `<div style="color:${palette.ink}">${escape(gameId)}</div>`;

  const seatLine = panel.appendChild(node("div", [`font-size:${typ.scale.sm}`, "margin-bottom:6px"]));
  seatLine.innerHTML = `<strong>${escape(username)}</strong> · seat ${escape(slot)}`;
  const phaseLine = panel.appendChild(node("div", [`font-size:${typ.scale.sm}`, "margin-bottom:6px"]));
  const rosterLine = panel.appendChild(node("div", [`font-size:${typ.scale.sm}`, `color:${palette.inkSoft}`, "margin-bottom:16px"]));

  // Live scoreboard — every player's banner colour, score, and standing.
  const scoreEl = panel.appendChild(node("div", ["margin-bottom:16px"]));

  // The command bar (phase-driven buttons) and a contextual help line.
  const barEl = panel.appendChild(node("div", ["display:flex", "flex-direction:column", "gap:8px", "margin-top:4px"]));
  const helpLine = panel.appendChild(
    node("p", [`font-size:${typ.scale.xs}`, `color:${palette.inkSoft}`, "min-height:16px", "margin:10px 0 0", "line-height:1.4"]),
  );
  const statusLine = panel.appendChild(
    node("p", [`font-size:${typ.scale.sm}`, "min-height:18px", "margin:12px 0 0", "line-height:1.4", `color:${palette.inkSoft}`]),
  );

  // --- imperative store + board (the React-free equivalent of useGame) ------
  let store: StoreState = reduce(initialStore, { type: "setViewer", slot });
  let roster: string[] = [];
  // Two-tap spatial selection for movement / engagement: first tap a legion,
  // then a destination land. Kept here (not in the store) since it's local UX.
  let selLegion: string | null = null;
  let selLand: number | null = null;

  const app = new Application();
  await app.init({ background: palette.vellum, antialias: true, resizeTo: boardEl });
  boardEl.appendChild(app.canvas);
  const renderer = new MasterboardRenderer(
    app,
    app.canvas.width || boardEl.clientWidth || window.innerWidth,
    app.canvas.height || boardEl.clientHeight || window.innerHeight,
  );
  renderer.attachInput({
    onLandClick: (landId) => onLandClick(landId),
    onLandHover: (landId) => dispatch({ type: "hover", id: landId === null ? null : String(landId) }),
  });

  const dispatch = (event: Parameters<typeof reduce>[1]): void => {
    store = reduce(store, event);
    paintPanel();
    paintBoard();
    debug.update(store.snapshot, store.command);
  };

  /** A board tap: if the land holds one of my legions, select it; otherwise
   *  treat it as a destination/target land. */
  function onLandClick(landId: number | null): void {
    if (landId === null) return;
    const view = store.snapshot;
    if (!view) return;
    const mineHere = Object.values(view.legions).find(
      (l) => l.ownerId === slot && l.land === landId,
    );
    if (mineHere) {
      selLegion = mineHere.marker;
      selLand = null;
    } else {
      selLand = landId;
    }
    dispatch({ type: "select", id: String(landId) });
  }

  function paintBoard(): void {
    if (!store.snapshot) return;
    const view = store.snapshot;
    const sel = selLand ?? (selLegion ? view.legions[selLegion]?.land ?? null : null);
    const hov = store.selection.hovered !== null ? Number(store.selection.hovered) : null;

    // Highlight legal targets: a selected legion's reachable lands during
    // Movement, or all contested lands during the Engagement phase.
    const highlights = new Set<number>();
    if (view.fsm.path === "Turn.Movement" && selLegion) {
      for (const d of moveDestinations(view, selLegion)) highlights.add(d);
    } else if (view.fsm.path.startsWith("Turn.Engagement")) {
      for (const land of engagementLands(view)) highlights.add(land);
    }

    renderer.render(view, sel ?? null, Number.isNaN(hov) ? null : hov, highlights);
  }

  function submit(dto: CommandDTO): void {
    dispatch({ type: "submitStart", commandType: dto.type });
    void submitCommand(client, gameId, dto).then((result) => {
      if (!result.ok) {
        dispatch({ type: "submitReject", commandType: dto.type, message: result.message });
      } else {
        // Clear spatial selection on a successful action; the authoritative
        // snapshot arrives over Realtime (strict-wait).
        selLegion = null;
        selLand = null;
      }
    });
  }

  function paintPanel(): void {
    const view = store.snapshot;
    if (!view) {
      phaseLine.textContent = "Waiting for the table…";
      scoreEl.replaceChildren();
    } else {
      const active = activeSlot(store);
      const yourTurn = active === slot;
      const over = view.fsm.path === "GameOver";
      // A clear banner: whose turn / what phase, emphasised when it's yours.
      phaseLine.innerHTML = over
        ? `<span style="color:${palette.oxblood};font-weight:700">Game over</span>`
        : `<span style="color:${yourTurn ? palette.oxblood : palette.inkSoft};font-weight:${yourTurn ? 700 : 500}">` +
          `${yourTurn ? "Your move" : `${escape(active ?? "—")}'s move`}</span>` +
          ` · <strong>${escape(phaseLabel(store))}</strong> · turn ${view.turn.number}`;
      paintScoreboard(view);
    }
    rosterLine.textContent =
      roster.length > 0 ? `At the table: ${roster.join(", ")}` : "You're the only one here so far.";

    // Rebuild the command bar from the authoritative view.
    barEl.replaceChildren();
    helpLine.textContent = "";

    if (view) {
      const myMove = isViewersMove(view, slot);
      if (view.fsm.path === "GameOver") {
        helpLine.innerHTML = winnerLine(view);
      } else if (!myMove) {
        helpLine.textContent = "Waiting for the other player…";
      } else {
        const actions = actionsFor(view, slot, { legion: selLegion, land: selLand } as Selection);
        const submitting = store.command.kind === "submitting";
        for (const a of actions) {
          const b = button(a.label, a.primary ? palette.oxblood : palette.verdigris);
          b.style.width = "100%";
          b.disabled = submitting;
          b.onclick = () => submit(a.dto);
          barEl.appendChild(b);
          if (a.hint) {
            const h = node("div", [`font-size:${typ.scale.xs}`, `color:${palette.inkSoft}`, "margin:-2px 0 4px"]);
            h.textContent = a.hint;
            barEl.appendChild(h);
          }
        }
        // Contextual help for the spatial phases.
        if (view.fsm.path === "Turn.Movement" && view.turn.movementRoll != null) {
          helpLine.textContent = selLegion
            ? `Selected ${selLegion} at land ${view.legions[selLegion]?.land} (${terrainOf(view.legions[selLegion]?.land ?? 0)}). Reachable lands glow green — tap one.`
            : `Rolled ${view.turn.movementRoll}. Tap one of your legions, then a glowing destination.`;
        } else if (view.fsm.path.startsWith("Turn.Engagement")) {
          helpLine.textContent = "Contested lands glow green. Resolve each engagement.";
        } else if (actions.length === 0) {
          helpLine.textContent = "Nothing to do in this phase yet.";
        }
      }
    }

    if (store.command.kind === "submitting") {
      statusLine.textContent = "Submitting to the server…";
      statusLine.style.color = palette.inkSoft;
    } else if (store.command.kind === "rejected") {
      statusLine.textContent = `Server rejected ${store.command.commandType}: ${store.command.message}`;
      statusLine.style.color = palette.alarm;
    } else {
      statusLine.textContent = "";
    }
  }

  /** Render the per-player scoreboard from the authoritative view. */
  function paintScoreboard(view: NonNullable<typeof store.snapshot>): void {
    const rows = view.playerOrder.map((pid) => {
      const p = view.players[pid] as { color?: string; score?: number; eliminated?: boolean } | undefined;
      const color = (p?.color && SLOT_HEX[p.color]) || palette.seal;
      const isActive = activeSlot(store) === pid;
      const isYou = pid === slot;
      const dead = p?.eliminated === true;
      return (
        `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;opacity:${dead ? 0.45 : 1}">` +
        `<span style="width:11px;height:11px;border-radius:50%;background:${color};` +
        `box-shadow:${isActive ? `0 0 0 2px ${palette.oxblood}` : "none"};flex:0 0 auto"></span>` +
        `<span style="flex:1;font-size:${typ.scale.sm};${isYou ? "font-weight:700" : ""}">` +
        `${escape(pid)}${isYou ? " (you)" : ""}${dead ? " — out" : ""}</span>` +
        `<span style="font-family:${typ.mono};font-size:${typ.scale.sm};color:${palette.inkSoft}">${p?.score ?? 0}</span>` +
        `</div>`
      );
    });
    scoreEl.innerHTML =
      `<div style="letter-spacing:.16em;text-transform:uppercase;color:${palette.verdigris};` +
      `font-size:${typ.scale.xs};margin-bottom:4px">Standings</div>` + rows.join("");
  }

  /** A celebratory winner line for the game-over state. */
  function winnerLine(view: NonNullable<typeof store.snapshot>): string {
    const survivors = view.playerOrder.filter((pid) => {
      const p = view.players[pid] as { eliminated?: boolean } | undefined;
      return p?.eliminated !== true;
    });
    const winner = survivors[0];
    if (!winner) return "The game has ended.";
    const youWon = winner === slot;
    return (
      `<span style="font-family:${typ.display};font-size:${typ.scale.lg};color:${palette.oxblood}">` +
      `${youWon ? "Victory" : `${escape(winner)} wins`}</span>` +
      `<br><span style="font-size:${typ.scale.sm};color:${palette.inkSoft}">` +
      `${youWon ? "Your Titan stands alone on the wheel." : "Their Titan stands alone on the wheel."}</span>`
    );
  }

  // --- realtime + presence --------------------------------------------------
  const subs = subscribeGame(
    client,
    gameId,
    (e) => dispatch(e),
    (members) => {
      roster = members
        .map((m) => (m as { displayName?: string }).displayName)
        .filter((n): n is string => typeof n === "string");
      paintPanel();
    },
    () => {/* ephemeral broadcast cues: not used in the minimal view */},
  );
  subs.trackPresence({ slot, displayName: username });

  // Initial authoritative snapshot (covers create, join, and reconnect).
  const snap = await fetchSnapshot(client, gameId);
  if (snap) dispatch({ type: "snapshot", version: snap.version, view: snap.view });

  paintPanel();
  debug.update(store.snapshot, store.command);
  window.addEventListener("beforeunload", () => subs.unsubscribe());
}

// ---------------------------------------------------------------------------
// Tiny DOM helpers (kept local, in the imperative spirit of preview.ts)
// ---------------------------------------------------------------------------

function node(tag: string, css: string[], html?: string): HTMLElement {
  const el = document.createElement(tag);
  el.style.cssText = css.join(";");
  if (html !== undefined) el.innerHTML = html;
  return el;
}

function field(label: string, type: string, placeholder: string): {
  wrap: HTMLElement;
  input: HTMLInputElement;
} {
  const wrap = node("label", ["display:block", "margin-bottom:14px"]);
  wrap.innerHTML = `<span style="display:block;font-size:${typ.scale.xs};letter-spacing:.12em;text-transform:uppercase;color:${palette.inkSoft};margin-bottom:6px">${escape(label)}</span>`;
  const input = document.createElement("input");
  input.type = type;
  input.placeholder = placeholder;
  input.style.cssText = [
    "width:100%",
    "box-sizing:border-box",
    "padding:10px 12px",
    `font-family:${typ.body}`,
    `font-size:${typ.scale.sm}`,
    `color:${palette.ink}`,
    "background:#FBF7EC",
    `border:1px solid ${palette.parchmentEdge}`,
    "border-radius:2px",
  ].join(";");
  wrap.appendChild(input);
  return { wrap, input };
}

/** A 2–6 seat picker for the Create flow. The engine needs the roster size up
 *  front (a table is fixed at creation), so the founder chooses it here. */
function seatSelect(): { wrap: HTMLElement; value: () => number } {
  const wrap = node("label", ["display:block", "margin-bottom:14px"]);
  wrap.innerHTML = `<span style="display:block;font-size:${typ.scale.xs};letter-spacing:.12em;text-transform:uppercase;color:${palette.inkSoft};margin-bottom:6px">Seats (for a new table)</span>`;
  const select = document.createElement("select");
  select.style.cssText = [
    "width:100%",
    "box-sizing:border-box",
    "padding:10px 12px",
    `font-family:${typ.body}`,
    `font-size:${typ.scale.sm}`,
    `color:${palette.ink}`,
    "background:#FBF7EC",
    `border:1px solid ${palette.parchmentEdge}`,
    "border-radius:2px",
  ].join(";");
  for (let n = 2; n <= 6; n++) {
    const opt = document.createElement("option");
    opt.value = String(n);
    opt.textContent = `${n} players`;
    select.appendChild(opt);
  }
  wrap.appendChild(select);
  return { wrap, value: () => Number(select.value) };
}

function button(text: string, color: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = text;
  b.style.cssText = [
    "flex:1",
    "padding:11px 14px",
    `font-family:${typ.body}`,
    `font-size:${typ.scale.sm}`,
    "font-weight:600",
    "color:#FBF7EC",
    `background:${color}`,
    "border:none",
    "border-radius:2px",
    "cursor:pointer",
  ].join(";");
  return b;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
