/**
 * Battleland renderer (Titan client, render layer).
 *
 * Draws one of the eleven 27-hex battle maps using the flat-top cube→pixel
 * projection. Each map is visually distinct: in-hex hazards (Brambles, Sand,
 * Bog, Drift, Tree, Volcano, Tower, …) get their own tint AND a small motif so
 * the terrain reads at a glance; elevation darkens the fill and shows a level
 * badge; and the hexside features (wall, cliff, slope, dune, river) are each
 * drawn in a distinct style. Combatants are placed from the redacted battle
 * state — a battle reveals both engaged legions, so creatures are shown openly.
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
import { palette } from "../ui/tokens.ts";

const hex = (s: string) => parseInt(s.replace("#", ""), 16);

/** In-hex hazard fills — distinct, terrain-evoking, within the heraldic palette. */
const HAZARD_TINT: Record<string, string> = {
  Plains: "#DAC78A", // dry grass
  Brambles: "#6F7A37", // thorny olive
  Sand: "#E2C079", // warm sand
  Bog: "#4C4733", // dark mud
  Drift: "#CBD9DF", // pale ice
  Tree: "#2F4A2A", // dense forest (impassable)
  Volcano: "#9A3A22", // lava rock (impassable)
  Tower: "#8C8273", // grey stone
  Lake: "#3E6B86", // water
  Stone: "#7C7568", // bare rock
  Abyss: "#1E1A24", // void
};

