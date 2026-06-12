/**
 * Battle FSM (Titan engine, module: core/fsm).
 *
 * Tactical combat on a Battleland. Defined as a composable SUBTREE — the
 * GameFSM grafts it under Turn.Engagement.Battle — plus a standalone machine
 * for testing battles in isolation and for any future "battle replayer".
 *
 * Shape of a Titan battle (1982 rules + this project's spec document):
 *
 *   DefenderDeployment      defender places entire legion first
 *   AttackerDeployment      attacker enters via the entry side dictated by
 *                           their Masterboard trajectory
 *   Round.*                 up to 7 rounds; each round = two half-turns,
 *                           DEFENDER half first, then attacker. Whose half it
 *                           is and the round number are GameState context,
 *                           not FSM states — the cycle of phases is identical
 *                           for both sides:
 *       Maneuver            active side moves creatures
 *       Strike              active side's engaged creatures strike
 *       Strikeback          the OTHER side's surviving engaged creatures
 *                           strike back, then the half-turn ends
 *       Reinforce           window at the start of the defender's half-turn
 *                           on round 4: muster one reinforcement if a
 *                           prerequisite creature survives (or decline)
 *       SummonAngel         INTERRUPT: per the project spec, the attacker's
 *                           FIRST kill grants an immediate, use-it-or-lose-it
 *                           right to summon an Angel/Archangel from an
 *                           unengaged external legion. The window seizes
 *                           control wherever the kill happened (Strike or
 *                           Strikeback) and resumes exactly there.
 *   Resolution              scoring, time-loss check, marker transfer,
 *                           post-battle Angel summon bookkeeping
 *
 * Guards live in the Command layer, not here. The FSM permits FIRST_KILL
 * whenever in Strike/Strikeback; the command firing it is responsible for
 * "only the attacker's first kill, only once per battle, only if an Angel is
 * available off-board". Same for REINFORCEMENT_OFFERED ("round 4, defender's
 * half, prerequisite present") and BATTLE_CONCLUDED ("a legion was wiped out
 * / time loss after round 7 / mutual destruction").
 */

import {
  RESUME,
  createMachine,
  type Machine,
  type StateNodeDef,
  type TransitionDef,
} from "./StateMachine.ts";

/** Battle event vocabulary. */
export const BattleEvent = {
  DEFENDER_DEPLOYED: "DEFENDER_DEPLOYED",
  ATTACKER_DEPLOYED: "ATTACKER_DEPLOYED",
  MANEUVERS_COMPLETED: "MANEUVERS_COMPLETED",
  STRIKES_COMPLETED: "STRIKES_COMPLETED",
  /** End of a half-turn (after strikebacks); next half begins at Maneuver. */
  HALF_TURN_ENDED: "HALF_TURN_ENDED",
  /** Instead of HALF_TURN_ENDED when the round-4 defender window opens. */
  REINFORCEMENT_OFFERED: "REINFORCEMENT_OFFERED",
  REINFORCEMENT_MUSTERED: "REINFORCEMENT_MUSTERED",
  REINFORCEMENT_DECLINED: "REINFORCEMENT_DECLINED",
  /** Attacker's first kill: interrupt into the summon window. */
  FIRST_KILL: "FIRST_KILL",
  ANGEL_SUMMONED: "ANGEL_SUMMONED",
  SUMMON_DECLINED: "SUMMON_DECLINED",
  /** Legion destroyed, mutual destruction, or time loss at end of round 7. */
  BATTLE_CONCLUDED: "BATTLE_CONCLUDED",
  /** Mid-battle concession by either side. */
  LEGION_CONCEDED: "LEGION_CONCEDED",
} as const;
export type BattleEvent = (typeof BattleEvent)[keyof typeof BattleEvent];

/** The battle subtree, graftable under any parent compound state. */
export const BATTLE_STATES: StateNodeDef = {
  initial: "DefenderDeployment",
  states: {
    DefenderDeployment: {},
    AttackerDeployment: {},
    Round: {
      initial: "Maneuver",
      states: {
        Maneuver: {},
        Strike: {},
        Strikeback: {},
        Reinforce: {},
        SummonAngel: {},
      },
    },
    Resolution: {},
  },
};

/**
 * Battle transitions with every path prefixed so the subtree can be mounted
 * at an arbitrary point in a larger machine. Pass "" for a standalone
 * machine whose root states are the battle states themselves.
 */
export function battleTransitions(prefix: string): TransitionDef[] {
  const p = (s: string) => (prefix === "" ? s : `${prefix}.${s}`);
  const E = BattleEvent;
  return [
    { from: p("DefenderDeployment"), event: E.DEFENDER_DEPLOYED, to: p("AttackerDeployment") },
    { from: p("AttackerDeployment"), event: E.ATTACKER_DEPLOYED, to: p("Round") },

    // The half-turn cycle. Round count / active side are context.
    { from: p("Round.Maneuver"), event: E.MANEUVERS_COMPLETED, to: p("Round.Strike") },
    { from: p("Round.Strike"), event: E.STRIKES_COMPLETED, to: p("Round.Strikeback") },
    { from: p("Round.Strikeback"), event: E.HALF_TURN_ENDED, to: p("Round.Maneuver") },

    // Round-4 defensive muster window (replaces HALF_TURN_ENDED when due).
    { from: p("Round.Strikeback"), event: E.REINFORCEMENT_OFFERED, to: p("Round.Reinforce") },
    { from: p("Round.Reinforce"), event: E.REINFORCEMENT_MUSTERED, to: p("Round.Maneuver") },
    { from: p("Round.Reinforce"), event: E.REINFORCEMENT_DECLINED, to: p("Round.Maneuver") },

    // Angel summon: immediate interrupt at the point of the first kill.
    // Kills by the attacker can occur in the attacker's Strike phase OR in
    // the attacker's Strikeback during the defender's half-turn.
    { from: p("Round.Strike"), event: E.FIRST_KILL, to: p("Round.SummonAngel"), interrupt: true },
    { from: p("Round.Strikeback"), event: E.FIRST_KILL, to: p("Round.SummonAngel"), interrupt: true },
    { from: p("Round.SummonAngel"), event: E.ANGEL_SUMMONED, to: RESUME },
    { from: p("Round.SummonAngel"), event: E.SUMMON_DECLINED, to: RESUME },

    // Battle end, declared on the Round SCOPE so it bubbles from any
    // substate (a wipe-out can be detected during Strike, Strikeback, or
    // even Maneuver via a concession-forcing situation).
    { from: p("Round"), event: E.BATTLE_CONCLUDED, to: p("Resolution") },
    { from: p("Round"), event: E.LEGION_CONCEDED, to: p("Resolution") },
  ];
}

/**
 * Standalone battle machine (root = battle states). Resolution is terminal
 * here; in the composed GameFSM, Resolution exits back to engagement
 * selection via ENGAGEMENT_RESOLVED.
 */
export const BATTLE_MACHINE: Machine = createMachine({
  id: "TitanBattle",
  initial: BATTLE_STATES.initial!,
  states: BATTLE_STATES.states!,
  transitions: battleTransitions(""),
});
