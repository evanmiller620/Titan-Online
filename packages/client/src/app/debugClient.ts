/**
 * Debug client (Titan client, app) — the single, debug-first game UI.
 *
 * Layout, left → right:
 *   [ Inspector ]  full state + live FSM (the centerpiece)
 *   [ Board     ]  Masterboard, swapped for the Battleland during a fight
 *   [ Control   ]  seat switcher · legal-action buttons · event log
 *
 * It is transport-agnostic: a GameSession over a LocalTransport (engine in the
 * browser — hot-seat, zero backend, always works) or a RemoteTransport (the
 * Supabase server). Boot local for instant play/debugging; boot remote to join
 * a networked table. The UI code below is identical either way.
 */

import { Application } from "pixi.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommandDTO, GameStateView } from "@titan/engine";
import { MasterboardRenderer } from "../render/MasterboardRenderer.ts";
import { BattlelandRenderer } from "../render/BattlelandRenderer.ts";
import { createDebugPanel } from "../ui/DebugPanel.ts";
import { GameSession, makeSeats, type Seat } from "../game/session.ts";
import { LocalTransport, RemoteTransport, type RemoteDeps } from "../game/transport.ts";
import { planMasterboardClick, planBattleClick } from "../game/legalActions.ts";
import { submitCommand, subscribeGame, fetchSnapshot } from "../net/supabase.ts";
import { palette, tokensCss, type as typ } from "../ui/tokens.ts";

// ---------------------------------------------------------------------------
// Boot entry points
// ---------------------------------------------------------------------------

/** Local hot-seat game: all seats driven from this browser. No backend. */
export function bootLocal(seats = 2): void {
  injectTokens();
  const transport = LocalTransport.newGame(seats);
  const session = new GameSession(transport, makeSeats(seats, allSlots(seats)));
  mount(session, { autoFollow: true });
}

/** Networked game: this browser drives `mySlot`; the rest are remote. */
export async function bootRemote(client: SupabaseClient, gameId: string, mySlot: string): Promise<void> {
  injectTokens();
  const deps: RemoteDeps = {
    submitCommand: async (gid, dto) => {
      const r = await submitCommand(client, gid, dto);
      return r.ok ? { ok: true } : { ok: false, code: r.code, message: r.message };
    },
    subscribe: (onSnapshot) => {
      const subs = subscribeGame(
        client, gameId,
        (e) => { if (e.type === "snapshot") onSnapshot(e.view, e.version); },
        () => {}, () => {},
      );
      return () => subs.unsubscribe();
    },
    fetchSnapshot: async () => {
      const snap = await fetchSnapshot(client, gameId);
      return snap ? { view: snap.view, version: snap.version } : null;
    },
  };
  const transport = new RemoteTransport(gameId, deps);
  await transport.start();
  const seats = transport.viewFor(mySlot)?.playerOrder.length ?? 2;
  const session = new GameSession(transport, makeSeats(seats, [mySlot]), mySlot);
  mount(session, { autoFollow: false });
}

/** Minimal create/join lobby for the networked path (anonymous auth). */
export async function bootRemoteLobby(client: SupabaseClient): Promise<void> {
  injectTokens();
  const { createTable, joinTable } = await import("./lobby.ts");
  const root = document.getElementById("root")!;
  root.innerHTML = "";
  root.style.cssText = `min-height:100vh;display:grid;place-items:center;background:${palette.vellum};`;
  const card = el("div", `width:min(420px,92vw);padding:28px;background:${palette.vellumDeep};border:1px solid ${palette.brass};border-radius:4px;font-family:${typ.body};color:${palette.ink};`);
  card.innerHTML = `<div style="font-family:${typ.display};font-size:${typ.scale.xl};color:${palette.oxblood};margin-bottom:14px">Titan — online</div>`;
  const name = input("Your name");
  const code = input("Room code (to join)");
  const seats = input("Seats (to create)", "2");
  const msg = el("div", `min-height:18px;margin-top:10px;font-size:${typ.scale.sm};color:${palette.alarm};`);
  const create = actionButton("Create table", true);
  const join = actionButton("Join table", false);
  card.append(name, seats, code, create, join, msg);
  root.appendChild(card);

  const auth = async () => {
    const { data } = await client.auth.getSession();
    if (!data.session) {
      const { error } = await client.auth.signInAnonymously();
      if (error) throw new Error(`Enable Anonymous sign-ins in Supabase → Auth. (${error.message})`);
    }
  };
  create.onclick = async () => {
    try { await auth(); const gid = await createTable(client, { name: name.value || "Host" }, Math.max(2, Math.min(6, Number(seats.value) || 2))); await bootRemote(client, gid, "p1"); }
    catch (e) { msg.textContent = e instanceof Error ? e.message : "failed"; }
  };
  join.onclick = async () => {
    try { await auth(); const slot = await joinTable(client, code.value.trim()); await bootRemote(client, code.value.trim(), slot); }
    catch (e) { msg.textContent = e instanceof Error ? e.message : "failed"; }
  };
}

