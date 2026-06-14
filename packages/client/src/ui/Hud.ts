/**
 * HUD (Titan client, ui).
 *
 * The heads-up layer over the board: a phase banner, the active player's
 * chrome, and the command bar whose buttons are gated by strict-wait state.
 * Copy follows the design guidance — active verbs naming what happens
 * ("Roll movement", "End turn"), consistent through the flow, errors that say
 * what went wrong and how to proceed.
 *
 * This component READS the store and EMITS command DTOs through `onCommand`;
 * it never talks to the network or the engine's mutating paths directly. The
 * app layer submits the DTO (strict-wait) and the store updates on broadcast.
 */

import type { FC } from "react";
import type { CommandDTO } from "@titan/engine";
import {
  type StoreState,
  isMyTurn,
  phaseLabel,
  activeSlot,
} from "../store/gameStore.ts";
import {
  availableActions,
  battleBanner,
  battleInputsLocked,
  viewerActsInBattle,
} from "../app/battleUi.ts";
import { palette, type as typ, space } from "./tokens.ts";

export interface HudProps {
  readonly store: StoreState;
  readonly onCommand: (dto: CommandDTO) => void;
}

const panel: Record<string, string | number> = {
  fontFamily: typ.body,
  color: palette.ink,
  background: palette.vellum,
};

export const Hud: FC<HudProps> = ({ store, onCommand }) => {
  const view = store.snapshot;
  if (!view) {
    return el("div", { style: { ...panel, padding: space.lg } }, "Waiting for the table…");
  }

  const myTurn = isMyTurn(store);
  const locked = battleInputsLocked(store);
  const slot = store.viewerSlot;
  const phase = phaseLabel(store);
  const banner = battleBanner(store);

  const issue = (type: string, payload: Record<string, unknown> = {}) => {
    if (slot === null) return;
    onCommand({ type, playerId: slot, payload });
  };

  return el(
    "div",
    { style: { ...panel, display: "flex", flexDirection: "column", gap: space.md, padding: space.lg } },
    [
      // Phase banner — the heraldic eyebrow + title.
      el("div", { key: "banner" }, [
        el(
          "div",
          {
            key: "eyebrow",
            style: {
              fontFamily: typ.mono,
              fontSize: typ.scale.xs,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: palette.verdigris,
            },
          },
          banner ?? `Turn ${view.turn.number} · ${labelForActive(store)}`,
        ),
        el(
          "div",
          {
            key: "title",
            style: { fontFamily: typ.display, fontSize: typ.scale.xl, color: palette.oxblood, lineHeight: 1.1 },
          },
          phase,
        ),
      ]),

      // Command bar — gated by strict-wait. Only the legal phase actions show.
      el("div", { key: "bar", style: { display: "flex", gap: space.sm, flexWrap: "wrap" } },
        commandButtons(store, myTurn, locked, issue)),

      // Status line — submitting / rejected feedback.
      statusLine(store),
    ],
  );
};

/** Phase-appropriate buttons. Names are the exact action that happens. The
 *  full set (incl. engagement and every battle phase) comes from the shared,
 *  unit-tested `availableActions` model so the HUD and tests never drift. */
function commandButtons(
  store: StoreState,
  _myTurn: boolean,
  locked: boolean,
  issue: (type: string, payload?: Record<string, unknown>) => void,
): unknown[] {
  const inBattle = store.snapshot?.battle != null;
  const canAct = inBattle ? viewerActsInBattle(store) : isMyTurn(store);
  const actions = availableActions(store);

  if (actions.length === 0) {
    if (canAct) return [];
    const who = inBattle ? "The other side" : `${activeSlot(store) ?? "Another player"}`;
    return [el("span", { key: "wait", style: hintStyle }, `${who} is playing`)];
  }

  return actions.map((b, i) =>
    el(
      "button",
      {
        key: `${b.type}-${i}`,
        disabled: locked,
        onClick: () => issue(b.type, b.payload),
        style: buttonStyle(b.primary === true, locked),
      },
      b.label,
    ),
  );
}

function statusLine(store: StoreState): unknown {
  const c = store.command;
  if (c.kind === "submitting") {
    return el("div", { key: "status", style: { ...hintStyle, color: palette.verdigris } },
      `Submitting ${humanize(c.commandType)}…`);
  }
  if (c.kind === "rejected") {
    // Errors explain what happened and how to proceed, in the UI's voice.
    return el("div", { key: "status", style: { ...hintStyle, color: palette.alarm } },
      `${humanize(c.commandType)} was not allowed: ${c.message}. Pick another action.`);
  }
  return el("div", { key: "status", style: { height: typ.scale.base } }, "");
}

function labelForActive(store: StoreState): string {
  const a = activeSlot(store);
  if (a && a === store.viewerSlot) return "Your move";
  return a ? `${a} to move` : "—";
}

const hintStyle: Record<string, string | number> = {
  fontFamily: typ.body,
  fontSize: typ.scale.sm,
  color: palette.inkSoft,
};

function buttonStyle(primary: boolean, locked: boolean): Record<string, string | number> {
  return {
    fontFamily: typ.body,
    fontSize: typ.scale.sm,
    fontWeight: primary ? 700 : 500,
    padding: `${space.sm} ${space.md}`,
    border: `1px solid ${primary ? palette.oxblood : palette.parchmentEdge}`,
    borderRadius: "3px",
    background: primary ? palette.oxblood : "transparent",
    color: primary ? palette.vellum : palette.ink,
    cursor: locked ? "not-allowed" : "pointer",
    opacity: locked ? 0.5 : 1,
  };
}

function humanize(commandType: string): string {
  return commandType.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

// Tiny createElement shim so this file reads as JSX-free TS that still
// type-checks against the React shim without pulling in the JSX runtime.
// Returns `any` deliberately: this keeps the component assignable to React.FC
// under BOTH the real @types/react (ReactNode) and the offline shim, since we
// build the actual element tree with createElement at runtime via the bundler.
function el(tag: string, props: Record<string, unknown>, children?: unknown): any {
  return { tag, props, children };
}
