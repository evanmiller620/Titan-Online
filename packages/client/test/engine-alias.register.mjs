// Register the resolve hook for the test process.
import { register } from "node:module";
register("./engine-alias.loader.mjs", import.meta.url);