function input(placeholder: string, value = ""): HTMLInputElement {
  const i = document.createElement("input");
  i.placeholder = placeholder;
  i.value = value;
  i.style.cssText = `display:block;width:100%;box-sizing:border-box;margin-bottom:10px;padding:10px;font-family:${typ.body};font-size:${typ.scale.sm};border:1px solid ${palette.parchmentEdge};border-radius:2px;background:#FBF7EC;color:${palette.ink};`;
  return i;
}

// ---------------------------------------------------------------------------
// Mount: inspector | board | control
// ---------------------------------------------------------------------------

interface MountOpts { autoFollow: boolean }

function mount(session: GameSession, opts: MountOpts): void {
  const root = document.getElementById("root");
  if (!root) throw new Error("missing #root mount");
  root.innerHTML = "";
  root.style.cssText = "position:absolute;inset:0;display:flex;background:#181B20;";

  // Inspector (left)
  const inspector = createDebugPanel();
  root.appendChild(inspector.el);

  // Board (centre)
  const boardEl = el("div", "position:relative;flex:1;min-width:0;");
  root.appendChild(boardEl);

  // Control (right)
  const control = el("aside", [
    "width:300px", "flex:0 0 300px", "height:100%", "overflow:auto",
    "padding:16px", "background:#20242A", `border-left:1px solid ${palette.brass}`,
    `font-family:${typ.body}`, `color:${palette.vellum}`,
  ].join(";"));
  root.appendChild(control);

  const seatRow = control.appendChild(el("div", "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;"));
  const bar = control.appendChild(el("div", "display:flex;flex-direction:column;gap:8px;"));
  const status = control.appendChild(el("div", `margin-top:12px;min-height:18px;font-size:${typ.scale.sm};line-height:1.4;`));
  const logTitle = control.appendChild(el("div", `margin-top:16px;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:${palette.verdigris};`));
  logTitle.textContent = "Event log";
  const log = control.appendChild(el("div", `margin-top:6px;font-family:${typ.mono};font-size:11px;line-height:1.5;color:#9AA1AB;`));

  // Boards
  let board: MasterboardRenderer | null = null;
  let battle: BattlelandRenderer | null = null;
  const logLines: string[] = [];

  void (async () => {
    const app = new Application();
    await app.init({ background: palette.vellum, antialias: true, resizeTo: boardEl });
    boardEl.appendChild(app.canvas);
    const w = app.canvas.width || boardEl.clientWidth || 800;
    const h = app.canvas.height || boardEl.clientHeight || 600;

    board = new MasterboardRenderer(app, w, h);
    board.attachInput({
      onLandClick: (landId) => onMasterClick(landId),
      onLandHover: () => {},
    });
    battle = new BattlelandRenderer(app, w, h);
    battle.setVisible(false);
    battle.attachInput({ onHexClick: (cube) => onBattleClick(cube) }, () => session.view());

    render();
  })();

  function onMasterClick(landId: number): void {
    const view = session.view();
    if (!view) return;
    const plan = planMasterboardClick(view, session.focusedSeat, session.getSelection(), landId);
    if (plan.dto) void submit(plan.dto);
    else if (plan.select) session.select(plan.select);
  }
  function onBattleClick(cube: { x: number; y: number; z: number }): void {
    const view = session.view();
    if (!view) return;
    const plan = planBattleClick(view, session.focusedSeat, session.getSelection().combatant, cube);
    if (plan.dto) void submit(plan.dto);
    else if (plan.select) session.select(plan.select);
  }

  async function submit(dto: CommandDTO): Promise<void> {
    status.textContent = `submitting ${dto.type}…`;
    status.style.color = palette.brassBright;
    const r = await session.submit(dto);
    if (!r.ok) {
      status.textContent = `✕ ${dto.type}: ${r.message}`;
      status.style.color = palette.alarm;
    } else {
      status.textContent = "";
      pushLog(dto, session.lastEvents());
      if (opts.autoFollow) session.focusActiveSeat();
    }
    render();
  }

  function pushLog(dto: CommandDTO, events: readonly { type: string }[]): void {
    const evs = events.map((e) => e.type).filter((t) => t !== "PhaseChanged");
    logLines.unshift(`${dto.playerId} ${dto.type}${evs.length ? " → " + evs.join(", ") : ""}`);
    if (logLines.length > 40) logLines.pop();
  }

  function renderSeats(): void {
    seatRow.replaceChildren();
    const view = session.view();
    for (const s of session.seats) {
      const isFocus = s.slot === session.focusedSeat;
      const c = seatChip(s, isFocus, !!view && actsNow(view, s.slot));
      if (s.control === "local") c.onclick = () => { session.setFocus(s.slot); render(); };
      seatRow.appendChild(c);
    }
  }

  function renderBar(): void {
    bar.replaceChildren();
    const actions = session.actions();
    if (actions.length === 0) {
      const hint = el("div", `font-size:${typ.scale.sm};color:#9AA1AB;`);
      hint.textContent = "No actions for this seat now.";
      bar.appendChild(hint);
      return;
    }
    for (const a of actions) {
      const b = actionButton(a.label, a.primary === true);
      b.onclick = () => void submit(a.dto);
      bar.appendChild(b);
      if (a.hint) {
        const hh = el("div", `font-size:11px;color:#9AA1AB;margin:-2px 0 2px;`);
        hh.textContent = a.hint;
        bar.appendChild(hh);
      }
    }
  }

  function renderBoard(): void {
    const view = session.view();
    if (!board || !view) return;
    const selLegion = session.getSelection().legion;
    if (view.battle) {
      board.setVisible(false);
      battle?.setVisible(true);
      battle?.render(view, session.getSelection().combatant);
    } else {
      board.setVisible(true);
      battle?.setVisible(false);
      const land = selLegion && view.legions[selLegion] ? view.legions[selLegion]!.land : null;
      board.render(view, land, null);
    }
  }

  function render(): void {
    inspector.update(session.view());
    renderSeats();
    renderBar();
    renderBoard();
    log.replaceChildren();
    for (const line of logLines) {
      const d = el("div", "padding:1px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;");
      d.textContent = line;
      log.appendChild(d);
    }
  }

  session.onChange(render);
}

