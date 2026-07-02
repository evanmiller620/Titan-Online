/**
 * Masterboard renderer (Titan client, render layer) — the AUTHENTIC board.
 *
 * Design goals:
 *   - Look like the 1980 board: 96 truncated-triangle lands, alternately
 *     pointing up and down, packed into one large hexagon on a dark field,
 *     with the movement gates (arrows / arches / blocks) PAINTED at every
 *     border exactly as printed — the board itself teaches the movement rules.
 *   - Interaction states stay legible on top: a selected legion's land gets a
 *     banner ring, its reachable lands glow, and lands that can act this phase
 *     carry a brass "attention" ring so the player always knows where to look.
 *   - A pan/zoom world so any corner can be read closely.
 *
 * Strict separation: this class READS a GameStateView and emits land click /
 * hover events through callbacks. It never imports the store, never builds a
 * command, never mutates anything.
 */

import { Application, Container, Graphics, Rectangle, Text } from "pixi.js";
import { MASTER_LANDS, type GameStateView } from "@titan/engine";
import {
  fitTriLayout, triCentroid, triLandPolygon, triPointsUp, nearestLand,
  type TriLayout, type Point,
} from "./projection.ts";
import { palette, terrainColor, type as typ } from "../ui/tokens.ts";

const LAND_CELLS = MASTER_LANDS.map((l) => ({ col: l.col, row: l.row }));
const LAND_BY_ID = new Map(MASTER_LANDS.map((l) => [l.id, l]));

const hex = (s: string) => parseInt(s.replace("#", ""), 16);
const INK_DARK = "#15120E";
const INK_LIGHT = "#F6F1E3";
const GATE_FILL = "#F2EAD3"; // painted-cream gate glyphs, as on the physical board
const TRUNC = 0.18; // corner-cut fraction — the classic near-triangular land shape
const SCALE = 0.955; // shrink toward centroid → the dark seam between lands

/** Owner banner colours for legion tokens. */
const SLOT_BANNER: Record<string, string> = {
  Black: "#2B2723", Brown: "#7A5631", Blue: "#345C86", Gold: "#C39A52", Green: "#3E6B45", Red: "#A23A4C",
};

function luminance(c: number): number {
  return 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255);
}

/** Hover-ring colour by connector type (matches the rail legend). */
function exitColor(type: string): number {
  if (type === "BLOCK") return hex(palette.alarm);
  if (type === "ARCH") return hex(palette.verdigris);
  return hex(palette.brassBright);
}

export interface MasterboardCallbacks {
  readonly onLandClick: (landId: number) => void;
  readonly onLandHover: (landId: number | null, point?: Point) => void;
}

export class MasterboardRenderer {
  private readonly app: Application;
  private readonly layer = new Container(); // screen-space event catcher
  private readonly world = new Container(); // pan/zoom transform
  private readonly base = new Container();   // board tiles + gates (rebuilt on render)
  private readonly overlay = new Container(); // hover detail (cheap redraw)
  private landPositions: ReadonlyArray<{ id: number; point: Point }> = [];
  private posById = new Map<number, Point>();
  private layout: TriLayout;
  private w: number;
  private h: number;
  private zoom = 1;
  private hoverId: number | null = null;

  constructor(app: Application, width: number, height: number) {
    this.app = app;
    this.w = width;
    this.h = height;
    this.layout = fitTriLayout(LAND_CELLS, width, height, 18);
    this.world.addChild(this.base);
    this.world.addChild(this.overlay);
    this.layer.addChild(this.world);
    this.app.stage.addChild(this.layer);
    this.precomputePositions();
  }

  private precomputePositions(): void {
    this.landPositions = MASTER_LANDS.map((l) => ({ id: l.id, point: triCentroid(l, this.layout) }));
    this.posById = new Map(this.landPositions.map((lp) => [lp.id, lp.point]));
  }

  setVisible(visible: boolean): void {
    this.layer.visible = visible;
  }

  resetView(): void {
    this.zoom = 1;
    this.world.scale.set(1);
    this.world.position.set(0, 0);
  }

