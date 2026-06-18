/**
 * Inspector (Titan client, ui) — the debugging drawer as a class.
 *
 * A collapsible drawer that OVERLAYS the board from the left. Closed, it leaves
 * the board full-width and shows only a slim launcher tab. Open, it slides in
 * with three tabs — State (grouped game state), FSM (live topology with the
 * active branch lit), and JSON (raw snapshot) — plus a filter and copy.
 *
 * Pure data shaping lives in debugModel.ts; this class is presentation, built
 * from the shared dom toolkit.
 */

import { elem, txt, eyebrow, iconButton, input, theme, surface } from "./dom.ts";
import { type as typ } from "./tokens.ts";
import { flattenFsm, activeChain, stateSections, type StateRow, type Tone } from "./debugModel.ts";
import type { GameStateView } from "@titan/engine";

export interface CommandInfo { kind: "idle" | "submitting" | "rejected"; commandType?: string; message?: string }

const TONE: Record<Tone, string> = { normal: theme.ink, good: theme.good, warn: theme.warn, muted: theme.dim };
const WIDTH = 384;
type Tab = "state" | "fsm" | "json";

export class Inspector {
  readonly el: HTMLElement;
  private readonly drawer: HTMLElement;
  private readonly launcher: HTMLButtonElement;
  private readonly tabsRow: HTMLElement;
  private readonly searchWrap: HTMLElement;
  private readonly pathStrip: HTMLElement;
  private readonly body: HTMLElement;
  private readonly searchEl: HTMLInputElement;
  private readonly collapsed = new Set<string>();
  private query = "";
  private tab: Tab = "state";
  private open = false; // collapsed by default — the board gets the room
  private view: GameStateView | null = null;
  private command: CommandInfo = { kind: "idle" };

  constructor() {
    this.searchEl = input("filter state & fsm…");
    this.searchEl.style.cssText += `;margin:0;background:${theme.field};color:${theme.ink};border:1px solid ${theme.line};font-family:${typ.mono};font-size:11px;padding:7px 10px`;
    this.searchEl.oninput = () => { this.query = this.searchEl.value.trim().toLowerCase(); this.renderBody(); };

    const copyBtn = iconButton("⧉", { title: "Copy state JSON" });
    copyBtn.onclick = () => this.copy(copyBtn);
    const closeBtn = iconButton("✕", { title: "Close inspector (`)" });
    closeBtn.onclick = () => this.setOpen(false);

    this.tabsRow = elem("div", "display:flex;gap:4px;margin-top:10px");
    this.searchWrap = elem("div", "margin-top:10px");
    this.searchWrap.appendChild(this.searchEl);
    this.pathStrip = elem("div", `padding:8px 16px;background:${theme.bgDeep};border-bottom:1px solid ${theme.lineSoft};line-height:1.5;display:flex;flex-wrap:wrap;gap:6px;align-items:center`);

    const head = elem("div", `flex:0 0 auto;padding:14px 16px 12px;background:${theme.bgDeep};border-bottom:1px solid ${theme.brass}`, {
      children: [
        elem("div", "display:flex;align-items:center;gap:8px", { children: [
          elem("div", "flex:1", { children: [eyebrow("Inspector")] }),
          copyBtn, closeBtn,
        ] }),
        this.tabsRow,
        this.searchWrap,
      ],
    });

    this.body = elem("div", "flex:1 1 auto;overflow:auto;padding:14px 16px 24px");

    this.drawer = elem("aside", [
      `position:absolute;left:0;top:0;bottom:0;width:${WIDTH}px`,
      `display:flex;flex-direction:column;background:${theme.bg};color:${theme.ink}`,
      `border-right:1px solid ${theme.brass}`, `box-shadow:${surface.elevation.lg}`,
      `font-family:${typ.mono};font-size:${typ.scale.xs}`, "overflow:hidden",
      "pointer-events:auto", "transition:transform 200ms ease, opacity 200ms ease",
    ].join(";"), { attrs: { "aria-label": "Game state inspector" } });
    this.drawer.append(head, this.pathStrip, this.body);

    this.launcher = iconButton("‹›", { title: "Open inspector (`)" });
    this.launcher.onclick = () => this.setOpen(true);
    this.launcher.style.cssText += [
      ";position:absolute;left:12px;top:12px;width:auto;height:auto;padding:7px 11px;gap:7px",
      "pointer-events:auto", `box-shadow:${surface.elevation.md}`,
    ].join(";");
    this.launcher.textContent = "";
    this.launcher.append(
      elem("span", `font-family:${typ.mono};font-size:13px;color:${theme.brassBright}`, { text: "‹›" }),
      elem("span", `font-family:${typ.mono};font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${theme.dim}`, { text: "Debug" }),
    );

    this.el = elem("div", "position:absolute;left:0;top:0;bottom:0;z-index:30;pointer-events:none");
    this.el.append(this.drawer, this.launcher);

    // Backtick toggles the drawer from anywhere.
    document.addEventListener("keydown", (e) => {
      if (e.key === "`" && !isTyping(e)) { e.preventDefault(); this.setOpen(!this.open); }
    });

    this.applyOpenState();
    this.renderTabs();
    this.render();
  }

