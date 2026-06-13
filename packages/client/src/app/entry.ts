/**
 * App entry (Titan client).
 *
 * The single script the page loads. It chooses ONE of two experiences at boot,
 * based on whether the Supabase env vars were present at BUILD time (Vite
 * inlines import.meta.env.*):
 *
 *   - both set  → the database-backed multiplayer client (room-code lobby).
 *   - unset     → the zero-config live Masterboard preview (no backend).
 *
 * This is the wiring DEPLOYMENT.md describes: set VITE_SUPABASE_URL and
 * VITE_SUPABASE_ANON_KEY in the host and rebuild to switch from preview to the
 * live table. Because the values are build-time, the choice is fixed per build.
 */

interface ViteEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
const env = ((import.meta as unknown as { env?: ViteEnv }).env ?? {}) as ViteEnv;

const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY;

if (url && key) {
  void import("./multiplayer.ts").then((m) => m.startMultiplayer(url, key));
} else {
  void import("./preview.ts").then((m) => m.renderPreview());
}