  /** Zoom by a factor toward the viewport centre (for the on-screen +/− buttons). */
  zoomBy(factor: number): void {
    const next = clampZoom(this.zoom * factor);
    const f = next / this.zoom;
    const cx = this.w / 2, cy = this.h / 2;
    this.world.position.set(cx - f * (cx - this.world.x), cy - f * (cy - this.world.y));
    this.zoom = next;
    this.world.scale.set(next);
  }

  attachInput(cb: MasterboardCallbacks): void {
    this.layer.eventMode = "static";
    this.layer.hitArea = new Rectangle(0, 0, this.w, this.h);
    // Nearest-centroid picking is exact between edge-neighbours (the shared
    // edge IS the bisector of their centroids); the cap only rejects misses
    // outside the board.
    const hitR = () => this.side() * 0.62;

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
        if (moved > 4) {
          this.world.position.set(worldStart.x + dx, worldStart.y + dy);
          cb.onLandHover(null);
          this.setHover(null);
          return;
        }
      }
      const id = idAt(e);
      this.setHover(id);
      cb.onLandHover(id, id === null ? undefined : this.screenPointFor(id));
    });
    const end = (e: unknown) => {
      if (dragStart && moved <= 4) {
        const id = idAt(e);
        if (id !== null) cb.onLandClick(id);
      }
      dragStart = worldStart = null;
    };
    this.layer.on("pointerup", end);
    this.layer.on("pointerupoutside", end);
    this.layer.on("pointerleave", () => { cb.onLandHover(null); this.setHover(null); });

    const canvas = this.app.canvas as HTMLCanvasElement;
    canvas.addEventListener("wheel", (ev: WheelEvent) => {
      if (!this.layer.visible) return;
      ev.preventDefault();
      const next = clampZoom(this.zoom * (ev.deltaY < 0 ? 1.12 : 1 / 1.12));
      const f = next / this.zoom;
      this.world.position.set(ev.offsetX - f * (ev.offsetX - this.world.x), ev.offsetY - f * (ev.offsetY - this.world.y));
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
    this.layout = fitTriLayout(LAND_CELLS, w, h, 18);
    if (this.layer.hitArea instanceof Rectangle) { this.layer.hitArea.width = w; this.layer.hitArea.height = h; }
    this.precomputePositions();
  }

  /**
   * Re-draw the whole board.
   *   selectedLand    banner ring (the selected legion's land)
   *   highlightLands  a selected legion's reachable set — lit while others dim
   *   attentionLands  lands whose legions can act this phase — brass ring
   *   engageLands     reachable lands holding an ENEMY legion — landing there
   *                   ends the move and forces a battle, so they ring as attacks
   */
  render(
    view: GameStateView,
    selectedLand: number | null,
    _hoveredLand: number | null,
    highlightLands: ReadonlySet<number> = new Set(),
    attentionLands: ReadonlySet<number> = new Set(),
    engageLands: ReadonlySet<number> = new Set(),
  ): void {
    this.syncExtent();
    this.base.removeChildren();
    const s = this.side();
    const focusing = highlightLands.size > 0;

    const legionsByLand = groupLegions(view);

    // Pass 1 — land tiles.
    for (const land of MASTER_LANDS) {
      const isSel = land.id === selectedLand;
      const isReach = highlightLands.has(land.id);
      const dim = focusing && !isReach && !isSel;
      this.drawTile(land, s, {
        dim, selected: isSel, reachable: isReach,
        attention: attentionLands.has(land.id), engage: engageLands.has(land.id),
      });
    }

    // Pass 2 — the painted gates, on top of every tile so they never get buried.
    const gates = new Graphics();
    for (const land of MASTER_LANDS) {
      const dim = focusing && !highlightLands.has(land.id) && land.id !== selectedLand;
      const A = this.posById.get(land.id)!;
      for (const ex of land.exits) {
        const B = this.posById.get(ex.to);
        if (B) drawGate(gates, ex.type, A, B, s, dim ? 0.25 : 1);
      }
    }
    this.base.addChild(gates);

    // Pass 3 — legion tokens above the gates.
    for (const land of MASTER_LANDS) {
      const legs = legionsByLand.get(land.id);
      if (!legs) continue;
      const dim = focusing && !highlightLands.has(land.id) && land.id !== selectedLand;
      this.drawLegionTokens(land, s, legs, view, dim);
    }

    this.renderOverlay(s);
  }

  /** One land: truncated-triangle tile, terrain fill, name + number, state rings. */
  private drawTile(
    land: (typeof MASTER_LANDS)[number],
    s: number,
    st: { dim: boolean; selected: boolean; reachable: boolean; attention: boolean; engage: boolean },
  ): void {
    const fill = hex(terrainColor[land.terrain] ?? terrainColor.Plains!);
    const isTower = land.terrain === "Tower";
    const c = this.posById.get(land.id)!;
    const poly = flat(triLandPolygon(land, this.layout, TRUNC, SCALE));

    const g = new Graphics();
    g.poly(poly)
      .fill({ color: fill, alpha: st.dim ? 0.28 : 1 })
      .stroke({ color: hex(isTower ? palette.brassBright : "#241F19"), width: isTower ? 2.5 : 1.25, alpha: st.dim ? 0.4 : 1 });
    // State rings, drawn just inside the land's own border.
    const ringPoly = flat(triLandPolygon(land, this.layout, TRUNC, SCALE * 0.94));
    if (st.selected) {
      g.poly(ringPoly).stroke({ color: hex(palette.oxbloodBright), width: 4 });
    } else if (st.reachable && st.engage) {
      // Attack destination: an enemy legion holds it — moving here ends the
      // move and forces an engagement. Ringed in alarm, not verdigris.
      g.poly(poly).fill({ color: hex(palette.alarm), alpha: 0.20 });
      g.poly(ringPoly).stroke({ color: hex(palette.alarm), width: 3.5 });
    } else if (st.reachable) {
      g.poly(poly).fill({ color: hex(palette.verdigris), alpha: 0.18 });
      g.poly(ringPoly).stroke({ color: hex(palette.verdigris), width: 3.5 });
    } else if (st.attention && !st.dim) {
      g.poly(ringPoly).stroke({ color: hex(palette.brassBright), width: 2.5, alpha: 0.9 });
    }
    this.base.addChild(g);

    const dark = luminance(fill) > 150;
    const ink = hex(st.dim ? (dark ? "#6B655B" : "#B7AE9C") : (dark ? INK_DARK : INK_LIGHT));
    const halo = hex(dark ? INK_LIGHT : INK_DARK);
    const up = triPointsUp(land);
    const toBase = up ? 1 : -1; // unit direction (screen-y) from centroid toward the wide base side

    // Text stack sits slightly toward the apex; tokens own the wide base side.
    const nameY = c.y - toBase * s * 0.155;
    const numY = c.y + toBase * s * 0.01;

    const name = new Text({
      text: land.terrain.toUpperCase(),
      style: {
        fontFamily: typ.body, fontSize: Math.max(7, Math.round(s * 0.072)), fontWeight: "700", letterSpacing: 0.4,
        fill: ink, stroke: { color: halo, width: Math.max(1, s * 0.012) },
      },
    });
    name.anchor.set(0.5);
    name.x = c.x; name.y = nameY;
    name.alpha = st.dim ? 0.5 : 1;
    this.base.addChild(name);

    const num = new Text({
      text: String(land.id),
      style: {
        fontFamily: typ.mono, fontSize: Math.max(10, Math.round(s * 0.13)), fontWeight: "700",
        fill: ink, stroke: { color: halo, width: Math.max(1.5, s * 0.02) },
      },
    });
    num.anchor.set(0.5);
    num.x = c.x; num.y = numY;
    num.alpha = st.dim ? 0.5 : 1;
    this.base.addChild(num);

    if (isTower) this.drawTowerIcon(c, s, toBase, st.dim);
  }

  /** The little castle silhouette a Tower land carries on the printed board. */
  private drawTowerIcon(c: Point, s: number, toBase: number, dim: boolean): void {
    const y = c.y + toBase * s * 0.235; // on the wide side, opposite the text
    const w = s * 0.17, h = s * 0.13;
    const g = new Graphics();
    g.rect(c.x - w / 2, y - h / 2, w, h).fill({ color: hex(INK_DARK), alpha: dim ? 0.35 : 0.9 });
    const mw = w / 5;
    for (let i = 0; i < 3; i++) {
      g.rect(c.x - w / 2 + (2 * i) * mw, y - h / 2 - mw, mw, mw).fill({ color: hex(INK_DARK), alpha: dim ? 0.35 : 0.9 });
    }
    this.base.addChild(g);
  }

  /** Legion tokens: owner-coloured discs along the land's wide (base) side. */
  private drawLegionTokens(
    land: (typeof MASTER_LANDS)[number],
    s: number,
    legs: GameStateView["legions"][string][],
    view: GameStateView,
    dim: boolean,
  ): void {
    const c = this.posById.get(land.id)!;
    const up = triPointsUp(land);
    const n = legs.length;
    const tr = Math.min(s * 0.105, s * 0.26 / Math.max(1, n));
    const gap = tr * 2.25;
    const y = c.y + (up ? 1 : -1) * s * 0.205;
    const x0 = c.x - (gap * (n - 1)) / 2;
    legs.forEach((legion, i) => {
      const owner = (view.players[legion.ownerId] as { color?: string } | undefined)?.color ?? null;
      const col = (owner && SLOT_BANNER[owner]) || palette.seal;
      const x = x0 + i * gap;
      const g = new Graphics();
      g.circle(x + tr * 0.1, y + tr * 0.14, tr).fill({ color: hex("#000000"), alpha: dim ? 0.1 : 0.3 });
      g.circle(x, y, tr).fill({ color: hex(col), alpha: dim ? 0.4 : 1 }).stroke({ color: hex(palette.vellum), width: Math.max(1, tr * 0.16), alpha: dim ? 0.4 : 1 });
      this.base.addChild(g);
      const t = new Text({
        text: String(legion.height),
        style: { fontFamily: typ.mono, fontSize: Math.max(8, tr * 1.05), fontWeight: "700", fill: hex(palette.vellum) },
      });
      t.anchor.set(0.5); t.x = x; t.y = y; t.alpha = dim ? 0.5 : 1;
      this.base.addChild(t);
    });
  }

  // --- hover detail (overlay layer) -----------------------------------------

  private setHover(id: number | null): void {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.renderOverlay(this.side());
  }

  /** On hover, outline the hovered land and ring each land its exits reach,
   *  coloured by exit type. The painted gates already show direction; this
   *  simply answers "where can this land go?" at a glance. */
  private renderOverlay(s: number): void {
    this.overlay.removeChildren();
    const id = this.hoverId;
    if (id === null) return;
    const land = LAND_BY_ID.get(id);
    if (!land) return;

    const g = new Graphics();
    for (const ex of land.exits) {
      const to = LAND_BY_ID.get(ex.to);
      if (!to) continue;
      g.poly(flat(triLandPolygon(to, this.layout, TRUNC, SCALE))).stroke({ color: exitColor(ex.type), width: 3, alpha: 0.95 });
    }
    g.poly(flat(triLandPolygon(land, this.layout, TRUNC, SCALE))).stroke({ color: hex(palette.brassBright), width: 3.5, alpha: 0.98 });
    this.overlay.addChild(g);
    void s;
  }

  // --- geometry helpers ------------------------------------------------------

  /** Side length of a full (untruncated) land triangle — the board's scale unit. */
  private side(): number {
    return this.layout.side;
  }

  private screenPointFor(id: number): Point | undefined {
    const c = this.posById.get(id);
    if (!c) return undefined;
    return { x: this.world.x + c.x * this.zoom, y: this.world.y + c.y * this.zoom };
  }

  private localPoint(e: unknown): Point {
    const gp = (e as { global?: { x: number; y: number } }).global;
    if (!gp) return { x: 0, y: 0 };
    const p = this.world.toLocal({ x: gp.x, y: gp.y } as never) as { x: number; y: number };
    return { x: p.x, y: p.y };
  }
}

