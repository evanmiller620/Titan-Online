/**
 * DOM toolkit (Titan client, ui) — the ONE place the UI builds elements.
 *
 * Every view (menu, inspector, board chrome) used to re-declare its own
 * `node`/`span`/`button`/`chip`/`input` helpers with copy-pasted token styling.
 * They now share these. `theme` centralises the dark-panel palette so colours
 * live in a single object, not inline strings scattered across files.
 *
 * Interaction polish (hover/press states, focus) lives here too: helpers attach
 * lightweight pointer handlers so every control feels alive without each view
 * re-implementing it.
 */

import { palette, type as typ, radius, elevation } from "./tokens.ts";

/** Dark-inspector surface palette (board parchment pops beside it). */
export const theme = {
  bg: "#20242A",
  bgDeep: "#181B20",
  field: "#2B2F36",
  fieldHi: "#363B44", // hovered field surface
  line: "#3A3F47",
  lineSoft: "#2C313A",
  dim: "#9AA1AB",
  ink: palette.vellum,
  accent: palette.oxblood,
  accentBright: palette.oxbloodBright,
  brass: palette.brass,
  brassBright: palette.brassBright,
  verdigris: palette.verdigris,
  good: "#7FB59B",
  warn: palette.alarm,
} as const;

export const surface = { radius, elevation } as const;

export interface ElemOpts {
  text?: string | undefined;
  html?: string | undefined;
  onClick?: (() => void) | undefined;
  title?: string | undefined;
  children?: HTMLElement[] | undefined;
  attrs?: Record<string, string> | undefined;
}

/** Build an element with cssText `css` and optional content/handlers. */
export function elem(tag: string, css: string, opts: ElemOpts = {}): HTMLElement {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (opts.text != null) e.textContent = opts.text;
  if (opts.html != null) e.innerHTML = opts.html;
  if (opts.onClick) e.onclick = opts.onClick;
  if (opts.title) e.title = opts.title;
  for (const [k, v] of Object.entries(opts.attrs ?? {})) e.setAttribute(k, v);
  for (const c of opts.children ?? []) e.appendChild(c);
  return e;
}

export function txt(text: string, color: string, size: string = typ.scale.sm): HTMLElement {
  return elem("span", `color:${color};font-size:${size};font-family:${typ.body}`, { text });
}

/** Eyebrow label (uppercase, tracked) used as a section header everywhere. */
export function eyebrow(text: string): HTMLElement {
  return elem("div", `font-family:${typ.mono};font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:${theme.brassBright}`, { text });
}

/** Attach hover/press feedback to a control without per-view boilerplate. */
function liven(el: HTMLElement, base: string, hover: string, opts: { press?: boolean } = {}): void {
  let hovering = false;
  const dis = () => (el as HTMLButtonElement).disabled;
  const set = (bg: string) => { if (!dis()) el.style.background = bg; };
  el.addEventListener("pointerenter", () => { hovering = true; set(hover); });
  el.addEventListener("pointerleave", () => { hovering = false; el.style.transform = "none"; set(base); });
  if (opts.press !== false) {
    el.addEventListener("pointerdown", () => { if (!dis()) el.style.transform = "translateY(1px)"; });
    const release = () => { if (!dis()) { el.style.transform = "none"; set(hovering ? hover : base); } };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
  }
}

export interface BtnOpts { primary?: boolean; full?: boolean; onClick?: () => void; disabled?: boolean; title?: string }

