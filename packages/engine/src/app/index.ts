/**
 * Engine ⇄ UI facade (Titan engine, module: app).
 *
 * THE defined boundary between the rules engine and any frontend. A UI should
 * import everything it needs from here (re-exported through `@titan/engine`) and
 * NEVER reach into engine internals (masterboard graph, combat math, hex
 * geometry, creature tables). That keeps game legality in one place and lets the
 * engine evolve without breaking the client.
 *
 * The contract has three parts:
 *   1. The RUNTIME — run an authoritative game from commands (GameRunner).
 *   2. The QUERIES — ask what is legal and what a board click means (presenter).
 *   3. The DATA the UI renders — board geometry and redacted views (re-exported
 *      from the engine's public types).
 */

export * from "./runner.ts";
export * from "./presenter.ts";

import type { GameStateView } from "../state/views.ts";
import type { CubeCoord } from "../hex/cube.ts";
import type { Action, ClickPlan, Selection } from "./presenter.ts";

/**
 * The complete surface a frontend uses to talk to the engine. The functions are
 * implemented as the free functions / `GameRunner` class re-exported above; this
 * interface documents and type-checks that surface in one place.
 */
export interface EngineUiApi {
  /** Which command buttons are legal for `seat` right now. */
  legalActions(view: GameStateView, seat: string, selection: Selection): Action[];
  /** Interpret a masterboard land click (select a legion, or move it). */
  planMasterboardClick(view: GameStateView, seat: string | null, selection: Selection, land: number): ClickPlan;
  /** Interpret a battleland hex click (deploy / select / move / strike / summon). */
  planBattleClick(view: GameStateView, seat: string | null, selection: Selection, hex: CubeCoord): ClickPlan;
  /** Is it this seat's move (setup picker, turn player, or battle actor)? */
  seatActsNow(view: GameStateView, seat: string | null): boolean;
  /** A short status string for the live battle, or null. */
  battleBanner(view: GameStateView): string | null;
}
