/**
 * Guidance (Titan client, ui) — the "what do I do now?" engine.
 *
 * A PURE mapping from game state to a single, clear instruction for the player
 * in focus. Titan has many phases; surfacing one plain-language prompt at every
 * step is the difference between "I'm lost" and effortless play. Kept pure and
 * frontend-agnostic so it is unit-tested and the view just paints the result.
 */

import type { GameStateView, Selection } from "@titan/engine";

export type GuidanceTone = "act" | "wait" | "info";

export interface Guidance {
  /** Headline instruction — what to do, in a few words. */
  readonly title: string;
  /** Optional secondary line with the how. */
  readonly detail?: string;
  /** act = your move; wait = someone else; info = neutral / game over. */
  readonly tone: GuidanceTone;
}

function colorOf(view: GameStateView, pid: string | undefined): string {
  if (!pid) return "—";
  return (view.players[pid] as { color?: string } | undefined)?.color ?? pid;
}

/** A short label for the current phase (used as wait-state detail). */
export function phaseLabel(view: GameStateView): string {
  const p = view.fsm.path;
  if (p === "GameOver") return "Game over";
  if (p.startsWith("Setup")) return "Setup";
  if (view.battle) {
    if (p.endsWith("Maneuver")) return "Battle · maneuver";
    if (p.endsWith("Strike")) return "Battle · strike";
    if (p.endsWith("Strikeback")) return "Battle · strikeback";
    if (p.endsWith("Deployment")) return "Battle · deploy";
    return "In battle";
  }
  if (p.endsWith("Commencement")) return "Split";
  if (p.endsWith("Movement")) return "Move";
  if (p.includes("Engagement")) return "Engagement";
  if (p.endsWith("Mustering")) return "Muster";
  return "Your turn";
}

/**
 * The instruction for `seat` given the live view. `actsNow` is the engine's
 * seatActsNow(view, seat) — whether it is this seat's move at all.
 */
export function currentGuidance(
  view: GameStateView | null,
  seat: string,
  selection: Selection,
  actsNow: boolean,
): Guidance {
  if (!view) return { title: "Loading…", tone: "info" };
  const p = view.fsm.path;

  if (p === "GameOver") {
    const alive = view.playerOrder.filter((pid) => !(view.players[pid] as { eliminated?: boolean } | undefined)?.eliminated);
    return { title: alive.length === 1 ? `${colorOf(view, alive[0])} wins the realm` : "Game over", tone: "info" };
  }

  if (!actsNow) {
    return { title: `Waiting for ${colorOf(view, view.playerOrder[view.turn.activeIndex])}…`, detail: phaseLabel(view), tone: "wait" };
  }

  // --- In a battle ---------------------------------------------------------
  const b = view.battle;
  if (b) {
    if (b.summonPending) return { title: "First blood!", detail: "Summon an Angel into the fight, or decline.", tone: "act" };
    if (p.endsWith("Deployment")) return { title: "Deploy your legion", detail: "Pick a unit, then tap a glowing hex.", tone: "act" };
    if (p.endsWith("Round.Maneuver")) return { title: "Maneuver your creatures", detail: "Move each up to its skill, then End maneuvers.", tone: "act" };
    if (p.endsWith("Round.Strike")) return { title: "Strike!", detail: "Tap a creature, then an enemy — adjacent for melee, distant to rangestrike. Engaged creatures must strike.", tone: "act" };
    if (p.endsWith("Round.Strikeback")) return { title: "Strike back", detail: "Your survivors hit back, then End.", tone: "act" };
    return { title: phaseLabel(view), tone: "act" };
  }

  // --- Setup ---------------------------------------------------------------
  if (p.endsWith("RollingForOrder")) return { title: "Roll for turn order", tone: "act" };
  if (p.endsWith("TowerSelection")) return { title: "Choose your starting Tower", detail: "Tap a Tower on the board.", tone: "act" };
  if (p.endsWith("ColorSelection")) return { title: "Choose your colour", tone: "act" };

  // --- The four turn phases ------------------------------------------------
  if (p.endsWith("Commencement")) {
    return selection.legion
      ? { title: "Split this legion", detail: "Tap the units for the new legion, then Split.", tone: "act" }
      : { title: "Split a legion", detail: "Tap a legion to divide it, or End splits.", tone: "act" };
  }
  if (p.endsWith("Movement")) {
    if (view.turn.movementRoll == null) return { title: "Roll the movement die", detail: "Press Roll to see how far you move.", tone: "act" };
    const roll = view.turn.movementRoll;
    return selection.legion
      ? { title: `Move — rolled ${roll}`, detail: "Tap a glowing land to move there. A red-ringed land holds an enemy — landing there ends the move and starts a battle.", tone: "act" }
      : { title: `Move your legions — rolled ${roll}`, detail: "Tap a legion, then a glowing land. At least one must move.", tone: "act" };
  }
  if (p.endsWith("Engagement.Choosing")) {
    return { title: "Enemies share a land!", detail: "Tap a contested land on the board to open that clash.", tone: "act" };
  }
  if (p.includes("Engagement")) {
    return { title: "Resolve the clash", detail: "Fight the battle, or settle by agreement.", tone: "act" };
  }
  if (p.endsWith("Mustering")) {
    return selection.legion
      ? { title: "Recruit a creature", detail: "Choose a creature to muster, or End turn." , tone: "act" }
      : { title: "Recruit, or end your turn", detail: "Tap a legion that moved to recruit.", tone: "act" };
  }

  return { title: phaseLabel(view), tone: "act" };
}
