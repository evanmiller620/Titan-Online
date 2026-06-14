/**
 * Debug panel (Titan client, ui) — a left-docked inspector for the full game
 * state and the FSM. Imperative DOM (matching multiplayer.ts/preview.ts), so it
 * drops into any mount without a React tree. All data shaping is the pure,
 * tested debugModel.ts; this file is presentation only.
 *
 * UX goals: legible at a glance, never in the way. A sticky header with search,
 * a JSON copy, and collapse-all; the live FSM path shown as breadcrumbs AND a
 * full state tree with the active branch lit and the active leaf as an oxblood
 * pill; every state slice grouped into collapsible, tone-coloured sections.
 */

import { palette, type as typ, space } from "./tokens.ts";
import {
  flattenFsm,
  activeChain,
  stateSections,
  type StateRow,
  type Tone,
} from "./debugModel.ts";
import type { GameStateView } from "@titan/engine";

export interface CommandInfo {
  readonly kind: "idle" | "submitting" | "rejected";
  readonly commandType?: string;
  readonly message?: string;
}

export interface DebugPanel {
  readonly el: HTMLElement;
  update(view: GameStateView | null, command?: CommandInfo): void;
}

const PANEL_WIDTH = 360;

// Tones tuned for the dark ink-slate panel (the parchment inks would vanish).
const TONE_COLOR: Record<Tone, string> = {
  normal: palette.vellum,
  good: "#7FB59B", // lifted verdigris
  warn: palette.alarm, // burnt sienna, readable on dark
  muted: "#7C828B", // dim slate
};

