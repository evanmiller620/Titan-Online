/**
 * State redaction / per-player views (Titan engine, module: state).
 *
 * The authoritative GameState is the UNREDACTED truth and lives only on the
 * server. Before any state leaves the server it is passed through here, which
 * strips information the recipient is not entitled to — the exact same
 * boundary the legion_contents RLS policy enforces in PostgreSQL. Having the
 * rule in one pure, tested function (and re-applying it in SQL) means the two
 * layers cannot drift: the database is the hard enforcement, this is the
 * shape contract the client renders against.
 *
 * What is hidden: the `creatures` array of any legion the viewer does not own
 * and that has not been revealed. The PUBLIC face — marker, owner, land, and
 * HEIGHT (creature count) — is always kept, because heights and positions are
 * public information in Titan.
 *
 * Battle combatants: once a battle begins the engaged legions are revealed to
 * both participants (combat is conducted in the open per the rules), so battle
 * combatant identities are visible to the two players in that battle and, for
 * spectators, redacted to creature-less placeholders. v1 keeps battle
 * combatants visible to both engaged players and to spectators (battles are
 * public once joined); flip `hideSpectatorBattle` to tighten later.
 */

import type { GameState, LegionState } from "./GameState.ts";
import type { PlayerId } from "../core/events/DomainEvent.ts";

/** A legion as seen by a viewer: contents present only if entitled. */
export interface LegionView {
  readonly marker: string;
  readonly ownerId: PlayerId;
  readonly land: number;
  readonly height: number;
  readonly moved: boolean;
  readonly splitThisTurn: boolean;
  readonly recruitedThisTurn: boolean;
  readonly revealed: boolean;
  /** Present only when the viewer owns the legion or it is revealed. */
  readonly creatures?: readonly string[];
}

export interface GameStateView {
  readonly gameId: string;
  readonly fsm: GameState["fsm"];
  readonly playerOrder: GameState["playerOrder"];
  readonly players: GameState["players"];
  readonly setup: GameState["setup"];
  readonly turn: GameState["turn"];
  readonly caretaker: GameState["caretaker"];
  readonly legions: Readonly<Record<string, LegionView>>;
  readonly battle: GameState["battle"];
  /** Which legion markers are revealed (engagement forced a reveal). */
  readonly revealedMarkers: readonly string[];
}

/**
 * Legions revealed to everyone. A legion is revealed once it is (or has been)
 * engaged in a battle. We track this via a per-legion flag the combat layer
 * sets; here we also treat the two CURRENTLY-battling legions as revealed.
 */
function revealedSet(state: GameState): Set<string> {
  const revealed = new Set<string>();
  for (const [marker, legion] of Object.entries(state.legions)) {
    if (legion.revealed) revealed.add(marker);
  }
  if (state.battle) {
    revealed.add(state.battle.attackerLegion);
    revealed.add(state.battle.defenderLegion);
  }
  return revealed;
}

function viewLegion(
  legion: LegionState,
  viewerId: PlayerId | null,
  revealed: Set<string>,
): LegionView {
  const isOwner = viewerId !== null && legion.ownerId === viewerId;
  const isRevealed = revealed.has(legion.marker);
  const base: LegionView = {
    marker: legion.marker,
    ownerId: legion.ownerId,
    land: legion.land,
    height: legion.creatures.length,
    moved: legion.moved,
    splitThisTurn: legion.splitThisTurn,
    recruitedThisTurn: legion.recruitedThisTurn,
    revealed: isRevealed,
  };
  if (isOwner || isRevealed) {
    return { ...base, creatures: [...legion.creatures] };
  }
  return base; // contents withheld — exactly what RLS returns to a non-owner
}

/**
 * Redact `state` for `viewerId` (a player slot), or for the public/spectator
 * view when viewerId is null. Pure; never mutates the input.
 */
export function viewFor(state: GameState, viewerId: PlayerId | null): GameStateView {
  const revealed = revealedSet(state);
  const legions: Record<string, LegionView> = {};
  for (const [marker, legion] of Object.entries(state.legions)) {
    legions[marker] = viewLegion(legion, viewerId, revealed);
  }
  return {
    gameId: state.gameId,
    fsm: state.fsm,
    playerOrder: state.playerOrder,
    players: state.players,
    setup: state.setup,
    turn: state.turn,
    caretaker: state.caretaker,
    legions,
    battle: state.battle,
    revealedMarkers: [...revealed],
  };
}

/** The public state stored in games.public_state (no viewer => nothing owned). */
export function publicState(state: GameState): GameStateView {
  return viewFor(state, null);
}

/** Convenience: does a view include a legion's contents? (for tests/UI). */
export function contentsVisible(view: GameStateView, marker: string): boolean {
  return view.legions[marker]?.creatures !== undefined;
}
