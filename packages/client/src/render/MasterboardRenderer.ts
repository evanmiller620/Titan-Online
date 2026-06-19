/**
 * Masterboard renderer (Titan client, render layer — the signature element).
 *
 * Draws the authentic 1980 masterboard: a regular hexagon of lands (the
 * (col,row) grid plotted directly) with black gaps between them, every legal
 * move shown as a colour-coded directional connector, and each land labelled
 * with its terrain name + number. The board is a pan/zoom WORLD so a player can
 * read any corner closely; hovering a land lights up its connections.
 *
 * Strict separation: this class READS a GameStateView and emits land-click /
 * hover events through callbacks. It never imports the store, never builds a
 * command, never mutates anything. The app layer wires its callbacks.
 */

import { Application, Container, Graphics, Rectangle, Text } from "pixi.js";
import { MASTER_LANDS, type GameStateView } from "@titan/engine";
import { colRowToPixel, fitColRowLayout, nearestLand, hexCornersFlat, type GridLayout, type Point } from "./projection.ts";
import { palette, terrainColor, type as typ } from "../ui/tokens.ts";

const LAND_CELLS = MASTER_LANDS.map((l) => ({ col: l.col, row: l.row }));
const LAND_BY_ID = new Map(MASTER_LANDS.map((l) => [l.id, l]));

const hex = (s: string) => parseInt(s.replace("#", ""), 16);
const INK_DARK = "#1A1714";
const INK_LIGHT = "#F4EEDF";

const SLOT_BANNER: Record<string, string> = {
  Black: "#26221E", Brown: "#6B4A2B", Blue: "#2C4A6B", Gold: "#B08D57", Green: "#3E6B45", Red: "#8E3247",
};

function luminance(c: number): number {
  return 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255);
}

export interface MasterboardCallbacks {
  readonly onLandClick: (landId: number) => void;
  readonly onLandHover: (landId: number | null, point?: Point) => void;
}

export class MasterboardRenderer {
  private readonly app: Application;
  private readonly layer = new Container();   // screen-space event catcher
  private readonly world = new Container();   // pan/zoom transform
  private readonly base = new Container();     // board graphics (rebuilt on render)
  private readonly overlay = new Container();  // hover highlight (cheap redraw)
  private landPositions: ReadonlyArray<{ id: number; point: Point }> = [];
  private posById = new Map<number, Point>();
  private layout: GridLayout;
  private w: number;
  private h: number;
  private zoom = 1;
  private hoverId: number | null = null;

  constructor(app: Application, width: number, height: number) {
    this.app = app;
    this.w = width;
    this.h = height;
    this.layout = fitColRowLayout(LAND_CELLS, width, height, 16);
    this.world.addChild(this.base);
    this.world.addChild(this.overlay);
    this.layer.addChild(this.world);
    this.app.stage.addChild(this.layer);
    this.precomputePositions();
  }

  private precomputePositions(): void {
    this.landPositions = MASTER_LANDS.map((l) => ({ id: l.id, point: colRowToPixel({ col: l.col, row: l.row }, this.layout) }));
    this.posById = new Map(this.landPositions.map((lp) => [lp.id, lp.point]));
  }

  setVisible(visible: boolean): void {
    this.layer.visible = visible;
  }

  /** Reset pan/zoom to the fitted view. */
  resetView(): void {
    this.zoom = 1;
    this.world.scale.set(1);
    this.world.position.set(0, 0);
  }

  /** Zoom by a factor toward the viewport centre (for on-screen +/- buttons). */
  zoomBy(factor: number): void {
    const next = Math.max(0.7, Math.min(4, this.zoom * factor));
    const f = next / this.zoom;
    const cx = this.w / 2, cy = this.h / 2;
    this.world.position.set(cx - f * (cx - this.world.x), cy - f * (cy - this.world.y));
    this.zoom = next;
    this.world.scale.set(next);
  }

