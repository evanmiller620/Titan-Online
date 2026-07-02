/**
 * Event log formatting (Titan client, ui) — turns domain events into one
 * concise, scannable line each. Pure string shaping, extracted from the view so
 * it can be reused and tested independently.
 */

import type { DomainEvent } from "@titan/engine";

/** A "MoveLegion" → "move legion" fallback when a command emits no event. */
export function humanizeType(t: string): string {
  return t.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

/** One concise log line per domain event. Returns "" for events that are noise
 *  in the log (phase changes already show in the bar / inspector). */
export function formatEvent(e: DomainEvent): string {
  const a = e as unknown as Record<string, unknown>;
  const pts = (n: unknown) => (Number(n) > 0 ? ` <b>+${n}</b>` : "");
  switch (e.type) {
    case "PhaseChanged": return "";
    case "BattlePhaseAdvanced": return "";
    case "TurnOrderRolled": return `turn order set`;
    case "MovementRolled": return `rolled ${a.roll}${a.mulligan ? " (reroll)" : ""}`;
    case "LegionMoved": return `${a.legionId} → ${a.to}${a.teleport ? " (teleport)" : ""}`;
    case "LegionsRecombined": return `merged into ${a.into} @${a.land}`;
    case "LegionSplit": return `split ${a.parentLegionId} → ${a.childLegionId}`;
    case "CreatureRecruited": return `mustered @${a.land}${(a.revealed as string[])?.length ? ` (showed ${(a.revealed as string[]).join(", ")})` : ""}`;
    case "CreatureAcquired": return `gained ${a.creature}`;
    case "BattleJoined": return `battle @${a.land} · ${a.terrain}`;
    case "StrikeResolved": return `${a.strikerId} → ${a.targetId}: ${a.hits} hit${Number(a.hits) === 1 ? "" : "s"}${a.carriedTo ? ` (carry)` : ""}`;
    case "CombatantSlain": return `${a.creature} slain`;
    case "AngelSummoned": return `summoned ${a.creature}`;
    case "BattleReinforced": return `reinforced ${a.creature}`;
    case "BattleConcluded": return `battle ${a.outcome}${a.winnerId ? ` · ${a.winnerId} wins` : ""}${pts(a.pointsAwarded)}${a.timeLoss ? " (time-loss)" : ""}`;
    case "EngagementResolved": return `${a.outcome} @${a.land}${pts(a.pointsAwarded)}`;
    case "MarkersInherited": return `inherited ${(a.markers as string[]).length} markers`;
    case "PlayerEliminated": return `${a.playerId} eliminated`;
    case "GameEnded": return `game over${a.winnerId ? ` · ${a.winnerId} wins` : ""}`;
    default: return humanizeType(e.type);
  }
}
