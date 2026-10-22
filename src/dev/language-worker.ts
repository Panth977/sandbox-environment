/**
 * Worker entry for the dev engine's TypeScript language service.
 * `new Worker(new URL("./language-worker.js", import.meta.url), { type: "module" })`
 *
 * @module
 */
import { startLanguageWorker } from "./language.ts";

startLanguageWorker();