  attachInput(cb: MasterboardCallbacks): void {
    this.layer.eventMode = "static";
    this.layer.hitArea = new Rectangle(0, 0, this.w, this.h);
    const hitR = () => this.cellRadius() * 1.25;

    let dragStart: Point | null = null;
    let worldStart: Point | null = null;
    let moved = 0;
    const idAt = (e: unknown) => nearestLand(this.localPoint(e), this.landPositions, hitR());

    this.layer.on("pointerdown", (e: unknown) => {
      const g = (e as { global: Point }).global;
      dragStart = { x: g.x, y: g.y };
      worldStart = { x: this.world.x, y: this.world.y };
      moved = 0;
    });
    this.layer.on("pointermove", (e: unknown) => {
      const g = (e as { global: Point }).global;
      if (dragStart && worldStart) {
        const dx = g.x - dragStart.x, dy = g.y - dragStart.y;
        moved = Math.hypot(dx, dy);
        if (moved > 4) { // panning
          this.world.position.set(worldStart.x + dx, worldStart.y + dy);
          cb.onLandHover(null);
          this.setHover(null);
          return;
        }
      }
      const id = idAt(e);
      this.setHover(id);
      const pt = id === null ? undefined : this.screenPointFor(id);
      cb.onLandHover(id, pt);
    });
    const end = (e: unknown) => {
      if (dragStart && moved <= 4) {
        const id = idAt(e);
        if (id !== null) cb.onLandClick(id);
      }
      dragStart = worldStart = null;
    };
    this.layer.on("pointerup", end);
    this.layer.on("pointerupoutside", (e: unknown) => { end(e); });
    this.layer.on("pointerleave", () => { cb.onLandHover(null); this.setHover(null); });

    // Wheel zoom toward the cursor.
    const canvas = this.app.canvas as HTMLCanvasElement;
    canvas.addEventListener("wheel", (ev: WheelEvent) => {
      if (!this.layer.visible) return;
      ev.preventDefault();
      const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
      const next = Math.max(0.7, Math.min(4, this.zoom * factor));
      const f = next / this.zoom;
      const cx = ev.offsetX, cy = ev.offsetY;
      this.world.position.set(cx - f * (cx - this.world.x), cy - f * (cy - this.world.y));
      this.zoom = next;
      this.world.scale.set(next);
    }, { passive: false });
  }

  private syncExtent(): void {
    const rend = this.app.renderer as { width?: number; height?: number } | undefined;
    const w = rend?.width || this.app.screen?.width || this.w;
    const h = rend?.height || this.app.screen?.height || this.h;
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.layout = fitColRowLayout(LAND_CELLS, w, h, 16);
    if (this.layer.hitArea instanceof Rectangle) { this.layer.hitArea.width = w; this.layer.hitArea.height = h; }
    this.precomputePositions();
  }

  /** Re-draw the whole board from a redacted snapshot. Idempotent. */
  render(
    view: GameStateView,
    selectedLand: number | null,
    _hoveredLand: number | null,
    highlightLands: ReadonlySet<number> = new Set(),
  ): void {
    this.syncExtent();
    this.base.removeChildren();
    const r = this.cellRadius();
    const highlighting = highlightLands.size > 0;

    // 1) Connectors first, so hexes sit on top of the tracks.
    this.drawConnectors(r, highlighting ? highlightLands : null, selectedLand);

    // 2) Reachable halos behind the hexes.
    if (highlighting) {
      const halos = new Graphics();
      for (const id of highlightLands) {
        const c = this.posById.get(id);
        if (c) halos.poly(hexPoly(c, r + 4)).fill({ color: hex(palette.verdigris), alpha: 0.16 }).stroke({ color: hex(palette.verdigris), width: 3, alpha: 0.95 });
      }
      this.base.addChild(halos);
    }

    // 3) Land hexes + labels.
    for (const land of MASTER_LANDS) {
      const c = this.posById.get(land.id)!;
      const fill = hex(terrainColor[land.terrain] ?? terrainColor.Plains!);
      const isTower = land.terrain === "Tower";
      const isSel = land.id === selectedLand;
      const isTarget = highlightLands.has(land.id);
      const dim = highlighting && !isTarget && !isSel;

      const g = new Graphics();
      g.poly(hexPoly(c, r))
        .fill({ color: fill, alpha: dim ? 0.3 : 1 })
        .stroke({
          color: isSel ? hex(palette.oxbloodBright) : isTarget ? hex(palette.verdigris) : isTower ? hex(palette.brass) : hex("#211E1A"),
          width: isSel ? 4 : isTarget ? 3 : isTower ? 2.5 : 1.5,
          alpha: dim ? 0.5 : 1,
        });
      this.base.addChild(g);

      this.drawLabel(land.terrain, land.id, c, r, fill, dim);
    }

    // 4) Legion seals (grouped per land, fanned so stacks all show).
    const byLand = new Map<number, GameStateView["legions"][string][]>();
    for (const legion of Object.values(view.legions)) {
      const arr = byLand.get(legion.land) ?? [];
      arr.push(legion);
      byLand.set(legion.land, arr);
    }
    for (const [land, legs] of byLand) {
      const c = this.posById.get(land);
      if (!c) continue;
      const n = legs.length;
      const sr = n > 1 ? r * 0.34 : r * 0.4;
      legs.forEach((legion, i) => {
        const color = (view.players[legion.ownerId] as { color?: string } | undefined)?.color ?? null;
        const pos = n === 1 ? { x: c.x, y: c.y + r * 0.4 } : fanAround(c, r * 0.46, i, n, r * 0.4);
        this.drawSeal(pos.x, pos.y, legion, sr, color);
      });
    }

    this.renderOverlay(r); // keep hover highlight in sync after a rebuild
  }

