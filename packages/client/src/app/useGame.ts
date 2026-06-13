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
  const subsRef = useRef<ReturnType<typeof subscribeGame> | null>(null);
  const appRef = useRef<Application | null>(null);

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
        onLandClick: (landId) => dispatch({ type: "select", id: String(landId) }),
        onLandHover: (landId) => dispatch({ type: "hover", id: landId === null ? null : String(landId) }),
      });
      boardRef.current = board;

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
    };
  }, [props.client, props.gameId, props.mountRef]);

  // --- redraw board whenever the snapshot or selection changes -----------
  useEffect(() => {
    const board = boardRef.current;
    if (!board || !store.snapshot) return;
    const sel = store.selection.selected ? Number(store.selection.selected) : null;
    const hov = store.selection.hovered ? Number(store.selection.hovered) : null;
    board.render(store.snapshot, Number.isNaN(sel as number) ? null : sel, Number.isNaN(hov as number) ? null : hov);
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

  const sendHover = useCallback(
    (landId: number | null) => {
      subsRef.current?.sendUi("hover", { slot: props.viewerSlot, land: landId });
    },
    [props.viewerSlot],
  );

  return { store, issueCommand, sendHover };
}
