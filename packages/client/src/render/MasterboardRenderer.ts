/**
 * Masterboard renderer (Titan client, render layer — the signature element).
 *
 * Draws the 96-land wheel from `MASTER_LANDS` using the wheel layout, tints
 * each land by terrain, marks tower lands, and places a wax-seal marker for
 * every legion. The seal is the visual embodiment of hidden information: an
 * opponent's legion shows only its banner colour and HEIGHT pip count — never
 * its contents, exactly as the redacted snapshot provides.
 *
 * Strict separation: this class READS a GameStateView and emits land-click /
 * hover events through callbacks. It never imports the store, never builds a
 * command, never mutates anything. The app layer wires its callbacks to
 * command construction.
 */

import { Application, Container, Graphics, Text } from "pixi.js";
import { MASTER_LANDS, type GameStateView } from "@titan/engine";
import { masterLandToPixel, nearestLand, hexCornersFlat, type BoardExtent, type Point } from "./projection.ts";
import { palette, terrainColor } from "../ui/tokens.ts";

const hex = (s: string) => parseInt(s.replace("#", ""), 16);

/** Banner colours for the six player slots → legion seal fills. */
const SLOT_BANNER: Record<string, string> = {
  Black: "#26221E",
  Brown: "#6B4A2B",
  Blue: "#2C4A6B",
  Gold: "#B08D57",
  Green: "#3E6B45",
  Red: "#8E3247",
};

export interface MasterboardCallbacks {
  readonly onLandClick: (landId: number) => void;
  readonly onLandHover: (landId: number | null) => void;
}

export class MasterboardRenderer {
  private readonly app: Application;
  private readonly layer = new Container();
  private landPositions: ReadonlyArray<{ id: number; point: Point }> = [];
  private ext: BoardExtent;

  constructor(app: Application, width: number, height: number) {
    this.app = app;
    this.ext = { cols: 15, rows: 8, width, height, margin: 22 };
    this.app.stage.addChild(this.layer);
    this.precomputePositions();
  }

  private precomputePositions(): void {
    this.landPositions = MASTER_LANDS.map((l) => ({
      id: l.id,
      point: masterLandToPixel(l.col, l.row, this.ext),
    }));
  }

  /** Show or hide this board (the app toggles between master/battle boards). */
  setVisible(visible: boolean): void {
    this.layer.visible = visible;
  }

  /** Wire pointer events. Call once after construction. */
  attachInput(cb: MasterboardCallbacks): void {
    this.layer.eventMode = "static";
    this.layer.on("pointertap", (e: unknown) => {
      const p = this.localPoint(e);
      const id = nearestLand(p, this.landPositions, this.cellRadius() * 1.1);
      if (id !== null) cb.onLandClick(id);
    });
    this.layer.on("pointermove", (e: unknown) => {
      const p = this.localPoint(e);
      const id = nearestLand(p, this.landPositions, this.cellRadius() * 1.1);
      cb.onLandHover(id);
    });
  }

  /** Re-derive the extent from the CURRENT canvas so the wheel always fills
   *  and centres in the live board area (never hidden under the side panels). */
  private syncExtent(): void {
    const rend = this.app.renderer as { width?: number; height?: number } | undefined;
    const w = rend?.width || this.app.screen?.width || this.ext.width;
    const h = rend?.height || this.app.screen?.height || this.ext.height;
    if (w === this.ext.width && h === this.ext.height) return;
    this.ext = { ...this.ext, width: w, height: h };
    this.precomputePositions();
  }

