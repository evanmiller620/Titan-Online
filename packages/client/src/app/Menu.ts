/**
 * Menu (Titan client, app) — the waiting room.
 *
 * Players gather in a room before play. A seat is filled either LOCALLY (a
 * hot-seat player on this machine) or by a MULTIPLAYER guest joining over
 * Supabase. The room shows the roster filling live; when every seat is taken
 * and at least one is local, the host enters the game. The seat logic is the
 * tested SeatRoster; this class is the screen around it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommandDTO, GameStateView } from "@titan/engine";
import { SeatRoster } from "../game/seatRoster.ts";
import { GameSession } from "../game/session.ts";
import { LocalTransport, RemoteTransport, type RemoteDeps } from "../game/transport.ts";
import { GameView } from "./GameView.ts";
import { createTable, joinTable } from "./lobby.ts";
import { submitCommand, subscribeGame, fetchSnapshot, type Subscriptions } from "../net/supabase.ts";
import { elem, txt, eyebrow, button, chip, input, theme } from "../ui/dom.ts";
import { palette, type as typ } from "../ui/tokens.ts";

export class Menu {
  private readonly client?: SupabaseClient;
  private root!: HTMLElement;
  private mode: "choose" | "local" | "online" = "choose";
  private roster = new SeatRoster(2);
  private size = 2;
  private nameField = input("your name", "Player 1");

  // online session-in-formation
  private gameId: string | null = null;
  private mySlot: string | null = null;
  private presence: Subscriptions | null = null;
  private msg = "";

  constructor(opts: { client?: SupabaseClient } = {}) {
    this.client = opts.client;
  }

  mount(root: HTMLElement): void {
    this.root = root;
    this.render();
  }

  // --- screens --------------------------------------------------------------

  private render(): void {
    this.root.innerHTML = "";
    this.root.style.cssText = `min-height:100vh;display:grid;place-items:center;background:${palette.vellum}`;
    const card = elem("div", `width:min(460px,92vw);padding:28px;background:${palette.vellumDeep};border:1px solid ${theme.brass};border-radius:4px;color:${palette.ink}`, {
      children: [
        elem("div", `font-family:${typ.display};font-size:${typ.scale.xl};color:${theme.accent};margin-bottom:6px`, { text: "Titan" }),
        eyebrow(this.mode === "online" ? "Online room" : "New table"),
        ...this.screen(),
      ],
    });
    this.root.appendChild(card);
  }

  private screen(): HTMLElement[] {
    if (this.mode === "choose") return this.chooseScreen();
    return this.roomScreen();
  }

  private chooseScreen(): HTMLElement[] {
    const sizeChips = elem("div", "display:flex;gap:6px;margin:14px 0", {
      children: [2, 3, 4, 5, 6].map((n) => chip(String(n), { active: this.size === n, onClick: () => { this.size = n; this.render(); } })),
    });
    const localBtn = button("Play locally (hot-seat)", { full: true, primary: true, onClick: () => this.startLocalRoom() });
    const kids = [
      txt("Seats at the table", palette.inkSoft),
      sizeChips,
      localBtn,
    ];
    if (this.client) {
      kids.push(elem("div", "height:8px"));
      kids.push(this.nameField);
      kids.push(button("Host online table", { full: true, onClick: () => void this.hostOnline() }));
      const code = input("room code to join");
      kids.push(code);
      kids.push(button("Join online table", { full: true, onClick: () => void this.joinOnline(code.value.trim()) }));
    } else {
      kids.push(elem("div", `margin-top:10px;font-size:11px;color:${palette.inkSoft}`, { text: "Configure Supabase to enable online tables." }));
    }
    if (this.msg) kids.push(elem("div", `margin-top:10px;font-size:${typ.scale.sm};color:${theme.warn}`, { text: this.msg }));
    return kids;
  }

  private roomScreen(): HTMLElement[] {
    const rows = this.roster.list().map((s) => {
      const tag = s.status === "local" ? "you (local)" : s.status === "remote" ? s.name || "guest" : "waiting…";
      const color = s.status === "empty" ? palette.inkSoft : s.status === "local" ? theme.accent : theme.brass;
      const row = elem("div", `display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid ${palette.parchmentEdge}`, {
        children: [
          elem("span", `font-family:${typ.mono};width:34px;color:${palette.ink}`, { text: s.slot }),
          elem("span", `flex:1;font-size:${typ.scale.sm};color:${color}`, { text: tag }),
        ],
      });
      if (this.mode === "local" && s.status === "empty") {
        row.appendChild(button("Sit (local)", { onClick: () => { this.roster.addLocal(`Player ${s.slot.slice(1)}`); this.render(); } }));
      }
      return row;
    });

    const kids: HTMLElement[] = [elem("div", "margin:12px 0", { children: rows })];

    if (this.mode === "online" && this.gameId) {
      kids.push(elem("div", `font-family:${typ.mono};font-size:11px;margin-bottom:10px;color:${palette.inkSoft};word-break:break-all`, { html: `Room code — share to invite:<br><b style="color:${palette.ink}">${this.gameId}</b>` }));
    }
    if (this.mode === "local") {
      kids.push(button("Fill remaining with locals", { full: true, onClick: () => { while (this.roster.addLocal("Player")) { /* fill */ } this.render(); } }));
    }
    kids.push(button("Start game", { full: true, primary: true, disabled: !this.roster.canStart(), onClick: () => void this.start() }));
    kids.push(button("Back", { full: true, onClick: () => { this.leaveOnline(); this.mode = "choose"; this.render(); } }));
    return kids;
  }

  // --- local ---------------------------------------------------------------

  private startLocalRoom(): void {
    this.mode = "local";
    this.roster = new SeatRoster(this.size);
    this.render();
  }

  // --- online --------------------------------------------------------------

  private async ensureAuth(): Promise<void> {
    const c = this.client!;
    const { data } = await c.auth.getSession();
    if (!data.session) {
      const { error } = await c.auth.signInAnonymously();
      if (error) throw new Error(`Enable Anonymous sign-ins in Supabase → Auth. (${error.message})`);
    }
  }

  private async hostOnline(): Promise<void> {
    try {
      await this.ensureAuth();
      const gameId = await createTable(this.client!, { name: this.nameField.value || "Host" }, this.size);
      this.enterOnlineRoom(gameId, "p1");
    } catch (e) { this.fail(e); }
  }

  private async joinOnline(code: string): Promise<void> {
    if (!code) return this.fail(new Error("Enter a room code."));
    try {
      await this.ensureAuth();
      const slot = await joinTable(this.client!, code);
      const snap = await fetchSnapshot(this.client!, code);
      this.size = snap?.view.playerOrder.length ?? this.size;
      this.enterOnlineRoom(code, slot);
    } catch (e) { this.fail(e); }
  }

  private enterOnlineRoom(gameId: string, slot: string): void {
    this.mode = "online";
    this.gameId = gameId;
    this.mySlot = slot;
    this.roster = new SeatRoster(this.size);
    this.roster.claim(slot, "local", this.nameField.value || slot);
    this.presence = subscribeGame(
      this.client!, gameId,
      () => {},
      (members) => this.onPresence(members),
      () => {},
    );
    this.presence.trackPresence({ slot, name: this.nameField.value || slot });
    this.render();
  }

  private onPresence(members: unknown[]): void {
    const others = members
      .map((m) => m as { slot?: string; name?: string })
      .filter((m) => typeof m.slot === "string" && m.slot !== this.mySlot)
      .map((m) => ({ slot: m.slot!, name: m.name ?? m.slot! }));
    this.roster.syncRemote(others);
    this.render();
  }

  private leaveOnline(): void {
    this.presence?.unsubscribe();
    this.presence = null;
    this.gameId = null;
    this.mySlot = null;
  }

  // --- launch ---------------------------------------------------------------

  private async start(): Promise<void> {
    if (this.mode === "local") {
      const transport = LocalTransport.newGame(this.roster.size);
      const session = new GameSession(transport, this.roster.toSeats());
      new GameView(session, { autoFollow: true }).mount(this.root);
      return;
    }
    // online
    const gameId = this.gameId!;
    this.presence?.unsubscribe();
    this.presence = null;
    const deps: RemoteDeps = {
      submitCommand: async (gid: string, dto: CommandDTO) => {
        const r = await submitCommand(this.client!, gid, dto);
        return r.ok ? { ok: true } : { ok: false, code: r.code, message: r.message };
      },
      subscribe: (onSnapshot: (v: GameStateView, version: number) => void) => {
        const subs = subscribeGame(this.client!, gameId, onSnapshot, () => {}, () => {});
        return () => subs.unsubscribe();
      },
      fetchSnapshot: async () => {
        const snap = await fetchSnapshot(this.client!, gameId);
        return snap ? { view: snap.view, version: snap.version } : null;
      },
    };
    const transport = new RemoteTransport(gameId, deps);
    await transport.start();
    const session = new GameSession(transport, this.roster.toSeats(), this.mySlot!);
    new GameView(session, { autoFollow: false }).mount(this.root);
  }

  private fail(e: unknown): void {
    this.msg = e instanceof Error ? e.message : "Something went wrong.";
    this.render();
  }
}
