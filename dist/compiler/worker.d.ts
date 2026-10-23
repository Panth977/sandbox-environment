import type { CompileOptions, CompileResult, SourceFiles } from "./compile.js";
type SerializableOptions = Omit<CompileOptions, "cdn" | "typescript" | "svelte" | "plugins" | "provided">;
/** Inside a worker: answer compile requests. `defaults` may hold functions. */
export declare function startCompilerWorker(defaults?: CompileOptions): void;
export interface CompilerWorker {
    compile(files: SourceFiles, options?: SerializableOptions): Promise<CompileResult>;
    terminate(): void;
}
/** On the page: a promise API over a compiler worker. */
export declare function compileInWorker(worker: Worker): CompilerWorker;
export {};
