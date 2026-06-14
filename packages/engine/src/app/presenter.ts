/**
 * Presenter (Titan engine, module: app) — the SINGLE source of UI legality.
 *
 * Pure functions of (view, seat, selection) that answer the questions a
 * frontend asks:
 *   legalActions()        which command buttons are legal for this seat now?
 *   planMasterboardClick()/planBattleClick()  what does a board click mean?
 *
 * Every result is a ready-to-submit CommandDTO; the runner re-validates each one
 * authoritatively, so an optimistic button can never corrupt state — it is just
 * rejected. This lives in the engine (not the client) so the frontend never
 * re-implements the rules: it consumes these through the app facade.
 */

import { BATTLE_MAPS, attackerEntryHexes, defenderEntryHexes, indexMap, movementRulesFor, isImpassableTerrain } from "../battleland/index.ts";
import { reachable, cubeKey, cubeNeighbor, cubeDistance, type CubeCoord } from "../hex/index.ts";
import { CREATURE_STATS, eligibleRecruits, LORDS } from "../creatures/index.ts";
import { destinationsForRoll, towerTeleportTargets, titanTeleportTargets, isTower, getLand, MASTER_LANDS, type MasterTerrain } from "../masterboard/index.ts";
import { PLAYER_COLORS } from "../state/GameState.ts";
import type { GameStateView } from "../state/views.ts";
import type { CommandDTO } from "../core/commands/Command.ts";

export interface Action {
  readonly label: string;
  readonly dto: CommandDTO;
  readonly primary?: boolean;
  readonly hint?: string;
}

export interface DeployPlacement { readonly combatantId: string; readonly hex: string }

export interface Selection {
  readonly legion: string | null; // masterboard legion marker
  readonly land: number | null; // masterboard land
  readonly combatant: string | null; // battle combatant id
  readonly deploy: readonly DeployPlacement[]; // accumulated manual deployment
  readonly hex: string | null; // a chosen battle hex (e.g. Angel summon target)
}

export const NO_SELECTION: Selection = { legion: null, land: null, combatant: null, deploy: [], hex: null };

export interface ClickPlan {
  readonly select?: Partial<Selection>;
  readonly dto?: CommandDTO;
}

type Side = "attacker" | "defender";
const other = (s: Side): Side => (s === "attacker" ? "defender" : "attacker");

// ---------------------------------------------------------------------------
// Whose move is it?
// ---------------------------------------------------------------------------

/** The side that must act in the current battle leaf, or null. */
export function actorSide(view: GameStateView): Side | null {
  const b = view.battle;
  if (!b) return null;
  const p = view.fsm.path;
  if (p.endsWith("DefenderDeployment")) return "defender";
  if (p.endsWith("AttackerDeployment")) return "attacker";
  if (p.endsWith("Strikeback")) return other(b.activeSide);
  if (p.endsWith("Round.Maneuver") || p.endsWith("Round.Strike")) return b.activeSide;
  return null;
}

function battleActor(view: GameStateView): string | null {
  const side = actorSide(view);
  if (!side || !view.battle) return null;
  return side === "attacker" ? view.battle.attackerPlayerId : view.battle.defenderPlayerId;
}

/** Is it `seat`'s move right now (setup pickers, turn player, or battle actor)? */
export function seatActsNow(view: GameStateView, seat: string | null): boolean {
  if (seat === null) return false;
  const path = view.fsm.path;
  if (path.includes("Battle.")) return battleActor(view) === seat;
  if (path === "Setup.RollingForOrder") return true;
  if (path === "Setup.TowerSelection") return view.setup?.order[view.setup.towerPickIndex] === seat;
  if (path === "Setup.ColorSelection") return view.setup?.order[view.setup.colorPickIndex] === seat;
  return view.playerOrder[view.turn.activeIndex] === seat;
}

