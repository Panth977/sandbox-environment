/**
 * Run the compiler off the main thread.
 *
 * In a worker script:
 * ```ts
 * import { startCompilerWorker } from "@panth977/sandbox/compiler";
 * startCompilerWorker();
 * ```
 * On the page:
 * ```ts
 * const w = compileInWorker(new Worker(new URL("./compiler.worker.js", import.meta.url), { type: "module" }));
 * const result = await w.compile(files, { jsx: "react" });
 * ```
 * Options with functions (cdn, loaders, plugins) cannot cross to a worker; set
 * them inside the worker with `startCompilerWorker(defaults)`.
 *
 * @module
 */
import { compile } from "./compile.ts";
import type { CompileOptions, CompileResult, SourceFiles } from "./compile.ts";

type SerializableOptions = Omit<CompileOptions, "cdn" | "typescript" | "svelte" | "plugins" | "provided">;

interface Req {
  id: number;
  files: SourceFiles;
  options?: SerializableOptions;
}

/** Inside a worker: answer compile requests. `defaults` may hold functions. */
export function startCompilerWorker(defaults: CompileOptions = {}): void {
  const scope = globalThis as unknown as { addEventListener(t: "message", f: (e: MessageEvent<Req>) => void): void; postMessage(m: unknown): void };
  scope.addEventListener("message", async (e) => {
    const { id, files, options } = e.data ?? ({} as Req);
    if (typeof id !== "number") return;
    let result: CompileResult;
    try {
      result = await compile(files, { ...defaults, ...options });
    } catch (err) {
      result = { ok: false, diagnostics: [{ message: String((err as Error)?.message ?? err), severity: "error", source: "transform" }], files: [] };
    }
    scope.postMessage({ id, result });
  });
}

export interface CompilerWorker {
  compile(files: SourceFiles, options?: SerializableOptions): Promise<CompileResult>;
  terminate(): void;
}

/** On the page: a promise API over a compiler worker. */
export function compileInWorker(worker: Worker): CompilerWorker {
  let next = 1;
  const pending = new Map<number, (r: CompileResult) => void>();
  worker.addEventListener("message", (e: MessageEvent<{ id: number; result: CompileResult }>) => {
    const p = pending.get(e.data?.id);
    if (p) {
      pending.delete(e.data.id);
      p(e.data.result);
    }
  });
  return {
    compile(files, options) {
      const id = next++;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        worker.postMessage({ id, files, options });
      });
    },
    terminate() {
      worker.terminate();
      for (const p of pending.values()) p({ ok: false, diagnostics: [{ message: "Compiler worker stopped", severity: "error", source: "transform" }], files: [] });
      pending.clear();
    },
  };
}
