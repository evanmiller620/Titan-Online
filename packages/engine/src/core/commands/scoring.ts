/**
 * Scoring (Titan engine, module: core/commands).
 *
 * The single place a player's score changes. Awarding points also grants any
 * acquirable Lords the new total crosses (§7.5): an Angel at 100, an Archangel
 * at 500. Without this the reinforcement economy stalls — a player would earn
 * points but never receive the Angels they can later summon.
 *
 * Auto-placement (deterministic simplification): the acquired creature is added
 * to one of the player's legions with room — preferring a non-Titan legion so
 * it can be summoned into the Titan's battles — drawn from the caretaker pool.
 * If the pool is empty or no legion has room, the acquisition is forfeited. The
 * classic game lets the player choose the legion and timing; this keeps the
 * deterministic engine self-contained.
 */

import type { Draft } from "./Command.ts";
import type { DomainEvent, PlayerId } from "../events/DomainEvent.ts";
import { PUBLIC } from "../events/DomainEvent.ts";
import { acquirablesCrossed } from "../../creatures/recruitment.ts";
import { MAX_LEGION_HEIGHT, type CreatureName } from "../../creatures/names.ts";

/** Add `points` to a player's score and grant any acquirables crossed. */
export function awardScore(draft: Draft, playerId: PlayerId, points: number, events: DomainEvent[]): void {
  const player = draft.players[playerId];
  if (!player) return;
  const oldScore = player.score;
  const newScore = oldScore + points;
  draft.players[playerId] = { ...player, score: newScore };
  for (const creature of acquirablesCrossed(oldScore, newScore)) {
    placeAcquired(draft, playerId, creature, events);
  }
}

function placeAcquired(draft: Draft, playerId: PlayerId, creature: CreatureName, events: DomainEvent[]): void {
  // Avalon Hill: at a 500-multiple you take an Archangel, but may take an Angel
  // instead if none are left in the pool.
  let toPlace: CreatureName = creature;
  if (toPlace === "Archangel" && (draft.caretaker.Archangel ?? 0) <= 0) toPlace = "Angel";
  if ((draft.caretaker[toPlace] ?? 0) <= 0) return; // pool empty → forfeit
  const creatureToAdd = toPlace;
  const owned = Object.values(draft.legions)
    .filter((l) => l.ownerId === playerId && l.creatures.length < MAX_LEGION_HEIGHT)
    .sort((a, b) => a.marker.localeCompare(b.marker)); // deterministic order
  if (owned.length === 0) return; // nowhere legal to put it → forfeit
  const target = owned.find((l) => !l.creatures.includes("Titan")) ?? owned[0]!;
  draft.legions[target.marker] = { ...target, creatures: [...target.creatures, creatureToAdd] };
  draft.caretaker[creatureToAdd] = (draft.caretaker[creatureToAdd] ?? 0) - 1;
  events.push({ type: "CreatureAcquired", audience: PUBLIC, playerId, creature: creatureToAdd, legionId: target.marker });
}