  /** Re-draw the whole board from a redacted snapshot. Idempotent. */
  render(
    view: GameStateView,
    selectedLand: number | null,
    hoveredLand: number | null,
    highlightLands: ReadonlySet<number> = new Set(),
  ): void {
    this.syncExtent();
    this.layer.removeChildren();
    const r = this.cellRadius();

    // Wheel rim — a brass ring framing the board (signature framing).
    const rim = new Graphics();
    rim
      .circle(this.ext.width / 2, this.ext.height / 2, Math.min(this.ext.width, this.ext.height) / 2 - 16)
      .stroke({ color: hex(palette.brass), width: 6, alpha: 0.5 });
    this.layer.addChild(rim);

    const posById = new Map(this.landPositions.map((lp) => [lp.id, lp.point]));

    // Lands.
    for (const land of MASTER_LANDS) {
      const c = posById.get(land.id)!;
      const g = new Graphics();
      const fill = hex(terrainColor[land.terrain] ?? terrainColor.Plains!);
      const isTower = land.terrain === "Tower";
      const isSel = land.id === selectedLand;
      const isHover = land.id === hoveredLand;
      const isTarget = highlightLands.has(land.id);

      // A legal-destination / target halo behind the land, so reachable lands
      // read at a glance during Movement and Engagement.
      if (isTarget) {
        const halo = new Graphics();
        halo
          .poly(hexPoly(c, r + 5))
          .fill({ color: hex(palette.verdigris), alpha: 0.22 })
          .stroke({ color: hex(palette.verdigris), width: 2.5, alpha: 0.95 });
        this.layer.addChild(halo);
      }

      // Lands are hexagons (the board is a tessellated wheel, not dots).
      g.poly(hexPoly(c, r))
        .fill({ color: fill, alpha: isTower ? 1 : 0.92 })
        .stroke({
          color: isSel
            ? hex(palette.oxbloodBright)
            : isTarget
              ? hex(palette.verdigris)
              : isTower
                ? hex(palette.brassBright)
                : hex(palette.parchmentEdge),
          width: isSel ? 3 : isTarget ? 2.5 : isHover ? 2 : 1,
          alpha: 1,
        });
      this.layer.addChild(g);

      // Land number label (utility mono), small and unobtrusive.
      const label = new Text({
        text: String(land.id),
        style: { fontFamily: "monospace", fontSize: Math.max(9, r * 0.5), fill: hex(palette.inkSoft) },
      });
      label.anchor.set(0.5);
      label.x = c.x;
      label.y = c.y;
      this.layer.addChild(label);
    }

    // Legion seals — grouped by land so STACKED legions all show (fanned out)
    // rather than overlapping into one. Each is a wax seal: banner colour +
    // height pips, never contents.
    const byLand = new Map<number, GameStateView["legions"][string][]>();
    for (const legion of Object.values(view.legions)) {
      const arr = byLand.get(legion.land) ?? [];
      arr.push(legion);
      byLand.set(legion.land, arr);
    }
    for (const [land, legs] of byLand) {
      const c = posById.get(land);
      if (!c) continue;
      const n = legs.length;
      const sr = n > 1 ? r * 0.46 : r * 0.6;
      legs.forEach((legion, i) => {
        const color = (view.players[legion.ownerId] as { color?: string } | undefined)?.color ?? null;
        const pos = n === 1
          ? { x: c.x + r * 0.42, y: c.y - r * 0.42 }
          : fanAround(c, r * 0.5, i, n);
        this.drawSeal(pos.x, pos.y, legion, sr, color);
      });
    }
  }

  /** A legion as a wax-seal disc at (sx,sy): banner colour + height pips. */
  private drawSeal(
    sx: number,
    sy: number,
    legion: GameStateView["legions"][string],
    sr: number,
    bannerColor: string | null,
  ): void {
    const color = (bannerColor && SLOT_BANNER[bannerColor]) || palette.seal;
    const seal = new Graphics();
    seal
      .circle(sx, sy, sr)
      .fill({ color: hex(color), alpha: 0.95 })
      .stroke({ color: hex(palette.vellum), width: 1.5 });

    // Height pips around the seal — the only public quantity about the stack.
    for (let i = 0; i < legion.height; i++) {
      const a = (Math.PI * 2 * i) / 7 - Math.PI / 2;
      seal
        .circle(sx + Math.cos(a) * sr * 0.7, sy + Math.sin(a) * sr * 0.7, 1.6)
        .fill({ color: hex(palette.vellum) });
    }
    this.layer.addChild(seal);
  }

  private cellRadius(): number {
    const stepX = (this.ext.width - 2 * this.ext.margin) / (this.ext.cols + 1);
    const stepY = (this.ext.height - 2 * this.ext.margin) / (this.ext.rows + 1);
    return Math.min(stepX, stepY) * 0.56;
  }

  private localPoint(e: unknown): Point {
    const ev = e as { global?: { x: number; y: number } };
    return ev.global ? { x: ev.global.x - this.layer.x, y: ev.global.y - this.layer.y } : { x: 0, y: 0 };
  }
}

/** Flat-top hexagon polygon (flattened x,y pairs) for a land cell. */
function hexPoly(center: Point, size: number): number[] {
  const pts: number[] = [];
  for (const c of hexCornersFlat(center, size)) pts.push(c.x, c.y);
  return pts;
}

/** The i-th of n seals fanned in an arc above the land centre, so a stack of
 *  legions on one land all stay visible instead of overlapping. */
function fanAround(center: Point, radius: number, i: number, n: number): Point {
  if (n <= 1) return { x: center.x, y: center.y };
  const spread = Math.PI * 0.9;
  const a = -Math.PI / 2 - spread / 2 + (spread * i) / (n - 1);
  return { x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius };
}
