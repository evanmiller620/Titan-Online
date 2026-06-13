import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The engine is consumed as TypeScript source via the workspace alias, so the
// browser bundle always runs the exact same rules code as the server.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@titan/engine": new URL("../engine/src/index.ts", import.meta.url).pathname },
  },
});