/** A short status string for the active battle, or null. */
export function battleBanner(view: GameStateView): string | null {
  const b = view.battle;
  if (!b) return null;
  const p = view.fsm.path;
  if (p.endsWith("Deployment")) return p.endsWith("Defender") ? "defender deploys" : "attacker deploys";
  const phase = p.endsWith("Strike") ? "strike" : p.endsWith("Strikeback") ? "strikeback" : "maneuver";
  return `round ${b.round} · ${actorSide(view)} ${phase}`;
}

// ---------------------------------------------------------------------------
// legalActions
// ---------------------------------------------------------------------------

export function legalActions(view: GameStateView, seat: string, sel: Selection): Action[] {
  const path = view.fsm.path;
  const dto = (type: string, payload: Record<string, unknown> = {}): CommandDTO => ({ type, playerId: seat, payload });

  if (path.startsWith("Setup")) return setupActions(view, seat, dto);
  if (path.includes("Battle.")) return battleActions(view, seat, sel, dto);
  if (!seatActsNow(view, seat)) return [];

  if (path.endsWith("Commencement")) {
    const out: Action[] = [];
    const split = proposeInitialSplit(view, seat);
    if (split) out.push({ label: "Split starting legion (4/4)", dto: dto("SplitLegion", split), primary: true });
    const stillEight = ownLegions(view, seat).some((l) => l.height > 7);
    out.push({ label: "End splits", dto: dto("EndSplits"), primary: !stillEight, hint: stillEight ? "split the 8-stack first" : undefined });
    return out;
  }
  if (path.endsWith("Movement")) {
    if (view.turn.movementRoll == null) return [{ label: "Roll movement", dto: dto("RollMovement"), primary: true }];
    const out: Action[] = [{ label: "End movement", dto: dto("EndMovement"), primary: true }];
    if (view.turn.number === 1 && !view.turn.mulliganUsed) out.push({ label: "Take mulligan", dto: dto("TakeMulligan") });
    out.push(...teleportActions(view, seat, sel, dto));
    return out;
  }
  if (path.endsWith("Engagement.Choosing")) {
    return pendingLands(view).map((land) => ({ label: `Resolve clash at ${land}`, dto: dto("SelectEngagement", { land }), primary: sel.land === land }));
  }
  if (path.endsWith("Engagement.Negotiation")) {
    return [
      { label: "Fight", dto: dto("ResolveEngagement", { outcome: "fight" }), primary: true },
      { label: "Settle — split points", dto: dto("ResolveEngagement", { outcome: "settle", attackerShare: 0.5 }) },
      { label: "Settle — take all", dto: dto("ResolveEngagement", { outcome: "settle", attackerShare: 1 }) },
    ];
  }
  if (path.endsWith("Mustering")) {
    const out = musterActions(view, seat, sel, dto);
    out.push({ label: "End turn", dto: dto("EndTurn"), primary: out.length === 0 });
    return out;
  }
  return [];
}

function setupActions(view: GameStateView, seat: string, dto: (t: string, p?: Record<string, unknown>) => CommandDTO): Action[] {
  const path = view.fsm.path;
  if (path.endsWith("RollingForOrder")) return [{ label: "Roll for turn order", dto: dto("RollTurnOrder"), primary: true }];
  const s = view.setup;
  if (!s) return [];
  if (path.endsWith("TowerSelection")) {
    if (s.order[s.towerPickIndex] !== seat) return [];
    const taken = new Set(Object.values(view.players).map((p) => p.tower).filter((t) => t != null));
    return MASTER_LANDS.filter((l) => isTower(l.id) && !taken.has(l.id)).map((l) => ({ label: `Take Tower ${l.id}`, dto: dto("SelectTower", { tower: l.id }), primary: true }));
  }
  if (path.endsWith("ColorSelection")) {
    if (s.order[s.colorPickIndex] !== seat) return [];
    const taken = new Set(Object.values(view.players).map((p) => p.color).filter(Boolean));
    return PLAYER_COLORS.filter((c) => !taken.has(c)).map((c) => ({ label: `Take ${c}`, dto: dto("SelectColor", { color: c }), primary: true }));
  }
  return [];
}

