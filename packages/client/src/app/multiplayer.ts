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
import { palette, tokensCss, type as typ, space } from "../ui/tokens.ts";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

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

  card.append(name.wrap, code.wrap, row, status);
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
      const gameId = await createTable(client, { id: "p1", name: username });
      // create_game seats the founder as slot p1 (migration 0006).
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

  // Board on the left, a thin parchment side panel on the right.
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
  root.append(boardEl, panel);

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

  const rollBtn = button("Roll turn order", palette.oxblood);
  rollBtn.style.width = "100%";
  panel.appendChild(rollBtn);
  const statusLine = panel.appendChild(
    node("p", [`font-size:${typ.scale.sm}`, "min-height:18px", "margin:12px 0 0", "line-height:1.4", `color:${palette.inkSoft}`]),
  );

  // --- imperative store + board (the React-free equivalent of useGame) ------
  let store: StoreState = reduce(initialStore, { type: "setViewer", slot });
  let roster: string[] = [];

  const app = new Application();
  await app.init({ background: palette.vellum, antialias: true, resizeTo: boardEl });
  boardEl.appendChild(app.canvas);
  const renderer = new MasterboardRenderer(
    app,
    app.canvas.width || boardEl.clientWidth || window.innerWidth,
    app.canvas.height || boardEl.clientHeight || window.innerHeight,
  );
  renderer.attachInput({
    onLandClick: (landId) => dispatch({ type: "select", id: landId === null ? null : String(landId) }),
    onLandHover: (landId) => dispatch({ type: "hover", id: landId === null ? null : String(landId) }),
  });

  const dispatch = (event: Parameters<typeof reduce>[1]): void => {
    store = reduce(store, event);
    paintPanel();
    paintBoard();
  };

  function paintBoard(): void {
    if (!store.snapshot) return;
    const sel = store.selection.selected !== null ? Number(store.selection.selected) : null;
    const hov = store.selection.hovered !== null ? Number(store.selection.hovered) : null;
    renderer.render(store.snapshot, Number.isNaN(sel) ? null : sel, Number.isNaN(hov) ? null : hov);
  }

  function paintPanel(): void {
    if (!store.snapshot) {
      phaseLine.textContent = "Waiting for the table…";
    } else {
      const active = activeSlot(store);
      phaseLine.innerHTML =
        `Phase: <strong>${escape(phaseLabel(store))}</strong>` +
        (active ? ` · active: ${escape(active)}` : "");
    }
    rosterLine.textContent =
      roster.length > 0 ? `At the table: ${roster.join(", ")}` : "You're the only one here so far.";

    const phase = phaseLabel(store);
    const inSetup = store.snapshot !== null && phase === "Setup";
    rollBtn.style.display = inSetup ? "" : "none";
    rollBtn.disabled = store.command.kind === "submitting";

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

  rollBtn.onclick = () => {
    const dto: CommandDTO = { type: "RollTurnOrder", playerId: slot, payload: {} };
    dispatch({ type: "submitStart", commandType: dto.type });
    void submitCommand(client, gameId, dto).then((result) => {
      if (!result.ok) dispatch({ type: "submitReject", commandType: dto.type, message: result.message });
      // On success the authoritative snapshot arrives over Realtime (strict-wait).
    });
  };

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
