/**
 * Command registry (Titan engine, module: core/commands).
 *
 * The single name→constructor map used to revive a CommandDTO into a live
 * command. Both consumers of the wire format go through here:
 *   - the submit-command Edge Function (deserialize → validate → execute)
 *   - command-log replay (rebuild any game state from the append-only log)
 *
 * Structural validation here is minimal (shape of the envelope); SEMANTIC
 * payload validation is each command's validate(), and wire-schema
 * validation (zod) lives in packages/protocol so the engine stays
 * dependency-free.
 */

import type { CommandDTO, GameCommand } from "./Command.ts";
import {
  RollTurnOrderCommand,
  SelectColorCommand,
  SelectTowerCommand,
} from "./setup.ts";
import {
  EndMovementCommand,
  EndSplitsCommand,
  EndTurnCommand,
  RollMovementCommand,
  SplitLegionCommand,
  TakeMulliganCommand,
} from "./turn.ts";

export class UnknownCommandError extends Error {
  constructor(type: string) {
    super(`Unknown command type "${type}"`);
    this.name = "UnknownCommandError";
  }
}

export class MalformedCommandError extends Error {
  constructor(problem: string) {
    super(`Malformed command DTO: ${problem}`);
    this.name = "MalformedCommandError";
  }
}

type Factory = (playerId: string, payload: unknown) => GameCommand;

const REGISTRY = new Map<string, Factory>();

function register(
  type: string,
  ctor: new (playerId: string, payload: never) => GameCommand,
): void {
  if (REGISTRY.has(type)) {
    throw new Error(`Command type "${type}" registered twice`);
  }
  REGISTRY.set(type, (playerId, payload) => {
    return new ctor(playerId, payload as never);
  });
}

register(RollTurnOrderCommand.TYPE, RollTurnOrderCommand);
register(SelectTowerCommand.TYPE, SelectTowerCommand);
register(SelectColorCommand.TYPE, SelectColorCommand);
register(SplitLegionCommand.TYPE, SplitLegionCommand);
register(EndSplitsCommand.TYPE, EndSplitsCommand);
register(RollMovementCommand.TYPE, RollMovementCommand);
register(TakeMulliganCommand.TYPE, TakeMulliganCommand);
register(EndMovementCommand.TYPE, EndMovementCommand);
register(EndTurnCommand.TYPE, EndTurnCommand);

export const COMMAND_TYPES: readonly string[] = [...REGISTRY.keys()];

export function deserializeCommand(dto: unknown): GameCommand {
  if (typeof dto !== "object" || dto === null) {
    throw new MalformedCommandError("not an object");
  }
  const { type, playerId, payload } = dto as Partial<CommandDTO>;
  if (typeof type !== "string") {
    throw new MalformedCommandError("missing string field 'type'");
  }
  if (typeof playerId !== "string" || playerId.length === 0) {
    throw new MalformedCommandError("missing string field 'playerId'");
  }
  const factory = REGISTRY.get(type);
  if (!factory) throw new UnknownCommandError(type);
  return factory(playerId, payload ?? {});
}
