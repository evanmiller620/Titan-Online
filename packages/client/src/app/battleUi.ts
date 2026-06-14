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

  if (path.includes("Battle.")) return battleActions(state, v);

  // Turn-level phases are driven by the masterboard-active player.
  if (!isMyTurn(state)) return [];

  if (path.endsWith("Commencement")) {
    return [{ label: "End splits", type: "EndSplits", primary: true }];
  }
  if (path.endsWith("Movement")) {
    const rolled = v.turn.movementRoll != null;
    if (!rolled) return [{ label: "Roll movement", type: "RollMovement", primary: true }];
    const out: ActionButton[] = [{ label: "End movement", type: "EndMovement", primary: true }];
    if (v.turn.number === 1 && !v.turn.mulliganUsed) out.push({ label: "Take mulligan", type: "TakeMulligan" });
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
    return [{ label: "End turn", type: "EndTurn", primary: true }];
  }
  return [];
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
