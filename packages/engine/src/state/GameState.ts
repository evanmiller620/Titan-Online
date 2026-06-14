/**
 * Canonical game state (Titan engine, module: state).
 *
 * GameState is PLAIN JSON, end to end: it is persisted as the authoritative
 * row in PostgreSQL, diffed for Realtime, and replayed from the command log.
 * No classes, no Maps, no functions — Records and arrays only.
 *
 * GameState is the UNREDACTED truth, including hidden legion contents. It
 * lives on the server. Clients receive per-player views (state/views.ts,
 * later module) with opponents' `creatures` arrays stripped — the same
 * boundary the legion_contents RLS policies enforce at the table level.
 */

import type { FsmState } from "../core/fsm/StateMachine.ts";
import type { CubeCoord } from "../hex/cube.ts";
import { GAME_MACHINE } from "../core/fsm/GameFSM.ts";
import type { LandId, LegionId, PlayerId } from "../core/events/DomainEvent.ts";
import {
  CARETAKER_LIMITS,
  type CreatureName,
} from "../creatures/names.ts";

/** The six classic Titan legion colors. */
export const PLAYER_COLORS = [
  "Black",
  "Brown",
  "Blue",
  "Gold",
  "Green",
  "Red",
] as const;
export type PlayerColor = (typeof PLAYER_COLORS)[number];

export const MARKERS_PER_PLAYER = 12;

export interface PlayerState {
  readonly id: PlayerId;
  readonly name: string;
  /** null until chosen during Setup.ColorSelection. */
  readonly color: PlayerColor | null;
  /** null until chosen during Setup.TowerSelection. */
  readonly tower: LandId | null;
  readonly score: number;
  readonly eliminated: boolean;
  /** Unused legion markers (e.g. "Black-07"). Spent by splits, inherited on
   *  Titan kills, permanently lost on mutual destruction. */
  readonly markersAvailable: readonly string[];
}

export interface LegionState {
  /** Marker id doubles as legion id — the marker IS the public identity. */
  readonly marker: LegionId;
  readonly ownerId: PlayerId;
  readonly land: LandId;
  /** HIDDEN information. Order is not meaningful (a multiset). */
  readonly creatures: readonly CreatureName[];
  /** Moved this turn (eligibility for mustering; reset at turn end). */
  readonly moved: boolean;
  /** Was created by / produced a split this turn (one split per legion per
   *  turn; reset at turn end). */
  readonly splitThisTurn: boolean;
  /** Mustered a recruit this turn (one recruit per legion per turn; reset at
   *  turn end). Also true for legions that began the turn 7 high — they may
   *  not recruit at all. */
  readonly recruitedThisTurn: boolean;
  /** Set true once an engagement forces this legion's contents into the open.
   *  Mirrors legions.revealed in the DB and drives view redaction. */
  readonly revealed: boolean;
}

/** Setup-phase bookkeeping; null once the game proper begins. */
export interface SetupState {
  /** Final roll-off order (index 0 = highest roll). Empty until rolled. */
  readonly order: readonly PlayerId[];
  /** Next picker index into `order` for towers (descending order). */
  readonly towerPickIndex: number;
  /** Next picker index into `order` for colors (ascending: last roller first). */
  readonly colorPickIndex: number;
}

export interface TurnState {
  /** Game-turn number, starting at 1; increments when play wraps to index 0. */
  readonly number: number;
  /** Index into playerOrder of the active player. */
  readonly activeIndex: number;
  /** This turn's movement die, once rolled. */
  readonly movementRoll: number | null;
  /** The turn-1 mulligan, once spent. */
  readonly mulliganUsed: boolean;
  /** The contested Land currently being negotiated, or null when none.
   *  Set by SelectEngagement, cleared on resolution. */
  readonly engagementLand?: LandId | null;
}

/** A single creature counter on the Battleland during a Battle. */
export type BattleSide = "attacker" | "defender";

export interface Combatant {
  /** Stable id within this battle, e.g. "atk-3". */
  readonly id: string;
  readonly side: BattleSide;
  readonly creature: CreatureName;
  /** Battleland position; null before deployment / after removal. */
  readonly hex: CubeCoord | null;
  readonly damage: number;
  readonly movedThisPhase: boolean;
  readonly struckThisPhase: boolean;
  readonly slain: boolean;
}

/** Live tactical state of an in-progress Battle (combat module populates it). */
export interface BattleContext {
  readonly land: LandId;
  readonly terrain: string;
  readonly attackerLegion: LegionId;
  readonly defenderLegion: LegionId;
  readonly attackerPlayerId: PlayerId;
  readonly defenderPlayerId: PlayerId;
  readonly attackerSide: string;
  readonly round: number;
  readonly activeSide: BattleSide;
  readonly summonUsed: boolean;
  readonly firstKillHappened: boolean;
  readonly reinforcementUsed: boolean;
  readonly combatants: readonly Combatant[];
}

export interface GameState {
  readonly gameId: string;
  readonly fsm: FsmState;
  readonly playerOrder: readonly PlayerId[];
  readonly players: Readonly<Record<PlayerId, PlayerState>>;
  readonly setup: SetupState | null;
  readonly turn: TurnState;
  readonly legions: Readonly<Record<LegionId, LegionState>>;
  readonly caretaker: Readonly<Record<CreatureName, number>>;
  readonly battle: BattleContext | null;
}

export interface CreateGameOptions {
  readonly gameId: string;
  /** 2–6 players, in lobby (seat) order. */
  readonly players: ReadonlyArray<{ readonly id: PlayerId; readonly name: string }>;
}

export class GameCreationError extends Error {
  constructor(problem: string) {
    super(`Cannot create game: ${problem}`);
    this.name = "GameCreationError";
  }
}

/** Build a fresh game in Setup.RollingForOrder with a full caretaker pool. */
export function createGame(opts: CreateGameOptions): GameState {
  const n = opts.players.length;
  if (n < 2 || n > 6) {
    throw new GameCreationError(`player count must be 2–6, got ${n}`);
  }
  const ids = new Set(opts.players.map((p) => p.id));
  if (ids.size !== n) {
    throw new GameCreationError("player ids must be unique");
  }

  const players: Record<PlayerId, PlayerState> = {};
  for (const p of opts.players) {
    players[p.id] = {
      id: p.id,
      name: p.name,
      color: null,
      tower: null,
      score: 0,
      eliminated: false,
      markersAvailable: [],
    };
  }

  // Full pool; Titans are exactly one per actual player.
  const caretaker: Record<CreatureName, number> = {
    ...CARETAKER_LIMITS,
    Titan: n,
  };

  return {
    gameId: opts.gameId,
    fsm: GAME_MACHINE.initialState,
    playerOrder: [], // set when the order roll resolves
    players,
    setup: { order: [], towerPickIndex: 0, colorPickIndex: 0 },
    turn: { number: 0, activeIndex: 0, movementRoll: null, mulliganUsed: false, engagementLand: null },
    legions: {},
    caretaker,
    battle: null,
  };
}

/** Marker ids for a color: "Black-01" … "Black-12". */
export function markerIdsFor(color: PlayerColor): string[] {
  const out: string[] = [];
  for (let i = 1; i <= MARKERS_PER_PLAYER; i++) {
    out.push(`${color}-${String(i).padStart(2, "0")}`);
  }
  return out;
}
