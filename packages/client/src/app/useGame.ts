/**
 * App orchestration (Titan client, app).
 *
 * Owns the wiring between the four decoupled layers and nothing else:
 *   store (authoritative snapshot, strict-wait)  ←→  net (Supabase)
 *        ↑ render reads snapshot                       ↓ submit → Edge Function
 *   render (Pixi Masterboard)                     ui (HUD command DTOs)
 *
 * The strict-wait contract lives here: handleCommand() dispatches submitStart,
 * posts to the Edge Function, and on reject dispatches submitReject. It NEVER
 * applies the command locally — the store advances only when the authoritative
 * Realtime snapshot arrives and the reducer adopts the newer version.
 *
 * Built with the React hooks shim; on a connected machine this is ordinary
 * React with real types.
 */

import { useEffect, useReducer, useRef, useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Application } from "pixi.js";
import type { CommandDTO } from "@titan/engine";
import {
  initialStore,
  reduce,
  type StoreState,
  type StoreEvent,
} from "../store/gameStore.ts";
import { submitCommand, subscribeGame, fetchSnapshot } from "../net/supabase.ts";
import { MasterboardRenderer } from "../render/MasterboardRenderer.ts";
import { BattlelandRenderer } from "../render/BattlelandRenderer.ts";
import { planBattleClick, planMasterboardClick } from "./battleUi.ts";
import type { GameStateView } from "@titan/engine";

export interface GameViewProps {
  readonly client: SupabaseClient;
  readonly gameId: string;
  readonly viewerSlot: string | null;
  /** Mount node for the Pixi canvas. */
  readonly mountRef: { current: HTMLDivElement | null };
}

/**
 * The headless controller hook: sets up store, board, subscription, and the
 * submit flow. Returns the current store state and a command issuer for the
 * HUD. (Rendering of the HUD/board chrome is done by the caller component.)
 */
export function useGame(props: GameViewProps): {
  store: StoreState;
  issueCommand: (dto: CommandDTO) => void;
  sendHover: (landId: number | null) => void;
} {
  const [store, dispatch] = useReducer(
    reduce,
    initialStore,
    (s: StoreState) => ({ ...s, viewerSlot: props.viewerSlot }),
  );
  const boardRef = useRef<MasterboardRenderer | null>(null);
  const battleRef = useRef<BattlelandRenderer | null>(null);
  const subsRef = useRef<ReturnType<typeof subscribeGame> | null>(null);
  const appRef = useRef<Application | null>(null);
  // Live refs so the (once-wired) board click handlers never read stale data.
  const viewRef = useRef<GameStateView | null>(null);
  const selRef = useRef<string | null>(null);
  const issueRef = useRef<((dto: CommandDTO) => void) | null>(null);

  // --- board + subscription lifecycle ------------------------------------
  useEffect(() => {
    let disposed = false;

    const setup = async () => {
      // 1. Pixi board.
      const app = new Application();
      await app.init({ background: "#E8DFC8", resizeTo: props.mountRef.current ?? undefined });
      if (disposed) {
        app.destroy(true);
        return;
      }
      appRef.current = app;
      props.mountRef.current?.appendChild(app.canvas);
      const board = new MasterboardRenderer(app, app.canvas.width, app.canvas.height);
      board.attachInput({
        onLandClick: (landId) => {
          const view = viewRef.current;
          if (!view) {
            dispatch({ type: "select", id: String(landId) });
            return;
          }
          const plan = planMasterboardClick(view, props.viewerSlot, selRef.current, landId);
          if (plan.command) issueRef.current?.(plan.command);
          else if (plan.select !== undefined) dispatch({ type: "select", id: plan.select });
        },
        onLandHover: (landId) => dispatch({ type: "hover", id: landId === null ? null : String(landId) }),
      });
      boardRef.current = board;

      // Battle board (hidden until a battle is joined). Hex clicks route through
      // the pure planBattleClick decision: select a character, move it, or strike.
      const battle = new BattlelandRenderer(app, app.canvas.width, app.canvas.height);
      battle.setVisible(false);
      battle.attachInput(
        {
          onHexClick: (cube) => {
            const view = viewRef.current;
            if (!view) return;
            const plan = planBattleClick(view, props.viewerSlot, selRef.current, cube);
            if (plan.command) issueRef.current?.(plan.command);
            else if (plan.select !== undefined) dispatch({ type: "select", id: plan.select });
          },
        },
        () => viewRef.current,
      );
      battleRef.current = battle;

      // 2. Authoritative subscription.
      subsRef.current = subscribeGame(
        props.client,
        props.gameId,
        (e: StoreEvent) => dispatch(e),
        (_members) => {/* presence handled by lobby UI */},
        (_event, _payload) => {/* ephemeral UI hooks: targeting arrows, etc. */},
      );

      // 3. Initial snapshot (covers reconnection / late join).
      const snap = await fetchSnapshot(props.client, props.gameId);
      if (snap && !disposed) {
        dispatch({ type: "snapshot", version: snap.version, view: snap.view });
      }
    };

    void setup();

    return () => {
      disposed = true;
      subsRef.current?.unsubscribe();
      appRef.current?.destroy(true);
      boardRef.current = null;
      battleRef.current = null;
    };
  }, [props.client, props.gameId, props.mountRef]);

  // --- redraw board whenever the snapshot or selection changes -----------
  useEffect(() => {
    // Keep the live refs current for the board click handlers.
    viewRef.current = store.snapshot;
    selRef.current = store.selection.selected;

    const board = boardRef.current;
    const battle = battleRef.current;
    if (!board || !store.snapshot) return;

    if (store.snapshot.battle) {
      // Tactical layer: show the battleland, hide the masterboard.
      board.setVisible(false);
      battle?.setVisible(true);
      battle?.render(store.snapshot, store.selection.selected);
      return;
    }

    board.setVisible(true);
    battle?.setVisible(false);
    // `selected` is a legion marker on the masterboard; highlight its land.
    const selMarker = store.selection.selected;
    const selLand = selMarker && store.snapshot.legions[selMarker]
      ? store.snapshot.legions[selMarker]!.land
      : selMarker ? Number(selMarker) : null;
    const hov = store.selection.hovered ? Number(store.selection.hovered) : null;
    board.render(store.snapshot, selLand != null && Number.isFinite(selLand) ? selLand : null, Number.isNaN(hov as number) ? null : hov);
  }, [store.snapshot, store.selection.selected, store.selection.hovered]);

  // --- strict-wait command submission ------------------------------------
  const issueCommand = useCallback(
    (dto: CommandDTO) => {
      dispatch({ type: "submitStart", commandType: dto.type });
      void submitCommand(props.client, props.gameId, dto).then((result) => {
        if (!result.ok) {
          dispatch({ type: "submitReject", commandType: dto.type, message: result.message });
        }
        // On success we deliberately do nothing: the authoritative snapshot
        // arriving over Realtime is what advances the store (strict-wait).
      });
    },
    [props.client, props.gameId],
  );
  // Expose the latest issuer to the board click handler (wired once).
  issueRef.current = issueCommand;

  const sendHover = useCallback(
    (landId: number | null) => {
      subsRef.current?.sendUi("hover", { slot: props.viewerSlot, land: landId });
    },
    [props.viewerSlot],
  );

  return { store, issueCommand, sendHover };
}
