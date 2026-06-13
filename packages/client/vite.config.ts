import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/**
 * Vite config for the Titan client.
 *
 * - `base` is read from VITE_BASE so the same build works on a root-served host
 *   (Vercel, Netlify, custom domain → "/") and on a GitHub Pages project site
 *   (served under "/<repo>/"). Defaults to "/".
 * - `@titan/engine` is aliased to its TypeScript SOURCE so the browser bundle
 *   runs the exact same rules code as the server, with no separate build step.
 */
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@titan/engine": fileURLToPath(new URL("../engine/src/index.ts", import.meta.url)),
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