// ---------------------------------------------------------------------------
// small DOM helpers + visuals
// ---------------------------------------------------------------------------

function allSlots(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `p${i + 1}`);
}

function actsNow(view: GameStateView, slot: string): boolean {
  // cheap mirror of seatActsNow without importing it for the chip glow
  const path = view.fsm.path;
  if (path.includes("Battle.")) {
    const b = view.battle!;
    const sidePlayer = path.endsWith("Strikeback")
      ? (b.activeSide === "attacker" ? b.defenderPlayerId : b.attackerPlayerId)
      : path.endsWith("DefenderDeployment") ? b.defenderPlayerId
      : path.endsWith("AttackerDeployment") ? b.attackerPlayerId
      : (b.activeSide === "attacker" ? b.attackerPlayerId : b.defenderPlayerId);
    return sidePlayer === slot;
  }
  if (path === "Setup.TowerSelection") return view.setup?.order[view.setup.towerPickIndex] === slot;
  if (path === "Setup.ColorSelection") return view.setup?.order[view.setup.colorPickIndex] === slot;
  if (path === "Setup.RollingForOrder") return true;
  return view.playerOrder[view.turn.activeIndex] === slot;
}

function injectTokens(): void {
  const style = document.createElement("style");
  style.textContent = tokensCss();
  document.head.appendChild(style);
}

function el(tag: string, css: string): HTMLElement {
  const e = document.createElement(tag);
  e.style.cssText = css;
  return e;
}

function seatChip(s: Seat, focused: boolean, acts: boolean): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = `${s.slot}${s.control === "remote" ? " ⇄" : ""}`;
  b.title = s.control === "local" ? "local seat — click to drive" : "remote seat";
  b.style.cssText = [
    "padding:5px 10px", `font-family:${typ.mono}`, "font-size:12px",
    `color:${focused ? palette.vellum : "#9AA1AB"}`,
    `background:${focused ? palette.oxblood : "#2B2F36"}`,
    `border:1px solid ${acts ? palette.brassBright : "#3A3F47"}`,
    "border-radius:3px", s.control === "local" ? "cursor:pointer" : "cursor:default",
  ].join(";");
  return b;
}

function actionButton(label: string, primary: boolean): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  b.style.cssText = [
    "width:100%", "text-align:left", "padding:9px 12px",
    `font-family:${typ.body}`, `font-size:${typ.scale.sm}`, "font-weight:600",
    `color:${primary ? palette.vellum : palette.vellum}`,
    `background:${primary ? palette.oxblood : "#2B2F36"}`,
    `border:1px solid ${primary ? palette.oxblood : "#3A3F47"}`,
    "border-radius:3px", "cursor:pointer",
  ].join(";");
  return b;
}
