/**
 * Design tokens (Titan client).
 *
 * Aesthetic direction — grounded in the subject, not a default. Titan is a
 * 1980 fantasy wargame of monstrous legions on a brass-and-vellum wheel-board,
 * where the core tension is the HIDDEN stack: you see a banner, never what is
 * under it until steel is drawn. The visual identity is therefore heraldic and
 * cartographic: aged vellum fields, oxblood banners, verdigris bronze fittings,
 * iron-gall ink. Hidden legions read as wax-sealed markers you cannot see into.
 *
 * This is deliberately NOT the cream/serif/terracotta nor the black/acid-green
 * AI defaults: the palette is a map drawn in the game's own world.
 */

export const palette = {
  vellum: "#E8DFC8", // aged parchment field
  vellumDeep: "#D8CBA8", // shadowed parchment / panel fill
  ink: "#1C1A17", // iron-gall text
  inkSoft: "#4A453C", // secondary text
  oxblood: "#6B2737", // the Titan's banner; primary accent
  oxbloodBright: "#8E3247", // hover/active banner
  verdigris: "#5E7A6B", // aged bronze; secondary accent
  brass: "#B08D57", // fittings, dividers, the wheel's rim
  brassBright: "#CBA86B",
  parchmentEdge: "#C4B488", // hairline rules
  alarm: "#A8431F", // errors / time-loss — burnt sienna, not generic red
  seal: "#5A1D29", // wax-seal marker for hidden stacks
} as const;

/** Per-terrain map tints for the eleven battlelands / masterboard lands.
 *  Echoes the 1980 board's terrain key (yellow plains, red mountains, white
 *  tundra/towers) while staying within the brass-and-vellum palette. */
export const terrainColor: Record<string, string> = {
  Plains: "#E0CF93", // pale gold
  Woods: "#7E9456", // forest green
  Brush: "#B7B25C", // olive
  Jungle: "#4F7A3E", // deep green
  Desert: "#E0B36A", // sand
  Hills: "#C79A5A", // tan-brown
  Mountains: "#A85B47", // brick red
  Swamp: "#5E86A0", // blue-grey water
  Marsh: "#8A8560", // muddy tan
  Tundra: "#D6DDDA", // pale ice
  Tower: "#E7DDC2", // vellum white
};

export const type = {
  /** Display: engraved, heraldic — used with restraint on titles & legions. */
  display: '"Cinzel", "Trajan Pro", Georgia, serif',
  /** Body / HUD: humanist sans for legibility at small sizes. */
  body: '"Inter", "Segoe UI", system-ui, sans-serif',
  /** Data: dice, coordinates, scores — tabular mono. */
  mono: '"IBM Plex Mono", "SFMono-Regular", ui-monospace, monospace',
  scale: {
    xs: "11px",
    sm: "13px",
    base: "15px",
    lg: "19px",
    xl: "26px",
    display: "40px",
  },
} as const;

export const space = {
  xs: "4px",
  sm: "8px",
  md: "16px",
  lg: "24px",
  xl: "40px",
} as const;

/** Corner radii — consistent, slightly soft, never pill-by-accident. */
export const radius = {
  sm: "4px",
  md: "6px",
  lg: "10px",
  pill: "999px",
} as const;

/** Elevation — layered shadows tuned for the dark chrome (warm, not flat black). */
export const elevation = {
  sm: "0 1px 2px rgba(0,0,0,0.35)",
  md: "0 6px 18px rgba(0,0,0,0.40)",
  lg: "0 18px 50px rgba(0,0,0,0.55)",
} as const;

/** Emit the tokens as a :root CSS custom-property block (injected once). */
export function tokensCss(): string {
  const vars: string[] = [];
  for (const [k, v] of Object.entries(palette)) vars.push(`  --c-${kebab(k)}: ${v};`);
  vars.push(`  --font-display: ${type.display};`);
  vars.push(`  --font-body: ${type.body};`);
  vars.push(`  --font-mono: ${type.mono};`);
  for (const [k, v] of Object.entries(type.scale)) vars.push(`  --fs-${k}: ${v};`);
  for (const [k, v] of Object.entries(space)) vars.push(`  --sp-${k}: ${v};`);
  for (const [k, v] of Object.entries(radius)) vars.push(`  --radius-${k}: ${v};`);
  for (const [k, v] of Object.entries(elevation)) vars.push(`  --shadow-${k}: ${v};`);
  return `:root {\n${vars.join("\n")}\n}`;
}

function kebab(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}
