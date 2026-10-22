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
export { compile, DEFAULT_VERSIONS, esmSh, extractBody, moduleKey, normalizePath, splitBare } from "./compile.ts";
export type { CompileOptions, CompileResult, Diagnostic, Plugin, PluginContext, SourceFiles, SvelteLike, TsLike } from "./compile.ts";
export { rewriteSpecifiers, scanSpecifiers } from "./lexer.ts";
export type { SpecifierRef } from "./lexer.ts";
export { compileInWorker, startCompilerWorker } from "./worker.ts";
export type { CompilerWorker } from "./worker.ts";
