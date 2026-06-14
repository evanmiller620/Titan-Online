/**
 * Debug model (Titan client, ui) — PURE data-shaping for the debug panel.
 *
 * The panel itself (DebugPanel.ts) is DOM and browser-only; everything that can
 * be a deterministic read over the snapshot lives here so it is unit-testable:
 *   - fsmTopology()    the whole GameFSM state tree, statically, from the def.
 *   - activeChain()    the set of path-prefixes lit up by the current FSM path.
 *   - stateSections()  the full game state, grouped and formatted for display.
 *
 * Nothing here renders or mutates; it turns a GameStateView (+ FSM path) into
 * plain strings the panel paints.
 */

import { GAME_MACHINE_DEF, BATTLE_MAPS, type GameStateView } from "@titan/engine";

// ---------------------------------------------------------------------------
// FSM topology
// ---------------------------------------------------------------------------

export interface FsmNode {
  readonly name: string;
  readonly path: string;
  readonly depth: number;
  readonly children: FsmNode[];
}

interface RawState { initial?: string; states?: Record<string, RawState> }

function build(states: Record<string, RawState>, prefix: string, depth: number): FsmNode[] {
  return Object.entries(states).map(([name, def]) => {
    const path = prefix ? `${prefix}.${name}` : name;
    const children = def.states ? build(def.states, path, depth + 1) : [];
    return { name, path, depth, children };
  });
}

/** The complete, static GameFSM tree (incl. the grafted Battle subtree). */
export function fsmTopology(): FsmNode[] {
  const def = GAME_MACHINE_DEF as unknown as { states: Record<string, RawState> };
  return build(def.states, "", 0);
}

/** Flatten the tree depth-first (the order the panel lists rows). */
export function flattenFsm(nodes: FsmNode[] = fsmTopology()): FsmNode[] {
  const out: FsmNode[] = [];
  const walk = (n: FsmNode) => { out.push(n); n.children.forEach(walk); };
  nodes.forEach(walk);
  return out;
}

/** Every path-prefix the current FSM path lights up. For
 *  "Turn.Engagement.Battle.Round.Strike" → {Turn, Turn.Engagement, …, …Strike}. */
export function activeChain(path: string): Set<string> {
  const out = new Set<string>();
  let acc = "";
  for (const seg of path.split(".").filter(Boolean)) {
    acc = acc ? `${acc}.${seg}` : seg;
    out.add(acc);
  }
  return out;
}

export function isActiveLeaf(path: string, currentPath: string): boolean {
  return path === currentPath;
}

// ---------------------------------------------------------------------------
// Game-state sections
// ---------------------------------------------------------------------------

export type Tone = "normal" | "good" | "warn" | "muted";
export interface StateRow { readonly k: string; readonly v: string; readonly tone?: Tone }
export interface StateSection { readonly title: string; readonly rows: StateRow[] }

function flag(b: boolean): string { return b ? "✓" : "·"; }

function hexLabel(terrain: string, cube: { x: number; y: number; z: number } | null): string {
  if (!cube) return "—";
  const map = (BATTLE_MAPS as Record<string, { hexes: Array<{ label: string; cube: { x: number; y: number; z: number } }> }>)[terrain];
  const h = map?.hexes.find((x) => x.cube.x === cube.x && x.cube.y === cube.y && x.cube.z === cube.z);
  return h ? h.label : `${cube.x},${cube.y},${cube.z}`;
}

/** Group the whole view into labelled sections for the panel. */
export function stateSections(view: GameStateView): StateSection[] {
  const sections: StateSection[] = [];

  // Turn
  const activePid = view.playerOrder[view.turn.activeIndex] ?? "—";
  sections.push({
    title: "Turn",
    rows: [
      { k: "number", v: String(view.turn.number) },
      { k: "active", v: `${activePid} (#${view.turn.activeIndex})`, tone: "good" },
      { k: "roll", v: view.turn.movementRoll == null ? "—" : String(view.turn.movementRoll) },
      { k: "mulligan", v: flag(view.turn.mulliganUsed) },
      { k: "engagement", v: view.turn.engagementLand == null ? "—" : String(view.turn.engagementLand) },
    ],
  });

  // Players
  sections.push({
    title: "Players",
    rows: view.playerOrder.map((pid) => {
      const p = view.players[pid] as { color?: string | null; score?: number; tower?: number | null; eliminated?: boolean; markersAvailable?: readonly string[] } | undefined;
      const parts = [
        p?.color ?? "—",
        `${p?.score ?? 0}pt`,
        p?.tower != null ? `T${p.tower}` : "no-tower",
        `${p?.markersAvailable?.length ?? 0}mk`,
      ];
      return { k: pid, v: parts.join(" · "), tone: p?.eliminated ? "muted" : pid === activePid ? "good" : "normal" };
    }),
  });

  // Legions
  const legions = Object.values(view.legions);
  sections.push({
    title: `Legions (${legions.length})`,
    rows: legions.map((l) => {
      const flags = `m${flag(l.moved)} s${flag(l.splitThisTurn)} r${flag(l.recruitedThisTurn)}`;
      const contents = l.creatures ? `{${l.creatures.join(",")}}` : "«hidden»";
      return {
        k: l.marker,
        v: `@${l.land} h${l.height} ${flags} ${l.revealed ? "rev " : ""}${contents}`,
        tone: l.creatures ? "normal" : "muted",
      };
    }),
  });

  // Caretaker pool (depleted entries flagged)
  sections.push({
    title: "Caretaker pool",
    rows: Object.entries(view.caretaker)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, n]) => ({ k: name, v: String(n), tone: (n as number) === 0 ? "warn" : "normal" })),
  });

  // Battle (only when one is live)
  const b = view.battle;
  if (b) {
    sections.push({
      title: "Battle",
      rows: [
        { k: "land/terrain", v: `${b.land} · ${b.terrain}` },
        { k: "round", v: String(b.round) },
        { k: "active side", v: b.activeSide, tone: "good" },
        { k: "attacker", v: `${b.attackerPlayerId} · ${b.attackerLegion}` },
        { k: "defender", v: `${b.defenderPlayerId} · ${b.defenderLegion}` },
        { k: "first kill", v: flag(b.firstKillHappened) },
        { k: "summon pending", v: flag(b.summonPending ?? false), tone: b.summonPending ? "warn" : "normal" },
        { k: "reinforced", v: flag(b.reinforcementUsed) },
      ],
    });
    sections.push({
      title: `Combatants (${b.combatants.length})`,
      rows: b.combatants.map((c) => ({
        k: c.id,
        v: `${c.creature} @${hexLabel(b.terrain, c.hex)} dmg${c.damage}${c.slain ? " ✝" : ""}`,
        tone: c.slain ? "muted" : c.side === "attacker" ? "warn" : "normal",
      })),
    });
  }

  // Setup (only before the game proper)
  if (view.setup) {
    const s = view.setup as { order?: readonly string[]; towerPickIndex?: number; colorPickIndex?: number };
    sections.push({
      title: "Setup",
      rows: [
        { k: "order", v: (s.order ?? []).join(", ") || "—" },
        { k: "towerPick", v: String(s.towerPickIndex ?? 0) },
        { k: "colorPick", v: String(s.colorPickIndex ?? 0) },
      ],
    });
  }

  return sections;
}
