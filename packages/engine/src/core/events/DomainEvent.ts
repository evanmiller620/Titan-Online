/**
 * Domain events (Titan engine, module: core/events).
 *
 * Commands return { state, events }. Events are the engine's outbound
 * narration: the UI animates from them, the server persists them in the
 * append-only command log, and Realtime fans them out.
 *
 * AUDIENCE is the key design decision. Titan is a hidden-information game:
 * legion contents are secret until revealed. Every event therefore declares
 * who may see it. This mirrors — in the engine, ahead of time — exactly the
 * boundary the Postgres RLS policies enforce in the database:
 *
 *   public          → broadcast to every player and spectators
 *   player-scoped   → delivered only to that player (e.g. the creature-level
 *                     detail of a split; opponents see only the new stack
 *                     heights)
 *
 * The same redaction logic will back state/views.ts (per-player snapshots),
 * so client and server cannot disagree about what is secret.
 *
 * Events added by later modules (movement, reveal, combat) extend the union;
 * the envelope and audience contract defined here are stable.
 */

import type { CreatureName } from "../../creatures/names.ts";

export type PlayerId = string;
/** A legion is identified by its marker id (e.g. "Black-03") — as in the
 *  physical game, the marker IS the legion's public identity. */
export type LegionId = string;
/** Masterboard land number (e.g. 100 = a Tower; full data in module 4). */
export type LandId = number;

export type Audience =
  | { readonly kind: "public" }
  | { readonly kind: "player"; readonly playerId: PlayerId };

export const PUBLIC: Audience = Object.freeze({ kind: "public" });
export const onlyPlayer = (playerId: PlayerId): Audience =>
  Object.freeze({ kind: "player", playerId });

interface EventBase {
  readonly audience: Audience;
}

/** Emitted on every FSM transition a command drives. */
export interface PhaseChanged extends EventBase {
  readonly type: "PhaseChanged";
  readonly fsmEvent: string;
  readonly from: string;
  readonly to: string;
}

export interface TurnOrderRolled extends EventBase {
  readonly type: "TurnOrderRolled";
  /** Every roll-off round, in order; ties trigger further rounds among the tied. */
  readonly rounds: ReadonlyArray<Readonly<Record<PlayerId, number>>>;
  /** Final order: index 0 picks a tower first and takes the first turn. */
  readonly order: readonly PlayerId[];
}

export interface TowerSelected extends EventBase {
  readonly type: "TowerSelected";
  readonly playerId: PlayerId;
  readonly land: LandId;
}

export interface ColorSelected extends EventBase {
  readonly type: "ColorSelected";
  readonly playerId: PlayerId;
  readonly color: string;
}

/** The fixed 8-stack is public knowledge, so contents are in the open. */
export interface InitialLegionMustered extends EventBase {
  readonly type: "InitialLegionMustered";
  readonly playerId: PlayerId;
  readonly legionId: LegionId;
  readonly land: LandId;
  readonly creatures: readonly CreatureName[];
}

/** Public face of a split: markers and heights only. Contents stay hidden. */
export interface LegionSplit extends EventBase {
  readonly type: "LegionSplit";
  readonly playerId: PlayerId;
  readonly parentLegionId: LegionId;
  readonly childLegionId: LegionId;
  readonly land: LandId;
  readonly parentHeight: number;
  readonly childHeight: number;
}

/** Owner-scoped detail of the same split: which creatures went where. */
export interface LegionSplitDetail extends EventBase {
  readonly type: "LegionSplitDetail";
  readonly playerId: PlayerId;
  readonly parentLegionId: LegionId;
  readonly childLegionId: LegionId;
  readonly parentCreatures: readonly CreatureName[];
  readonly childCreatures: readonly CreatureName[];
}

export interface MovementRolled extends EventBase {
  readonly type: "MovementRolled";
  readonly playerId: PlayerId;
  readonly roll: number;
  readonly mulligan: boolean;
}

export interface TurnEnded extends EventBase {
  readonly type: "TurnEnded";
  readonly endedByPlayerId: PlayerId;
  readonly nextPlayerId: PlayerId;
  readonly turnNumber: number;
}

export type DomainEvent =
  | PhaseChanged
  | TurnOrderRolled
  | TowerSelected
  | ColorSelected
  | InitialLegionMustered
  | LegionSplit
  | LegionSplitDetail
  | MovementRolled
  | TurnEnded;

/** Filter an event stream down to what one player may legally see. */
export function visibleTo(
  events: readonly DomainEvent[],
  playerId: PlayerId,
): DomainEvent[] {
  return events.filter(
    (e) => e.audience.kind === "public" || e.audience.playerId === playerId,
  );
}
