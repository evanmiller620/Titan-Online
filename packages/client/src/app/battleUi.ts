/**
 * Battle & flow UI logic (Titan client, app layer).
 *
 * PURE decision functions the HUD and board call to drive a full game — now
 * including the tactical battle. Nothing here renders or talks to the network;
 * everything is a deterministic read over the redacted GameStateView plus the
 * viewer's slot, so it is unit-testable under Node and shared by the React HUD
 * and the Pixi board.
 *
 *   availableActions(store)   the command-bar buttons legal RIGHT NOW, for the
 *                             whole flow: splits, movement, engagement
 *                             (fight/flee/concede), and every battle phase
 *                             (deploy, end maneuvers, end strikes, Angel
 *                             summon, round-4 muster, end turn).
 *   battleBanner(store)       a short "Round 3 · your strike" status string.
 *   autoDeployPlacements()    place a side's combatants on legal entry hexes
 *                             (so deployment needs no multi-click UI).
 *   planBattleClick()         translate a board hex click into the next battle
 *                             command (select / move / strike).
 */

import type { CommandDTO, GameStateView, CubeCoord } from "@titan/engine";
import {
  BATTLE_MAPS,
  attackerEntryHexes,
  defenderEntryHexes,
  indexMap,
  movementRulesFor,
  isImpassableTerrain,
  reachable,
  cubeKey,
  cubeNeighbor,
  cubeDistance,
  CREATURE_STATS,
  eligibleRecruits,
  destinationsForRoll,
  towerTeleportTargets,
  titanTeleportTargets,
  isTower,
  getLand,
  MASTER_LANDS,
  PLAYER_COLORS,
  LORDS,
  type MasterTerrain,
} from "@titan/engine";
import {
  type StoreState,
  isMyTurn,
  inputsLocked,
} from "../store/gameStore.ts";

export interface ActionButton {
  readonly label: string;
  readonly type: string;
  readonly payload?: Record<string, unknown>;
  readonly primary?: boolean;
}

type Side = "attacker" | "defender";
const other = (s: Side): Side => (s === "attacker" ? "defender" : "attacker");

// ---------------------------------------------------------------------------
// Battle phase helpers
// ---------------------------------------------------------------------------

/** Which side must act in the current battle leaf, or null if not in battle. */
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

function actingPlayer(view: GameStateView): string | null {
  const side = actorSide(view);
  if (!side || !view.battle) return null;
  return side === "attacker" ? view.battle.attackerPlayerId : view.battle.defenderPlayerId;
}

/** The viewer is the player who must act in the battle right now. */
export function viewerActsInBattle(state: StoreState): boolean {
  const v = state.snapshot;
  if (!v || !v.battle || state.viewerSlot === null) return false;
  return actingPlayer(v) === state.viewerSlot;
}

export function battleBanner(state: StoreState): string | null {
  const v = state.snapshot;
  if (!v || !v.battle) return null;
  const b = v.battle;
  const p = v.fsm.path;
  if (p.endsWith("DefenderDeployment")) return "Defender deploys";
  if (p.endsWith("AttackerDeployment")) return "Attacker deploys";
  const side = actorSide(v);
  const yours = side && actingPlayer(v) === state.viewerSlot ? " · your move" : "";
  const phase = p.endsWith("Strike") ? "strike"
    : p.endsWith("Strikeback") ? "strikeback"
    : p.endsWith("Maneuver") ? "maneuver" : "battle";
  return `Round ${b.round} · ${side} ${phase}${yours}`;
}

// ---------------------------------------------------------------------------
// Deployment placement
// ---------------------------------------------------------------------------

export interface DeployPlacement { readonly combatantId: string; readonly hex: string }

/** Labels of the legal deploy zone: the entry edge plus its on-board, passable
 *  neighbours (mirrors the engine's DeployLegion validation). */
