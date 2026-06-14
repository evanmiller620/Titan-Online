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
import { elem, txt, eyebrow, chip, button, input, theme } from "../ui/dom.ts";
import { type as typ } from "../ui/tokens.ts";
import type { DomainEvent } from "@titan/engine";

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
  private devEl!: HTMLElement;
  private readonly forceField = input("dice e.g. 6,6,1");

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
    this.devEl = elem("div", "display:flex;flex-direction:column;gap:6px;margin-top:6px");
    this.logEl = elem("div", `margin-top:6px;font-family:${typ.mono};font-size:11px;line-height:1.5;color:${theme.dim};white-space:pre-wrap`);
    const control = elem("aside", `width:320px;flex:0 0 320px;height:100%;overflow:auto;padding:16px;background:${theme.bg};border-left:1px solid ${theme.brass};color:${theme.ink}`, {
      children: [
        this.seatRow, this.bar, this.status,
        elem("div", "margin-top:16px", { children: [eyebrow("Developer")] }), this.devEl,
        elem("div", "margin-top:16px", { children: [eyebrow("Event log (verbose)")] }), this.logEl,
      ],
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
      const ev = this.session.lastEvents().map(formatEvent);
      const block = `▸ ${dto.playerId} · ${dto.type}` + (ev.length ? "\n" + ev.map((l) => "    " + l).join("\n") : "");
      this.log.unshift(block);
      if (this.log.length > 60) this.log.pop();
      if (this.autoFollow) this.session.focusActiveSeat();
    }
    this.render();
  }

  private renderDev(): void {
    const dev = this.session.dev();
    if (!dev) {
      this.devEl.replaceChildren(txt("Networked game — rules run on each client; dev tools are local-table only.", theme.dim, "11px"));
      return;
    }
    const copy = (label: string, get: () => unknown) =>
      button(label, { full: true, onClick: () => { try { void navigator.clipboard?.writeText(JSON.stringify(get(), null, 2)); } catch { /* no-op */ } } });
    const forceRow = elem("div", "display:flex;gap:6px", {
      children: [
        elem("div", "flex:1", { children: [this.forceField] }),
        button("Force dice", { onClick: () => { const f = this.forceField.value.split(",").map((n) => Number(n.trim())).filter((n) => n >= 1 && n <= 6); if (f.length) dev.forceRolls(f); } }),
      ],
    });
    this.forceField.style.margin = "0";
    const saveRow = elem("div", "display:flex;gap:6px", {
      children: [
        button("Save", { onClick: () => { dev.save(); this.status.textContent = "saved to slot 'quick'"; this.status.style.color = theme.good; } }),
        button("Load", { onClick: () => { if (dev.load()) { this.status.textContent = "loaded slot 'quick'"; this.status.style.color = theme.good; } else { this.status.textContent = "no save found"; this.status.style.color = theme.warn; } } }),
      ],
    });
    this.devEl.replaceChildren(
      button(`Reveal all: ${this.session.isRevealAll() ? "ON" : "off"}`, { full: true, primary: this.session.isRevealAll(), onClick: () => this.session.setRevealAll(!this.session.isRevealAll()) }),
      saveRow,
      button("Undo last command", { full: true, onClick: () => dev.undo() }),
      forceRow,
      copy("Copy state JSON", () => this.session.view()),
      copy("Copy command log", () => dev.snapshot().log),
    );
  }

  private render(): void {
    const v = this.session.view();
    this.inspector.update(v);
    this.renderSeats(v);
    this.renderBar();
    this.renderDev();
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

/** One detailed line per domain event, for the verbose log. */
function formatEvent(e: DomainEvent): string {
  const a = e as unknown as Record<string, unknown>;
  switch (e.type) {
    case "PhaseChanged": return `phase ${a.from} → ${a.to}`;
    case "TurnOrderRolled": return `order ${(a.order as string[]).join(",")}`;
    case "MovementRolled": return `roll d6=${a.roll}${a.mulligan ? " (mulligan)" : ""}`;
    case "LegionMoved": return `${a.legionId} ${a.from}→${a.to}${a.teleport ? " (teleport)" : ""}`;
    case "LegionSplit": return `split ${a.parentLegionId}(${a.parentHeight}) / ${a.childLegionId}(${a.childHeight})`;
    case "CreatureRecruited": return `recruit @${a.land} → height ${a.newHeight}`;
    case "BattleJoined": return `battle @${a.land} (${a.terrain}) ${a.attackerLegion} vs ${a.defenderLegion}`;
    case "BattlePhaseAdvanced": return `battle r${a.round} ${a.activeSide} ${a.phase}`;
    case "StrikeResolved": return `strike ${a.strikerId}→${a.targetId}: ${a.dice}d need ${a.strikeNumber} rolled [${(a.rolls as number[]).join(",")}] = ${a.hits} hit${a.carriedTo ? ` carry→${a.carriedTo}` : ""}`;
    case "CombatantSlain": return `SLAIN ${a.creature} (${a.side} ${a.combatantId})`;
    case "AngelSummoned": return `summon ${a.creature} from ${a.fromLegion}`;
    case "BattleReinforced": return `reinforce ${a.creature}`;
    case "BattleConcluded": return `battle ${a.outcome} winner=${a.winnerId ?? "—"} +${a.pointsAwarded}${a.timeLoss ? " TIME-LOSS" : ""}`;
    case "MarkersInherited": return `${a.heirId} inherits ${(a.markers as string[]).length} markers from ${a.fromId}`;
    case "PlayerEliminated": return `ELIMINATED ${a.playerId}`;
    case "GameEnded": return `GAME OVER winner=${a.winnerId ?? "—"}`;
    case "EngagementResolved": return `engagement @${a.land} ${a.outcome} +${a.pointsAwarded}`;
    default: return e.type;
  }
}
