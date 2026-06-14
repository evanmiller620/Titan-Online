# Titan Online — How to Play & UI Guide

This document explains how a full multiplayer game of *Titan* is played in this
client, and ties **every** game action to the exact UI element that triggers it.
It is meant to be read alongside the board: keep it open while you learn the flow.

For the underlying rules, see `docs/The_Law_of_Titan_Context.md`. This guide is
about *playing* — what you click, when, and why.

---

## 1. The two boards and three input surfaces

Titan is a dual-layer game, and the UI mirrors that:

- **The Masterboard** — the 96-land wheel where legions march and meet. Shown by
  default.
- **The Battleland** — a 27-hex tactical grid that replaces the Masterboard
  whenever two legions fight. The client switches to it automatically when a
  battle begins and switches back when the battle ends.

You drive the game through three surfaces, and every action uses one of them:

1. **The command bar (HUD)** — context-sensitive buttons for everything that
   doesn't need a board target (roll, end phase, fight/settle, deploy, summon…).
   The bar only shows the actions that are *legal right now for you*.
2. **Masterboard clicks** — click a land to select your legion there, then click
   a destination land to move it.
3. **Battleland clicks** — click one of your characters to select it, then click
   a hex to move, or an adjacent enemy to strike.

**Strict-wait:** when you submit an action the bar locks ("Submitting…") until the
authoritative result arrives. The board never changes from your click alone — it
changes when the server confirms. A rejected action shows *what* went wrong and
asks you to pick another; nothing is lost.

A banner at the top always tells you the phase and whose move it is (e.g.
*"Round 3 · attacker strike · your move"*).

---

## 2. The shape of a game

```
SETUP                roll for order → pick Towers → pick colors
  │
  ▼
TURN (repeats per player, clockwise)
  ├─ Commencement   split legions (the turn-1 split is mandatory)
  ├─ Movement       roll the die, move every legion that can move
  ├─ Engagement     resolve each clash: fight a battle, or a point-split settlement
  └─ Mustering      each moved legion may recruit one creature, then end turn
  │
  ▼
GAME OVER            last player with a living Titan wins
```

A **battle** (inside Engagement) has its own loop:

```
Defender deploys → Attacker deploys →
  Round 1..7:  Maneuver → Strike → Strikeback   (defender half, then attacker half)
Conclusion:    scoring, elimination, marker transfer
```

---

## 3. Walkthrough — what you click, phase by phase

### Setup

1. **Roll for turn order.** Anyone clicks **"Roll for turn order"**; the table is
   ordered by the roll.
2. **Pick a Tower.** In descending roll order, the current picker sees a
   **"Choose Tower N"** button for each free Tower. Click one.
3. **Pick a color.** In ascending order (last mover picks first), the picker sees
   a **"Take *color*"** button for each free color. Your starting eight-stack
   (Titan, Angel, 2 Centaurs, 2 Gargoyles, 2 Ogres) is placed at your Tower
   automatically.

### Commencement (splitting)

You must divide your eight-stack before play continues on turn 1.

- Click **"Make initial split (4/4)"**. This proposes a legal split — your Titan
  in one legion, your Angel in the other, four characters each — and submits it.
- Then click **"End splits"** to advance to Movement.

> On later turns, "End splits" alone advances the phase. (See *Known limits* for
> arbitrary mid-game splitting.)

### Movement

1. Click **"Roll movement"** to roll the die. On turn 1 you may also click
   **"Take mulligan"** once to re-roll.
2. **Move a legion:** click the land holding your legion to **select** it (its
   land highlights), then click a **legal destination land**. The move is
   submitted. Repeat for each legion — every legion that *can* move *must* move
   before the phase ends.
3. **Tower teleport:** select a legion that contains a Lord and starts in a
   Tower; the bar shows **"Tower-teleport to N"** buttons for each legal
   destination.
4. **Titan teleport:** select your Titan's legion when you have 400+ points and
   rolled a 6; the bar shows **"Titan-teleport to N"** buttons targeting enemy
   legions.
5. Click **"End movement"** to advance.

### Engagement

If any of your legions ended on an enemy-occupied land, you resolve each clash.

- **Choosing:** the bar lists **"Resolve clash at N"** for each contested land.
  Click one.
- **Negotiation:** choose the outcome — **"Fight"** (play out a tactical battle),
  or a **settlement** — a negotiated point-split where the defender's legion
  withdraws and its point value is divided between the two players (even split or
  attacker-takes-all). There are no one-sided concessions.

### Battle (when you choose Fight)

The board switches to the Battleland.

1. **Deploy.** The defender goes first: click **"Deploy legion"** to place your
   whole legion on legal entry hexes automatically. Then the attacker clicks
   **"Deploy legion"**.
2. **Maneuver.** The acting side moves characters: click one of your characters
   to select it, then click a reachable hex. Click **"End maneuvers"** when done.
   - *Round-4 defender muster:* at the start of round 4 the defender sees
     **"Muster *creature*"** buttons to bring in one reinforcement.
