/**
 * Inspector (Titan client, ui) — the left-docked debugging panel as a class.
 *
 * Shows the live FSM (breadcrumbs + full topology with the active branch lit)
 * and the whole game state in collapsible, tone-coloured sections. Pure data
 * shaping lives in debugModel.ts; this class is presentation, built from the
 * shared dom toolkit.
 */

import { elem, txt, eyebrow, chip, input, theme } from "./dom.ts";
import { type as typ } from "./tokens.ts";
import { flattenFsm, activeChain, stateSections, type StateRow, type Tone } from "./debugModel.ts";
import type { GameStateView } from "@titan/engine";

export interface CommandInfo { kind: "idle" | "submitting" | "rejected"; commandType?: string; message?: string }

const TONE: Record<Tone, string> = { normal: theme.ink, good: theme.good, warn: theme.warn, muted: theme.dim };
const WIDTH = 360;

export class Inspector {
  readonly el: HTMLElement;
  private readonly phaseRow: HTMLElement;
  private readonly body: HTMLElement;
  private readonly searchEl: HTMLInputElement;
  private readonly collapsed = new Set<string>();
  private query = "";
  private showJson = false;
  private open = true;
  private view: GameStateView | null = null;
  private command: CommandInfo = { kind: "idle" };

  constructor() {
    this.searchEl = input("filter…");
    this.searchEl.style.cssText += `;background:${theme.field};color:${theme.ink};border:1px solid ${theme.line};margin:0;font-family:${typ.mono};font-size:11px`;
    this.searchEl.oninput = () => { this.query = this.searchEl.value.trim().toLowerCase(); this.renderBody(); };

    const toggle = chip("▾", { onClick: () => { this.open = !this.open; this.render(); }, title: "collapse panel" });
    const jsonBtn = chip("{ }", { onClick: () => { this.showJson = !this.showJson; this.renderBody(); }, title: "raw JSON" });
    const copyBtn = chip("⧉", { onClick: () => this.copy(copyBtn), title: "copy state" });

    const head = elem("div", `flex:0 0 auto;padding:16px 16px 10px;background:${theme.bgDeep};border-bottom:1px solid ${theme.brass}`, {
      children: [
        elem("div", "display:flex;align-items:center;gap:8px", { children: [
          elem("div", "flex:1", { children: [eyebrow("Inspector · state & FSM")] }),
          toggle,
        ] }),
        elem("div", "display:flex;gap:6px;margin-top:10px", { children: [
          elem("div", "flex:1;min-width:0", { children: [this.searchEl] }), jsonBtn, copyBtn,
        ] }),
      ],
    });
    this.phaseRow = elem("div", "padding:10px 16px 0;line-height:1.5");
    head.appendChild(this.phaseRow);

    this.body = elem("div", "flex:1 1 auto;overflow:auto;padding:16px");
    this.el = elem("aside", `width:${WIDTH}px;flex:0 0 ${WIDTH}px;height:100%;display:flex;flex-direction:column;background:${theme.bg};color:${theme.ink};border-right:1px solid ${theme.brass};font-family:${typ.mono};font-size:${typ.scale.xs};overflow:hidden`, { attrs: { "aria-label": "Game state inspector" } });
    this.el.append(head, this.body);
    this.render();
  }

  update(view: GameStateView | null, command: CommandInfo = { kind: "idle" }): void {
    this.view = view;
    this.command = command;
    this.renderBody();
  }

  private render(): void {
    this.el.style.width = this.open ? `${WIDTH}px` : "44px";
    this.el.style.flexBasis = this.open ? `${WIDTH}px` : "44px";
    this.renderBody();
  }

