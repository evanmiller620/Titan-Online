/**
 * Battleland renderer (Titan client, render layer).
 *
 * Draws one of the eleven 27-hex battle maps using the flat-top cube→pixel
 * projection. Hex fills are tinted by in-hex terrain; elevation darkens the
 * fill; hexside features (walls, slopes, dunes, cliffs) are drawn as edge
 * strokes. Combatants are placed from the redacted battle state — and because
 * a battle reveals both engaged legions, combatant creatures are shown openly,
 * matching the rules and the redaction view.
 *
 * Pure render: reads a BattleContext, emits hex clicks; never mutates state.
 */

import { Application, Container, Graphics, Text } from "pixi.js";
import {
  BATTLE_MAPS,
  type GameStateView,
  type CubeCoord,
} from "@titan/engine";
import { cubeToPixelFlat, hexCornersFlat, fitHexLayout, type HexLayout, type Point } from "./projection.ts";
import { palette, terrainColor } from "../ui/tokens.ts";

const hex = (s: string) => parseInt(s.replace("#", ""), 16);

/** Hexside feature stroke colours. */
const BORDER_COLOR: Record<string, string> = {
  w: palette.brass, // wall
  c: palette.ink, // cliff
  s: palette.verdigris, // slope
  d: palette.brassBright, // dune
  r: palette.verdigris, // river
};

const HAZARD_TINT: Record<string, string> = {
  Brambles: "#7C7A3A",
  Sand: "#D8B878",
  Bog: "#5C5436",
  Drift: "#CBD6D8",
  Tree: "#3E5A33",
  Volcano: "#8E3A24",
  Tower: "#9A8466",
  Plains: terrainColor.Plains!,
};

export interface BattlelandCallbacks {
  readonly onHexClick: (cube: CubeCoord) => void;
}

export class BattlelandRenderer {
  private readonly app: Application;
  private readonly layer = new Container();
  private layout: HexLayout;

  constructor(app: Application, width: number, height: number) {
    this.app = app;
    this.layout = { size: Math.min(width, height) / 9, origin: { x: width / 2, y: height / 2 } };
    this.app.stage.addChild(this.layer);
  }

