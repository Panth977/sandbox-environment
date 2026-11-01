/**
 * Compile artifact sources in the browser, a worker, Node or Deno.
 *
 * ```ts
 * import { compile } from "@panth977/sandbox/compiler";
 * const { ok, artifact, diagnostics } = await compile({
 *   "/index.tsx": `import { host } from "@panth977/sandbox/artifact"; …`,
 *   "/manifest.json": `{ "name": "Allocator", "dependencies": { "react": "19" } }`,
 * });
 * ```
 *
 * @module
 */
export { compile, DEFAULT_VERSIONS, esmSh, extractBody, moduleKey, normalizePath, splitBare } from "./compile.js";
export type { CompileOptions, CompileResult, Diagnostic, Plugin, PluginContext, SourceFiles, SvelteLike, TsLike } from "./compile.js";
export { rewriteSpecifiers, scanSpecifiers } from "./lexer.js";
export type { SpecifierRef } from "./lexer.js";
export { compileInWorker, startCompilerWorker } from "./worker.js";
export type { CompilerWorker } from "./worker.js";
