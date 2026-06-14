/**
 * App entry (Titan client).
 *
 * Boots the waiting-room Menu. Players gather in a room and join each seat
 * locally (hot-seat) or — when Supabase is configured — over the network, then
 * the host starts the game. With no backend the local table always works.
 */

import { injectTokens } from "../ui/dom.ts";
import { tokensCss } from "../ui/tokens.ts";
import { Menu } from "./Menu.ts";

interface ViteEnv { readonly VITE_SUPABASE_URL?: string; readonly VITE_SUPABASE_ANON_KEY?: string }
const env = ((import.meta as unknown as { env?: ViteEnv }).env ?? {}) as ViteEnv;

injectTokens(tokensCss());
const root = document.getElementById("root");
if (!root) throw new Error("missing #root mount");

if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY) {
  void import("../net/supabase.ts").then(({ makeClient }) =>
    new Menu({ client: makeClient({ supabaseUrl: env.VITE_SUPABASE_URL!, supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY! }) }).mount(root),
  );
} else {
  new Menu().mount(root);
}
