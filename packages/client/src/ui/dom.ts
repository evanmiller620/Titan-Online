/**
 * DOM toolkit (Titan client, ui) — the ONE place the UI builds elements.
 *
 * Every view (menu, inspector, board chrome) used to re-declare its own
 * `node`/`span`/`button`/`chip`/`input` helpers with copy-pasted token styling.
 * They now share these. `theme` centralises the dark-panel palette so colours
 * live in a single object, not inline strings scattered across files.
 */

import { palette, type as typ } from "./tokens.ts";

/** Dark-inspector surface palette (board parchment pops beside it). */
export const theme = {
  bg: "#20242A",
  bgDeep: "#181B20",
  field: "#2B2F36",
  line: "#3A3F47",
  dim: "#9AA1AB",
  ink: palette.vellum,
  accent: palette.oxblood,
  brass: palette.brass,
  brassBright: palette.brassBright,
  good: "#7FB59B",
  warn: palette.alarm,
} as const;

export interface ElemOpts {
  text?: string;
  html?: string;
  onClick?: () => void;
  title?: string;
  children?: HTMLElement[];
  attrs?: Record<string, string>;
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

export function txt(text: string, color: string, size = typ.scale.sm): HTMLElement {
  return elem("span", `color:${color};font-size:${size};font-family:${typ.body}`, { text });
}

/** Eyebrow label (uppercase, tracked) used as a section header everywhere. */
export function eyebrow(text: string): HTMLElement {
  return elem("div", `font-family:${typ.mono};font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:${theme.brassBright}`, { text });
}

export interface BtnOpts { primary?: boolean; full?: boolean; onClick?: () => void; disabled?: boolean }

export function button(label: string, opts: BtnOpts = {}): HTMLButtonElement {
  const b = elem("button", [
    opts.full ? "width:100%;text-align:left" : "",
    "padding:9px 12px", `font-family:${typ.body}`, `font-size:${typ.scale.sm}`, "font-weight:600",
    `color:${theme.ink}`,
    `background:${opts.primary ? theme.accent : theme.field}`,
    `border:1px solid ${opts.primary ? theme.accent : theme.line}`,
    "border-radius:3px", "cursor:pointer",
  ].join(";"), { text: label, onClick: opts.onClick }) as HTMLButtonElement;
  if (opts.disabled) { b.disabled = true; b.style.opacity = "0.5"; b.style.cursor = "not-allowed"; }
  return b;
}

export interface ChipOpts { active?: boolean; ring?: boolean; onClick?: () => void; title?: string }

export function chip(label: string, opts: ChipOpts = {}): HTMLButtonElement {
  return elem("button", [
    "padding:5px 10px", `font-family:${typ.mono}`, "font-size:12px", "line-height:1",
    `color:${opts.active ? theme.ink : theme.dim}`,
    `background:${opts.active ? theme.accent : theme.field}`,
    `border:1px solid ${opts.ring ? theme.brassBright : theme.line}`,
    "border-radius:3px", opts.onClick ? "cursor:pointer" : "cursor:default",
  ].join(";"), { text: label, onClick: opts.onClick, title: opts.title }) as HTMLButtonElement;
}

export function input(placeholder: string, value = ""): HTMLInputElement {
  const i = elem("input", [
    "display:block", "width:100%", "box-sizing:border-box", "margin-bottom:10px", "padding:10px",
    `font-family:${typ.body}`, `font-size:${typ.scale.sm}`,
    `border:1px solid ${palette.parchmentEdge}`, "border-radius:2px", "background:#FBF7EC", `color:${palette.ink}`,
  ].join(";")) as HTMLInputElement;
  i.placeholder = placeholder;
  i.value = value;
  return i;
}

/** Inject the design tokens as a :root block (once). */
export function injectTokens(css: string): void {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}
