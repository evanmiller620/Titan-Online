/**
 * Battleland renderer (Titan client, render layer) — the PHYSICAL board look.
 *
 * Each of the eleven 27-hex battle maps renders like the printed Titan
 * battleland card:
 *   - a board card washed in the masterboard terrain's colour, with the
 *     terrain name printed along the top edge;
 *   - cream hexes with dark rims; hazard hexes carry their full-hex art
 *     (brambles, sand, bog, drift, trees, the volcano, tower stone);
 *   - elevation shown as the printed brown hill tints, level number inset;
 *   - hexside features drawn as the board prints them: slope TEETH pointing
 *     uphill, a solid CLIFF band, crenellated WALLs, scalloped DUNEs;
 *   - creatures as square counters — name, POWER bottom-left, SKILL
 *     bottom-right — exactly like the cardboard chits.
 *
 * Pure render: reads a BattleContext, emits hex clicks; never mutates state.
 */

import { Application, Container, Graphics, Text } from "pixi.js";
import {
  BATTLE_MAPS,
  CREATURE_STATS,
  type GameStateView,
  type CubeCoord,
} from "@titan/engine";
import { cubeToPixelFlat, hexCornersFlat, fitHexLayout, type HexLayout, type Point } from "./projection.ts";
import { palette, terrainColor, type as typ } from "../ui/tokens.ts";

const hex = (s: string) => parseInt(s.replace("#", ""), 16);

const HEX_CREAM = "#EFE6CC"; // the printed board's pale hex field
const HEX_RIM = "#241F19";

/** Full-hex hazard fills, echoing the printed art. */
const HAZARD_TINT: Record<string, string> = {
  Plains: HEX_CREAM,
  Brambles: "#7C8A44", // thorny green
  Sand: "#E3C27E", // warm sand
  Bog: "#5A5540", // dark mire
  Drift: "#DDE7EA", // snow
  Tree: "#3A5A34", // dense canopy (impassable)
  Volcano: "#8F3320", // lava rock (impassable)
  Tower: "#B9AE95", // dressed stone
  Lake: "#4E7D9E",
  Stone: "#8C8578",
  Abyss: "#221D2A",
};