  /** Colour-coded directional connectors for every legal exit. When a legion is
   *  selected (movement), only its land's connectors stay bright so the routes
   *  open to it read clearly; otherwise the whole wheel's flow is visible. */
  private drawConnectors(r: number, reachable: ReadonlySet<number> | null, selected: number | null): void {
    const g = new Graphics();
    const focusMode = reachable !== null; // a legion is selected
    for (const land of MASTER_LANDS) {
      const A = this.posById.get(land.id);
      if (!A) continue;
      const focal = !focusMode || selected === land.id;
      for (const ex of land.exits) {
        const B = this.posById.get(ex.to);
        if (!B) continue;
        const kind = edgeKind(ex.type);
        const color = hex(kind === "block" ? palette.alarm : kind === "gateway" ? palette.verdigris : palette.brassBright);
        const base = focusMode ? (focal ? 0.92 : 0.1) : 0.5;
        const alpha = kind === "block" ? base * 0.7 : base;
        connector(g, A, B, r, color, alpha, kind, focal ? 2.4 : 1.7);
      }
    }
    this.base.addChild(g);
  }

  /** Terrain name (haloed for legibility on any tint) + a number pill. */
  private drawLabel(terrain: string, id: number, c: Point, r: number, fill: number, dim: boolean): void {
    const dark = luminance(fill) > 150;
    const inkName = dark ? INK_DARK : INK_LIGHT;
    const halo = dark ? INK_LIGHT : INK_DARK;
    const name = new Text({
      text: terrain.toUpperCase(),
      style: {
        fontFamily: typ.body, fontSize: Math.max(9, Math.round(r * 0.32)), fontWeight: "700",
        letterSpacing: 0.5, fill: hex(inkName),
        stroke: { color: hex(halo), width: Math.max(1.5, r * 0.06) },
      },
    });
    name.anchor.set(0.5);
    name.x = c.x;
    name.y = c.y + r * 0.04;
    name.alpha = dim ? 0.4 : 1;
    this.base.addChild(name);

    // Number pill at the top of the hex — dark chip, light text, always legible.
    const fs = Math.max(8, Math.round(r * 0.26));
    const num = new Text({ text: String(id), style: { fontFamily: typ.mono, fontSize: fs, fontWeight: "600", fill: hex(INK_LIGHT) } });
    num.anchor.set(0.5);
    const pw = num.width + r * 0.28, ph = fs + r * 0.14, py = c.y - r * 0.52;
    const pill = new Graphics();
    pill.roundRect(c.x - pw / 2, py - ph / 2, pw, ph, ph / 2).fill({ color: hex("#15120F"), alpha: dim ? 0.35 : 0.82 });
    pill.alpha = dim ? 0.5 : 1;
    num.x = c.x; num.y = py; num.alpha = dim ? 0.5 : 1;
    this.base.addChild(pill);
    this.base.addChild(num);
  }

  /** Light a land's connections + ring on hover, without rebuilding the board. */
  private setHover(id: number | null): void {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.renderOverlay(this.cellRadius());
  }

  private renderOverlay(r: number): void {
    this.overlay.removeChildren();
    const id = this.hoverId;
    if (id === null) return;
    const A = this.posById.get(id);
    if (!A) return;
    const land = LAND_BY_ID.get(id);
    const g = new Graphics();
    // Outgoing edges, bright + bold — and ring each place you may actually move
    // to, so "where can I go from here" is answered at a glance.
    for (const ex of land?.exits ?? []) {
      const B = this.posById.get(ex.to);
      if (!B) continue;
      const kind = edgeKind(ex.type);
      const color = hex(kind === "block" ? palette.alarm : kind === "gateway" ? palette.verdigris : palette.brassBright);
      connector(g, A, B, r, color, 0.98, kind, 3.4);
      if (kind !== "block") {
        g.poly(hexPoly(B, r + 2)).stroke({ color, width: 2.4, alpha: 0.9 });
      }
    }
    // Ring on the hovered land.
    g.poly(hexPoly(A, r + 3)).stroke({ color: hex(palette.brassBright), width: 3.5, alpha: 0.98 });
    this.overlay.addChild(g);
  }

