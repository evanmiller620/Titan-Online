// Resolve the "@titan/engine" workspace alias to its TypeScript source for
// Node-run tests. In CI after `pnpm install` the package is symlinked in
// node_modules and this loader is a harmless no-op for it; locally (or without
// an install) it lets the action-builder test resolve the engine. Registered
// via package.json's test script: node --import ./test/engine-alias.register.mjs
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

const ENGINE_SRC = new URL("../../engine/src/index.ts", import.meta.url).href;

export function resolve(specifier, context, nextResolve) {
  if (specifier === "@titan/engine") {
    return { url: ENGINE_SRC, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