3. **Strike / Strikeback.** Click your character, then click an **adjacent
   enemy** to strike it. Click **"End strikes"** to pass to the strikeback (the
   other side strikes back), and again to end the half-turn.
   - *First blood:* the first time the attacker kills, the bar offers
     **"Summon Angel from *marker*"** (one per eligible off-board legion) and
     **"Decline summon"**. You must choose before ending the strike phase.
4. The battle ends when a side is wiped, a Titan falls, or seven rounds elapse
   (attacker *time-loss*). Scoring, elimination and marker inheritance are
   applied automatically and the board returns to the Masterboard.

### Mustering

- Click a moved legion on the Masterboard to **select** it; the bar shows a
  **"Muster *creature*"** button for each creature its terrain and contents
  allow. Click one to recruit (one recruit per legion per turn).
- Click **"End turn"** to pass play to the next player.

### Victory

When only one player's Titan remains, the bar/banner shows **Game over**.

---

## 4. Every action → its UI element

Every command the engine accepts is reachable from the UI. *CB* = command-bar
button; *Board* = a board click.

| Game action | Command | How you trigger it |
| :-- | :-- | :-- |
| Roll for turn order | `RollTurnOrder` | CB — "Roll for turn order" |
| Choose a starting Tower | `SelectTower` | CB — "Choose Tower N" (your pick) |
| Choose a legion color | `SelectColor` | CB — "Take *color*" (your pick) |
| Split the eight-stack | `SplitLegion` | CB — "Make initial split (4/4)" |
| Finish splitting | `EndSplits` | CB — "End splits" |
| Roll the movement die | `RollMovement` | CB — "Roll movement" |
| Re-roll on turn 1 | `TakeMulligan` | CB — "Take mulligan" |
| Move a legion | `MoveLegion` | Board — select legion, click destination land |
| Teleport from a Tower | `TowerTeleport` | CB — "Tower-teleport to N" (legion selected) |
| Titan power-teleport | `TitanTeleport` | CB — "Titan-teleport to N" (legion selected) |
| Finish moving | `EndMovement` | CB — "End movement" |
| Pick a clash to resolve | `SelectEngagement` | CB — "Resolve clash at N" |
| Fight or settle (point-split) | `ResolveEngagement` | CB — "Fight" / "Settle — split points" / "Settle — take all" |
| Deploy to battle (manual) | `DeployLegion` | Board — click hexes to place each character, then "Deploy legion" |
| Summon Angel to a chosen hex | `SummonAngel` | Board — click a hex, then "Summon Angel from …" |
| Deploy a legion to battle | `DeployLegion` | CB — "Deploy legion" (auto-places) |
| Move a combatant | `MoveCombatant` | Board — select character, click hex |
| Finish maneuvering | `EndManeuvers` | CB — "End maneuvers" |
| Strike an enemy | `Strike` | Board — select character, click adjacent enemy |
| Finish striking | `EndStrikes` | CB — "End strikes" |
| Summon an Angel (first blood) | `SummonAngel` | CB — "Summon Angel from *marker*" |
| Decline the summon | `DeclineSummon` | CB — "Decline summon" |
| Round-4 defensive muster | `ReinforceBattle` | CB — "Muster *creature*" (round 4, defender) |
| Recruit during Mustering | `Muster` | Board select legion → CB "Muster *creature*" |
| End your turn | `EndTurn` | CB — "End turn" |

The button set comes from one shared, unit-tested function (`availableActions`)
and the board planners (`planMasterboardClick`, `planBattleClick`), so the HUD,
the board, and the tests can never disagree about what is legal.

---

## 5. Selection model (how "select then act" works)

- On the **Masterboard**, clicking a land selects *your legion there* (its land
  highlights). A second click on a legal destination moves it; teleport and
  muster options for the selected legion appear in the command bar.
- On the **Battleland**, clicking selects one of *your* characters; the next
  click moves it (Maneuver) or strikes an adjacent enemy (Strike).
- Selecting is purely local and never alters game state — only confirmed
  commands do.

---

## 6. Known limits (current build)

- **Arbitrary mid-game splits.** The engine fully supports splitting any legion
  into any legal halves, but the command bar currently only auto-proposes the
  mandatory turn-1 4/4 split. Choosing exactly which creatures go to a new marker
  mid-game needs a multi-select panel that isn't built yet; "End splits" still
  advances the phase normally.
- **Board placement is automatic.** Battle deployment auto-places your legion on
  legal entry hexes rather than letting you hand-place each character, and the
  attacker entry side defaults to one wide edge rather than being derived from
  the Masterboard approach. The rules are honored; only the placement choice is
  simplified.
- **Rendering is browser-only.** The Pixi board and React HUD run in a browser;
  the rules engine and all the decision logic above are covered by automated
  tests, but the canvas/React wiring is verified by running the client
  (`pnpm --filter @titan/client dev`), not by the Node test suite.