/** Hexside feature stroke colours. */
const BORDER_COLOR: Record<string, string> = {
  w: palette.brass, // wall
  c: "#15120F", // cliff (near-black)
  s: palette.verdigris, // slope
  d: palette.brassBright, // dune
  r: "#4E86A6", // river
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
  render(view: GameStateView, selected: string | null, pendingHexes: readonly string[] = [], markHex: string | null = null, deployHexes: readonly string[] = []): void {
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
    const s = this.layout.size;

    // Pass 1: hex bodies (fill + rim), hazard motif, elevation badge, label.
    for (const hxd of map.hexes) {
      const center = cubeToPixelFlat(hxd.cube, this.layout);
      const corners = hexCornersFlat(center, s * 0.93);
      const poly: number[] = [];
      for (const c of corners) poly.push(c.x, c.y);

      const tint = hex(HAZARD_TINT[hxd.terrain] ?? HAZARD_TINT.Plains!);
      const fill = shade(tint, 1 - hxd.elevation * 0.13);

      const g = new Graphics();
      g.poly(poly).fill({ color: fill, alpha: 1 }).stroke({ color: hex(palette.parchmentEdge), width: 1, alpha: 0.7 });
      // Elevation lift: a light top highlight + dark lower shade for a 3D read.
      if (hxd.elevation > 0) {
        g.poly([corners[5]!.x, corners[5]!.y, corners[0]!.x, corners[0]!.y, corners[1]!.x, corners[1]!.y])
          .stroke({ color: hex("#FFFFFF"), width: 1.5, alpha: 0.12 + hxd.elevation * 0.05 });
      }
      this.layer.addChild(g);

      this.drawHazardMotif(hxd.terrain, center, s);
      if (hxd.elevation > 0) this.drawElevationBadge(center, s, hxd.elevation);

      // Hex coordinate label, faint, tucked at the bottom.
      const label = new Text({
        text: hxd.label,
        style: { fontFamily: "monospace", fontSize: s * 0.22, fill: hex(palette.inkSoft), fontWeight: "600" },
      });
      label.anchor.set(0.5);
      label.x = center.x;
      label.y = center.y + s * 0.62;
      label.alpha = 0.65;
      this.layer.addChild(label);
    }

    // Pass 2: hexside features on top of the fills, each in a distinct style.
    for (const hxd of map.hexes) {
      const center = cubeToPixelFlat(hxd.cube, this.layout);
      for (const b of hxd.borders) {
        const { a, c } = this.edgeSegment(center, b.dir);
        this.drawBorderFeature(a, c, center, b.type, s);
      }
    }

    // Pass 2.5: available deployment hexes — glowing rings inviting placement.
    const byLabelAll = new Map(map.hexes.map((hxd) => [hxd.label, hxd.cube]));
    for (const label of deployHexes) {
      const cube = byLabelAll.get(label);
      if (!cube) continue;
      const p = cubeToPixelFlat(cube, this.layout);
      this.layer.addChild(new Graphics()
        .poly(hexPolyPoints(p, s * 0.78))
        .fill({ color: hex(palette.brassBright), alpha: 0.16 })
        .stroke({ color: hex(palette.brassBright), width: 2.5, alpha: 0.9 }));
      this.layer.addChild(new Graphics().circle(p.x, p.y, s * 0.12).fill({ color: hex(palette.brassBright), alpha: 0.55 }));
    }

    // Pass 3: combatants (battle reveals both legions → creatures shown openly).
    const rad = s * 0.5;
    for (const c of battle.combatants) {
      if (c.slain || !c.hex) continue;
      const center = cubeToPixelFlat(c.hex, this.layout);
      const isSel = c.id === selected;
      const fill = c.side === "attacker" ? palette.oxblood : palette.verdigris;

      if (isSel) {
        this.layer.addChild(new Graphics()
          .circle(center.x, center.y, rad + s * 0.14)
          .stroke({ color: hex(palette.brassBright), width: 3, alpha: 0.9 }));
      }

      const disc = new Graphics();
      disc.circle(center.x + rad * 0.12, center.y + rad * 0.16, rad).fill({ color: hex("#000000"), alpha: 0.25 });
      disc
        .circle(center.x, center.y, rad)
        .fill({ color: hex(fill) })
        .stroke({ color: isSel ? hex(palette.brassBright) : hex(palette.vellum), width: isSel ? 3 : 1.5 });
      this.layer.addChild(disc);

      const name = new Text({
        text: abbrev(c.creature),
        style: { fontFamily: "sans-serif", fontSize: s * 0.32, fill: hex(palette.vellum), fontWeight: "700", stroke: { color: hex("#1A1714"), width: 1 } },
      });
      name.anchor.set(0.5);
      name.x = center.x;
      name.y = center.y;
      this.layer.addChild(name);

      if (c.damage > 0) {
        const bx = center.x + rad * 0.78, by = center.y - rad * 0.78, br = s * 0.22;
        this.layer.addChild(new Graphics().circle(bx, by, br)
          .fill({ color: hex(palette.alarm) }).stroke({ color: hex(palette.vellum), width: 1.5 }));
        const dmg = new Text({
          text: String(c.damage),
          style: { fontFamily: "monospace", fontSize: s * 0.26, fontWeight: "700", fill: hex(palette.vellum) },
        });
        dmg.anchor.set(0.5);
        dmg.x = bx;
        dmg.y = by;
        this.layer.addChild(dmg);
      }
    }

    // Pass 4: pending deployment placements + a chosen target marker.
    const byLabel = new Map(map.hexes.map((hxd) => [hxd.label, hxd.cube]));
    for (const label of pendingHexes) {
      const cube = byLabel.get(label);
      if (!cube) continue;
      const p = cubeToPixelFlat(cube, this.layout);
      this.layer.addChild(new Graphics().circle(p.x, p.y, s * 0.5)
        .fill({ color: hex(palette.oxblood), alpha: 0.4 })
        .stroke({ color: hex(palette.brassBright), width: 2 }));
    }
    if (markHex) {
      const cube = byLabel.get(markHex);
      if (cube) {
        const p = cubeToPixelFlat(cube, this.layout);
        this.layer.addChild(new Graphics().circle(p.x, p.y, s * 0.55)
          .stroke({ color: hex(palette.brassBright), width: 3 }));
      }
    }
  }

  /** A small motif at the hex centre that distinguishes the hazard at a glance. */
  private drawHazardMotif(terrain: string, c: Point, s: number): void {
    const g = new Graphics();
    const { x, y } = c;
    switch (terrain) {
      case "Brambles": {
        const col = hex("#2C3717");
        for (const dx of [-0.26, 0, 0.26]) {
          g.moveTo(x + dx * s - 0.1 * s, y - 0.16 * s).lineTo(x + dx * s + 0.1 * s, y + 0.16 * s);
          g.moveTo(x + dx * s + 0.1 * s, y - 0.16 * s).lineTo(x + dx * s - 0.1 * s, y + 0.16 * s);
        }
        g.stroke({ color: col, width: Math.max(1, s * 0.045), alpha: 0.5 });
        break;
      }
      case "Sand": {
        for (const [dx, dy] of [[-0.26, -0.08], [0, -0.2], [0.26, -0.04], [-0.13, 0.18], [0.18, 0.16]] as const) {
          g.circle(x + dx * s, y + dy * s, s * 0.05).fill({ color: hex("#A07E3C"), alpha: 0.55 });
        }
        break;
      }
      case "Bog": {
        for (const dy of [-0.1, 0.08]) {
          g.moveTo(x - 0.28 * s, y + dy * s);
          for (let i = 1; i <= 4; i++) g.lineTo(x - 0.28 * s + i * 0.14 * s, y + dy * s + (i % 2 ? 0.06 : -0.06) * s);
        }
        g.stroke({ color: hex("#221F12"), width: Math.max(1, s * 0.04), alpha: 0.5 });
        break;
      }
      case "Drift": {
        for (let i = 0; i < 3; i++) {
          const a = (Math.PI / 3) * i;
          g.moveTo(x - Math.cos(a) * 0.26 * s, y - Math.sin(a) * 0.26 * s)
            .lineTo(x + Math.cos(a) * 0.26 * s, y + Math.sin(a) * 0.26 * s);
        }
        g.stroke({ color: hex("#F4FAFE"), width: Math.max(1, s * 0.04), alpha: 0.7 });
        break;
      }
      case "Tree": {
        g.poly([x, y - 0.36 * s, x - 0.26 * s, y + 0.14 * s, x + 0.26 * s, y + 0.14 * s]).fill({ color: hex("#1E3A1A"), alpha: 0.9 });
        g.poly([x, y - 0.12 * s, x - 0.2 * s, y + 0.26 * s, x + 0.2 * s, y + 0.26 * s]).fill({ color: hex("#234720"), alpha: 0.9 });
        g.rect(x - 0.05 * s, y + 0.24 * s, 0.1 * s, 0.12 * s).fill({ color: hex("#3A2A19"), alpha: 0.9 });
        break;
      }
      case "Volcano": {
        g.poly([x - 0.32 * s, y + 0.24 * s, x - 0.1 * s, y - 0.3 * s, x + 0.1 * s, y - 0.3 * s, x + 0.32 * s, y + 0.24 * s])
          .fill({ color: hex("#5A2018"), alpha: 0.92 });
        g.poly([x - 0.1 * s, y - 0.3 * s, x + 0.1 * s, y - 0.3 * s, x + 0.04 * s, y - 0.18 * s, x - 0.04 * s, y - 0.18 * s])
          .fill({ color: hex("#E8742E"), alpha: 0.95 });
        g.circle(x, y - 0.3 * s, s * 0.07).fill({ color: hex("#F4B142"), alpha: 0.95 });
        break;
      }
      case "Tower": {
        const wpx = 0.46 * s;
        g.rect(x - wpx / 2, y - 0.06 * s, wpx, 0.3 * s).fill({ color: hex("#CFC6AD"), alpha: 0.75 });
        for (let i = 0; i < 3; i++) {
          g.rect(x - wpx / 2 + i * (wpx / 3), y - 0.16 * s, wpx / 5, 0.1 * s).fill({ color: hex("#CFC6AD"), alpha: 0.75 });
        }
        break;
      }
      case "Lake": {
        for (const dy of [-0.06, 0.12]) {
          g.moveTo(x - 0.26 * s, y + dy * s);
          for (let i = 1; i <= 4; i++) g.lineTo(x - 0.26 * s + i * 0.13 * s, y + dy * s + (i % 2 ? 0.05 : -0.05) * s);
        }
        g.stroke({ color: hex("#BfE0F0"), width: Math.max(1, s * 0.04), alpha: 0.7 });
        break;
      }
      default:
        return; // Plains and unused terrains: clean hex
    }
    this.layer.addChild(g);
  }

  /** Small badge in the upper-left marking elevation level (▲1, ▲2 …). */
  private drawElevationBadge(c: Point, s: number, elevation: number): void {
    const bx = c.x - s * 0.42, by = c.y - s * 0.5;
    const g = new Graphics();
    g.roundRect(bx - s * 0.02, by - s * 0.12, s * 0.34, s * 0.24, s * 0.06)
      .fill({ color: hex("#15120F"), alpha: 0.72 });
    this.layer.addChild(g);
    const t = new Text({
      text: `▲${elevation}`,
      style: { fontFamily: "monospace", fontSize: s * 0.18, fontWeight: "700", fill: hex(palette.brassBright) },
    });
    t.anchor.set(0, 0.5);
    t.x = bx + s * 0.01;
    t.y = by;
    this.layer.addChild(t);
  }

  /** Draw one hexside feature in a style unique to its type. `a`,`c` are the two
   *  edge corners; `center` is the hex centre (for inward direction). */
  private drawBorderFeature(a: Point, c: Point, center: Point, type: string, s: number): void {
    const g = new Graphics();
    const col = hex(BORDER_COLOR[type] ?? palette.ink);
    const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
    // inward unit (edge midpoint → centre)
    const inx = center.x - mid.x, iny = center.y - mid.y;
    const il = Math.hypot(inx, iny) || 1;
    const nx = inx / il, ny = iny / il;

    switch (type) {
      case "w": { // wall — bold double line (battlement)
        g.moveTo(a.x, a.y).lineTo(c.x, c.y).stroke({ color: col, width: s * 0.16, alpha: 1 });
        g.moveTo(a.x + nx * s * 0.1, a.y + ny * s * 0.1).lineTo(c.x + nx * s * 0.1, c.y + ny * s * 0.1)
          .stroke({ color: hex(palette.brassBright), width: s * 0.05, alpha: 0.9 });
        break;
      }
      case "c": { // cliff — thick dark edge with inward hatch ticks
        g.moveTo(a.x, a.y).lineTo(c.x, c.y).stroke({ color: col, width: s * 0.16, alpha: 1 });
        for (const t of [0.25, 0.5, 0.75]) {
          const px = a.x + (c.x - a.x) * t, py = a.y + (c.y - a.y) * t;
          g.moveTo(px, py).lineTo(px + nx * s * 0.16, py + ny * s * 0.16).stroke({ color: col, width: s * 0.04, alpha: 0.8 });
        }
        break;
      }
      case "s": { // slope — line + a chevron pointing inward (uphill)
        g.moveTo(a.x, a.y).lineTo(c.x, c.y).stroke({ color: col, width: s * 0.08, alpha: 0.95 });
        const ex = (c.x - a.x) / (Math.hypot(c.x - a.x, c.y - a.y) || 1);
        const ey = (c.y - a.y) / (Math.hypot(c.x - a.x, c.y - a.y) || 1);
        const tip = { x: mid.x + nx * s * 0.16, y: mid.y + ny * s * 0.16 };
        g.moveTo(tip.x - ex * s * 0.12, tip.y - ey * s * 0.12).lineTo(tip.x, tip.y)
          .lineTo(tip.x + ex * s * 0.12, tip.y + ey * s * 0.12).stroke({ color: col, width: s * 0.05, alpha: 0.95 });
        break;
      }
      case "d": { // dune — dashed line
        const segs = 5;
        for (let i = 0; i < segs; i += 2) {
          const t0 = i / segs, t1 = (i + 1) / segs;
          g.moveTo(a.x + (c.x - a.x) * t0, a.y + (c.y - a.y) * t0)
            .lineTo(a.x + (c.x - a.x) * t1, a.y + (c.y - a.y) * t1);
        }
        g.stroke({ color: col, width: s * 0.1, alpha: 0.95 });
        break;
      }
      case "r": { // river — blue double thin line
        g.moveTo(a.x, a.y).lineTo(c.x, c.y).stroke({ color: col, width: s * 0.12, alpha: 0.9 });
        g.moveTo(a.x - nx * s * 0.05, a.y - ny * s * 0.05).lineTo(c.x - nx * s * 0.05, c.y - ny * s * 0.05)
          .stroke({ color: hex("#9FD0E6"), width: s * 0.04, alpha: 0.8 });
        break;
      }
      default:
        g.moveTo(a.x, a.y).lineTo(c.x, c.y).stroke({ color: col, width: s * 0.08, alpha: 0.9 });
    }
    this.layer.addChild(g);
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

  /** The two corner points of the edge in direction `dir`. */
  private edgeSegment(center: Point, dir: number): { a: Point; c: Point } {
    const corners = hexCornersFlat(center, this.layout.size * 0.93);
    // Flat-top edge `dir` lies between corner dir and dir+1.
    return { a: corners[dir % 6]!, c: corners[(dir + 1) % 6]! };
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

/** Flat-top hexagon outline (flattened x,y pairs) for highlight rings. */
function hexPolyPoints(center: Point, size: number): number[] {
  const pts: number[] = [];
  for (const c of hexCornersFlat(center, size)) pts.push(c.x, c.y);
  return pts;
}