  private renderBody(): void {
    this.phaseRow.replaceChildren();
    if (this.view) {
      this.phaseRow.appendChild(txt(this.view.fsm.path, theme.brassBright, "12px"));
      if (this.command.kind === "submitting") this.phaseRow.appendChild(txt(`  submitting ${this.command.commandType ?? ""}…`, theme.brass, "11px"));
      else if (this.command.kind === "rejected") this.phaseRow.appendChild(txt(`  ✕ ${this.command.message ?? ""}`, theme.warn, "11px"));
    } else this.phaseRow.appendChild(txt("awaiting state…", theme.dim, "12px"));

    this.body.style.display = this.open ? "block" : "none";
    if (!this.open) { this.body.replaceChildren(); return; }
    this.body.replaceChildren();
    if (!this.view) { this.body.appendChild(txt("No game state yet.", theme.dim, "12px")); return; }
    if (this.showJson) { this.body.appendChild(this.jsonBlock(this.view)); return; }

    this.body.appendChild(this.fsmBlock(this.view.fsm.path));
    for (const sec of stateSections(this.view)) this.body.appendChild(this.section(sec.title, sec.rows));
  }

  private fsmBlock(path: string): HTMLElement {
    const wrap = this.shell("FSM");
    const chain = activeChain(path);
    const crumbs = elem("div", "display:flex;flex-wrap:wrap;gap:4px;margin:2px 0 8px");
    path.split(".").forEach((seg, i, arr) => {
      crumbs.appendChild(elem("span", `padding:1px 7px;border-radius:10px;font-size:11px;${i === arr.length - 1 ? `background:${theme.accent};color:${theme.ink};font-weight:700` : `background:${theme.field};color:${theme.brassBright}`}`, { text: seg }));
    });
    wrap.appendChild(crumbs);
    for (const node of flattenFsm()) {
      if (this.query && !node.path.toLowerCase().includes(this.query) && !chain.has(node.path)) continue;
      const onChain = chain.has(node.path);
      const leaf = node.path === path;
      wrap.appendChild(elem("div", [
        `padding:2px 6px 2px ${8 + node.depth * 14}px`, "border-radius:3px", "white-space:nowrap",
        leaf ? `background:${theme.accent};color:${theme.ink}` : onChain ? `color:${theme.brassBright}` : `color:${theme.dim}`,
        onChain && !leaf ? `border-left:2px solid ${theme.brass}` : "border-left:2px solid transparent",
        onChain ? "font-weight:600" : "font-weight:400",
      ].join(";"), { text: (node.children.length ? "▸ " : "· ") + node.name }));
    }
    return wrap;
  }

  private section(title: string, rows: StateRow[]): HTMLElement {
    const isCollapsed = this.collapsed.has(title);
    const wrap = this.shell(title, () => { isCollapsed ? this.collapsed.delete(title) : this.collapsed.add(title); this.renderBody(); }, isCollapsed);
    if (isCollapsed) return wrap;
    for (const r of rows) {
      if (this.query && !`${r.k} ${r.v}`.toLowerCase().includes(this.query)) continue;
      const line = elem("div", "display:flex;gap:8px;padding:1px 0;align-items:baseline");
      const k = txt(r.k, theme.brass, "11px");
      k.style.cssText += ";flex:0 0 38%;overflow:hidden;text-overflow:ellipsis";
      const v = txt(r.v, TONE[r.tone ?? "normal"], "11px");
      v.style.cssText += ";flex:1;word-break:break-word";
      line.append(k, v);
      wrap.appendChild(line);
    }
    return wrap;
  }

  private shell(title: string, onToggle?: () => void, isCollapsed = false): HTMLElement {
    const head = elem("div", `display:flex;align-items:center;gap:6px;letter-spacing:.16em;text-transform:uppercase;font-size:10px;color:${theme.brass};margin-bottom:5px;user-select:none;cursor:${onToggle ? "pointer" : "default"}`, { onClick: onToggle });
    if (onToggle) head.appendChild(txt(isCollapsed ? "▸" : "▾", theme.brass, "10px"));
    head.appendChild(txt(title, theme.brassBright, "10px"));
    return elem("div", "margin-bottom:14px", { children: [head] });
  }

  private jsonBlock(view: GameStateView): HTMLElement {
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(view, null, 2);
    pre.style.cssText = `margin:0;white-space:pre-wrap;word-break:break-word;font-size:10px;line-height:1.45;color:${theme.ink}`;
    return pre;
  }

  private copy(btn: HTMLElement): void {
    if (!this.view) return;
    try { void navigator.clipboard?.writeText(JSON.stringify(this.view, null, 2)); } catch { /* no-op */ }
    btn.textContent = "✓";
    setTimeout(() => { btn.textContent = "⧉"; }, 900);
  }
}