function clampZoom(z: number): number {
  return Math.max(0.7, Math.min(4, z));
}

/** Flatten Points to the number[] Pixi's poly() wants. */
function flat(pts: readonly Point[]): number[] {
  const out: number[] = [];
  for (const p of pts) { out.push(p.x, p.y); }
  return out;
}

/** Group legions by the land they sit on. */
function groupLegions(view: GameStateView): Map<number, GameStateView["legions"][string][]> {
  const byLand = new Map<number, GameStateView["legions"][string][]>();
  for (const legion of Object.values(view.legions)) {
    const arr = byLand.get(legion.land) ?? [];
    arr.push(legion);
    byLand.set(legion.land, arr);
  }
  return byLand;
}

// ---------------------------------------------------------------------------
// The painted gates — drawn once per exit, exactly as the physical board
// prints them at the border between two lands:
//   ARROWS  three chevrons abreast     — a track: the normal forward flow
//   ARROW   one chevron                — tower / summit connector
//   ARCH    a cream archway            — a gateway you may pass or stop through
//   BLOCK   a solid bar                — one-way: exit only, no entry this side
// Each glyph sits just inside the DESTINATION land at the shared edge and
// points along the direction of travel, so two-way connectors never overlap.
// ---------------------------------------------------------------------------

function drawGate(g: Graphics, type: string, from: Point, to: Point, s: number, alpha: number): void {
  // The midpoint of the two centroids lies ON the shared edge (both centroids
  // are the triangle inradius from it, mirror-imaged).
  const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;   // direction of travel
  const px = -uy, py = ux;              // along the edge
  const inset = s * 0.075;              // glyph centre, just inside the destination
  const cx = mx + ux * inset, cy = my + uy * inset;

  const fill = hex(GATE_FILL);
  const line = hex(INK_DARK);

  if (type === "BLOCK") {
    const hw = s * 0.115, hh = s * 0.028;
    g.poly([
      cx - px * hw - ux * hh, cy - py * hw - uy * hh,
      cx + px * hw - ux * hh, cy + py * hw - uy * hh,
      cx + px * hw + ux * hh, cy + py * hw + uy * hh,
      cx - px * hw + ux * hh, cy - py * hw + uy * hh,
    ]).fill({ color: fill, alpha }).stroke({ color: line, width: 1, alpha });
    return;
  }

  if (type === "ARCH") {
    // A little archway: a half-disc whose rounded top bulges along travel,
    // built point-by-point so the bulge side never flips with orientation.
    const r = s * 0.085;
    const pts: number[] = [];
    for (let i = 0; i <= 12; i++) {
      const th = Math.PI * (i / 12); // +edge → +travel → −edge
      const bx = px * Math.cos(th) + ux * Math.sin(th);
      const by = py * Math.cos(th) + uy * Math.sin(th);
      pts.push(cx + bx * r, cy + by * r);
    }
    // Flat base slightly behind the edge, closing the arch.
    pts.push(cx - px * r - ux * r * 0.5, cy - py * r - uy * r * 0.5);
    pts.push(cx + px * r - ux * r * 0.5, cy + py * r - uy * r * 0.5);
    g.poly(pts).fill({ color: fill, alpha: alpha * 0.95 }).stroke({ color: line, width: 1, alpha });
    return;
  }

  const count = type === "ARROWS" ? 3 : 1;
  const spacing = s * 0.105;
  const l = s * 0.085, w = s * 0.062; // arrowhead length / half-width
  for (let i = 0; i < count; i++) {
    const off = (i - (count - 1) / 2) * spacing;
    const ax = cx + px * off, ay = cy + py * off;
    g.poly([
      ax + ux * l, ay + uy * l,
      ax - ux * l * 0.4 + px * w, ay - uy * l * 0.4 + py * w,
      ax - ux * l * 0.4 - px * w, ay - uy * l * 0.4 - py * w,
    ]).fill({ color: fill, alpha }).stroke({ color: line, width: 1, alpha });
  }
}
