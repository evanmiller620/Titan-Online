/**
 * App entry (Titan client).
 *
 * One debug-first client. By default it boots a LOCAL hot-seat game — the pure
 * engine runs in the browser, every seat is drivable from this screen, and no
 * backend is needed, so it always works. If the Supabase env vars were set at
 * build time, it instead opens the networked lobby (create/join a table) and
 * runs the same UI over the server.
 */

import { bootLocal, bootRemoteLobby } from "./debugClient.ts";

interface ViteEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
const env = ((import.meta as unknown as { env?: ViteEnv }).env ?? {}) as ViteEnv;

if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY) {
  void import("../net/supabase.ts").then(({ makeClient }) =>
    bootRemoteLobby(makeClient({ supabaseUrl: env.VITE_SUPABASE_URL!, supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY! })),
  );
} else {
  bootLocal(2);
}