export function createDebugPanel(opts: { startCollapsed?: boolean } = {}): DebugPanel {
  // --- persistent UI state (kept across re-renders) -------------------------
  const collapsed = new Set<string>();
  let query = "";
  let showJson = false;
  let panelOpen = !opts.startCollapsed;
  let lastView: GameStateView | null = null;
  let lastCommand: CommandInfo = { kind: "idle" };

  // --- shell ----------------------------------------------------------------
  const el = n("aside", [
    `width:${PANEL_WIDTH}px`,
    `flex:0 0 ${PANEL_WIDTH}px`,
    "height:100%",
    "display:flex",
    "flex-direction:column",
    "background:#20242A", // ink-slate so the parchment board pops beside it
    `color:${palette.vellum}`,
    `border-right:1px solid ${palette.brass}`,
    `font-family:${typ.mono}`,
    `font-size:${typ.scale.xs}`,
    "overflow:hidden",
  ]);
  el.setAttribute("aria-label", "Game state inspector");

  // Header (sticky chrome)
  const header = n("div", [
    "flex:0 0 auto",
    `padding:${space.md} ${space.md} ${space.sm}`,
    "background:#181B20",
    `border-bottom:1px solid ${palette.brass}`,
  ]);
  const titleRow = n("div", ["display:flex", "align-items:center", "gap:8px"]);
  const eyebrow = n("div", [
    `font-family:${typ.mono}`, "font-size:10px", "letter-spacing:.22em",
    "text-transform:uppercase", `color:${palette.brassBright}`, "flex:1",
  ]);
  eyebrow.textContent = "Inspector · state & FSM";
  const toggleBtn = chip("▾", () => { panelOpen = !panelOpen; render(); });
  toggleBtn.title = "Collapse/expand panel";
  titleRow.append(eyebrow, toggleBtn);

  const controls = n("div", ["display:flex", "gap:6px", "margin-top:10px"]);
  const search = document.createElement("input");
  search.placeholder = "filter…";
  search.style.cssText = [
    "flex:1", "min-width:0", "padding:6px 8px",
    `font-family:${typ.mono}`, "font-size:11px",
    `color:${palette.vellum}`, "background:#2B2F36",
    `border:1px solid #3A3F47`, "border-radius:3px",
  ].join(";");
  search.oninput = () => { query = search.value.trim().toLowerCase(); renderBody(); };
  const jsonBtn = chip("{ }", () => { showJson = !showJson; renderBody(); });
  jsonBtn.title = "Toggle raw JSON";
  const copyBtn = chip("⧉", () => doCopy());
  copyBtn.title = "Copy state JSON";
  const collapseBtn = chip("⊟", () => { collapseAll(); renderBody(); });
  collapseBtn.title = "Collapse all sections";
  controls.append(search, jsonBtn, copyBtn, collapseBtn);

  const phaseRow = n("div", ["margin-top:10px", "line-height:1.5"]);
  header.append(titleRow, controls, phaseRow);

  // Scrolling body
  const body = n("div", ["flex:1 1 auto", "overflow:auto", `padding:${space.md}`]);

  el.append(header, body);

  // --- rendering ------------------------------------------------------------
  function render(): void {
    if (panelOpen) {
      el.style.width = `${PANEL_WIDTH}px`;
      el.style.flexBasis = `${PANEL_WIDTH}px`;
      controls.style.display = "flex";
      body.style.display = "block";
      toggleBtn.textContent = "▾";
    } else {
      el.style.width = "44px";
      el.style.flexBasis = "44px";
      controls.style.display = "none";
      body.style.display = "none";
      toggleBtn.textContent = "▸";
    }
    renderBody();
  }

  function renderBody(): void {
    // Phase / command status line.
    phaseRow.replaceChildren();
    if (lastView) {
      const path = lastView.fsm.path;
      phaseRow.appendChild(span(path, palette.brassBright, "12px"));
      if (lastCommand.kind === "submitting") {
        phaseRow.appendChild(span(`  submitting ${lastCommand.commandType ?? ""}…`, palette.brass, "11px"));
      } else if (lastCommand.kind === "rejected") {
        phaseRow.appendChild(span(`  ✕ ${lastCommand.commandType}: ${lastCommand.message ?? ""}`, palette.alarm, "11px"));
      }
    } else {
      phaseRow.appendChild(span("awaiting snapshot…", palette.inkSoft, "12px"));
    }

    if (!panelOpen) { body.replaceChildren(); return; }
    body.replaceChildren();
    if (!lastView) {
      body.appendChild(muted("No game state yet."));
      return;
    }
    if (showJson) { body.appendChild(jsonView(lastView)); return; }

    body.appendChild(fsmBlock(lastView.fsm.path));
    for (const sec of stateSections(lastView)) body.appendChild(sectionBlock(sec.title, sec.rows));
  }

  // FSM tree with the live branch lit and the active leaf as a pill.
  function fsmBlock(currentPath: string): HTMLElement {
    const wrap = sectionShell("FSM");
    const chain = activeChain(currentPath);

    // Breadcrumbs of the active path.
    const crumbs = n("div", ["display:flex", "flex-wrap:wrap", "gap:4px", "margin:2px 0 8px"]);
    currentPath.split(".").forEach((seg, i, arr) => {
      crumbs.appendChild(pill(seg, i === arr.length - 1));
      if (i < arr.length - 1) crumbs.appendChild(span("›", palette.brass, "11px"));
    });
    wrap.appendChild(crumbs);

    // Full topology tree.
    for (const node of flattenFsm()) {
      if (query && !node.path.toLowerCase().includes(query) && !chain.has(node.path)) continue;
      const onChain = chain.has(node.path);
      const isLeafActive = node.path === currentPath;
      const row = n("div", [
        `padding:2px 6px 2px ${8 + node.depth * 14}px`,
        "border-radius:3px",
        "white-space:nowrap",
        isLeafActive ? `background:${palette.oxblood}` : "background:transparent",
        isLeafActive ? `color:${palette.vellum}` : onChain ? `color:${palette.brassBright}` : "color:#7C828B",
        onChain && !isLeafActive ? `border-left:2px solid ${palette.brass}` : "border-left:2px solid transparent",
        onChain ? "font-weight:600" : "font-weight:400",
      ]);
      row.textContent = (node.children.length ? "▸ " : "· ") + node.name;
      wrap.appendChild(row);
    }
    return wrap;
  }

  function sectionBlock(title: string, rows: StateRow[]): HTMLElement {
    const isCollapsed = collapsed.has(title);
    const wrap = sectionShell(title, () => {
      if (collapsed.has(title)) collapsed.delete(title); else collapsed.add(title);
      renderBody();
    }, isCollapsed);
    if (isCollapsed) return wrap;

    let shown = 0;
    for (const r of rows) {
      if (query && !`${r.k} ${r.v}`.toLowerCase().includes(query)) continue;
      shown++;
      const line = n("div", ["display:flex", "gap:8px", "padding:1px 0", "align-items:baseline"]);
      const key = span(r.k, palette.brass, "11px");
      key.style.flex = "0 0 38%";
      key.style.overflow = "hidden";
      key.style.textOverflow = "ellipsis";
      const val = span(r.v, TONE_COLOR[r.tone ?? "normal"], "11px");
      val.style.flex = "1";
      val.style.wordBreak = "break-word";
      line.append(key, val);
      wrap.appendChild(line);
    }
    if (query && shown === 0) return document.createComment("hidden") as unknown as HTMLElement;
    return wrap;
  }

  // --- small builders -------------------------------------------------------
  function sectionShell(title: string, onToggle?: () => void, isCollapsed = false): HTMLElement {
    const wrap = n("div", ["margin-bottom:14px"]);
    const h = n("div", [
      "display:flex", "align-items:center", "gap:6px",
      "letter-spacing:.16em", "text-transform:uppercase", "font-size:10px",
      `color:${palette.verdigris}`, "margin-bottom:5px",
      onToggle ? "cursor:pointer" : "cursor:default",
      "user-select:none",
    ]);
    if (onToggle) h.appendChild(span(isCollapsed ? "▸" : "▾", palette.brass, "10px"));
    h.appendChild(span(title, palette.brassBright, "10px"));
    if (onToggle) h.onclick = onToggle;
    wrap.appendChild(h);
    return wrap;
  }

  function jsonView(view: GameStateView): HTMLElement {
    const pre = document.createElement("pre");
    pre.textContent = safeJson(view);
    pre.style.cssText = [
      "margin:0", "white-space:pre-wrap", "word-break:break-word",
      "font-size:10px", "line-height:1.45", `color:${palette.vellum}`,
    ].join(";");
    return pre;
  }

  function doCopy(): void {
    if (!lastView) return;
    try { void navigator.clipboard?.writeText(safeJson(lastView)); } catch { /* no-op */ }
    copyBtn.textContent = "✓";
    setTimeout(() => { copyBtn.textContent = "⧉"; }, 900);
  }

  function collapseAll(): void {
    if (!lastView) return;
    for (const sec of stateSections(lastView)) collapsed.add(sec.title);
  }

  // --- public update --------------------------------------------------------
  function update(view: GameStateView | null, command?: CommandInfo): void {
    lastView = view;
    lastCommand = command ?? { kind: "idle" };
    renderBody();
  }

  render();
  return { el, update };
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function n(tag: string, css: string[]): HTMLElement {
  const e = document.createElement(tag);
  e.style.cssText = css.join(";");
  return e;
}

function span(text: string, color: string, size: string): HTMLElement {
  const s = document.createElement("span");
  s.textContent = text;
  s.style.cssText = `color:${color};font-size:${size}`;
  return s;
}

function muted(text: string): HTMLElement {
  return span(text, palette.inkSoft, "12px");
}

function pill(text: string, active: boolean): HTMLElement {
  const p = document.createElement("span");
  p.textContent = text;
  p.style.cssText = [
    "padding:1px 7px", "border-radius:10px", "font-size:11px",
    active ? `background:${palette.oxblood}` : "background:#2B2F36",
    active ? `color:${palette.vellum}` : `color:${palette.brassBright}`,
    active ? "font-weight:700" : "font-weight:500",
  ].join(";");
  return p;
}

function chip(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  b.style.cssText = [
    "padding:5px 9px", "min-width:30px",
    `font-family:${typ.mono}`, "font-size:12px", "line-height:1",
    `color:${palette.vellum}`, "background:#2B2F36",
    "border:1px solid #3A3F47", "border-radius:3px", "cursor:pointer",
  ].join(";");
  b.onclick = onClick;
  return b;
}

function safeJson(view: GameStateView): string {
  try { return JSON.stringify(view, null, 2); } catch { return "«unserialisable state»"; }
}