function battleActions(view: GameStateView, seat: string, sel: Selection, dto: (t: string, p?: Record<string, unknown>) => CommandDTO): Action[] {
  const b = view.battle!;
  const side = actorSide(view);
  if (!side || battleActor(view) !== seat) return [];
  const path = view.fsm.path;

  if (path.endsWith("Deployment")) {
    const mine = b.combatants.filter((c) => c.side === side);
    const placed = sel.deploy.length;
    if (placed >= mine.length) {
      return [{ label: `Deploy legion (${placed}/${mine.length})`, dto: dto("DeployLegion", { placements: sel.deploy }), primary: true }];
    }
    return [{
      label: `Auto-place all (${placed}/${mine.length} placed — or click hexes)`,
      dto: dto("DeployLegion", { placements: autoDeployPlacements(view, side) }), primary: true,
    }];
  }
  if (path.endsWith("Round.Maneuver")) {
    const out: Action[] = [];
    if (b.round === 4 && b.activeSide === "defender" && !b.reinforcementUsed && side === "defender") {
      for (const c of reinforcementOptions(view)) out.push({ label: `Muster ${c}`, dto: dto("ReinforceBattle", { creature: c }) });
    }
    out.push({ label: "End maneuvers", dto: dto("EndManeuvers"), primary: true });
    return out;
  }
  if (path.endsWith("Round.Strike") || path.endsWith("Round.Strikeback")) {
    if (b.summonPending && seat === b.attackerPlayerId) {
      const hex = sel.hex ?? undefined;
      const out: Action[] = summonSources(view).map((m) => ({
        label: `Summon Angel from ${m}${hex ? ` @${hex}` : ""}`,
        dto: dto("SummonAngel", hex ? { fromLegion: m, creature: "Angel", hex } : { fromLegion: m, creature: "Angel" }),
        primary: true,
      }));
      out.push({ label: "Decline summon", dto: dto("DeclineSummon") });
      return out;
    }
    return [{ label: "End strikes", dto: dto("EndStrikes"), primary: true }];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Board click planning
// ---------------------------------------------------------------------------

/** Masterboard: select your legion, then click a legal destination to move. */
export function planMasterboardClick(view: GameStateView, seat: string | null, sel: Selection, landId: number): ClickPlan {
  if (seat === null) return {};
  const here = Object.values(view.legions).filter((l) => l.land === landId);
  const mine = here.find((l) => l.ownerId === seat);

  if (view.fsm.path.endsWith("Movement") && view.turn.movementRoll != null && sel.legion) {
    const leg = view.legions[sel.legion];
    if (leg && leg.ownerId === seat && !leg.moved) {
      const dests = destinationsForRoll(leg.land, view.turn.movementRoll);
      if (dests.some((d) => d.destination === landId)) {
        return { dto: { type: "MoveLegion", playerId: seat, payload: { legionId: leg.marker, destination: landId } } };
      }
    }
  }
  if (mine) return { select: { legion: mine.marker, land: null } };
  return { select: { land: landId } };
}

/** Battleland: place during deployment, pick a summon hex, select a character,
 *  move it, or strike an adjacent enemy — depending on the phase. */
export function planBattleClick(view: GameStateView, seat: string | null, sel: Selection, clicked: CubeCoord): ClickPlan {
  const b = view.battle;
  if (!b || seat === null) return {};
  const side = actorSide(view);
  if (!side || battleActor(view) !== seat) return {};

  const path = view.fsm.path;
  const clickedKey = cubeKey(clicked);
  const at = b.combatants.find((c) => !c.slain && c.hex && cubeKey(c.hex) === clickedKey);

  // Deployment: place the next unplaced character on a legal, empty zone hex.
  if (path.endsWith("Deployment")) {
    const label = labelAt(b.terrain, clickedKey);
    if (!label || !new Set(deployZoneLabels(b.terrain, side)).has(label)) return {};
    const taken = new Set([
      ...b.combatants.filter((c) => c.hex && c.side !== side).map((c) => labelAt(b.terrain, cubeKey(c.hex!))),
      ...sel.deploy.map((p) => p.hex),
    ]);
    if (taken.has(label)) return {};
    const placed = new Set(sel.deploy.map((p) => p.combatantId));
    const next = b.combatants.find((c) => c.side === side && !placed.has(c.id));
    if (!next) return {};
    return { select: { deploy: [...sel.deploy, { combatantId: next.id, hex: label }] } };
  }

  // Summon window: clicking an empty hex picks the Angel's landing spot.
  if ((path.endsWith("Round.Strike") || path.endsWith("Round.Strikeback")) && b.summonPending && seat === b.attackerPlayerId && !at) {
    const label = labelAt(b.terrain, clickedKey);
    if (label) return { select: { hex: label } };
  }

  if (at && at.side === side) return { select: { combatant: at.id } };

  const me = sel.combatant ? b.combatants.find((c) => c.id === sel.combatant && c.side === side && !c.slain) : undefined;
  if (!me || !me.hex) return {};

  if (path.endsWith("Round.Maneuver")) {
    if (at) return {};
    const grid = indexMap(BATTLE_MAPS[b.terrain]!);
    const occ = new Set(b.combatants.filter((c) => !c.slain && c.hex && c.id !== me.id).map((c) => cubeKey(c.hex!)));
    const rules = movementRulesFor(me.creature, grid, { isOccupied: (q) => occ.has(cubeKey(q)), maxSteps: CREATURE_STATS[me.creature].skill });
    if (reachable(me.hex, rules).destinations.has(clickedKey)) {
      return { dto: { type: "MoveCombatant", playerId: seat, payload: { combatantId: me.id, hex: labelAt(b.terrain, clickedKey) } } };
    }
    return {};
  }
  if (path.endsWith("Round.Strike") || path.endsWith("Round.Strikeback")) {
    if (at && at.side !== side && cubeDistance(me.hex, at.hex!) === 1) {
      return { dto: { type: "Strike", playerId: seat, payload: { strikerId: me.id, targetId: at.id } } };
    }
    return {};
  }
  return {};
}

// ---------------------------------------------------------------------------
// helpers (pure)
// ---------------------------------------------------------------------------

function ownLegions(view: GameStateView, seat: string) {
  return Object.values(view.legions).filter((l) => l.ownerId === seat);
}

function pendingLands(view: GameStateView): number[] {
  const owners = new Map<number, Set<string>>();
  for (const l of Object.values(view.legions)) {
    const set = owners.get(l.land) ?? new Set<string>();
    set.add(l.ownerId);
    owners.set(l.land, set);
  }
  return [...owners.entries()].filter(([, s]) => s.size >= 2).map(([land]) => land).sort((a, b) => a - b);
}

export function proposeInitialSplit(view: GameStateView, seat: string): Record<string, unknown> | null {
  if (view.turn.number !== 1) return null;
  const legion = ownLegions(view, seat).find((l) => l.height > 7 && !l.splitThisTurn && l.creatures);
  if (!legion || !legion.creatures) return null;
  const marker = view.players[seat]?.markersAvailable?.[0];
  if (!marker) return null;
  const isLord = (c: string) => c === "Titan" || c === "Angel" || c === "Archangel";
  const childLord = legion.creatures.find((c) => isLord(c) && c !== "Titan");
  if (!childLord) return null;
  const nonLords = legion.creatures.filter((c) => !isLord(c));
  return { legionId: legion.marker, newMarker: marker, toNewLegion: [childLord, ...nonLords.slice(0, 3)] };
}

function teleportActions(view: GameStateView, seat: string, sel: Selection, dto: (t: string, p?: Record<string, unknown>) => CommandDTO): Action[] {
  if (!sel.legion) return [];
  const leg = view.legions[sel.legion];
  if (!leg || leg.ownerId !== seat || leg.moved) return [];
  const creatures = leg.creatures ?? [];
  const out: Action[] = [];
  if (isTower(leg.land) && creatures.some((c) => LORDS.has(c as never))) {
    const occ = new Set(Object.values(view.legions).filter((l) => isTower(l.land)).map((l) => l.land));
    for (const t of towerTeleportTargets(leg.land, occ)) out.push({ label: `Tower-teleport → ${t}`, dto: dto("TowerTeleport", { legionId: leg.marker, destination: t }) });
  }
  if (view.turn.movementRoll === 6 && (view.players[seat]?.score ?? 0) >= 400 && creatures.includes("Titan")) {
    const enemy = new Set(Object.values(view.legions).filter((l) => l.ownerId !== seat).map((l) => l.land));
    for (const t of titanTeleportTargets(enemy)) out.push({ label: `Titan-teleport → ${t}`, dto: dto("TitanTeleport", { legionId: leg.marker, destination: t }) });
  }
  return out;
}

function musterActions(view: GameStateView, seat: string, sel: Selection, dto: (t: string, p?: Record<string, unknown>) => CommandDTO): Action[] {
  if (!sel.legion) return [];
  const leg = view.legions[sel.legion];
  if (!leg || leg.ownerId !== seat || !leg.moved || leg.recruitedThisTurn || leg.height >= 7) return [];
  const land = getLand(leg.land);
  if (!land) return [];
  const creatures = leg.creatures ?? [];
  return eligibleRecruits(land.terrain as MasterTerrain, creatures as never, view.caretaker, { containsOwnTitan: creatures.includes("Titan") })
    .map((o) => ({ label: `Muster ${o.creature}`, dto: dto("Muster", { legionId: leg.marker, creature: o.creature }) }));
}

export function deployZoneLabels(terrain: string, side: Side): string[] {
  const map = BATTLE_MAPS[terrain];
  if (!map) return [];
  const base = side === "attacker" ? attackerEntryHexes(map, "BOTTOM") : defenderEntryHexes(map, "BOTTOM");
  const byCube = new Map(map.hexes.map((h) => [cubeKey(h.cube), h]));
  const byLabel = new Map(map.hexes.map((h) => [h.label, h]));
  const labels = new Set<string>();
  for (const lbl of base) {
    const h = byLabel.get(lbl);
    if (!h) continue;
    labels.add(h.label);
    for (let d = 0; d < 6; d++) {
      const nb = byCube.get(cubeKey(cubeNeighbor(h.cube, d)));
      if (nb && !isImpassableTerrain(nb.terrain)) labels.add(nb.label);
    }
  }
  return [...labels];
}

export function autoDeployPlacements(view: GameStateView, side: Side): DeployPlacement[] {
  const b = view.battle;
  if (!b) return [];
  const mine = b.combatants.filter((c) => c.side === side);
  const occupied = new Set(b.combatants.filter((c) => c.hex && c.side !== side).map((c) => cubeKey(c.hex!)));
  const cubeByLabel = new Map(BATTLE_MAPS[b.terrain]!.hexes.map((h) => [h.label, h.cube]));
  const free = deployZoneLabels(b.terrain, side).filter((lbl) => !occupied.has(cubeKey(cubeByLabel.get(lbl)!)));
  return mine.map((c, i) => ({ combatantId: c.id, hex: free[i]! })).filter((p) => p.hex);
}

function summonSources(view: GameStateView): string[] {
  const b = view.battle!;
  return Object.values(view.legions)
    .filter((l) => l.ownerId === b.attackerPlayerId && l.marker !== b.attackerLegion && (l.creatures ?? []).some((c) => c === "Angel" || c === "Archangel"))
    .map((l) => l.marker);
}

function reinforcementOptions(view: GameStateView): string[] {
  const b = view.battle!;
  const onBoard = b.combatants.filter((c) => c.side === "defender" && !c.slain).map((c) => c.creature);
  return eligibleRecruits(b.terrain as MasterTerrain, onBoard as never, view.caretaker, { containsOwnTitan: onBoard.includes("Titan") }).map((o) => o.creature);
}

function labelAt(terrain: string, key: string): string {
  const h = BATTLE_MAPS[terrain]!.hexes.find((x) => cubeKey(x.cube) === key);
  return h ? h.label : "";
}