  /** Draw a battle from the redacted snapshot's battle context. `pendingHexes`
   *  are manual deployment placements not yet submitted; `markHex` is a chosen
   *  target (e.g. an Angel-summon landing spot) — both drawn as markers. */
  render(view: GameStateView, selected: string | null, pendingHexes: readonly string[] = [], markHex: string | null = null): void {
    this.layer.removeChildren();
    const battle = view.battle;
    if (!battle) return;
    const map = BATTLE_MAPS[battle.terrain];
    if (!map) return;

    // Size the board to its ACTUAL hex extent within the live canvas, centred —
    // so it fills the board area without overflowing or hiding under a panel.
    const r = this.app.renderer as { width?: number; height?: number } | undefined;
    const w = r?.width || this.app.screen?.width || 800;
    const h = r?.height || this.app.screen?.height || 600;
    this.layout = fitHexLayout(map.hexes.map((hx) => hx.cube), w, h, Math.min(w, h) * 0.06);

    // Hexes.
    for (const h of map.hexes) {
      const center = cubeToPixelFlat(h.cube, this.layout);
      const corners = hexCornersFlat(center, this.layout.size * 0.92);
      const poly: number[] = [];
      for (const c of corners) poly.push(c.x, c.y);

      const tint = hex(HAZARD_TINT[h.terrain] ?? HAZARD_TINT.Plains!);
      const elevationDarken = 1 - h.elevation * 0.12;

      const g = new Graphics();
      g.poly(poly)
        .fill({ color: shade(tint, elevationDarken), alpha: 1 })
        .stroke({ color: hex(palette.parchmentEdge), width: 1 });
      this.layer.addChild(g);

      // Hexside features as thick edge strokes on the relevant borders.
      for (const b of h.borders) {
        const edge = this.edgeSegment(center, b.dir);
        const eg = new Graphics();
        eg.poly([edge.a.x, edge.a.y, edge.b.x, edge.b.y])
          .stroke({ color: hex(BORDER_COLOR[b.type] ?? palette.ink), width: 4 });
        this.layer.addChild(eg);
      }

      // Hex label, faint.
      const label = new Text({
        text: h.label,
        style: { fontFamily: "monospace", fontSize: this.layout.size * 0.28, fill: hex(palette.inkSoft) },
      });
      label.anchor.set(0.5);
      label.x = center.x;
      label.y = center.y - this.layout.size * 0.5;
      this.layer.addChild(label);
    }

    // Combatants (battle reveals both legions → creatures shown openly).
    const rad = this.layout.size * 0.5;
    for (const c of battle.combatants) {
      if (c.slain || !c.hex) continue;
      const center = cubeToPixelFlat(c.hex, this.layout);
      const isSel = c.id === selected;
      const fill = c.side === "attacker" ? palette.oxblood : palette.verdigris;

      // Selection glow ring behind the disc.
      if (isSel) {
        this.layer.addChild(new Graphics()
          .circle(center.x, center.y, rad + this.layout.size * 0.14)
          .stroke({ color: hex(palette.brassBright), width: 3, alpha: 0.9 }));
      }

      const disc = new Graphics();
      disc.circle(center.x + rad * 0.12, center.y + rad * 0.16, rad).fill({ color: hex("#000000"), alpha: 0.25 }); // shadow
      disc
        .circle(center.x, center.y, rad)
        .fill({ color: hex(fill) })
        .stroke({ color: isSel ? hex(palette.brassBright) : hex(palette.vellum), width: isSel ? 3 : 1.5 });
      this.layer.addChild(disc);

      const name = new Text({
        text: abbrev(c.creature),
        style: { fontFamily: "sans-serif", fontSize: this.layout.size * 0.32, fill: hex(palette.vellum), fontWeight: "700", stroke: { color: hex("#1A1714"), width: 1 } },
      });
      name.anchor.set(0.5);
      name.x = center.x;
      name.y = center.y;
      this.layer.addChild(name);

      // Damage as a clear badge at the top-right of the disc.
      if (c.damage > 0) {
        const bx = center.x + rad * 0.78, by = center.y - rad * 0.78, br = this.layout.size * 0.22;
        this.layer.addChild(new Graphics().circle(bx, by, br)
          .fill({ color: hex(palette.alarm) }).stroke({ color: hex(palette.vellum), width: 1.5 }));
        const dmg = new Text({
          text: String(c.damage),
          style: { fontFamily: "monospace", fontSize: this.layout.size * 0.26, fontWeight: "700", fill: hex(palette.vellum) },
        });
        dmg.anchor.set(0.5);
        dmg.x = bx;
        dmg.y = by;
        this.layer.addChild(dmg);
      }
    }

    // Pending manual-deployment placements (not yet submitted) + a chosen target.
    const byLabel = new Map(map.hexes.map((h) => [h.label, h.cube]));
    for (const label of pendingHexes) {
      const cube = byLabel.get(label);
      if (!cube) continue;
      const p = cubeToPixelFlat(cube, this.layout);
      this.layer.addChild(new Graphics().circle(p.x, p.y, this.layout.size * 0.5)
        .fill({ color: hex(palette.oxblood), alpha: 0.4 })
        .stroke({ color: hex(palette.brassBright), width: 2 }));
    }
    if (markHex) {
      const cube = byLabel.get(markHex);
      if (cube) {
        const p = cubeToPixelFlat(cube, this.layout);
        this.layer.addChild(new Graphics().circle(p.x, p.y, this.layout.size * 0.55)
          .stroke({ color: hex(palette.brassBright), width: 3 }));
      }
    }
  }

  /** Show or hide this board (the app toggles between master/battle boards). */
  setVisible(visible: boolean): void {
    this.layer.visible = visible;
  }

  /** Wire hex clicks. `getView` returns the LATEST snapshot so the handler is
   *  never stale as the battle advances. */
  attachInput(cb: BattlelandCallbacks, getView: () => GameStateView | null): void {
    this.layer.eventMode = "static";
    this.layer.on("pointertap", (e: unknown) => {
      const battle = getView()?.battle;
      if (!battle) return;
      const map = BATTLE_MAPS[battle.terrain];
      if (!map) return;
      const ev = e as { global?: { x: number; y: number } };
      if (!ev.global) return;
      // Nearest hex centre wins (cheap and exact enough at this scale).
      let best: CubeCoord | null = null;
      let bestD = Infinity;
      for (const h of map.hexes) {
        const c = cubeToPixelFlat(h.cube, this.layout);
        const d = (c.x - ev.global.x) ** 2 + (c.y - ev.global.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = h.cube;
        }
      }
      if (best && bestD <= (this.layout.size * 1.1) ** 2) cb.onHexClick(best);
    });
  }

  /** Midpoint segment of the edge in direction `dir` for drawing features. */
  private edgeSegment(center: Point, dir: number): { a: Point; b: Point } {
    const corners = hexCornersFlat(center, this.layout.size * 0.92);
    // Flat-top edge `dir` lies between corner dir and dir+1.
    const a = corners[dir % 6]!;
    const b = corners[(dir + 1) % 6]!;
    return { a, b };
  }
}

/** Darken a packed RGB color by factor (0..1). */
function shade(color: number, factor: number): number {
  const r = Math.round(((color >> 16) & 0xff) * factor);
  const g = Math.round(((color >> 8) & 0xff) * factor);
  const b = Math.round((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

function abbrev(creature: string): string {
  return creature.slice(0, 3);
}