  update(view: GameStateView | null, command: CommandInfo = { kind: "idle" }): void {
    this.view = view;
    this.command = command;
    this.renderBody();
  }

  private setOpen(open: boolean): void {
    if (this.open === open) return;
    this.open = open;
    this.applyOpenState();
    if (open) setTimeout(() => this.searchEl.focus(), 210);
  }

  private applyOpenState(): void {
    this.drawer.style.transform = this.open ? "translateX(0)" : `translateX(-${WIDTH + 8}px)`;
    this.drawer.style.opacity = this.open ? "1" : "0";
    this.launcher.style.display = this.open ? "none" : "inline-flex";
  }

  private render(): void {
    this.renderBody();
  }

  private tabBtn(label: string, tab: Tab): HTMLElement {
    const active = this.tab === tab;
    const b = elem("button", [
      "flex:1", "padding:6px 8px", "text-align:center", "cursor:pointer",
      `font-family:${typ.mono}`, "font-size:11px", "letter-spacing:.06em", "text-transform:uppercase", "font-weight:600",
      `color:${active ? "#FBF4E6" : theme.dim}`,
      `background:${active ? theme.accent : theme.field}`,
      `border:1px solid ${active ? theme.accentBright : theme.line}`,
      `border-radius:${surface.radius.sm}`, "transition:background 120ms ease, color 120ms ease",
    ].join(";"), { text: label, onClick: () => { this.tab = tab; this.renderTabs(); this.renderBody(); } });
    return b;
  }

  private renderTabs(): void {
    this.tabsRow.replaceChildren(
      this.tabBtn("State", "state"),
      this.tabBtn("FSM", "fsm"),
      this.tabBtn("JSON", "json"),
    );
    // Filter is only meaningful for State & FSM.
    this.searchWrap.style.display = this.tab === "json" ? "none" : "block";
  }

  private renderBody(): void {
    // Path strip — always-visible context.
    this.pathStrip.replaceChildren();
    if (this.view) {
      this.pathStrip.appendChild(elem("span", `font-family:${typ.mono};font-size:12px;color:${theme.brassBright};font-weight:700`, { text: this.view.fsm.path }));
      if (this.command.kind === "submitting") this.pathStrip.appendChild(txt(`submitting ${this.command.commandType ?? ""}…`, theme.brass, "11px"));
      else if (this.command.kind === "rejected") this.pathStrip.appendChild(txt(`✕ ${this.command.message ?? ""}`, theme.warn, "11px"));
    } else this.pathStrip.appendChild(txt("awaiting state…", theme.dim, "12px"));

    this.body.replaceChildren();
    if (!this.view) { this.body.appendChild(txt("No game state yet.", theme.dim, "12px")); return; }
    if (this.tab === "json") { this.body.appendChild(this.jsonBlock(this.view)); return; }
    if (this.tab === "fsm") { this.body.appendChild(this.fsmBlock(this.view.fsm.path)); return; }

    let any = false;
    for (const sec of stateSections(this.view)) { this.body.appendChild(this.section(sec.title, sec.rows)); any = true; }
    if (!any) this.body.appendChild(txt("No sections.", theme.dim, "11px"));
  }

