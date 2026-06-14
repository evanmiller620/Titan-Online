/**
 * GameView (Titan client, app) — the in-game screen as a class.
 *
 *   [ Inspector ] full state + FSM   [ Board ] master/battle   [ Control ] seats · actions · log
 *
 * Transport-agnostic: it only talks to a GameSession. Local hot-seat or remote
 * networked play render identically.
 */

import { Application } from "pixi.js";
import type { CommandDTO, GameStateView } from "@titan/engine";
import { MasterboardRenderer } from "../render/MasterboardRenderer.ts";
import { BattlelandRenderer } from "../render/BattlelandRenderer.ts";
import { Inspector } from "../ui/Inspector.ts";
import { GameSession } from "../game/session.ts";
import { planMasterboardClick, planBattleClick, seatActsNow, battleBanner } from "../game/legalActions.ts";
import { elem, txt, eyebrow, chip, button, theme } from "../ui/dom.ts";
import { type as typ } from "../ui/tokens.ts";

export class GameView {
  private readonly session: GameSession;
  private readonly autoFollow: boolean;
  private readonly inspector = new Inspector();
  private board: MasterboardRenderer | null = null;
  private battle: BattlelandRenderer | null = null;
  private readonly log: string[] = [];

  private seatRow!: HTMLElement;
  private bar!: HTMLElement;
  private status!: HTMLElement;
  private logEl!: HTMLElement;

  constructor(session: GameSession, opts: { autoFollow: boolean }) {
    this.session = session;
    this.autoFollow = opts.autoFollow;
  }

  mount(root: HTMLElement): void {
    root.innerHTML = "";
    root.style.cssText = `position:absolute;inset:0;display:flex;background:${theme.bgDeep}`;
    root.appendChild(this.inspector.el);

    const boardEl = elem("div", "position:relative;flex:1;min-width:0");
    root.appendChild(boardEl);

    this.seatRow = elem("div", "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px");
    this.bar = elem("div", "display:flex;flex-direction:column;gap:8px");
    this.status = elem("div", `margin-top:12px;min-height:18px;font-size:${typ.scale.sm};line-height:1.4`);
    this.logEl = elem("div", `margin-top:6px;font-family:${typ.mono};font-size:11px;line-height:1.5;color:${theme.dim}`);
    const control = elem("aside", `width:300px;flex:0 0 300px;height:100%;overflow:auto;padding:16px;background:${theme.bg};border-left:1px solid ${theme.brass};color:${theme.ink}`, {
      children: [this.seatRow, this.bar, this.status, elem("div", "margin-top:16px", { children: [eyebrow("Event log")] }), this.logEl],
    });
    root.appendChild(control);

    void this.initBoard(boardEl);
    this.session.onChange(() => this.render());
  }

  private async initBoard(boardEl: HTMLElement): Promise<void> {
    const app = new Application();
    await app.init({ background: theme.bg, antialias: true, resizeTo: boardEl });
    boardEl.appendChild(app.canvas);
    const w = app.canvas.width || boardEl.clientWidth || 800;
    const h = app.canvas.height || boardEl.clientHeight || 600;
    this.board = new MasterboardRenderer(app, w, h);
    this.board.attachInput({ onLandClick: (id) => this.onMasterClick(id), onLandHover: () => {} });
    this.battle = new BattlelandRenderer(app, w, h);
    this.battle.setVisible(false);
    this.battle.attachInput({ onHexClick: (c) => this.onBattleClick(c) }, () => this.session.view());
    this.render();
  }

  private onMasterClick(landId: number): void {
    const v = this.session.view();
    if (!v) return;
    const plan = planMasterboardClick(v, this.session.focusedSeat, this.session.getSelection(), landId);
    if (plan.dto) void this.submit(plan.dto);
    else if (plan.select) this.session.select(plan.select);
  }

  private onBattleClick(cube: { x: number; y: number; z: number }): void {
    const v = this.session.view();
    if (!v) return;
    const plan = planBattleClick(v, this.session.focusedSeat, this.session.getSelection().combatant, cube);
    if (plan.dto) void this.submit(plan.dto);
    else if (plan.select) this.session.select(plan.select);
  }

  private async submit(dto: CommandDTO): Promise<void> {
    this.status.textContent = `submitting ${dto.type}…`;
    this.status.style.color = theme.brassBright;
    const r = await this.session.submit(dto);
    if (!r.ok) {
      this.status.textContent = `✕ ${dto.type}: ${r.message}`;
      this.status.style.color = theme.warn;
    } else {
      this.status.textContent = "";
      const evs = this.session.lastEvents().map((e) => e.type).filter((t) => t !== "PhaseChanged");
      this.log.unshift(`${dto.playerId} ${dto.type}${evs.length ? " → " + evs.join(", ") : ""}`);
      if (this.log.length > 40) this.log.pop();
      if (this.autoFollow) this.session.focusActiveSeat();
    }
    this.render();
  }

  private render(): void {
    const v = this.session.view();
    this.inspector.update(v);
    this.renderSeats(v);
    this.renderBar();
    this.renderBoard(v);
    this.logEl.replaceChildren(...this.log.map((line) => elem("div", "padding:1px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis", { text: line })));
  }

  private renderSeats(v: GameStateView | null): void {
    this.seatRow.replaceChildren(...this.session.seats.map((s) => {
      const acts = !!v && seatActsNow(v, s.slot);
      const c = chip(`${s.slot}${s.control === "remote" ? " ⇄" : ""}`, {
        active: s.slot === this.session.focusedSeat, ring: acts,
        title: s.control === "local" ? "local seat — click to drive" : "remote seat",
        onClick: s.control === "local" ? () => { this.session.setFocus(s.slot); this.render(); } : undefined,
      });
      return c;
    }));
  }

  private renderBar(): void {
    const v = this.session.view();
    const banner = v && v.battle ? battleBanner(v) : null;
    const actions = this.session.actions();
    const kids: HTMLElement[] = [];
    if (banner) kids.push(txt(banner, theme.brassBright, typ.scale.sm));
    if (actions.length === 0) kids.push(txt("No actions for this seat now.", theme.dim));
    for (const a of actions) {
      kids.push(button(a.label, { full: true, primary: a.primary === true, onClick: () => void this.submit(a.dto) }));
      if (a.hint) kids.push(elem("div", `font-size:11px;color:${theme.dim};margin:-2px 0 2px`, { text: a.hint }));
    }
    this.bar.replaceChildren(...kids);
  }

  private renderBoard(v: GameStateView | null): void {
    if (!this.board || !v) return;
    if (v.battle) {
      this.board.setVisible(false);
      this.battle?.setVisible(true);
      this.battle?.render(v, this.session.getSelection().combatant);
    } else {
      this.board.setVisible(true);
      this.battle?.setVisible(false);
      const legion = this.session.getSelection().legion;
      const land = legion && v.legions[legion] ? v.legions[legion]!.land : null;
      this.board.render(v, land, null);
    }
  }
}
