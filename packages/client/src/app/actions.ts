/**
 * Action builder (Titan client, app).
 *
 * The brain behind the playable command bar. Given the authoritative redacted
 * view and the viewer's slot, it returns the list of LEGAL actions for the
 * current phase — each a button label plus a ready-to-submit CommandDTO. The
 * multiplayer view renders these; selecting a legion or destination on the
 * board fills in the spatial payloads.
 *
 * This is deliberately the client's READING of legality for UX (which buttons
 * to show); the server's engine re-validates every command authoritatively, so
 * a stale or optimistic button can never produce an illegal state — it just
 * gets rejected. Pure function of (view, slot, selection); unit-tested.
 */

import {
  destinationsForRoll,
  getLand,
  pendingEngagements,
  PLAYER_COLORS,
  type CommandDTO,
  type GameStateView,
} from "@titan/engine";

export interface Action {
  readonly label: string;
  readonly dto: CommandDTO;
  /** Primary actions are visually emphasised (the expected next step). */
  readonly primary?: boolean | undefined;
  /** A hint shown beneath the bar (e.g. "select a legion first"). */
  readonly hint?: string | undefined;
}

export interface Selection {
  /** Selected own-legion marker, if any. */
  readonly legion: string | null;
  /** Selected land id (move destination / engagement / tower), if any. */
  readonly land: number | null;
}

const TOWERS = [100, 200, 300, 400, 500, 600] as const;

/** Is it this viewer's turn to act in the CURRENT phase? */
export function isViewersMove(view: GameStateView, slot: string | null): boolean {
  if (slot === null) return false;
  const path = view.fsm.path;

  // Setup picks have their own pickers (not the turn's active player).
  if (path === "Setup.RollingForOrder") return true; // anyone may roll once
  if (path === "Setup.TowerSelection") {
    return view.setup?.order[view.setup.towerPickIndex] === slot;
  }
  if (path === "Setup.ColorSelection") {
    return view.setup?.order[view.setup.colorPickIndex] === slot;
  }
  // All Turn.* phases are driven by the active player.
  const active = view.playerOrder[view.turn.activeIndex];
  return active === slot;
}

/**
 * The legal actions for the viewer right now. `selection` supplies the spatial
 * choices (which legion, which land) the board click handlers set.
 */