  private fsmBlock(path: string): HTMLElement {
    const wrap = elem("div", "");
    const chain = activeChain(path);
    const crumbs = elem("div", "display:flex;flex-wrap:wrap;gap:4px;margin:2px 0 12px");
    path.split(".").forEach((seg, i, arr) => {
      crumbs.appendChild(elem("span", `padding:2px 8px;border-radius:999px;font-size:11px;${i === arr.length - 1 ? `background:${theme.accent};color:#FBF4E6;font-weight:700` : `background:${theme.field};color:${theme.brassBright}`}`, { text: seg }));
    });
    wrap.appendChild(crumbs);
    for (const node of flattenFsm()) {
      if (this.query && !node.path.toLowerCase().includes(this.query) && !chain.has(node.path)) continue;
      const onChain = chain.has(node.path);
      const leaf = node.path === path;
      wrap.appendChild(elem("div", [
        `padding:3px 6px 3px ${8 + node.depth * 14}px`, `border-radius:${surface.radius.sm}`, "white-space:nowrap", "margin:1px 0",
        leaf ? `background:${theme.accent};color:#FBF4E6` : onChain ? `color:${theme.brassBright}` : `color:${theme.dim}`,
        onChain && !leaf ? `border-left:2px solid ${theme.brass}` : "border-left:2px solid transparent",
        onChain ? "font-weight:600" : "font-weight:400",
      ].join(";"), { text: (node.children.length ? "▸ " : "· ") + node.name }));
    }
    return wrap;
  }

  private section(title: string, rows: StateRow[]): HTMLElement {
    const isCollapsed = this.collapsed.has(title);
    const visibleRows = this.query ? rows.filter((r) => `${r.k} ${r.v}`.toLowerCase().includes(this.query)) : rows;
    if (this.query && visibleRows.length === 0) return elem("div", "display:none");

    const head = elem("div", [
      "display:flex;align-items:center;gap:7px", `padding:6px 8px`, `border-radius:${surface.radius.sm}`,
      "letter-spacing:.14em;text-transform:uppercase;font-size:10px", "cursor:pointer;user-select:none",
      `color:${theme.brassBright}`, `background:${theme.bgDeep}`,
    ].join(";"), { onClick: () => { isCollapsed ? this.collapsed.delete(title) : this.collapsed.add(title); this.renderBody(); } });
    head.append(
      txt(isCollapsed ? "▸" : "▾", theme.brass, "10px"),
      elem("span", "flex:1", { children: [txt(title, theme.brassBright, "10px")] }),
      txt(String(visibleRows.length), theme.dim, "10px"),
    );

    const wrap = elem("div", "margin-bottom:8px;border:1px solid " + theme.lineSoft + `;border-radius:${surface.radius.sm};overflow:hidden`, { children: [head] });
    if (isCollapsed) return wrap;

    const rowsBox = elem("div", "padding:6px 10px 8px");
    for (const r of visibleRows) {
      const line = elem("div", "display:flex;gap:8px;padding:2px 0;align-items:baseline");
      const k = txt(r.k, theme.brass, "11px");
      k.style.cssText += ";flex:0 0 40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      const v = txt(r.v, TONE[r.tone ?? "normal"], "11px");
      v.style.cssText += ";flex:1;word-break:break-word";
      line.append(k, v);
      rowsBox.appendChild(line);
    }
    wrap.appendChild(rowsBox);
    return wrap;
  }

  private jsonBlock(view: GameStateView): HTMLElement {
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(view, null, 2);
    pre.style.cssText = `margin:0;white-space:pre-wrap;word-break:break-word;font-size:10px;line-height:1.5;color:${theme.ink};font-family:${typ.mono}`;
    return pre;
  }

  private copy(btn: HTMLElement): void {
    if (!this.view) return;
    try { void navigator.clipboard?.writeText(JSON.stringify(this.view, null, 2)); } catch { /* no-op */ }
    const prev = btn.textContent;
    btn.textContent = "✓";
    setTimeout(() => { btn.textContent = prev; }, 900);
  }
}

/** True when focus is in a text field — so the backtick hotkey doesn't fire. */
function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable;
}
