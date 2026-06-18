/**
 * Help overlay (Titan client, ui) — an in-game "how to play" panel covering
 * gameplay, interactions, and strategy. Pure DOM, no game state: it explains
 * the rules and the controls, and closes on backdrop / button / Esc.
 *
 * Kept as data (SECTIONS) + a thin renderer so the prose lives in one place.
 */

import { elem, eyebrow, button, theme } from "./dom.ts";
import { type as typ } from "./tokens.ts";

interface Section {
  readonly title: string;
  readonly blocks: ReadonlyArray<string | readonly string[]>; // string = paragraph, array = bullet list
}

const SECTIONS: readonly Section[] = [
  {
    title: "The goal",
    blocks: [
      "Each player commands legions of mythical creatures on a wheel of 96 lands. You grow your army by recruiting, and you fight when legions of different players meet. The last player with a living Titan wins — kill every enemy Titan and the game is yours.",
      "Your Titan is your king: it is one creature inside one legion. If your Titan dies, you are eliminated and the killer inherits your remaining points.",
    ],
  },
  {
    title: "A turn, phase by phase",
    blocks: [
      "Your turn runs through four phases. The command bar (right) always shows the legal actions, and a hint tells you what to do if you must first select something.",
      [
        "Split (Commencement): optionally divide a legion into two. On turn 1 you MUST split your 8-stack into two legions of 4. Then press “End splits”.",
        "Move: roll the movement die, then move your legions. You only need to move ONE legion, but you may move as many as you like. Each must land on a legal destination for the number rolled.",
        "Fight (Engagement): if you moved onto a land holding an enemy legion, you resolve that clash — either fight a battle or settle it by agreement.",
        "Recruit (Mustering): a legion that moved this turn can recruit one new creature if it is on the right terrain. Then press “End turn”.",
      ],
    ],
  },
  {
    title: "Splitting",
    blocks: [
      "Select a legion (tap it on the board or in “Your legions”). A chooser appears: tap the units you want to peel off into a NEW legion, then “Split off N → new legion”.",
      "A legion must be 2–7 creatures. So you can only split a stack of 4 or more (each half needs at least 2). Splitting is how you cover more ground and threaten more lands — but small legions are fragile.",
    ],
  },
  {
    title: "Moving and the rings",
    blocks: [
      "After rolling, select a legion to light up its legal destinations (green halos). The board’s connector lines are the tracks: brass arrows are the normal one-way flow around the three rings; dashed lines are the inner-ring gateways. Two lands with NO line between them are not connected — that gap is a void you cannot cross.",
      "You move exactly the number of lands you rolled, following the arrows. Towers (the bright-rimmed lands) are where new legions enter and are safe staging points.",
    ],
  },
  {
    title: "Recruiting (Mustering)",
    blocks: [
      "Recruiting happens in the LAST phase of your turn. A legion can recruit only if it MOVED this turn, is below 7 creatures, hasn’t already recruited, and sits on terrain that breeds the creature you want.",
      "In “Your legions”, any legion that can recruit is tagged in green (“can recruit: …”). Select it and the “Muster <creature>” buttons appear in the bar. You need the right prerequisites already in the legion (e.g. Centaurs on Plains let you take a Lion); Towers give a free Centaur, Gargoyle, or Ogre. The creature that pays for a recruit is revealed publicly.",
    ],
  },
  {
    title: "Battles",
    blocks: [
      "When you choose to fight, the board switches to the battle hex grid. Deploy your creatures, then over a series of rounds you Maneuver (move one hex) and Strike. To hit, you roll dice per creature and compare to the strike number set by the attacker’s and defender’s skills; range-strikers can hit from afar at half power.",
      "A battle that runs 7 rounds is a time-loss for the attacker. Kill the enemy legion to win the land and score points equal to the creatures you slew.",
    ],
  },
  {
    title: "Scoring & acquiring",
    blocks: [
      "You score points for every enemy creature you kill (in battle or by settlement). Crossing each multiple of 100 points earns a free Angel you can add to a legion; multiples of 500 earn an Archangel. Points are how you build toward an unbeatable army — and how an eliminated player’s killer gets stronger.",
    ],
  },
  {
    title: "Strategy tips",
    blocks: [
      [
        "Keep your Titan in a strong, well-guarded legion — losing it loses the game. Don’t over-expose it for a few points.",
        "Recruit aggressively early: move legions onto matching terrain every turn so they grow. A legion that doesn’t move can’t recruit.",
        "Split to grab more lands and recruiting options, but recombine before a fight — two legions on one land merge at end of movement.",
        "Pick your battles. Settling can split points without risking your creatures; fight when you have a clear edge in size or terrain.",
        "Use Towers as safe muster points, and watch the rings: control of chokepoints lets you force or avoid engagements.",
        "Chase the 100-point thresholds — a timely Angel can swing a battle.",
      ],
    ],
  },
  {
    title: "Controls cheat-sheet",
    blocks: [
      [
        "Tap a land or a legion in “Your legions” to select it.",
        "Selected legion → board shows its legal destinations; tap one to move.",
        "The command bar lists every legal action for the seat right now.",
        "Fastplay (top): auto-runs forced single-option steps (rolling, a lone pick, an empty phase-end) so you only click when there’s a real choice.",
        "Developer panel: reveal-all, save/load, undo, and force dice for testing.",
      ],
    ],
  },
];

/** Build the help overlay, hidden until `.show()`. Append to the root once. */
export function helpOverlay(): { el: HTMLElement; show: () => void; hide: () => void } {
  const panel = elem("div", [
    "max-width:720px", "width:90%", "max-height:86vh", "overflow:auto",
    "padding:24px 28px", `background:${theme.bg}`, `border:1px solid ${theme.brass}`,
    "border-radius:6px", "box-shadow:0 20px 60px rgba(0,0,0,0.5)",
  ].join(";"));

  const close = button("Close", { onClick: () => hide() });
  panel.appendChild(elem("div", "display:flex;justify-content:space-between;align-items:center;margin-bottom:14px", {
    children: [
      elem("div", `font-family:${typ.display ?? typ.body};font-size:22px;color:${theme.brassBright};font-weight:700`, { text: "How to play Titan" }),
      close,
    ],
  }));

  for (const s of SECTIONS) {
    panel.appendChild(elem("div", "margin-top:16px", { children: [eyebrow(s.title)] }));
    for (const b of s.blocks) {
      if (typeof b === "string") {
        panel.appendChild(elem("p", `margin:6px 0 0;font-family:${typ.body};font-size:13px;line-height:1.55;color:${theme.ink}`, { text: b }));
      } else {
        const ul = elem("ul", "margin:6px 0 0;padding-left:18px");
        for (const li of b) ul.appendChild(elem("li", `font-family:${typ.body};font-size:13px;line-height:1.5;color:${theme.ink};margin:3px 0`, { text: li }));
        panel.appendChild(ul);
      }
    }
  }

  const el = elem("div", [
    "position:fixed", "inset:0", "z-index:50", "display:none",
    "align-items:center", "justify-content:center",
    "background:rgba(10,11,13,0.66)",
  ].join(";"), { children: [panel] });

  const show = () => { el.style.display = "flex"; };
  const hide = () => { el.style.display = "none"; };
  // Close on backdrop click (but not when clicking inside the panel).
  el.onclick = (e) => { if (e.target === el) hide(); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });

  return { el, show, hide };
}