export function deployZoneLabels(terrain: string, side: Side): string[] {
  const map = BATTLE_MAPS[terrain];
  if (!map) return [];
  const base = side === "attacker"
    ? attackerEntryHexes(map, "BOTTOM")
    : defenderEntryHexes(map, "BOTTOM");
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

/** Place every un-deployed combatant of `side` on a distinct legal hex. */
export function autoDeployPlacements(view: GameStateView, side: Side): DeployPlacement[] {
  const b = view.battle;
  if (!b) return [];
  const mine = b.combatants.filter((c) => c.side === side);
  const occupied = new Set(
    b.combatants.filter((c) => c.hex && c.side !== side).map((c) => cubeKey(c.hex!)),
  );
  const map = BATTLE_MAPS[b.terrain]!;
  const cubeByLabel = new Map(map.hexes.map((h) => [h.label, h.cube]));
  const free = deployZoneLabels(b.terrain, side).filter((lbl) => {
    const c = cubeByLabel.get(lbl)!;
    return !occupied.has(cubeKey(c));
  });
  return mine.map((c, i) => ({ combatantId: c.id, hex: free[i]! })).filter((p) => p.hex);
}

// ---------------------------------------------------------------------------
// Command-bar actions for the whole flow
// ---------------------------------------------------------------------------

export function availableActions(state: StoreState): ActionButton[] {
  const v = state.snapshot;
  if (!v) return [];
  const path = v.fsm.path;

  if (path.startsWith("Setup")) return setupActions(state, v);
  if (path.includes("Battle.")) return battleActions(state, v);

  // Turn-level phases are driven by the masterboard-active player.
  if (!isMyTurn(state)) return [];

  if (path.endsWith("Commencement")) {
    const out: ActionButton[] = [];
    const split = proposeInitialSplit(v, state.viewerSlot);
    if (split) out.push({ label: "Make initial split (4/4)", type: "SplitLegion", payload: split, primary: true });
    out.push({ label: "End splits", type: "EndSplits", primary: !split });
    return out;
  }
  if (path.endsWith("Movement")) {
    const rolled = v.turn.movementRoll != null;
    if (!rolled) return [{ label: "Roll movement", type: "RollMovement", primary: true }];
    const out: ActionButton[] = [{ label: "End movement", type: "EndMovement", primary: true }];
    if (v.turn.number === 1 && !v.turn.mulliganUsed) out.push({ label: "Take mulligan", type: "TakeMulligan" });
    out.push(...teleportOptions(state, v)); // Tower / Titan teleport for the selected legion
    return out;
  }
  if (path.endsWith("Engagement.Choosing")) {
    return pendingEngagementLands(v).map((land) => ({
      label: `Resolve clash at ${land}`, type: "SelectEngagement", payload: { land }, primary: true,
    }));
  }
  if (path.endsWith("Engagement.Negotiation")) {
    return [
      { label: "Fight", type: "ResolveEngagement", payload: { outcome: "fight" }, primary: true },
      { label: "Make them flee", type: "ResolveEngagement", payload: { outcome: "flee" } },
      { label: "Concede", type: "ResolveEngagement", payload: { outcome: "concede" } },
    ];
  }
  if (path.endsWith("Mustering")) {
    const out = musterOptions(state, v); // recruit for the selected legion
    out.push({ label: "End turn", type: "EndTurn", primary: out.length === 0 });
    return out;
  }
  return [];
}

// --- Setup phase actions ---------------------------------------------------

function setupActions(state: StoreState, v: GameStateView): ActionButton[] {
  const viewer = state.viewerSlot;
  if (!viewer) return [];
  const path = v.fsm.path;

  if (path.endsWith("RollingForOrder")) {
    return [{ label: "Roll for turn order", type: "RollTurnOrder", primary: true }];
  }
  const setup = v.setup;
  if (!setup) return [];

  if (path.endsWith("TowerSelection")) {
    if (setup.order[setup.towerPickIndex] !== viewer) return [];
    const claimed = new Set(Object.values(v.players).map((p) => p.tower).filter((t) => t != null));
    return MASTER_LANDS.filter((l) => isTower(l.id) && !claimed.has(l.id)).map((l) => ({
      label: `Choose Tower ${l.id}`, type: "SelectTower", payload: { tower: l.id }, primary: true,
    }));
  }
  if (path.endsWith("ColorSelection")) {
    if (setup.order[setup.colorPickIndex] !== viewer) return [];
    const taken = new Set(Object.values(v.players).map((p) => p.color).filter(Boolean));
    return PLAYER_COLORS.filter((c) => !taken.has(c)).map((c) => ({
      label: `Take ${c}`, type: "SelectColor", payload: { color: c }, primary: true,
    }));
  }
  return [];
}

// --- Initial split (the always-required turn-1 4/4) ------------------------

/** Propose a legal 4/4 initial split of the eight-stack: one Lord per half. */
export function proposeInitialSplit(v: GameStateView, viewer: string | null): Record<string, unknown> | null {
  if (!viewer || v.turn.number !== 1) return null;
  const legion = Object.values(v.legions).find(
    (l) => l.ownerId === viewer && l.height > 7 && !l.splitThisTurn && l.creatures,
  );
  if (!legion || !legion.creatures) return null;
  const marker = v.players[viewer]?.markersAvailable?.[0];
  if (!marker) return null;

  const creatures = [...legion.creatures];
  const isLord = (c: string) => c === "Titan" || c === "Angel" || c === "Archangel";
  // Keep the Titan in the parent; send the other Lord (the Angel) to the child.
  const childLord = creatures.find((c) => isLord(c) && c !== "Titan");
  if (!childLord) return null;
  const nonLords = creatures.filter((c) => !isLord(c));
  const toNewLegion = [childLord, ...nonLords.slice(0, 3)];
  return { legionId: legion.marker, newMarker: marker, toNewLegion };
}

// --- Movement teleports ----------------------------------------------------

function teleportOptions(state: StoreState, v: GameStateView): ActionButton[] {
  const marker = state.selection.selected;
  if (!marker) return [];
  const legion = v.legions[marker];
  if (!legion || legion.ownerId !== state.viewerSlot || legion.moved) return [];
  const creatures = legion.creatures ?? [];
  const out: ActionButton[] = [];

  if (isTower(legion.land) && creatures.some((c) => LORDS.has(c as never))) {
    const occupied = new Set(Object.values(v.legions).filter((l) => isTower(l.land)).map((l) => l.land));
    for (const t of towerTeleportTargets(legion.land, occupied)) {
      out.push({ label: `Tower-teleport to ${t}`, type: "TowerTeleport", payload: { legionId: marker, destination: t } });
    }
  }
  const score = v.players[state.viewerSlot!]?.score ?? 0;
  if (v.turn.movementRoll === 6 && score >= 400 && creatures.includes("Titan")) {
    const enemyLands = new Set(Object.values(v.legions).filter((l) => l.ownerId !== state.viewerSlot).map((l) => l.land));
    for (const t of titanTeleportTargets(enemyLands)) {
      out.push({ label: `Titan-teleport to ${t}`, type: "TitanTeleport", payload: { legionId: marker, destination: t } });
    }
  }
  return out;
}

// --- Mustering -------------------------------------------------------------

function musterOptions(state: StoreState, v: GameStateView): ActionButton[] {
  const marker = state.selection.selected;
  if (!marker) return [];
  const legion = v.legions[marker];
  if (!legion || legion.ownerId !== state.viewerSlot) return [];
  if (!legion.moved || legion.recruitedThisTurn || legion.height >= 7) return [];
  const creatures = legion.creatures ?? [];
  const land = getLand(legion.land);
  if (!land) return [];
  const opts = eligibleRecruits(land.terrain, creatures as never, v.caretaker, {
    containsOwnTitan: creatures.includes("Titan"),
  });
  return opts.map((o) => ({ label: `Muster ${o.creature}`, type: "Muster", payload: { legionId: marker, creature: o.creature } }));
}

// --- Masterboard click: select a legion, then move it ----------------------

export function planMasterboardClick(
  view: GameStateView,
  viewer: string | null,
  selected: string | null,
  landId: number,
): ClickPlan {
  if (viewer === null) return {};
  const here = Object.values(view.legions).filter((l) => l.land === landId);
  const mineHere = here.find((l) => l.ownerId === viewer);

  if (view.fsm.path.endsWith("Movement") && view.turn.movementRoll != null) {
    const sel = selected ? view.legions[selected] : undefined;
    if (sel && sel.ownerId === viewer && !sel.moved) {
      const dests = destinationsForRoll(sel.land, view.turn.movementRoll);
      if (dests.some((d) => d.destination === landId)) {
        return { command: { type: "MoveLegion", playerId: viewer, payload: { legionId: sel.marker, destination: landId } } };
      }
    }
  }
  if (mineHere) return { select: mineHere.marker };
  return {};
}

function battleActions(state: StoreState, v: GameStateView): ActionButton[] {
  const b = v.battle!;
  const side = actorSide(v);
  if (!side || actingPlayer(v) !== state.viewerSlot) return [];
  const path = v.fsm.path;

  if (path.endsWith("Deployment")) {
    return [{
      label: "Deploy legion", type: "DeployLegion",
      payload: { placements: autoDeployPlacements(v, side) }, primary: true,
    }];
  }

  if (path.endsWith("Round.Maneuver")) {
    const out: ActionButton[] = [];
    if (b.round === 4 && b.activeSide === "defender" && !b.reinforcementUsed && side === "defender") {
      for (const r of reinforcementOptions(v)) {
        out.push({ label: `Muster ${r}`, type: "ReinforceBattle", payload: { creature: r } });
      }
    }
    out.push({ label: "End maneuvers", type: "EndManeuvers", primary: true });
    return out;
  }

  if (path.endsWith("Round.Strike") || path.endsWith("Round.Strikeback")) {
    if (b.summonPending && state.viewerSlot === b.attackerPlayerId) {
      const sources = summonSources(v);
      const out: ActionButton[] = sources.map((m) => ({
        label: `Summon Angel from ${m}`, type: "SummonAngel", payload: { fromLegion: m, creature: "Angel" }, primary: true,
      }));
      out.push({ label: "Decline summon", type: "DeclineSummon" });
      return out;
    }
    return [{ label: "End strikes", type: "EndStrikes", primary: true }];
  }
  return [];
}

function pendingEngagementLands(v: GameStateView): number[] {
  const owners = new Map<number, Set<string>>();
  for (const l of Object.values(v.legions)) {
    const set = owners.get(l.land) ?? new Set<string>();
    set.add(l.ownerId);
    owners.set(l.land, set);
  }
  return [...owners.entries()].filter(([, s]) => s.size >= 2).map(([land]) => land).sort((a, b) => a - b);
}

function summonSources(v: GameStateView): string[] {
  const b = v.battle!;
  return Object.values(v.legions)
    .filter((l) =>
      l.ownerId === b.attackerPlayerId && l.marker !== b.attackerLegion &&
      (l.creatures ?? []).some((c) => c === "Angel" || c === "Archangel"))
    .map((l) => l.marker);
}

function reinforcementOptions(v: GameStateView): string[] {
  const b = v.battle!;
  const onBoard = b.combatants
    .filter((c) => c.side === "defender" && !c.slain)
    .map((c) => c.creature);
  const opts = eligibleRecruits(b.terrain as MasterTerrain, onBoard, v.caretaker, {
    containsOwnTitan: onBoard.includes("Titan"),
  });
  return opts.map((o) => o.creature);
}

// ---------------------------------------------------------------------------
// Board-click planning (select / move / strike)
// ---------------------------------------------------------------------------

export interface ClickPlan {
  readonly select?: string | null;
  readonly command?: CommandDTO;
}

/** Translate a battle board hex click into the next intent. Pure. */
export function planBattleClick(
  view: GameStateView,
  viewerSlot: string | null,
  selectedId: string | null,
  clicked: CubeCoord,
): ClickPlan {
  const b = view.battle;
  if (!b || viewerSlot === null) return {};
  const side = actorSide(view);
  if (!side || actingPlayer(view) !== viewerSlot) return {};

  const path = view.fsm.path;
  const clickedKey = cubeKey(clicked);
  const at = b.combatants.find((c) => !c.slain && c.hex && cubeKey(c.hex) === clickedKey);

  // Click one of your own active-side characters → select it.
  if (at && at.side === side) return { select: at.id };

  const sel = selectedId
    ? b.combatants.find((c) => c.id === selectedId && c.side === side && !c.slain)
    : undefined;
  if (!sel || !sel.hex) return {};

  if (path.endsWith("Round.Maneuver")) {
    if (at) return {}; // occupied
    const map = BATTLE_MAPS[b.terrain]!;
    const grid = indexMap(map);
    const occ = new Set(b.combatants.filter((c) => !c.slain && c.hex && c.id !== sel.id).map((c) => cubeKey(c.hex!)));
    const rules = movementRulesFor(sel.creature, grid, {
      isOccupied: (q) => occ.has(cubeKey(q)),
      maxSteps: CREATURE_STATS[sel.creature].skill,
    });
    const { destinations } = reachable(sel.hex, rules);
    if (destinations.has(clickedKey)) {
      return { command: { type: "MoveCombatant", playerId: viewerSlot, payload: { combatantId: sel.id, hex: labelAt(b.terrain, clickedKey) } } };
    }
    return {};
  }

  if (path.endsWith("Round.Strike") || path.endsWith("Round.Strikeback")) {
    if (at && at.side !== side && cubeDistance(sel.hex, at.hex!) === 1) {
      return { command: { type: "Strike", playerId: viewerSlot, payload: { strikerId: sel.id, targetId: at.id } } };
    }
    return {};
  }
  return {};
}

function labelAt(terrain: string, key: string): string {
  const map = BATTLE_MAPS[terrain]!;
  const h = map.hexes.find((x) => cubeKey(x.cube) === key);
  return h ? h.label : "";
}

/** Whether the command bar should be disabled (strict-wait + not the actor). */
export function battleInputsLocked(state: StoreState): boolean {
  if (state.command.kind === "submitting") return true;
  const v = state.snapshot;
  if (v?.battle) return !viewerActsInBattle(state);
  return inputsLocked(state);
}
