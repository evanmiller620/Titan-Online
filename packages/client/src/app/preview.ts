/**
 * Live preview (Titan client, app entry).
 *
 * The zero-configuration landing served by the deployment. It needs NO backend:
 * it runs the pure @titan/engine in the browser to set up a six-player game,
 * then renders the Masterboard with the real PixiJS renderer. This puts the
 * signature element — the wheel of lands with hidden legions shown as wax-seal
 * markers — in front of anyone who opens the URL, before any Supabase setup.
 *
 * It is explicitly a PREVIEW, not the multiplayer client: there is no turn
 * interaction, because online play is authoritative on the server (configure
 * Supabase and use the multiplayer entry for that). The banner says so plainly.
 */

import { Application } from "pixi.js";
import {
  createGame,
  publicState,
  scriptedRng,
  RollTurnOrderCommand,
  SelectTowerCommand,
  SelectColorCommand,
  PLAYER_COLORS,
  type GameState,
  type GameStateView,
} from "@titan/engine";
import { MasterboardRenderer } from "../render/MasterboardRenderer.ts";
import { palette, tokensCss, type as typ, space } from "../ui/tokens.ts";

const TOWERS = [100, 200, 300, 400, 500, 600] as const;

/**
 * Build a fully set-up six-player game and return its redacted public view.
 * Drives the real setup commands, reading the engine's own pick order so the
 * sequence is always valid rather than hard-coded.
 */
function previewView(): GameStateView {
  const players = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `p${n}`, name: `Player ${n}` }));
  let s: GameState = createGame({ gameId: "preview", players });

  // Distinct descending rolls → deterministic order p1..p6, no tie re-rolls.
  s = new RollTurnOrderCommand("p1", {}).execute(s, scriptedRng([6, 5, 4, 3, 2, 1])).state;

  // Towers: pick in the engine's tower order (highest roller first).
  for (let i = 0; i < players.length; i++) {
    const picker = s.setup!.order[s.setup!.towerPickIndex]!;
    s = new SelectTowerCommand(picker, { tower: TOWERS[i]! }).execute(s, scriptedRng([])).state;
  }

  // Colors: pick in the engine's colour order (lowest roller first), assigning
  // distinct banner colours in the canonical order.
  for (let i = 0; i < players.length; i++) {
    const picker = s.setup!.order[s.setup!.colorPickIndex]!;
    s = new SelectColorCommand(picker, { color: PLAYER_COLORS[i]! }).execute(s, scriptedRng([])).state;
  }

  return publicState(s);
}

function injectTokens(): void {
  const style = document.createElement("style");
  style.textContent = tokensCss();
  document.head.appendChild(style);
}

function legend(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = [
    "position:absolute", "left:24px", "top:24px", "max-width:340px",
    "padding:20px 22px", `background:${palette.vellumDeep}`,
    `border:1px solid ${palette.brass}`, "border-radius:3px",
    `font-family:${typ.body}`, `color:${palette.ink}`,
    "box-shadow:0 6px 28px rgba(28,26,23,0.18)",
  ].join(";");
  el.innerHTML = [
    `<div style="font-family:${typ.mono};font-size:${typ.scale.xs};letter-spacing:.18em;text-transform:uppercase;color:${palette.verdigris}">Live preview</div>`,
    `<h1 style="font-family:${typ.display};font-size:${typ.scale.xl};color:${palette.oxblood};margin:4px 0 10px;line-height:1.1">Titan</h1>`,
    `<p style="font-size:${typ.scale.sm};margin:0 0 10px;line-height:1.5">The Masterboard wheel, rendered in your browser from the rules engine. Each <strong>wax seal</strong> is a legion: you see its banner colour and height in pips, never its contents — the game's hidden-information mechanic, enforced for real on the server.</p>`,
    `<p style="font-size:${typ.scale.xs};margin:0;color:${palette.inkSoft};line-height:1.5">This page needs no backend. For online multiplayer, configure Supabase and open the multiplayer client (see the deployment guide).</p>`,
  ].join("");
  return el;
}

export async function renderPreview(): Promise<void> {
  injectTokens();
  const root = document.getElementById("root");
  if (!root) throw new Error("missing #root mount");
  root.innerHTML = "";

  const board = document.createElement("div");
  board.className = "titan-board";
  board.style.cssText = "position:absolute;inset:0;";
  root.appendChild(board);

  const view = previewView();

  const app = new Application();
  await app.init({ background: palette.vellum, antialias: true, resizeTo: board });
  board.appendChild(app.canvas);

  const width = app.canvas.width || board.clientWidth || window.innerWidth;
  const height = app.canvas.height || board.clientHeight || window.innerHeight;
  const renderer = new MasterboardRenderer(app, width, height);

  let hovered: number | null = null;
  renderer.attachInput({
    onLandClick: () => {/* preview is non-interactive: play happens online */},
    onLandHover: (landId) => {
      if (landId === hovered) return;
      hovered = landId;
      renderer.render(view, null, hovered);
    },
  });
  renderer.render(view, null, null);

  root.appendChild(legend());
}