export function button(label: string, opts: BtnOpts = {}): HTMLButtonElement {
  const baseBg = opts.primary ? theme.accent : theme.field;
  const hoverBg = opts.primary ? theme.accentBright : theme.fieldHi;
  const b = elem("button", [
    opts.full ? "width:100%;text-align:left" : "",
    "display:inline-flex;align-items:center;gap:6px",
    "padding:9px 13px", `font-family:${typ.body}`, `font-size:${typ.scale.sm}`, "font-weight:600",
    "letter-spacing:.01em",
    `color:${opts.primary ? "#FBF4E6" : theme.ink}`,
    `background:${baseBg}`,
    `border:1px solid ${opts.primary ? theme.accentBright : theme.line}`,
    `border-radius:${radius.sm}`, "cursor:pointer",
    `box-shadow:${opts.primary ? elevation.sm : "none"}`,
    "transition:background 120ms ease, transform 80ms ease, box-shadow 120ms ease",
  ].join(";"), { text: label, onClick: opts.onClick, title: opts.title }) as HTMLButtonElement;
  liven(b, baseBg, hoverBg);
  if (opts.disabled) { b.disabled = true; b.style.opacity = "0.45"; b.style.cursor = "not-allowed"; b.style.boxShadow = "none"; }
  return b;
}

export interface IconBtnOpts { onClick?: () => void; title?: string; active?: boolean }

/** Compact square control for chrome (toggles, close, copy). */
export function iconButton(glyph: string, opts: IconBtnOpts = {}): HTMLButtonElement {
  const baseBg = opts.active ? theme.accent : theme.field;
  const hoverBg = opts.active ? theme.accentBright : theme.fieldHi;
  const b = elem("button", [
    "display:inline-flex;align-items:center;justify-content:center",
    "width:30px;height:30px;flex:0 0 auto",
    `font-family:${typ.mono}`, "font-size:14px", "line-height:1",
    `color:${opts.active ? "#FBF4E6" : theme.brassBright}`,
    `background:${baseBg}`, `border:1px solid ${opts.active ? theme.accentBright : theme.line}`,
    `border-radius:${radius.sm}`, "cursor:pointer",
    "transition:background 120ms ease, transform 80ms ease",
  ].join(";"), { text: glyph, onClick: opts.onClick, title: opts.title }) as HTMLButtonElement;
  liven(b, baseBg, hoverBg);
  return b;
}

export interface ChipOpts { active?: boolean | undefined; ring?: boolean | undefined; onClick?: (() => void) | undefined; title?: string | undefined }

export function chip(label: string, opts: ChipOpts = {}): HTMLButtonElement {
  const baseBg = opts.active ? theme.accent : theme.field;
  const hoverBg = opts.active ? theme.accentBright : theme.fieldHi;
  const c = elem("button", [
    "padding:5px 11px", `font-family:${typ.mono}`, "font-size:12px", "line-height:1", "font-weight:600",
    `color:${opts.active ? "#FBF4E6" : theme.dim}`,
    `background:${baseBg}`,
    `border:1px solid ${opts.ring ? theme.brassBright : opts.active ? theme.accentBright : theme.line}`,
    opts.ring && !opts.active ? "box-shadow:0 0 0 1px rgba(203,168,107,0.35)" : "",
    `border-radius:${radius.pill}`, opts.onClick ? "cursor:pointer" : "cursor:default",
    "transition:background 120ms ease, color 120ms ease",
  ].join(";"), { text: label, onClick: opts.onClick, title: opts.title }) as HTMLButtonElement;
  if (opts.onClick) liven(c, baseBg, hoverBg, { press: false });
  return c;
}

export function input(placeholder: string, value = ""): HTMLInputElement {
  const i = elem("input", [
    "display:block", "width:100%", "box-sizing:border-box", "margin-bottom:10px", "padding:10px 12px",
    `font-family:${typ.body}`, `font-size:${typ.scale.sm}`,
    `border:1px solid ${palette.parchmentEdge}`, `border-radius:${radius.sm}`, "background:#FBF7EC", `color:${palette.ink}`,
    "transition:border-color 120ms ease, box-shadow 120ms ease",
  ].join(";")) as HTMLInputElement;
  i.placeholder = placeholder;
  i.value = value;
  i.addEventListener("focus", () => { i.style.borderColor = theme.brassBright; i.style.boxShadow = "0 0 0 2px rgba(176,141,87,0.25)"; });
  i.addEventListener("blur", () => { i.style.boxShadow = "none"; });
  return i;
}

/** Inject the design tokens as a :root block (once). */
export function injectTokens(css: string): void {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}
