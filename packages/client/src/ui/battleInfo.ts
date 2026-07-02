/**
 * Battle terrain key (Titan client, ui) — the rules effect of each in-hex
 * hazard and hexside feature, for the in-battle legend. Colours mirror the
 * BattlelandRenderer's tints so the swatches match the board.
 */

/** In-hex hazard key: swatch colour + the rules effect (Hazard Chart). */
export const HAZARD_INFO: Record<string, { color: string; effect: string }> = {
  Brambles: { color: "#6F7A37", effect: "non-natives stop on entry · +1 to hit a native here" },
  Sand: { color: "#E2C079", effect: "slows non-native entry" },
  Bog: { color: "#4C4733", effect: "only natives may enter" },
  Drift: { color: "#CBD9DF", effect: "slows non-natives · like bramble for strikes" },
  Tree: { color: "#2F4A2A", effect: "impassable · blocks line of sight" },
  Volcano: { color: "#9A3A22", effect: "impassable · a Dragon striking out adds 2 dice" },
  Tower: { color: "#8C8273", effect: "walled keep · defender deploys inside" },
  Lake: { color: "#3E6B86", effect: "water" },
  Stone: { color: "#7C7568", effect: "bare rock" },
};

/** Hexside feature key: swatch colour, name + the rules effect. */
export const BORDER_INFO: Record<string, { color: string; name: string; effect: string }> = {
  w: { color: "#B08D57", name: "Wall", effect: "blocks non-flyers · +1 skill striking down across it" },
  c: { color: "#15120F", name: "Cliff", effect: "blocks movement across this edge" },
  s: { color: "#5E7A6B", name: "Slope", effect: "native +1 die down · non-native −1 skill up" },
  d: { color: "#CBA86B", name: "Dune", effect: "native +2 dice down · non-native −1 die across" },
  r: { color: "#4E86A6", name: "River", effect: "slows non-flying non-natives" },
};