  private drawSeal(sx: number, sy: number, legion: GameStateView["legions"][string], sr: number, bannerColor: string | null): void {
    const color = (bannerColor && SLOT_BANNER[bannerColor]) || palette.seal;
    const seal = new Graphics();
    // Soft drop shadow so seals lift off the parchment.
    seal.circle(sx + sr * 0.12, sy + sr * 0.16, sr).fill({ color: hex("#000000"), alpha: 0.28 });
    // Wax disc with a double rim (vellum outer, brass inner) — reads as a seal.
    seal.circle(sx, sy, sr).fill({ color: hex(color), alpha: 0.97 })
      .stroke({ color: hex(palette.vellum), width: Math.max(1.5, sr * 0.12) });
    seal.circle(sx, sy, sr * 0.78).stroke({ color: hex(palette.brassBright), width: Math.max(0.8, sr * 0.06), alpha: 0.55 });
    this.base.addChild(seal);

    // Height as a legible number in the centre — far easier to read than pips,
    // especially for tall stacks.
    const fs = Math.max(9, Math.round(sr * 1.05));
    const label = new Text({
      text: String(legion.height),
      style: { fontFamily: typ.mono, fontSize: fs, fontWeight: "700", fill: hex(palette.vellum), stroke: { color: hex("#1A1714"), width: Math.max(1, sr * 0.08) } },
    });
    label.anchor.set(0.5);
    label.x = sx;
    label.y = sy;
    this.base.addChild(label);
  }

  private cellRadius(): number {
    return this.layout.size;
  }

  /** Screen position of a land centre (for placing the DOM tooltip). */
  private screenPointFor(id: number): Point | undefined {
    const c = this.posById.get(id);
    if (!c) return undefined;
    return { x: this.world.x + c.x * this.zoom, y: this.world.y + c.y * this.zoom };
  }

  private localPoint(e: unknown): Point {
    const g = (e as { global?: { x: number; y: number } }).global;
    if (!g) return { x: 0, y: 0 };
    const p = this.world.toLocal({ x: g.x, y: g.y } as never) as { x: number; y: number };
    return { x: p.x, y: p.y };
  }
}

/** Flat-top hexagon polygon (flattened x,y pairs) for a land cell. */
function hexPoly(center: Point, size: number): number[] {
  const pts: number[] = [];
  for (const c of hexCornersFlat(center, size)) pts.push(c.x, c.y);
  return pts;
}

/** How an edge reads: a one-way track, a gateway you can pass, or a barrier you
 *  cannot cross. Drives the connector's arrowhead style. */
type EdgeKind = "track" | "gateway" | "block";

/** Classify a board exit type into its visual kind. */
function edgeKind(type: string): EdgeKind {
  if (type === "BLOCK") return "block";
  if (type === "ARCH") return "gateway";
  return "track"; // ARROW / ARROWS — the painted directional flow
}

/**
 * A connector from A toward B, drawn so DIRECTION is unmistakable.
 *
 *   track    solid line + a filled arrowhead AT B's doorstep → you may move here.
 *   gateway  solid line + a hollow (outlined) arrowhead → a passable gateway.
 *   block    a stub from A capped by a perpendicular barrier, NO arrowhead →
 *            this side cannot be entered; not a direction you can take.
 *
 * Placing the arrowhead at the destination (not mid-line) means each land's
 * exits clearly point at where a legion can go next.
 */
function connector(g: Graphics, A: Point, B: Point, r: number, color: number, alpha: number, kind: EdgeKind, width: number): void {
  const dx = B.x - A.x, dy = B.y - A.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;
  const a = { x: A.x + ux * r * 0.92, y: A.y + uy * r * 0.92 };
  const b = { x: B.x - ux * r * 0.92, y: B.y - uy * r * 0.92 };

  if (kind === "block") {
    // Stub from A that halts mid-gap, capped by a bold barrier bar.
    const stop = { x: A.x + ux * (len * 0.46), y: A.y + uy * (len * 0.46) };
    const s = r * 0.3;
    g.moveTo(a.x, a.y).lineTo(stop.x, stop.y).stroke({ color, width, alpha, cap: "round" });
    g.moveTo(stop.x - px * s, stop.y - py * s).lineTo(stop.x + px * s, stop.y + py * s)
      .stroke({ color, width: width * 1.7, alpha, cap: "round" });
    return;
  }

  // Shaft, then an arrowhead seated at B's doorstep pointing inward.
  g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color, width, alpha, cap: "round" });
  const headLen = r * 0.4, headW = r * 0.26;
  const baseC = { x: b.x - ux * headLen, y: b.y - uy * headLen };
  const poly = [b.x, b.y, baseC.x + px * headW, baseC.y + py * headW, baseC.x - px * headW, baseC.y - py * headW];
  if (kind === "gateway") g.poly(poly).stroke({ color, width: Math.max(1.4, width * 0.8), alpha });
  else g.poly(poly).fill({ color, alpha });
}

/** The i-th of n seals fanned in an arc below the land centre. */
function fanAround(center: Point, radius: number, i: number, n: number, yOffset: number): Point {
  if (n <= 1) return { x: center.x, y: center.y + yOffset };
  const spread = Math.PI * 0.8;
  const a = Math.PI / 2 - spread / 2 + (spread * i) / (n - 1);
  return { x: center.x + Math.cos(a) * radius, y: center.y + yOffset + Math.sin(a) * radius * 0.5 };
}
