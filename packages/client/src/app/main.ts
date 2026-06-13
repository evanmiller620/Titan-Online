/**
 * Entry point (Titan client).
 *
 * Boots the client: injects the design tokens as CSS variables, reads Supabase
 * config from the Vite env, and mounts the React tree. The App component wires
 * the four decoupled layers via useGame(): the board mount, the store, the net
 * subscription, and the HUD command bar.
 *
 * Kept import-light so it type-checks against the shims; on a connected
 * machine the real react-dom renders the JSX App.
 */

import { createRoot } from "react-dom/client";
import { makeClient } from "../net/supabase.ts";
import { tokensCss } from "../ui/tokens.ts";
import "./global.css";

/** Vite injects import.meta.env; declared narrowly so it type-checks offline. */
interface ViteEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
const env = ((import.meta as unknown as { env?: ViteEnv }).env ?? {}) as ViteEnv;

/** Inject the token :root block once. */
function injectTokens(): void {
  const style = document.createElement("style");
  style.textContent = tokensCss();
  document.head.appendChild(style);
}

export function boot(): void {
  injectTokens();

  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  const root = document.getElementById("root");
  if (!root) throw new Error("missing #root mount");

  if (!url || !key) {
    // Failure is direction, not mood: tell the operator exactly what to set.
    root.innerHTML =
      '<div class="titan-empty"><h1>Titan</h1>' +
      "<p>Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then reload to reach the table.</p></div>";
    return;
  }

  const client = makeClient({ supabaseUrl: url, supabaseAnonKey: key });
  // The App component (App.tsx) consumes `client` and renders the shell:
  //   <div class="titan-shell">
  //     <div class="titan-board" ref={mountRef} />   ← Pixi canvas mounts here
  //     <div class="titan-hud"><Hud …/></div>
  //   </div>
  // useGame(mountRef) owns the board + subscription + strict-wait submit.
  createRoot(root).render(renderApp(client));
}

/** Placeholder app node; App.tsx provides the real JSX tree in a full build. */
function renderApp(client: ReturnType<typeof makeClient>): unknown {
  return { app: "TitanApp", client };
}

boot();
