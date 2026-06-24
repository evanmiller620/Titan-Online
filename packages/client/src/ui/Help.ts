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
      "After rolling, select a legion to light up its legal destinations (green halos). You move exactly the number of lands you rolled, and you may never reverse the step you just took. Two lands with NO connector between them are not linked — that gap is a void you cannot cross.",
      "The connectors carry the rules. Read them like this:",
      [
        "Brass arrow (triple-arrow track): the one-way flow around a ring. The arrowhead points to where you may go.",
        "Verdigris arrow (gateway): a cross-link between rings or into the central summit. A summit gateway may be crossed only on the SECOND step of a move.",
        "Red arrow (block): a FORCED exit. A legion that begins its move on a land bearing a block must make its first step across that block — it is not a barrier but a one-way push (it is also how legions drop out of the central summit).",
      ],
      "The forced-flow rule. Once your legion moves INTO a land that carries a triple-arrow track, it must keep following that arrow if it moves on — it cannot turn off onto a side gateway mid-move. So a legion riding a ring stays on the ring. The two ways to change tracks are: leave on your FIRST step (your starting land, including a Tower, lets you set off in any legal direction), or take the inward summit gateway on your SECOND step. This is why the outer ring is a trap and the Towers are prized launch points.",
      "The block rule. If your legion ended last turn on a land that has a block (a red arrow), its very first step this turn is forced across that block — you have no other first move. Watch for this when parking a legion: a block land commits your next departure in advance.",
      "Towers (the bright-rimmed lands) carry single arrows, not a track, so a legion starting in one may leave by any of its arrows — and they are where new legions enter and stage safely.",
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
    title: "Battle interactions, in detail",
    blocks: [
      "Entering the battleland. The attacker enters along a 4-hex-wide edge — the side matching the direction their legion came from on the masterboard — and the defender enters along the narrow 3-hex side directly opposite. Two special cases: attacking into a Tower, the defender deploys inside the walled centre and can’t move on the first Maneuver; a Titan that teleported in may pick any of the three wide edges.",
      "The round loop. A battle runs up to seven rounds, and each round is two half-turns (one per side). On your half-turn you take three steps in order:",
      [
        "Maneuver — move your creatures. A creature’s move allowance is its skill; flyers ignore terrain and can pass over other creatures. You may not move through an enemy, and once adjacent to one you are engaged.",
        "Strike — each of your engaged creatures may strike an adjacent enemy.",
        "Strikeback — the other side’s surviving engaged creatures strike you back. Then the half-turn ends and play passes.",
      ],
      "How a strike resolves. The striker rolls a number of dice equal to its power. Each die that meets or beats the strike number is one hit; landing hits equal to the target’s power slays it. The strike number is 4 − (attacker skill − defender skill), clamped to the 2–6 range — so a sharper striker hits on lower rolls, and a die never hits on a 1 nor needs better than a 6. Excess hits can sometimes ‘carry over’ to a second adjacent enemy, but only if it would face the same strike number without any positional advantage you used.",
      "Rangestriking. Creatures with the rangestrike ability can hit at a distance instead of in melee, but only on the moving player’s turn and never while in contact with an enemy. They roll half their power (rounded down), reach 2–4 hexes, and lose a point of skill at the maximum range of 4. Line of sight must be clear — Trees, Volcano, and occupied hexes block it. Lords (Titan, Angel, Archangel) are immune to rangestrikes, except from a Warlock, whose magic missile ignores line of sight, terrain, and the range penalty.",
      "Terrain and nativity. Each battleland is tinted by its hazards (brambles, sand, bog, drift, etc.) and ringed by hexside features (walls, slopes, dunes, cliffs, rivers). A creature native to a hazard moves and fights through it without penalty and often with an edge; a non-native is slowed or easier to hit there. Striking downhill over a slope or wall, or out of a volcano, grants extra dice — these advantages are exactly what can disqualify a carry-over.",
      "Interrupts and the clock. The attacker’s first kill of the battle opens a one-time window to summon an Angel or Archangel from reserve into the fight. At the start of round 4 the defender may muster one reinforcement if a recruit is legal. If any defender is still standing at the end of round 7, the attacker suffers a Time Loss — the attacking legion is destroyed and no points are scored, so don’t pick a fight you can’t finish in time.",
    ],
  },
  {
    title: "The creatures",
    blocks: [
      "Every creature is summarised as power / skill. Power is how many dice it rolls when it strikes (and how many hits kill it, and the points it’s worth when slain). Skill is its move allowance and feeds the strike-number math — higher skill hits on lower rolls and is harder to hit. ‘Flies’ ignores terrain and other creatures when moving; ‘rangestrikes’ can hit at a distance for half power; ‘native’ terrain is fought through without penalty.",
      "Lords & summoned creatures:",
      [
        "Titan — power 6 (+1 for every 100 of your score) / skill 4. Your king. If it dies you are eliminated, so it never fights alone if you can help it.",
        "Angel — 6 / 4, flies. Gained free at each 100 points, or summoned into a battle after your first kill.",
        "Archangel — 9 / 4, flies. Gained free at each 500 points; the strongest summon.",
        "Guardian — 12 / 2, flies. A heavy demilord — the hardest-hitting creature short of a high-score Titan.",
        "Warlock — 5 / 4, rangestrikes with a magic missile that ignores line of sight, terrain, and range penalty — and can hit lords.",
      ],
      "Recruitable creatures (power / skill · native terrain):",
      [
        "Centaur — 3 / 4 · river. A Tower starter; recruits up toward Lions and Warbears.",
        "Gargoyle — 4 / 3, flies · brambles. A Tower starter.",
        "Ogre — 6 / 2 · bog, slope. A Tower starter; tough but slow.",
        "Lion — 5 / 3 · sand, slope, river.",
        "Griffon — 5 / 4, flies · sand.",
        "Minotaur — 4 / 4, rangestrikes · slope.",
        "Ranger — 4 / 4, flies + rangestrikes · bog, river.",
        "Warbear — 6 / 3 · drift, river.",
        "Unicorn — 6 / 4 · slope, river.",
        "Gorgon — 6 / 3, flies + rangestrikes · brambles.",
        "Wyvern — 7 / 3, flies · bog.",
        "Giant — 7 / 4, rangestrikes · drift.",
        "Behemoth — 8 / 3 · brambles.",
        "Troll — 8 / 2 · drift, bog.",
        "Cyclops — 9 / 2 · brambles.",
        "Dragon — 9 / 3, flies + rangestrikes · slope, volcano.",
        "Hydra — 10 / 3, rangestrikes · bog, sand.",
        "Colossus — 10 / 4 · drift, slope.",
        "Serpent — 18 / 2 · brambles. Devastating power, but easy to hit.",
      ],
      "Each creature type is drawn from a shared, limited pool — once it’s exhausted no one can recruit more, so strong creatures are worth grabbing early.",
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
