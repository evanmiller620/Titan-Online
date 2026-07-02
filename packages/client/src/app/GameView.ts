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
import { planMasterboardClick, planBattleClick, seatActsNow, battleBanner, seatLegions, reachableLands, landSummary, autoAction, NO_SELECTION, BATTLE_MAPS, deployZoneLabels } from "@titan/engine";
import { elem, txt, eyebrow, chip, button, input, iconButton, theme, surface } from "../ui/dom.ts";
import { type as typ } from "../ui/tokens.ts";
import { helpOverlay } from "../ui/Help.ts";
import { formatEvent, humanizeType } from "../ui/eventLog.ts";
import { HAZARD_INFO, BORDER_INFO } from "../ui/battleInfo.ts";
import { currentGuidance, phaseLabel } from "../ui/guidance.ts";

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
  private legionsEl!: HTMLElement;
  private logEl!: HTMLElement;
  private devEl!: HTMLElement;
  private tooltip!: HTMLElement;
  private turnBanner!: HTMLElement;
  private splitPick = new Set<number>(); // creature indices chosen for a new legion
  private splitFor: string | null = null; // which legion the pick applies to
  private readonly forceField = input("dice e.g. 6,6,1");
  private readonly help = helpOverlay();
  private fastplay = false;
  private fastplayPending = false;
  private topRow!: HTMLElement;
  private phaseEl!: HTMLElement;
  private legionsWrap!: HTMLElement;
  private devWrap!: HTMLElement;
  private logWrap!: HTMLElement;
  private legendEl!: HTMLElement;
  private readonly collapsed = new Set<string>(["dev"]); // Developer tucked away by default

  constructor(session: GameSession, opts: { autoFollow: boolean }) {
    this.session = session;
    this.autoFollow = opts.autoFollow;
  }

  mount(root: HTMLElement): void {
    root.innerHTML = "";
    root.style.cssText = `position:absolute;inset:0;display:flex;background:${theme.bgDeep}`;

    const boardEl = elem("div", "position:relative;flex:1;min-width:0");
    this.tooltip = elem("div", `position:absolute;pointer-events:none;display:none;z-index:8;padding:7px 10px;background:#181B20;color:${theme.ink};border:1px solid ${theme.brass};border-radius:${surface.radius.md};font-family:${typ.body};font-size:12px;max-width:220px;box-shadow:${surface.elevation.md}`);
    boardEl.appendChild(this.tooltip);
    boardEl.appendChild(this.buildTurnBanner());
    boardEl.appendChild(this.boardLegend());
    boardEl.appendChild(this.boardControls());
    root.appendChild(boardEl);
    // Inspector is an OVERLAY drawer — appended after the board so it floats on top.
    root.appendChild(this.inspector.el);

    this.topRow = elem("div", "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px");
    this.phaseEl = elem("div", "display:flex;align-items:center;gap:4px;margin-bottom:14px");
    this.seatRow = elem("div", "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px");
    this.bar = elem("div", "display:flex;flex-direction:column;gap:8px");
    this.status = elem("div", "display:none");
    this.legionsEl = elem("div", "display:flex;flex-direction:column;gap:6px;margin-top:10px");
    this.devEl = elem("div", "display:flex;flex-direction:column;gap:6px;margin-top:10px");
    this.logEl = elem("div", `margin-top:8px;font-family:${typ.mono};font-size:11px;line-height:1.5;color:${theme.dim}`);

    this.legionsWrap = this.collapsibleSection("legions", "Your legions", this.legionsEl);
    this.devWrap = this.collapsibleSection("dev", "Developer tools", this.devEl);
    this.logWrap = this.collapsibleSection("log", "Event log", this.logEl, () => this.logActions());

    const control = elem("aside", `width:336px;flex:0 0 336px;height:100%;overflow:auto;background:${theme.bg};border-left:1px solid ${theme.brass};color:${theme.ink}`, {
      children: [
        this.railHeader(),
        elem("div", "padding:16px", { children: [
          this.topRow, this.phaseEl, this.seatRow, this.bar, this.status,
          this.legionsWrap, this.devWrap, this.logWrap,
        ] }),
      ],
    });
    root.appendChild(control);
    root.appendChild(this.help.el);

    void this.initBoard(boardEl);
    this.session.onChange(() => this.render());
    document.addEventListener("keydown", (e) => this.onKey(e));
  }

  /** Wordmark header pinned to the top of the control rail. */
  private railHeader(): HTMLElement {
    return elem("div", `position:sticky;top:0;z-index:2;display:flex;align-items:baseline;gap:10px;padding:14px 16px;background:${theme.bgDeep};border-bottom:1px solid ${theme.brass}`, {
      children: [
        elem("div", `font-family:${typ.display};font-size:22px;font-weight:700;letter-spacing:.04em;color:${theme.brassBright}`, { text: "TITAN" }),
        elem("div", `font-family:${typ.mono};font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:${theme.dim}`, { text: "command" }),
      ],
    });
  }

  /** A collapsible rail section with a clickable header and optional toolbar. */
  private collapsibleSection(key: string, title: string, bodyEl: HTMLElement, tools?: () => HTMLElement[]): HTMLElement {
    const head = elem("div", [
      "display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none",
      "padding:7px 9px", `border-radius:${surface.radius.sm}`, `background:${theme.bgDeep}`,
    ].join(";"), { onClick: () => { this.collapsed.has(key) ? this.collapsed.delete(key) : this.collapsed.add(key); this.render(); } });
    const caret = txt("▾", theme.brass, "10px");
    caret.setAttribute("data-caret", key);
    head.append(caret, elem("div", "flex:1", { children: [eyebrow(title)] }));
    for (const t of tools?.() ?? []) head.appendChild(t);
    return elem("div", "margin-top:16px", { children: [head, bodyEl] });
  }

  /** Toolbar for the event-log section: a clear button. */
  private logActions(): HTMLElement[] {
    const clear = iconButton("⌫", { title: "Clear log" });
    clear.style.cssText += ";width:26px;height:26px;font-size:12px";
    clear.onclick = (e) => { e.stopPropagation(); this.log.length = 0; this.render(); };
    return [clear];
  }

  private applyCollapse(): void {
    const sync = (key: string, wrap: HTMLElement | undefined, body: HTMLElement) => {
      if (!wrap) return;
      const open = !this.collapsed.has(key);
      body.style.display = open ? "" : "none";
      const caret = wrap.querySelector(`[data-caret="${key}"]`);
      if (caret) caret.textContent = open ? "▾" : "▸";
    };
    sync("legions", this.legionsWrap, this.legionsEl);
    sync("dev", this.devWrap, this.devEl);
    sync("log", this.logWrap, this.logEl);
  }

  /** Keyboard: Enter fires the primary action; Esc closes Help or deselects. */
  private onKey(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      const primary = this.session.actions().find((a) => a.primary) ?? this.session.actions()[0];
      if (primary) { e.preventDefault(); void this.submit(primary.dto); }
    } else if (e.key === "Escape") {
      if (this.session.getSelection().legion || this.session.getSelection().combatant) {
        this.session.select(NO_SELECTION);
        this.showTooltip(null);
        this.render();
      }
    }
  }

  /** Zoom / fit controls pinned to the board's top-right corner. */
  private boardControls(): HTMLElement {
    const btn = (glyph: string, title: string, fn: () => void) => {
      const b = iconButton(glyph, { title });
      b.style.cssText += `;width:34px;height:34px;font-size:16px;box-shadow:${surface.elevation.sm};pointer-events:auto`;
      b.onclick = fn;
      return b;
    };
    return elem("div", "position:absolute;right:12px;top:12px;z-index:6;display:flex;flex-direction:column;gap:6px;pointer-events:none", {
      children: [
        btn("+", "Zoom in", () => this.board?.zoomBy(1.25)),
        btn("−", "Zoom out", () => this.board?.zoomBy(1 / 1.25)),
        btn("⤢", "Fit board to view", () => this.board?.resetView()),
      ],
    });
  }

  /** The turn banner floats top-centre over the board: whose turn, which phase,
   *  and exactly what to do — the one thing a player reads between clicks. */
  private buildTurnBanner(): HTMLElement {
    this.turnBanner = elem("div", [
      "position:absolute;top:12px;left:50%;transform:translateX(-50%)",
      "z-index:5;pointer-events:none;max-width:min(520px,70%)",
      "padding:10px 18px;text-align:center",
      "background:rgba(24,27,32,0.92)", `border:1px solid ${theme.brass}`,
      `border-radius:${surface.radius.md}`, `box-shadow:${surface.elevation.md}`,
    ].join(";"));
    return this.turnBanner;
  }

  private renderTurnBanner(v: GameStateView | null): void {
    if (!this.turnBanner) return;
    if (!v) { this.turnBanner.style.display = "none"; return; }
    this.turnBanner.style.display = "block";
    const acts = seatActsNow(v, this.session.focusedSeat);
    const g = currentGuidance(v, this.session.focusedSeat, this.session.getSelection(), acts);
    const accent = g.tone === "act" ? theme.brassBright : g.tone === "wait" ? theme.dim : theme.verdigris;
    this.turnBanner.style.borderColor = g.tone === "act" ? theme.brassBright : theme.brass;
    const active = v.playerOrder[v.turn.activeIndex];
    const activeColor = (v.players[active ?? ""] as { color?: string } | undefined)?.color ?? active ?? "";
    const kids: HTMLElement[] = [
      elem("div", `font-family:${typ.mono};font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:${theme.brass}`, {
        text: v.fsm.path === "GameOver" ? "Game over" : `${activeColor}'s turn · ${phaseLabel(v)}`,
      }),
      elem("div", `font-family:${typ.body};font-size:15px;font-weight:700;line-height:1.3;color:${accent};margin-top:2px`, { text: g.title }),
    ];
    if (g.detail) kids.push(elem("div", `font-size:11.5px;color:${theme.dim};margin-top:2px;line-height:1.4`, { text: g.detail }));
    this.turnBanner.replaceChildren(...kids);
  }

  /** A small key pinned to the board corner — swaps between movement (master)
   *  and combatant (battle) modes via {@link updateLegend}. */
  private boardLegend(): HTMLElement {
    this.legendEl = elem("div", `position:absolute;left:12px;bottom:12px;z-index:4;pointer-events:none;padding:9px 11px;background:rgba(24,27,32,0.88);border:1px solid ${theme.line};border-radius:${surface.radius.md};display:flex;flex-direction:column;gap:5px;box-shadow:${surface.elevation.sm}`);
    this.updateLegend(false);
    return this.legendEl;
  }

  private legendItem(swatch: string, label: string): HTMLElement {
    return elem("div", "display:flex;align-items:center;gap:7px", {
      children: [elem("span", `display:inline-block;flex:0 0 auto;${swatch}`), txt(label, theme.dim, "11px")],
    });
  }

  private updateLegend(inBattle: boolean): void {
    if (!this.legendEl) return;
    const title = (t: string) => elem("div", `font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:${theme.brass};margin-bottom:2px`, { text: t });
    if (inBattle) {
      this.buildBattleLegend(title);
    } else {
      const glyph = (t: string, label: string) => elem("div", "display:flex;align-items:center;gap:7px", {
        children: [
          elem("span", "flex:0 0 22px;font-size:11px;letter-spacing:-1px;color:#F2EAD3;text-align:center", { text: t }),
          txt(label, theme.dim, "11px"),
        ],
      });
      this.legendEl.replaceChildren(
        title("Board gates"),
        glyph("▸▸▸", "track — the normal flow"),
        glyph("▸", "tower / summit link"),
        glyph("◠", "arch — pass or stop, both ways"),
        glyph("▬", "block — exit only, no entry"),
        elem("div", `margin-top:5px;padding-top:5px;border-top:1px solid ${theme.line};display:flex;flex-direction:column;gap:5px`, { children: [
          this.legendItem(`width:12px;height:12px;border:2.5px solid ${theme.brassBright};border-radius:50%`, "your legion can act"),
          this.legendItem(`width:12px;height:12px;border:2.5px solid ${theme.verdigris};border-radius:50%`, "reachable now"),
          this.legendItem(`width:12px;height:12px;border:2.5px solid ${theme.accentBright};border-radius:50%`, "selected legion"),
        ] }),
        elem("div", `margin-top:3px;font-size:10px;color:${theme.dim}`, { text: "hover a land → its exits · scroll/drag to zoom & pan" }),
      );
    }
  }

  /** Battle legend: the side key plus every hazard / hexside feature actually
   *  present on THIS battleland, with its movement & combat modifiers. */
  private buildBattleLegend(title: (t: string) => HTMLElement): void {
    const terrain = this.session.view()?.battle?.terrain;
    const map = terrain ? BATTLE_MAPS[terrain] : undefined;
    const kids: HTMLElement[] = [
      title(terrain ? `${terrain} battleland` : "Battle"),
      this.legendItem(`width:12px;height:12px;border-radius:50%;background:${theme.accent}`, "your attackers"),
      this.legendItem(`width:12px;height:12px;border-radius:50%;background:${theme.verdigris}`, "defenders"),
    ];
    if (map) {
      const hazards = new Set<string>();
      const borders = new Set<string>();
      let highGround = false;
      for (const h of map.hexes) {
        if (h.terrain !== "Plains") hazards.add(h.terrain);
        if (h.elevation > 0) highGround = true;
        for (const b of h.borders) borders.add(b.type);
      }
      const rows: HTMLElement[] = [];
      for (const hz of hazards) { const info = HAZARD_INFO[hz]; if (info) rows.push(this.legendRow(info.color, false, hz, info.effect)); }
      if (highGround) rows.push(this.legendRow(theme.dim, false, "High ground", "aids down-strikes over slopes & walls"));
      for (const b of borders) { const info = BORDER_INFO[b]; if (info) rows.push(this.legendRow(info.color, true, info.name, info.effect)); }
      if (rows.length) {
        kids.push(elem("div", `margin-top:5px;padding-top:5px;border-top:1px solid ${theme.line};display:flex;flex-direction:column;gap:5px;max-width:250px`, { children: rows }));
      }
    }
    kids.push(elem("div", `margin-top:4px;font-size:10px;color:${theme.dim}`, { text: "tap a hex to move or strike" }));
    this.legendEl.replaceChildren(...kids);
  }

  /** One terrain-key row: a colour swatch (square = hazard, bar = hexside) + a
   *  name and its rules effect. */
  private legendRow(color: string, isEdge: boolean, name: string, effect: string): HTMLElement {
    const swatch = isEdge
      ? `width:13px;height:4px;border-radius:2px;background:${color};margin-top:4px`
      : `width:11px;height:11px;border-radius:2px;background:${color};margin-top:1px`;
    return elem("div", "display:flex;gap:7px;align-items:flex-start", {
      children: [
        elem("span", `display:inline-block;flex:0 0 auto;${swatch}`),
        elem("div", "display:flex;flex-direction:column;line-height:1.25", {
          children: [
            elem("span", `font-size:11px;font-weight:600;color:${theme.ink}`, { text: name }),
            elem("span", `font-size:10px;color:${theme.dim}`, { text: effect }),
          ],
        }),
      ],
    });
  }

  private async initBoard(boardEl: HTMLElement): Promise<void> {
    const app = new Application();
    await app.init({ background: theme.bg, antialias: true, resizeTo: boardEl });
    boardEl.appendChild(app.canvas);
    const w = app.canvas.width || boardEl.clientWidth || 800;
    const h = app.canvas.height || boardEl.clientHeight || 600;
    this.board = new MasterboardRenderer(app, w, h);
    this.board.attachInput({ onLandClick: (id) => this.onMasterClick(id), onLandHover: (id, pt) => this.showTooltip(id, pt) });
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
    const plan = planBattleClick(v, this.session.focusedSeat, this.session.getSelection(), cube);
    if (plan.dto) void this.submit(plan.dto);
    else if (plan.select) this.session.select(plan.select);
  }

  private async submit(dto: CommandDTO): Promise<void> {
    this.setStatus(`submitting ${humanizeType(dto.type)}…`, "info");
    const r = await this.session.submit(dto);
    if (!r.ok) {
      this.setStatus(`✕ ${r.message}`, "warn");
    } else {
      this.setStatus("", "info");
      const v = this.session.view();
      const actor = (v?.players?.[dto.playerId] as { color?: string } | undefined)?.color ?? dto.playerId;
      const lines = this.session.lastEvents().map(formatEvent).filter((l) => l.length > 0);
      const shown = lines.length ? lines : [humanizeType(dto.type)];
      const tag = `<span style="color:${theme.brassBright}">${actor}</span>`;
      // Newest command on top; events within it stay chronological.
      for (let i = shown.length - 1; i >= 0; i--) {
        this.log.unshift(`${tag} <span style="color:${theme.ink}">${shown[i]}</span>`);
      }
      while (this.log.length > 80) this.log.pop();
      if (this.autoFollow) this.session.focusActiveSeat();
    }
    this.render();
  }

  private renderDev(): void {
    const dev = this.session.dev();
    if (!dev) {
      this.devEl.replaceChildren(elem("div", `padding:9px 10px;border:1px solid ${theme.lineSoft};border-radius:${surface.radius.sm};background:${theme.bgDeep}`, {
        children: [txt("Networked game — rules run on each client; dev tools are local-table only.", theme.dim, "11px")],
      }));
      return;
    }
    const copy = (label: string, get: () => unknown) =>
      button(label, { full: true, onClick: () => { try { void navigator.clipboard?.writeText(JSON.stringify(get(), null, 2)); } catch { /* no-op */ } } });
    const forceRow = elem("div", "display:flex;gap:6px", {
      children: [
        elem("div", "flex:1", { children: [this.forceField] }),
        button("Force", { onClick: () => { const f = this.forceField.value.split(",").map((n) => Number(n.trim())).filter((n) => n >= 1 && n <= 6); if (f.length) dev.forceRolls(f); } }),
      ],
    });
    this.forceField.style.margin = "0";
    const saveRow = elem("div", "display:flex;gap:6px", {
      children: [
        button("Save", { full: true, onClick: () => { dev.save(); this.flash("saved to slot 'quick'", theme.good); } }),
        button("Load", { full: true, onClick: () => { if (dev.load()) { this.flash("loaded slot 'quick'", theme.good); } else { this.flash("no save found", theme.warn); } } }),
      ],
    });
    this.devEl.replaceChildren(
      this.devGroup("Visibility", [
        button(`Reveal all stacks: ${this.session.isRevealAll() ? "ON" : "off"}`, { full: true, primary: this.session.isRevealAll(), onClick: () => this.session.setRevealAll(!this.session.isRevealAll()) }),
      ]),
      this.devGroup("History", [
        button("Undo last command", { full: true, onClick: () => dev.undo() }),
        saveRow,
      ]),
      this.devGroup("Dice", [forceRow]),
      this.devGroup("Export", [
        copy("Copy state JSON", () => this.session.view()),
        copy("Copy command log", () => dev.snapshot().log),
      ]),
    );
  }

  /** Labelled cluster of dev controls. */
  private devGroup(label: string, kids: HTMLElement[]): HTMLElement {
    return elem("div", "display:flex;flex-direction:column;gap:6px", {
      children: [
        elem("div", `font-family:${typ.mono};font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:${theme.dim};margin-top:2px`, { text: label }),
        ...kids,
      ],
    });
  }

  /** Transient status message, styled as a tone pill. */
  private setStatus(msg: string, tone: "good" | "warn" | "info"): void {
    if (!msg) { this.status.style.display = "none"; this.status.textContent = ""; return; }
    const c = tone === "good" ? theme.good : tone === "warn" ? theme.warn : theme.brassBright;
    this.status.textContent = msg;
    this.status.style.cssText = [
      "display:block", "margin-top:12px", "padding:8px 11px", `border-radius:${surface.radius.sm}`,
      `font-size:${typ.scale.sm}`, "line-height:1.4", `color:${c}`,
      `background:${theme.bgDeep}`, `border:1px solid ${theme.line}`, `border-left:3px solid ${c}`,
    ].join(";");
  }
  /** Back-compat shim for dev tools that pass a colour. */
  private flash(msg: string, color: string): void {
    this.setStatus(msg, color === theme.good ? "good" : color === theme.warn ? "warn" : "info");
  }

  private render(): void {
    const v = this.session.view();
    this.inspector.update(v);
    this.renderTop();
    this.renderPhase(v);
    this.renderSeats(v);
    this.renderBar();
    this.renderLegions(v);
    this.renderDev();
    this.renderBoard(v);
    this.renderTurnBanner(v);
    this.renderLog();
    this.applyCollapse();
    this.maybeFastplay();
  }

  private renderLog(): void {
    if (this.log.length === 0) {
      this.logEl.replaceChildren(elem("div", `padding:10px;text-align:center;color:${theme.dim};font-family:${typ.body};font-size:11px`, { text: "No moves yet." }));
      return;
    }
    this.logEl.replaceChildren(...this.log.map((line, i) => elem("div", [
      "display:flex;gap:8px;padding:4px 6px;line-height:1.45;border-radius:3px",
      i % 2 ? "background:transparent" : "background:rgba(255,255,255,0.02)",
    ].join(";"), {
      children: [
        elem("span", `color:${theme.brass};flex:0 0 auto;opacity:.6`, { text: "›" }),
        elem("span", "flex:1", { html: line }),
      ],
    })));
  }

  /** Help + Fastplay controls, above the seats. */
  private renderTop(): void {
    this.topRow.replaceChildren(
      button((this.fastplay ? "⏵ Fastplay: ON" : "⏵ Fastplay: off"), {
        full: true, primary: this.fastplay,
        title: "Auto-run forced single-option steps",
        onClick: () => { this.fastplay = !this.fastplay; this.render(); },
      }),
      button("Help", { title: "How to play", onClick: () => this.help.show() }),
    );
  }

  /** Streamline forced steps: when fastplay is on and the focused seat has a
   *  single forced option (autoAction), auto-submit it after a short, visible
   *  delay. Chains naturally — each submit re-renders and may fire the next. */
  private maybeFastplay(): void {
    if (!this.fastplay || this.fastplayPending) return;
    const v = this.session.view();
    if (!v || v.fsm.path === "GameOver") return;
    const dto = autoAction(v, this.session.focusedSeat, this.session.getSelection());
    if (!dto) return;
    this.fastplayPending = true;
    setTimeout(() => { this.fastplayPending = false; void this.submit(dto); }, 280);
  }

  /** Phase stepper: where this turn is (Split → Move → Fight → Muster), with
   *  Setup / battle / game-over states. Gives an at-a-glance "what now". */
  private renderPhase(v: GameStateView | null): void {
    if (!v) { this.phaseEl.replaceChildren(); return; }
    const path = v.fsm.path;
    let chips: HTMLElement[];
    if (path === "GameOver") {
      chips = [this.phaseChip("Game over", true)];
    } else if (path.startsWith("Setup") || path === "Lobby") {
      chips = [this.phaseChip("Setup", true)];
    } else if (v.battle) {
      chips = [this.phaseChip("In battle", true)];
    } else {
      const steps: Array<[string, (p: string) => boolean]> = [
        ["Split", (p) => p.endsWith("Commencement")],
        ["Move", (p) => p.endsWith("Movement")],
        ["Fight", (p) => p.includes("Engagement")],
        ["Muster", (p) => p.endsWith("Mustering")],
      ];
      const activeIdx = steps.findIndex(([, on]) => on(path));
      chips = [];
      steps.forEach(([label, on], i) => {
        if (i > 0) chips!.push(elem("div", `flex:0 0 auto;color:${i <= activeIdx ? theme.brass : theme.line};font-size:10px`, { text: "›" }));
        chips!.push(this.phaseChip(label, on(path), activeIdx >= 0 && i < activeIdx));
      });
    }
    this.phaseEl.replaceChildren(...chips);
  }

  private phaseChip(label: string, active: boolean, done = false): HTMLElement {
    const bg = active ? theme.accent : done ? theme.fieldHi : theme.field;
    return elem("div", [
      "flex:1", "text-align:center", "padding:6px 4px", `border-radius:${surface.radius.sm}`,
      `font-family:${typ.mono}`, "font-size:11px", "letter-spacing:.04em", active ? "font-weight:700" : "font-weight:500",
      `color:${active ? "#FBF4E6" : done ? theme.brassBright : theme.dim}`,
      `background:${bg}`,
      `border:1px solid ${active ? theme.accentBright : done ? theme.brass : theme.line}`,
    ].join(";"), { text: done ? `✓ ${label}` : label });
  }

  private renderSeats(v: GameStateView | null): void {
    this.seatRow.replaceChildren(...this.session.seats.map((s) => {
      const acts = !!v && seatActsNow(v, s.slot);
      const p = v?.players?.[s.slot] as { color?: string; score?: number; eliminated?: boolean } | undefined;
      const name = p?.color ?? s.slot;
      const legionCount = v ? Object.values(v.legions).filter((l) => l.ownerId === s.slot).length : 0;
      const label = p?.eliminated
        ? `${name} (out)`
        : `${name}${s.control === "remote" ? " ⇄" : ""} · ${p?.score ?? 0}pt · ${legionCount}L`;
      return chip(label, {
        active: s.slot === this.session.focusedSeat, ring: acts,
        title: s.control === "local" ? "local seat — click to drive" : "remote seat",
        onClick: s.control === "local" ? () => { this.session.setFocus(s.slot); this.render(); } : undefined,
      });
    }));
  }

  /** Deployment state for the focused seat, or null when not deploying now. */
  private deployContext(v: GameStateView): { side: string; units: Array<{ id: string; creature: string; placed: boolean }>; available: string[] } | null {
    const b = v.battle;
    if (!b || !v.fsm.path.endsWith("Deployment")) return null;
    if (!seatActsNow(v, this.session.focusedSeat)) return null;
    const side = v.fsm.path.endsWith("DefenderDeployment") ? "defender" : "attacker";
    const sel = this.session.getSelection();
    const placed = new Set(sel.deploy.map((p) => p.combatantId));
    const pendingHexes = new Set(sel.deploy.map((p) => p.hex));
    const map = BATTLE_MAPS[b.terrain];
    const occupied = new Set<string>();
    if (map) {
      const byCube = new Map(map.hexes.map((hxd) => [`${hxd.cube.x},${hxd.cube.y},${hxd.cube.z}`, hxd.label]));
      for (const c of b.combatants) {
        if (!c.hex) continue;
        const l = byCube.get(`${c.hex.x},${c.hex.y},${c.hex.z}`);
        if (l) occupied.add(l);
      }
    }
    const available = deployZoneLabels(b.terrain, side).filter((l) => !pendingHexes.has(l) && !occupied.has(l));
    const units = b.combatants.filter((c) => c.side === side).map((c) => ({ id: c.id, creature: c.creature, placed: placed.has(c.id) }));
    return { side, units, available };
  }

  /** A pick-your-unit deployment tray: tap a unit, then a glowing board hex. */
  private renderDeployPicker(dc: { units: Array<{ id: string; creature: string; placed: boolean }>; available: string[] }): HTMLElement[] {
    const selId = this.session.getSelection().combatant;
    const remaining = dc.units.filter((u) => !u.placed).length;
    const chips = dc.units.map((u) => chip(u.placed ? `✓ ${u.creature}` : u.creature, {
      active: !u.placed && u.id === selId,
      ring: !u.placed && u.id === selId,
      title: u.placed ? "placed — tap its hex to keep it" : "select, then tap a highlighted hex",
      onClick: u.placed ? undefined : () => { this.session.select({ combatant: u.id }); this.render(); },
    }));
    const placedCount = dc.units.length - remaining;
    if (placedCount > 0) {
      chips.push(chip("↺ reset", { title: "clear all placements", onClick: () => { this.session.select({ deploy: [], combatant: null }); this.render(); } }));
    }
    return [
      txt(`Deploy your legion — ${remaining} to place`, theme.brassBright, typ.scale.sm),
      elem("div", `font-size:11px;color:${theme.dim};margin:-2px 0 2px`, { text: remaining ? "Pick a unit, then tap a glowing hex (or just tap hexes to place in order)." : "All placed — confirm below." }),
      elem("div", "display:flex;flex-wrap:wrap;gap:5px", { children: chips }),
    ];
  }

  private renderBar(): void {
    const v = this.session.view();
    const actions = this.session.actions();
    const kids: HTMLElement[] = [this.guidanceBanner(v)];

    // Live battle context (round / side) sits just under the prompt.
    if (v?.battle) { const banner = battleBanner(v); if (banner) kids.push(txt(banner, theme.brass, "11px")); }

    const dc = v ? this.deployContext(v) : null;
    if (dc) for (const el of this.renderDeployPicker(dc)) kids.push(el);

    for (const a of actions) {
      kids.push(button(a.label, { full: true, primary: a.primary === true, onClick: () => void this.submit(a.dto) }));
      if (a.hint) kids.push(elem("div", `font-size:11px;color:${theme.dim};margin:-2px 0 2px`, { text: a.hint }));
    }
    this.bar.replaceChildren(...kids);
  }

  /** A prominent contextual prompt — what the player should do right now,
   *  driven by the pure guidance engine. Replaces the old scattered hints. */
  private guidanceBanner(v: GameStateView | null): HTMLElement {
    const g = currentGuidance(v, this.session.focusedSeat, this.session.getSelection(), v ? seatActsNow(v, this.session.focusedSeat) : false);
    const accent = g.tone === "act" ? theme.brassBright : g.tone === "wait" ? theme.dim : theme.verdigris;
    const glyph = g.tone === "act" ? "▸" : g.tone === "wait" ? "◴" : "✦";
    return elem("div", [
      "display:flex;gap:10px;align-items:flex-start", "padding:12px 14px",
      `border-radius:${surface.radius.md}`, `background:${theme.bgDeep}`,
      `border:1px solid ${theme.line}`, `border-left:3px solid ${accent}`, `box-shadow:${surface.elevation.sm}`,
    ].join(";"), {
      children: [
        elem("div", `font-size:15px;line-height:1.25;color:${accent}`, { text: glyph }),
        elem("div", "flex:1;min-width:0", { children: [
          elem("div", `font-family:${typ.body};font-size:14px;font-weight:700;line-height:1.3;color:${theme.ink}`, { text: g.title }),
          ...(g.detail ? [elem("div", `font-size:11.5px;color:${theme.dim};margin-top:3px;line-height:1.45`, { text: g.detail })] : []),
        ] }),
      ],
    });
  }

  private renderLegions(v: GameStateView | null): void {
    if (!v) { this.legionsEl.replaceChildren(); return; }
    const seat = this.session.focusedSeat;
    const legions = seatLegions(v, seat);
    const selected = this.session.getSelection().legion;
    if (selected !== this.splitFor) { this.splitPick.clear(); this.splitFor = selected; } // reset picks on reselect
    const inCommencement = v.fsm.path.endsWith("Commencement");
    if (legions.length === 0) { this.legionsEl.replaceChildren(txt("No legions.", theme.dim, "11px")); return; }

    const out: HTMLElement[] = [];
    for (const l of legions) {
      const isSel = l.marker === selected;
      const tags: string[] = [`@${l.land} ${l.terrain}`, `h${l.height}`];
      if (l.moved) tags.push("moved");
      if (l.recruited) tags.push("recruited");
      if (l.destinations.length) tags.push(`${l.destinations.length} moves`);
      if (l.recruits.length) tags.push(`can recruit: ${l.recruits.join(", ")}`);
      const kids: HTMLElement[] = [
        elem("div", `font-family:${typ.mono};font-size:12px;color:${theme.brassBright}`, { text: l.marker }),
        elem("div", `font-size:11px;color:${l.recruits.length ? theme.good : theme.dim};margin-top:2px`, { text: tags.join(" · ") }),
      ];
      if (l.creatures) kids.push(elem("div", `font-size:11px;color:${theme.ink};margin-top:2px;word-break:break-word`, { text: l.creatures.join(", ") }));
      out.push(elem("div", [
        "padding:6px 8px", "border-radius:4px", "cursor:pointer",
        `border:1px solid ${isSel ? theme.accent : theme.line}`,
        `background:${isSel ? "#2B2F36" : "transparent"}`,
      ].join(";"), {
        onClick: () => { this.session.select({ legion: l.marker, combatant: null }); this.render(); },
        children: kids,
      }));
      // Split chooser is a SIBLING (not inside the clickable row) so chip taps
      // don't re-select and reset the picks.
      if (isSel && inCommencement && l.creatures) out.push(this.splitChooser(l.marker, l.creatures));
    }
    this.legionsEl.replaceChildren(...out);
  }

  /** Pick which creatures peel off into a NEW legion, then split. */
  private splitChooser(marker: string, creatures: readonly string[]): HTMLElement {
    const chips = creatures.map((c, i) => chip(c, {
      active: this.splitPick.has(i),
      onClick: () => { this.splitPick.has(i) ? this.splitPick.delete(i) : this.splitPick.add(i); this.render(); },
    }));
    const childN = this.splitPick.size;
    const legal = childN >= 1 && childN < creatures.length;
    const split = button(`Split off ${childN} → new legion`, {
      full: true, primary: true, disabled: !legal,
      onClick: () => {
        const v = this.session.view()!;
        const child = [...this.splitPick].sort((a, b) => a - b).map((i) => creatures[i]);
        const newMarker = (v.players[this.session.focusedSeat] as { markersAvailable?: string[] } | undefined)?.markersAvailable?.[0];
        if (!newMarker) return;
        void this.submit({ type: "SplitLegion", playerId: this.session.focusedSeat, payload: { legionId: marker, newMarker, toNewLegion: child } });
      },
    });
    return elem("div", "margin-top:6px;display:flex;flex-direction:column;gap:5px", {
      children: [
        elem("div", `font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:${theme.brass}`, { text: "Split — tap units for the new legion" }),
        elem("div", "display:flex;flex-wrap:wrap;gap:4px", { children: chips }),
        split,
      ],
    });
  }

  private showTooltip(id: number | null, pt?: { x: number; y: number }): void {
    if (id === null || !pt) { this.tooltip.style.display = "none"; return; }
    const s = landSummary(id);
    const rows = s.muster.map((m) =>
      `<div style="display:flex;justify-content:space-between;gap:10px;line-height:1.5">` +
      `<span style="color:${theme.ink}">${m.creature}</span>` +
      `<span style="color:${theme.dim}">${m.requires}</span></div>`).join("");
    this.tooltip.innerHTML =
      `<div style="color:${theme.brassBright};font-weight:600">${s.terrain} <span style="color:${theme.dim};font-weight:400">· land ${s.id}</span></div>` +
      (s.muster.length
        ? `<div style="margin-top:5px;font-size:11px;color:${theme.brass};text-transform:uppercase;letter-spacing:.08em">Muster here · needs</div>${rows}`
        : `<div style="margin-top:4px;color:${theme.dim};font-size:11px">No mustering here</div>`);
    this.tooltip.style.left = `${Math.min(pt.x + 14, (this.tooltip.parentElement?.clientWidth ?? 9999) - 220)}px`;
    this.tooltip.style.top = `${pt.y + 14}px`;
    this.tooltip.style.display = "block";
  }

  private renderBoard(v: GameStateView | null): void {
    if (!this.board || !v) return;
    this.updateLegend(!!v.battle);
    if (v.battle) {
      this.showTooltip(null);
      this.board.setVisible(false);
      this.battle?.setVisible(true);
      const sel = this.session.getSelection();
      const dc = this.deployContext(v);
      this.battle?.render(v, sel.combatant, sel.deploy.map((p) => p.hex), sel.hex, dc?.available ?? []);
    } else {
      this.board.setVisible(true);
      this.battle?.setVisible(false);
      const legion = this.session.getSelection().legion;
      const land = legion && v.legions[legion] ? v.legions[legion]!.land : null;
      // Highlight a selected legion's legal destinations during Movement.
      const reach = legion ? new Set(reachableLands(v, this.session.focusedSeat, legion)) : new Set<number>();
      this.board.render(v, land, null, reach, this.attentionLands(v));
    }
  }

  /** Lands whose legions can still act THIS phase — ringed brass on the board
   *  so "what do I click?" always has a visible answer. */
  private attentionLands(v: GameStateView): Set<number> {
    const out = new Set<number>();
    if (!seatActsNow(v, this.session.focusedSeat)) return out;
    const p = v.fsm.path;
    for (const l of seatLegions(v, this.session.focusedSeat)) {
      if (p.endsWith("Commencement") && l.height >= 4) out.add(l.land);
      else if (p.endsWith("Movement") && !l.moved && l.destinations.length > 0) out.add(l.land);
      else if (p.endsWith("Mustering") && !l.recruited && l.recruits.length > 0) out.add(l.land);
    }
    return out;
  }
}