/** Elevation tints — the printed brown hill shades. */
const ELEVATION_TINT: Record<number, string> = {
  1: "#CDA86E",
  2: "#B3854B",
  3: "#996B38",
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

    const r = this.app.renderer as { width?: number; height?: number } | undefined;
    const w = r?.width || this.app.screen?.width || 800;
    const h = r?.height || this.app.screen?.height || 600;
    this.layout = fitHexLayout(map.hexes.map((hx) => hx.cube), w, h, Math.min(w, h) * 0.1);
    const s = this.layout.size;

    this.drawBoardCard(map.hexes.map((hx) => hx.cube), battle.terrain, s);

    // Pass 1: hex bodies — cream field / hazard art / elevation tint + rims.
    for (const hxd of map.hexes) {
      const center = cubeToPixelFlat(hxd.cube, this.layout);
      const corners = hexCornersFlat(center, s * 0.96);
      const poly: number[] = [];
      for (const c of corners) poly.push(c.x, c.y);

      const fill = hxd.elevation > 0 && hxd.terrain === "Plains"
        ? hex(ELEVATION_TINT[hxd.elevation] ?? ELEVATION_TINT[3]!)
        : hex(HAZARD_TINT[hxd.terrain] ?? HEX_CREAM);

      const g = new Graphics();
      g.poly(poly).fill({ color: fill }).stroke({ color: hex(HEX_RIM), width: Math.max(1.5, s * 0.05) });
      this.layer.addChild(g);

      this.drawHazardArt(hxd.terrain, center, s);
      if (hxd.elevation > 0) this.drawElevationNumber(center, s, hxd.elevation, hxd.terrain);

      const label = new Text({
        text: hxd.label,
        style: { fontFamily: typ.mono, fontSize: s * 0.18, fill: hex("#4A453C"), fontWeight: "600" },
      });
      label.anchor.set(0.5);
      label.x = center.x;
      label.y = center.y + s * 0.68;
      label.alpha = 0.55;
      this.layer.addChild(label);
    }

    // Pass 2: hexside features, printed-board style.
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
        .poly(hexPolyPoints(p, s * 0.8))
        .fill({ color: hex(palette.brassBright), alpha: 0.18 })
        .stroke({ color: hex(palette.brassBright), width: 2.5, alpha: 0.95 }));
    }

    // Pass 3: creature counters (battle reveals both legions).
    for (const c of battle.combatants) {
      if (c.slain || !c.hex) continue;
      this.drawCounter(view, battle, c, s, c.id === selected);
    }

    // Pass 4: pending deployment placements + a chosen target marker.
    for (const label of pendingHexes) {
      const cube = byLabelAll.get(label);
      if (!cube) continue;
      const p = cubeToPixelFlat(cube, this.layout);
      this.layer.addChild(new Graphics().roundRect(p.x - s * 0.42, p.y - s * 0.42, s * 0.84, s * 0.84, s * 0.1)
        .fill({ color: hex(palette.oxblood), alpha: 0.4 })
        .stroke({ color: hex(palette.brassBright), width: 2 }));
    }
    if (markHex) {
      const cube = byLabelAll.get(markHex);
      if (cube) {
        const p = cubeToPixelFlat(cube, this.layout);
        this.layer.addChild(new Graphics().circle(p.x, p.y, s * 0.55)
          .stroke({ color: hex(palette.brassBright), width: 3 }));
      }
    }
  }

  /** The board "card": a rounded panel in the masterboard terrain colour with
   *  the battleland's name printed along the top — like the physical board. */
  private drawBoardCard(cubes: readonly CubeCoord[], terrain: string, s: number): void {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of cubes) {
      const p = cubeToPixelFlat(c, this.layout);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const pad = s * 1.55;
    const x = minX - pad, y = minY - pad, w = maxX - minX + 2 * pad, hgt = maxY - minY + 2 * pad;
    const base = terrainColor[terrain] ?? terrainColor.Plains!;

    const g = new Graphics();
    g.roundRect(x + s * 0.08, y + s * 0.1, w, hgt, s * 0.35).fill({ color: hex("#000000"), alpha: 0.35 });
    g.roundRect(x, y, w, hgt, s * 0.35)
      .fill({ color: hex(base) })
      .stroke({ color: hex(HEX_RIM), width: Math.max(2, s * 0.06) });
    // Inner keyline, like the printed frame.
    g.roundRect(x + s * 0.16, y + s * 0.16, w - s * 0.32, hgt - s * 0.32, s * 0.26)
      .stroke({ color: hex(HEX_RIM), width: 1, alpha: 0.45 });
    this.layer.addChild(g);

    // Name printed in the top-left corner, clear of the tallest hex column —
    // as on the physical battleland cards.
    const title = new Text({
      text: terrain.toUpperCase(),
      style: {
        fontFamily: typ.display, fontSize: s * 0.4, fontWeight: "700", letterSpacing: 2.5,
        fill: hex(HEX_RIM),
      },
    });
    title.anchor.set(0, 0.5);
    title.x = x + s * 0.5;
    title.y = y + s * 0.48;
    title.alpha = 0.85;
    this.layer.addChild(title);
  }

  /** Full-hex hazard art in the spirit of the printed board. */
  private drawHazardArt(terrain: string, c: Point, s: number): void {
    const g = new Graphics();
    const { x, y } = c;
    switch (terrain) {
      case "Brambles": { // thorny scrub: scattered dark asterisks
        const col = hex("#33421C");
        for (const [dx, dy] of [[-0.3, -0.2], [0.1, -0.34], [0.34, -0.05], [-0.12, 0.06], [0.2, 0.3], [-0.34, 0.3]] as const) {
          const px = x + dx * s, py = y + dy * s, rr = s * 0.09;
          g.moveTo(px - rr, py).lineTo(px + rr, py);
          g.moveTo(px - rr * 0.6, py - rr * 0.8).lineTo(px + rr * 0.6, py + rr * 0.8);
          g.moveTo(px + rr * 0.6, py - rr * 0.8).lineTo(px - rr * 0.6, py + rr * 0.8);
        }
        g.stroke({ color: col, width: Math.max(1, s * 0.035), alpha: 0.7 });
        break;
      }
      case "Sand": { // stippled dunes
        for (const [dx, dy] of [[-0.3, -0.12], [0, -0.26], [0.3, -0.08], [-0.16, 0.16], [0.16, 0.2], [0.34, 0.34], [-0.34, 0.36]] as const) {
          g.circle(x + dx * s, y + dy * s, s * 0.045).fill({ color: hex("#A67F35"), alpha: 0.55 });
        }
        break;
      }
      case "Bog": { // murky pools
        g.ellipse(x - 0.14 * s, y - 0.05 * s, s * 0.2, s * 0.11).fill({ color: hex("#3B3827"), alpha: 0.8 });
        g.ellipse(x + 0.18 * s, y + 0.18 * s, s * 0.14, s * 0.08).fill({ color: hex("#3B3827"), alpha: 0.8 });
        g.ellipse(x + 0.12 * s, y - 0.26 * s, s * 0.1, s * 0.055).fill({ color: hex("#3B3827"), alpha: 0.7 });
        break;
      }
      case "Drift": { // snow crystals
        for (const [dx, dy] of [[-0.2, -0.16], [0.22, 0.02], [-0.05, 0.26]] as const) {
          const px = x + dx * s, py = y + dy * s, rr = s * 0.11;
          for (let i = 0; i < 3; i++) {
            const a = (Math.PI / 3) * i;
            g.moveTo(px - Math.cos(a) * rr, py - Math.sin(a) * rr).lineTo(px + Math.cos(a) * rr, py + Math.sin(a) * rr);
          }
        }
        g.stroke({ color: hex("#FFFFFF"), width: Math.max(1, s * 0.035), alpha: 0.85 });
        break;
      }
      case "Tree": { // one big canopy filling the hex
        g.circle(x, y - 0.08 * s, s * 0.34).fill({ color: hex("#274423"), alpha: 0.95 });
        g.circle(x - 0.22 * s, y + 0.06 * s, s * 0.22).fill({ color: hex("#2E5029"), alpha: 0.95 });
        g.circle(x + 0.22 * s, y + 0.06 * s, s * 0.22).fill({ color: hex("#2E5029"), alpha: 0.95 });
        g.rect(x - 0.06 * s, y + 0.2 * s, 0.12 * s, 0.24 * s).fill({ color: hex("#4A3320") });
        break;
      }
      case "Volcano": { // the caldera
        g.circle(x, y, s * 0.34).stroke({ color: hex("#5A1F12"), width: s * 0.09 });
        g.circle(x, y, s * 0.18).fill({ color: hex("#E8742E") });
        g.circle(x, y, s * 0.08).fill({ color: hex("#F6C453") });
        break;
      }
      case "Tower": { // flagstone joints
        const col = hex("#7A7160");
        g.moveTo(x - 0.4 * s, y - 0.14 * s).lineTo(x + 0.4 * s, y - 0.14 * s);
        g.moveTo(x - 0.4 * s, y + 0.14 * s).lineTo(x + 0.4 * s, y + 0.14 * s);
        for (const dx of [-0.2, 0.1, 0.32]) g.moveTo(x + dx * s, y - 0.14 * s).lineTo(x + dx * s, y + 0.14 * s);
        g.stroke({ color: col, width: Math.max(1, s * 0.03), alpha: 0.7 });
        break;
      }
      case "Lake": {
        for (const dy of [-0.08, 0.1]) {
          g.moveTo(x - 0.28 * s, y + dy * s);
          for (let i = 1; i <= 4; i++) g.lineTo(x - 0.28 * s + i * 0.14 * s, y + dy * s + (i % 2 ? 0.05 : -0.05) * s);
        }
        g.stroke({ color: hex("#BFE0F0"), width: Math.max(1, s * 0.04), alpha: 0.8 });
        break;
      }
      default:
        return; // Plains: clean cream hex
    }
    this.layer.addChild(g);
  }

  /** Elevation level, printed small near the hex top like the board's numbers. */
  private drawElevationNumber(c: Point, s: number, elevation: number, terrain: string): void {
    const t = new Text({
      text: String(elevation),
      style: {
        fontFamily: typ.mono, fontSize: s * 0.26, fontWeight: "700",
        fill: hex(terrain === "Tower" ? "#4A453C" : "#6B4A22"),
      },
    });
    t.anchor.set(0.5);
    t.x = c.x;
    t.y = c.y - s * 0.56;
    t.alpha = 0.9;
    this.layer.addChild(t);
  }

  /** One hexside feature, drawn as the physical board prints it. `a`,`c` are
   *  the edge corners; `center` the owning hex's centre (features point INTO
   *  the hex that carries them — the higher/inner side). */
  private drawBorderFeature(a: Point, c: Point, center: Point, type: string, s: number): void {
    const g = new Graphics();
    const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
    const inx = center.x - mid.x, iny = center.y - mid.y;
    const il = Math.hypot(inx, iny) || 1;
    const nx = inx / il, ny = iny / il; // inward unit
    const ex = (c.x - a.x), ey = (c.y - a.y);
    const el = Math.hypot(ex, ey) || 1;
    const tx = ex / el, ty = ey / el; // along-edge unit

    switch (type) {
      case "s": { // SLOPE — a row of small teeth pointing uphill (inward)
        const teeth = 3;
        for (let i = 1; i <= teeth; i++) {
          const t = i / (teeth + 1);
          const bx = a.x + ex * t, by = a.y + ey * t;
          const half = s * 0.09, len = s * 0.16;
          g.poly([
            bx - tx * half, by - ty * half,
            bx + tx * half, by + ty * half,
            bx + nx * len, by + ny * len,
          ]).fill({ color: hex("#6B4A22"), alpha: 0.9 });
        }
        break;
      }
      case "c": { // CLIFF — a solid black band
        g.moveTo(a.x, a.y).lineTo(c.x, c.y).stroke({ color: hex("#15120F"), width: s * 0.14 });
        break;
      }
      case "w": { // WALL — black band with crenellation blocks on the inner side
        g.moveTo(a.x, a.y).lineTo(c.x, c.y).stroke({ color: hex("#26211A"), width: s * 0.11 });
        for (const t of [0.22, 0.5, 0.78]) {
          const bx = a.x + ex * t + nx * s * 0.07, by = a.y + ey * t + ny * s * 0.07;
          const mw = s * 0.1;
          g.rect(bx - mw / 2, by - mw / 2, mw, mw).fill({ color: hex("#26211A") });
        }
        break;
      }
      case "d": { // DUNE — scalloped arcs bulging into the sand side
        const scallops = 3;
        for (let i = 0; i < scallops; i++) {
          const t0 = i / scallops, t1 = (i + 1) / scallops;
          const p0 = { x: a.x + ex * t0, y: a.y + ey * t0 };
          const p1 = { x: a.x + ex * t1, y: a.y + ey * t1 };
          const cx = (p0.x + p1.x) / 2 + nx * s * 0.14, cy = (p0.y + p1.y) / 2 + ny * s * 0.14;
          g.moveTo(p0.x, p0.y).quadraticCurveTo(cx, cy, p1.x, p1.y);
        }
        g.stroke({ color: hex("#8F6A25"), width: Math.max(1.5, s * 0.055) });
        break;
      }
      case "r": { // RIVER — blue double line
        g.moveTo(a.x, a.y).lineTo(c.x, c.y).stroke({ color: hex("#4E86A6"), width: s * 0.12, alpha: 0.9 });
        g.moveTo(a.x - nx * s * 0.05, a.y - ny * s * 0.05).lineTo(c.x - nx * s * 0.05, c.y - ny * s * 0.05)
          .stroke({ color: hex("#9FD0E6"), width: s * 0.04, alpha: 0.8 });
        break;
      }
      default:
        g.moveTo(a.x, a.y).lineTo(c.x, c.y).stroke({ color: hex(palette.ink), width: s * 0.08, alpha: 0.9 });
    }
    this.layer.addChild(g);
  }

  /** A creature as its cardboard counter: square chit, name across the middle,
   *  POWER bottom-left, SKILL bottom-right, damage badge top-right. */
  private drawCounter(
    view: GameStateView,
    battle: NonNullable<GameStateView["battle"]>,
    c: NonNullable<GameStateView["battle"]>["combatants"][number],
    s: number,
    isSel: boolean,
  ): void {
    const center = cubeToPixelFlat(c.hex!, this.layout);
    const half = s * 0.52;
    const fill = c.side === "attacker" ? palette.oxblood : palette.verdigris;

    const g = new Graphics();
    g.roundRect(center.x - half + s * 0.05, center.y - half + s * 0.07, half * 2, half * 2, s * 0.1)
      .fill({ color: hex("#000000"), alpha: 0.3 });
    g.roundRect(center.x - half, center.y - half, half * 2, half * 2, s * 0.1)
      .fill({ color: hex(fill) })
      .stroke({ color: isSel ? hex(palette.brassBright) : hex(palette.vellum), width: isSel ? 3 : 1.5 });
    this.layer.addChild(g);

    const name = new Text({
      text: abbrev(c.creature),
      style: {
        fontFamily: typ.body, fontSize: s * 0.26, fontWeight: "700",
        fill: hex(palette.vellum), stroke: { color: hex("#1A1714"), width: 1 },
      },
    });
    name.anchor.set(0.5);
    name.x = center.x;
    name.y = center.y - s * 0.1;
    this.layer.addChild(name);

    // Power bottom-left · skill bottom-right, exactly like the printed chit.
    const pid = c.side === "attacker" ? battle.attackerPlayerId : battle.defenderPlayerId;
    const score = (view.players[pid] as { score?: number } | undefined)?.score ?? 0;
    const stats = CREATURE_STATS[c.creature as keyof typeof CREATURE_STATS];
    const power = c.creature === "Titan" ? 6 + Math.floor(score / 100) : stats?.power ?? 0;
    const corner = (text: string, dx: number, anchorX: number) => {
      const t = new Text({
        text,
        style: { fontFamily: typ.mono, fontSize: s * 0.2, fontWeight: "700", fill: hex(palette.vellum) },
      });
      t.anchor.set(anchorX, 1);
      t.x = center.x + dx;
      t.y = center.y + half - s * 0.05;
      t.alpha = 0.95;
      this.layer.addChild(t);
    };
    corner(String(power), -half + s * 0.08, 0);
    corner(String(stats?.skill ?? ""), half - s * 0.08, 1);

    if (c.damage > 0) {
      const bx = center.x + half - s * 0.06, by = center.y - half + s * 0.06, br = s * 0.16;
      this.layer.addChild(new Graphics().circle(bx, by, br)
        .fill({ color: hex(palette.alarm) }).stroke({ color: hex(palette.vellum), width: 1.5 }));
      const dmg = new Text({
        text: String(c.damage),
        style: { fontFamily: typ.mono, fontSize: s * 0.2, fontWeight: "700", fill: hex(palette.vellum) },
      });
      dmg.anchor.set(0.5);
      dmg.x = bx;
      dmg.y = by;
      this.layer.addChild(dmg);
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
    const corners = hexCornersFlat(center, this.layout.size * 0.96);
    // Flat-top edge `dir` lies between corner dir and dir+1.
    return { a: corners[dir % 6]!, c: corners[(dir + 1) % 6]! };
  }
}

function abbrev(creature: string): string {
  return creature.length <= 7 ? creature : creature.slice(0, 6) + "·";
}

/** Flat-top hexagon outline (flattened x,y pairs) for highlight rings. */
function hexPolyPoints(center: Point, size: number): number[] {
  const pts: number[] = [];
  for (const c of hexCornersFlat(center, size)) pts.push(c.x, c.y);
  return pts;
}