export function actionsFor(
  view: GameStateView,
  slot: string,
  selection: Selection,
): Action[] {
  const path = view.fsm.path;
  const issue = (type: string, payload: Record<string, unknown> = {}): CommandDTO => ({
    type,
    playerId: slot,
    payload,
  });

  // ---- Setup ----
  if (path === "Setup.RollingForOrder") {
    return [{ label: "Roll for turn order", dto: issue("RollTurnOrder"), primary: true }];
  }
  if (path === "Setup.TowerSelection") {
    const taken = new Set(Object.values(view.players).map((p) => p.tower).filter((t): t is number => t !== null));
    return TOWERS.filter((t) => !taken.has(t)).map((t) => ({
      label: `Take tower ${t}`,
      dto: issue("SelectTower", { tower: t }),
      primary: selection.land === t,
    }));
  }
  if (path === "Setup.ColorSelection") {
    const taken = new Set(
      Object.values(view.players)
        .map((p) => p.color)
        .filter((c): c is NonNullable<typeof c> => c !== null),
    );
    return PLAYER_COLORS.filter((c) => !taken.has(c)).map((c) => ({
      label: `Take ${c}`,
      dto: issue("SelectColor", { color: c }),
    }));
  }

  // ---- Commencement (splits) ----
  if (path === "Turn.Commencement") {
    const actions: Action[] = [];
    const mine = ownLegions(view, slot);
    const turn1 = view.turn.number === 1;
    // The turn-1 mandatory 8→4/4 split is offered as a one-click helper.
    if (turn1) {
      const eight = mine.find((l) => l.height === 8 && l.creatures);
      if (eight) {
        const split = initialSplit(eight.creatures!);
        if (split) {
          actions.push({
            label: "Split starting legion (4 / 4)",
            dto: issue("SplitLegion", {
              legionId: eight.marker,
              newMarker: nextMarker(view, slot),
              toNewLegion: split,
            }),
            primary: true,
          });
        }
      }
    }
    const stillEight = mine.some((l) => l.height > 7);
    actions.push({
      label: "End splits",
      dto: issue("EndSplits"),
      primary: !stillEight,
      hint: stillEight ? "your starting legion must be split 4/4 first" : undefined,
    });
    return actions;
  }

  // ---- Movement ----
  if (path === "Turn.Movement") {
    const rolled = view.turn.movementRoll != null;
    if (!rolled) {
      return [{ label: "Roll movement die", dto: issue("RollMovement"), primary: true }];
    }
    const actions: Action[] = [];
    const roll = view.turn.movementRoll!;
    const mine = ownLegions(view, slot);
    const unmoved = mine.filter((l) => !l.moved);

    if (selection.legion && selection.land !== null) {
      // A legion and a destination are chosen — offer the concrete move.
      const leg = mine.find((l) => l.marker === selection.legion);
      if (leg) {
        const dests = destinationsForRoll(leg.land, roll).map((d) => d.destination);
        if (dests.includes(selection.land)) {
          actions.push({
            label: `Move ${selection.legion} → land ${selection.land}`,
            dto: issue("MoveLegion", { legionId: selection.legion, destination: selection.land }),
            primary: true,
          });
        }
      }
    }
    actions.push({
      label: "End movement",
      dto: issue("EndMovement"),
      primary: unmoved.length === 0,
      hint: unmoved.length > 0 ? `${unmoved.length} legion(s) still able to move` : undefined,
    });
    if (view.turn.number === 1 && !view.turn.mulliganUsed) {
      actions.push({ label: "Take mulligan", dto: issue("TakeMulligan") });
    }
    return actions;
  }

  // ---- Engagement ----
  if (path === "Turn.Engagement.Choosing") {
    const pending = pendingEngagements(view as never); // selector reads .legions
    return pending.map((land) => ({
      label: `Resolve engagement at land ${land}`,
      dto: issue("SelectEngagement", { land }),
      primary: selection.land === land,
    }));
  }
  if (path === "Turn.Engagement.Negotiation") {
    const land = view.turn.engagementLand ?? null;
    return [
      { label: "Defender flees (you take the ground)", dto: issue("ResolveEngagement", { outcome: "flee" }), primary: true },
      { label: "Defender concedes", dto: issue("ResolveEngagement", { outcome: "concede" }) },
      ...(land !== null ? [] : []),
    ];
  }

  // ---- Mustering ----
  if (path === "Turn.Mustering") {
    // Recruiting needs the recruit options per legion; the minimal bar offers
    // "End turn" and per-legion recruit is surfaced when a legion is selected.
    return [{ label: "End turn", dto: issue("EndTurn"), primary: true }];
  }

  if (path === "GameOver") return [];
  return [];
}

// ---------------------------------------------------------------------------
// helpers (pure)
// ---------------------------------------------------------------------------

function ownLegions(view: GameStateView, slot: string): GameStateView["legions"][string][] {
  return Object.values(view.legions).filter((l) => l.ownerId === slot);
}

/** The legion's available destinations for the current roll (for highlighting). */
export function moveDestinations(view: GameStateView, marker: string): number[] {
  const roll = view.turn.movementRoll;
  if (roll == null) return [];
  const leg = view.legions[marker];
  if (!leg) return [];
  return destinationsForRoll(leg.land, roll).map((d) => d.destination);
}

/** Lands currently contested (for board highlighting in the Engagement phase). */
export function engagementLands(view: GameStateView): number[] {
  return pendingEngagements(view as never);
}

/** Terrain name for a land id (for panel display). */
export function terrainOf(land: number): string {
  return getLand(land)?.terrain ?? "—";
}

/**
 * Compute a legal initial 4/4 split: Titan + 3 others into the new legion,
 * leaving the Angel + 3 in the parent (one Lord per half). Returns the new
 * legion's creature list, or null if the legion isn't the 8-stack.
 */
function initialSplit(creatures: readonly string[]): string[] | null {
  if (creatures.length !== 8) return null;
  const others = creatures.filter((c) => c !== "Titan" && c !== "Angel");
  if (others.length !== 6) return null;
  return ["Titan", ...others.slice(0, 3)];
}

/** The viewer's next available legion marker (lowest unused). */
function nextMarker(view: GameStateView, slot: string): string {
  const player = view.players[slot] as { markersAvailable?: readonly string[] } | undefined;
  const avail = player?.markersAvailable ?? [];
  return [...avail].sort()[0] ?? `${slot}-X`;
}
