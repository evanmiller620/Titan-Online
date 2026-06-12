/**
 * Game FSM (Titan engine, module: core/fsm).
 *
 * The outer machine. One active leaf at all times; the Battle FSM subtree is
 * grafted under Turn.Engagement.Battle so "the game is in a battle" and "the
 * game is in the strike phase of a battle" are the same fact at different
 * depths — queryable with matches(state, "Turn.Engagement.Battle").
 *
 * Topology:
 *
 *   Setup
 *     RollingForOrder     all players roll; highest picks tower first
 *     TowerSelection      towers chosen in DESCENDING roll order
 *     ColorSelection      colors chosen in ASCENDING order (last mover
 *                         picks color first) — per the spec document
 *   Turn                  repeats per player; whose turn = GameState context
 *     Commencement        splits (incl. the turn-1 initial 8→4+4 split)
 *     Movement            roll die (mulligan on turn 1), move legions
 *     Engagement
 *       Choosing          pick the next unresolved engagement, or finish
 *       Negotiation       flee / concede / negotiated settlement / fight
 *       Battle.*          the grafted Battle subtree (see BattleFSM.ts)
 *     Mustering           eligible legions recruit; then next player
 *   GameOver              terminal; reached via root-scoped GAME_ENDED
 *
 * GAME_ENDED is declared once on each live superstate (Setup, Turn): a Titan
 * can die deep inside a battle's Strikeback, players can resign during
 * Setup, and mutual destruction is adjudicated in Resolution — scope-level
 * declarations cover all of it via bubbling while leaving GameOver truly
 * terminal (a root-scoped event would match GameOver too).
 *
 * Phase-skip note: there is no special edge for "no engagements this turn".
 * Movement always hands off to Engagement.Choosing; the command layer fires
 * ALL_ENGAGEMENTS_RESOLVED immediately when the engagement list is empty.
 * One topology, zero special cases.
 */

import {
  createMachine,
  type Machine,
  type MachineDef,
} from "./StateMachine.ts";
import { BATTLE_STATES, BattleEvent, battleTransitions } from "./BattleFSM.ts";

/** Game-level event vocabulary (battle events are in BattleEvent). */
export const GameEvent = {
  // Setup
  TURN_ORDER_DETERMINED: "TURN_ORDER_DETERMINED",
  TOWERS_SELECTED: "TOWERS_SELECTED",
  COLORS_SELECTED: "COLORS_SELECTED",
  // Turn phases
  SPLITS_COMPLETED: "SPLITS_COMPLETED",
  MOVEMENT_COMPLETED: "MOVEMENT_COMPLETED",
  ENGAGEMENT_SELECTED: "ENGAGEMENT_SELECTED",
  ALL_ENGAGEMENTS_RESOLVED: "ALL_ENGAGEMENTS_RESOLVED",
  // Negotiation outcomes (pre-battle)
  DEFENDER_FLED: "DEFENDER_FLED",
  LEGION_CONCEDED: "LEGION_CONCEDED", // also legal mid-battle (Round scope)
  SETTLEMENT_AGREED: "SETTLEMENT_AGREED",
  BATTLE_JOINED: "BATTLE_JOINED",
  // Battle exit
  ENGAGEMENT_RESOLVED: "ENGAGEMENT_RESOLVED",
  // Turn end / game end
  TURN_ENDED: "TURN_ENDED",
  GAME_ENDED: "GAME_ENDED",
} as const;
export type GameEvent = (typeof GameEvent)[keyof typeof GameEvent];

/** Every event either machine layer can fire. */
export type TitanEvent = GameEvent | BattleEvent;

const BATTLE_PATH = "Turn.Engagement.Battle";

export const GAME_MACHINE_DEF: MachineDef = {
  id: "TitanGame",
  initial: "Setup",
  states: {
    Setup: {
      initial: "RollingForOrder",
      states: {
        RollingForOrder: {},
        TowerSelection: {},
        ColorSelection: {},
      },
    },
    Turn: {
      initial: "Commencement",
      states: {
        Commencement: {},
        Movement: {},
        Engagement: {
          initial: "Choosing",
          states: {
            Choosing: {},
            Negotiation: {},
            Battle: BATTLE_STATES,
          },
        },
        Mustering: {},
      },
    },
    GameOver: {},
  },
  transitions: [
    // Setup
    { from: "Setup.RollingForOrder", event: GameEvent.TURN_ORDER_DETERMINED, to: "Setup.TowerSelection" },
    { from: "Setup.TowerSelection", event: GameEvent.TOWERS_SELECTED, to: "Setup.ColorSelection" },
    { from: "Setup.ColorSelection", event: GameEvent.COLORS_SELECTED, to: "Turn" },

    // The four phases
    { from: "Turn.Commencement", event: GameEvent.SPLITS_COMPLETED, to: "Turn.Movement" },
    { from: "Turn.Movement", event: GameEvent.MOVEMENT_COMPLETED, to: "Turn.Engagement" },
    { from: "Turn.Engagement.Choosing", event: GameEvent.ENGAGEMENT_SELECTED, to: "Turn.Engagement.Negotiation" },
    { from: "Turn.Engagement.Choosing", event: GameEvent.ALL_ENGAGEMENTS_RESOLVED, to: "Turn.Mustering" },
    { from: "Turn.Mustering", event: GameEvent.TURN_ENDED, to: "Turn.Commencement" },

    // Negotiation outcomes
    { from: "Turn.Engagement.Negotiation", event: GameEvent.DEFENDER_FLED, to: "Turn.Engagement.Choosing" },
    { from: "Turn.Engagement.Negotiation", event: GameEvent.LEGION_CONCEDED, to: "Turn.Engagement.Choosing" },
    { from: "Turn.Engagement.Negotiation", event: GameEvent.SETTLEMENT_AGREED, to: "Turn.Engagement.Choosing" },
    { from: "Turn.Engagement.Negotiation", event: GameEvent.BATTLE_JOINED, to: BATTLE_PATH },

    // The grafted battle subtree
    ...battleTransitions(BATTLE_PATH),
    { from: `${BATTLE_PATH}.Resolution`, event: GameEvent.ENGAGEMENT_RESOLVED, to: "Turn.Engagement.Choosing" },

    // A Titan's death (or table-wide resignation) can end the game from any
    // live state. Declared on the Setup and Turn scopes — NOT the root —
    // because a root-scoped event would also match inside GameOver, making
    // the terminal state able to "end" again. Terminal means terminal.
    { from: "Setup", event: GameEvent.GAME_ENDED, to: "GameOver" },
    { from: "Turn", event: GameEvent.GAME_ENDED, to: "GameOver" },
  ],
};

export const GAME_MACHINE: Machine = createMachine(GAME_MACHINE_DEF);

/** Convenience scopes for matches() queries by UI and commands. */
export const Scope = {
  Setup: "Setup",
  Turn: "Turn",
  Commencement: "Turn.Commencement",
  Movement: "Turn.Movement",
  Engagement: "Turn.Engagement",
  Battle: BATTLE_PATH,
  BattleRound: `${BATTLE_PATH}.Round`,
  Mustering: "Turn.Mustering",
  GameOver: "GameOver",
} as const;
export type Scope = (typeof Scope)[keyof typeof Scope];
