/**
 * The development engine: a split view with the artifact's files and a typed
 * code editor on one side and the live preview (the same render engine
 * viewers get) on the other, plus problems and console panels.
 *
 * ```ts
 * import { mountDev } from "@panth977/sandbox/dev";
 * const dev = mountDev(document.getElementById("ide")!, {
 *   files: { "/index.tsx": "…", "/manifest.json": "{…}" },
 *   api: hostApi,                 // same as mount()
 *   hostTypes: hostApiDts,        // `declare module "@panth977/sandbox/artifact" { interface HostApi {…} }`
 *   onSave: (files) => store.save(files),
 * });
 * ```
 *
 * @module
 */
import { compile } from "../compiler/compile.ts";
import type { CompileOptions, CompileResult, Diagnostic, SourceFiles } from "../compiler/compile.ts";
import { mount } from "../host/mount.ts";
import type { ArtifactHandle, MountOptions } from "../host/mount.ts";
import { createEndpoint } from "../bridge.ts";
import type { Remote } from "../bridge.ts";
import type { LanguageService, LspDiagnostic } from "./language.ts";
import { installStyles, promptDialog, confirmDialog } from "../ui/index.ts";
import { SbxEditor } from "../editor/editor.ts";
import { languageOf } from "../editor/highlight.ts";
import { esc } from "../ui/base.ts";
import type { ConsoleEntry } from "../protocol.ts";

export interface DevOptions extends Omit<MountOptions, "artifact" | "size"> {
  files: SourceFiles;
  /** `.d.ts` text describing the host API for artifact authors. */
  hostTypes?: string;
  compile?: CompileOptions;
  /** URL of the language worker module (`dev/language-worker.js`), or false to turn type checking off. */
  languageWorker?: string | URL | false;
  /** ESM URL of TypeScript for the language worker. */
  typescriptUrl?: string;
  /** Code on the left (default) or right. */
  layout?: "code-left" | "code-right";
  /** Rebuild delay after typing, ms (default 400). */
  debounceMs?: number;
  readOnly?: boolean;
  /** File opened first. Default: the entry. */
  open?: string;
  onChange?(files: SourceFiles): void;
  onSave?(files: SourceFiles): void;
  onBuild?(result: CompileResult): void;
}

export interface DevHandle {
  files(): SourceFiles;
  setFile(path: string, text: string): void;
  openFile(path: string): void;
  build(): Promise<CompileResult>;
  /** The running preview. */
  readonly preview: ArtifactHandle<any> | null;
  setLayout(layout: "code-left" | "code-right"): void;
  destroy(): void;
}

const CSS = `
.sbx-dev { --dev-split: 50%; display: grid; grid-template-rows: auto 1fr auto; height: 100%; min-height: 420px; border: 1px solid var(--sbx-line);
  border-radius: var(--sbx-radius-lg); overflow: hidden; background: var(--sbx-surface); color: var(--sbx-text); font-family: var(--sbx-font); }
.sbx-dev__bar { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--sbx-line); background: var(--sbx-surface); min-width: 0; }
.sbx-dev__tabs { display: flex; gap: 2px; overflow-x: auto; flex: 1; min-width: 0; scrollbar-width: none; }
.sbx-dev__tab { all: unset; display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 10px; border-radius: var(--sbx-radius);
  font-size: 12.5px; color: var(--sbx-muted); cursor: pointer; white-space: nowrap; font-family: var(--sbx-font-mono); }
.sbx-dev__tab:hover { background: var(--sbx-surface-2); color: var(--sbx-text); }
.sbx-dev__tab[aria-selected="true"] { background: var(--sbx-accent-soft); color: var(--sbx-accent); }
.sbx-dev__tab .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--sbx-danger); }
.sbx-dev__status { font-size: 12px; color: var(--sbx-muted); white-space: nowrap; }
.sbx-dev__status.err { color: var(--sbx-danger); } .sbx-dev__status.ok { color: var(--sbx-success); }
.sbx-dev__main { display: grid; grid-template-columns: var(--dev-split) 6px 1fr; min-height: 0; }
.sbx-dev--right .sbx-dev__main { grid-template-columns: 1fr 6px var(--dev-split); }
.sbx-dev--right .sbx-dev__code { order: 3; } .sbx-dev--right .sbx-dev__split { order: 2; } .sbx-dev--right .sbx-dev__preview { order: 1; }
.sbx-dev__code { position: relative; min-width: 0; min-height: 0; }
.sbx-dev__code sbx-editor { position: absolute; inset: 0; height: auto; }
.sbx-dev__split { cursor: col-resize; background: var(--sbx-line); opacity: .6; }
.sbx-dev__split:hover, .sbx-dev__split.drag { background: var(--sbx-accent); opacity: 1; }
.sbx-dev__preview { position: relative; min-width: 0; min-height: 0; overflow: auto; background: var(--sbx-bg); }
.sbx-dev__preview > iframe { position: absolute; inset: 0; height: 100% !important; }
.sbx-dev__panel { border-top: 1px solid var(--sbx-line); max-height: 34%; display: flex; flex-direction: column; min-height: 0; }
.sbx-dev__panel[data-collapsed="true"] .sbx-dev__list { display: none; }
.sbx-dev__ptabs { display: flex; gap: 4px; padding: 4px 8px; align-items: center; }
.sbx-dev__ptabs button { all: unset; font-size: 12px; padding: 2px 8px; border-radius: 999px; cursor: pointer; color: var(--sbx-muted); }
.sbx-dev__ptabs button[aria-selected="true"] { background: var(--sbx-surface-2); color: var(--sbx-text); }
.sbx-dev__list { overflow: auto; font-family: var(--sbx-font-mono); font-size: 12px; padding: 0 0 6px; min-height: 60px; max-height: 180px; }
.sbx-dev__row { display: flex; gap: 8px; padding: 2px 12px; cursor: default; white-space: pre-wrap; }
.sbx-dev__row[data-file] { cursor: pointer; } .sbx-dev__row[data-file]:hover { background: var(--sbx-surface-2); }
.sbx-dev__row .sev { width: 14px; flex: none; } .sbx-dev__row.error .sev, .sbx-dev__row.error { color: var(--sbx-danger); }
.sbx-dev__row.warning .sev, .sbx-dev__row.warn { color: var(--sbx-warning); }
.sbx-dev__row .loc { color: var(--sbx-subtle); flex: none; }
.sbx-dev__empty { padding: 6px 12px; color: var(--sbx-subtle); font-size: 12px; }
`;

function installDevStyles() {
  if (document.getElementById("sbx-dev-css")) return;
  const s = document.createElement("style");
  s.id = "sbx-dev-css";
  s.textContent = CSS;
  document.head.append(s);
}

/** A module worker from any URL (cross-origin module URLs are wrapped in a same-origin blob worker). */
function moduleWorker(url: string | URL): Worker {
  const src = `import ${JSON.stringify(String(url))};`;
  return new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })), { type: "module" });
}

interface Problem {
  file?: string;
  line?: number;
  column?: number;
  message: string;
  severity: "error" | "warning" | "info";
  source: string;
}

/** Mounts the development engine into `container`. */
export function mountDev(container: HTMLElement, options: DevOptions): DevHandle {
  installStyles();
  installDevStyles();
  const files: SourceFiles = { ...options.files };
  const root = document.createElement("div");
  root.className = "sbx-dev" + (options.layout === "code-right" ? " sbx-dev--right" : "");
  root.innerHTML = `
    <div class="sbx-dev__bar">
      <div class="sbx-dev__tabs" role="tablist" aria-label="Files"></div>
      <button class="sbx-btn sbx-btn--ghost sbx-btn--sm" data-act="new" title="New file">＋</button>
      <span class="sbx-dev__status" aria-live="polite">…</span>
      <button class="sbx-btn sbx-btn--ghost sbx-btn--sm" data-act="swap" title="Swap sides">⇄</button>
      <button class="sbx-btn sbx-btn--sm" data-act="run" title="Rebuild (Ctrl/Cmd+Enter)">Run</button>
    </div>
    <div class="sbx-dev__main">
      <div class="sbx-dev__code"></div>
      <div class="sbx-dev__split" role="separator" aria-orientation="vertical" tabindex="0"></div>
      <div class="sbx-dev__preview"></div>
    </div>
    <div class="sbx-dev__panel">
      <div class="sbx-dev__ptabs"><button data-p="problems" aria-selected="true">Problems</button><button data-p="console" aria-selected="false">Console</button>
        <span class="sbx-spacer"></span><button data-p="clear">Clear</button><button data-p="toggle">▾</button></div>
      <div class="sbx-dev__list"></div>
    </div>`;
  container.append(root);
  const $ = <T extends Element>(sel: string) => root.querySelector(sel) as T;
  const editor = document.createElement("sbx-editor") as SbxEditor;
  editor.readOnly = !!options.readOnly;
  $(".sbx-dev__code").append(editor);
  const previewEl = $<HTMLElement>(".sbx-dev__preview");
  const status = $<HTMLElement>(".sbx-dev__status");
  const list = $<HTMLElement>(".sbx-dev__list");

  let current = "";
  let preview: ArtifactHandle<any> | null = null;
  let compileProblems: Problem[] = [];
  const tsProblems = new Map<string, Problem[]>();
  const tsRanges = new Map<string, LspDiagnostic[]>();
  let consoleRows: { level: string; text: string }[] = [];
  let panel: "problems" | "console" = "problems";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let buildSeq = 0;
  let destroyed = false;

  // ---- language service --------------------------------------------------
  let lsp: Remote<LanguageService> | null = null;
  let worker: Worker | null = null;
  let lspReady: Promise<void> = Promise.resolve();
  if (options.languageWorker !== false) {
    try {
      const url = options.languageWorker ?? new URL("./language-worker.js", import.meta.url);
      worker = moduleWorker(url);
      lsp = createEndpoint<LanguageService>(worker as unknown as Parameters<typeof createEndpoint>[0]).remote;
      const deps = () => {
        try {
          return JSON.parse(files["/manifest.json"] ?? "{}").dependencies ?? {};
        } catch {
          return {};
        }
      };
      lspReady = (async () => {
        await lsp!.init({ typescriptUrl: options.typescriptUrl });
        await lsp!.setHostTypes(options.hostTypes ?? "");
        await lsp!.setFiles(files, deps());
      })().catch((e) => {
        lsp = null;
        console.warn("[sandbox dev] type checking unavailable:", e);
      });
      editor.completions = async (pos) => {
        await lspReady;
        return lsp ? await lsp.completions(current, pos) : null;
      };
      editor.hover = async (pos) => {
        await lspReady;
        return lsp ? await lsp.quickInfo(current, pos) : null;
      };
    } catch (e) {
      console.warn("[sandbox dev] language worker failed to start:", e);
    }
  }

  async function checkTypes() {
    await lspReady;
    if (!lsp) return;
    const tsFiles = Object.keys(files).filter((p) => /\.(tsx?|jsx?)$/.test(p));
    await Promise.all(tsFiles.map(async (p) => {
      const ds = await lsp!.diagnostics(p).catch(() => []);
      tsRanges.set(p, ds);
      tsProblems.set(p, ds.map((d) => ({ file: p, line: d.line, column: d.column, message: d.message, severity: d.severity, source: "ts" })));
    }));
    for (const p of [...tsProblems.keys()]) if (!(p in files)) (tsProblems.delete(p), tsRanges.delete(p));
    syncEditorDiagnostics();
    renderTabs();
    renderPanel();
  }

  function syncEditorDiagnostics() {
    const text = files[current] ?? "";
    const offsetOf = (line?: number, col?: number) => {
      if (!line) return 0;
      let off = 0;
      const lines = text.split("\n");
      for (let i = 0; i < line - 1 && i < lines.length; i++) off += lines[i].length + 1;
      return off + Math.max(0, (col ?? 1) - 1);
    };
    const fromCompile = compileProblems.filter((p) => p.file === current && p.line).map((p) => {
      const from = offsetOf(p.line, p.column);
      return { from, to: from + 1, severity: p.severity, message: p.message };
    });
    editor.diagnostics = [...(tsRanges.get(current) ?? []), ...fromCompile];
  }

  // ---- files / tabs -------------------------------------------------------
  function renderTabs() {
    const tabs = $<HTMLElement>(".sbx-dev__tabs");
    const paths = Object.keys(files).sort((a, b) => (a === "/manifest.json" ? 1 : b === "/manifest.json" ? -1 : a.localeCompare(b)));
    tabs.innerHTML = paths.map((p) => {
      const bad = [...compileProblems, ...(tsProblems.get(p) ?? [])].some((x) => x.file === p && x.severity === "error");
      return `<button class="sbx-dev__tab" role="tab" data-path="${esc(p)}" aria-selected="${p === current}">${esc(p.slice(1))}${bad ? '<span class="dot"></span>' : ""}</button>`;
    }).join("");
  }

  function openFile(path: string) {
    if (!(path in files)) return;
    current = path;
    editor.path = path;
    editor.value = files[path];
    syncEditorDiagnostics();
    renderTabs();
  }

  function setFile(path: string, text: string) {
    files[path] = text;
    if (path === current && editor.value !== text) editor.value = text;
    void lsp?.setFile(path, text).catch(() => {});
    options.onChange?.({ ...files });
    schedule();
  }

  // ---- build --------------------------------------------------------------
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void build(), options.debounceMs ?? 400);
  }

  async function build(): Promise<CompileResult> {
    const my = ++buildSeq;
    status.className = "sbx-dev__status";
    status.textContent = "Building…";
    const t0 = performance.now();
    const result = await compile(files, options.compile);
    if (destroyed || my !== buildSeq) return result;
    compileProblems = result.diagnostics.map((d: Diagnostic) => ({ ...d, severity: d.severity }));
    const ms = Math.round(performance.now() - t0);
    if (result.ok && result.artifact) {
      status.className = "sbx-dev__status ok";
      status.textContent = `Built in ${ms} ms`;
      consoleRows = [];
      const mountOpts: MountOptions = {
        ...options,
        artifact: result.artifact,
        size: "fill",
        onConsole: (e: ConsoleEntry) => {
          consoleRows.push({ level: e.level, text: e.args.join(" ") });
          if (consoleRows.length > 500) consoleRows.shift();
          if (panel === "console") renderPanel();
          options.onConsole?.(e);
        },
        onError: (e) => {
          consoleRows.push({ level: "error", text: e.message + (e.line ? ` (line ${e.line})` : "") });
          renderPanel();
          options.onError?.(e);
        },
      };
      if (preview) preview.reload(result.artifact);
      else preview = mount(previewEl, mountOpts);
    } else {
      status.className = "sbx-dev__status err";
      const n = result.diagnostics.filter((d) => d.severity === "error").length;
      status.textContent = `${n} error${n === 1 ? "" : "s"}`;
      panel = "problems";
    }
    syncEditorDiagnostics();
    renderTabs();
    renderPanel();
    options.onBuild?.(result);
    void checkTypes();
    return result;
  }

  // ---- panel --------------------------------------------------------------
  function renderPanel() {
    for (const b of root.querySelectorAll<HTMLElement>(".sbx-dev__ptabs button[data-p]")) {
      if (b.dataset.p === "problems" || b.dataset.p === "console") b.setAttribute("aria-selected", String(b.dataset.p === panel));
    }
    const problems = [...compileProblems, ...[...tsProblems.values()].flat()];
    const pb = root.querySelector<HTMLElement>('[data-p="problems"]')!;
    pb.textContent = `Problems${problems.length ? ` (${problems.length})` : ""}`;
    const cb = root.querySelector<HTMLElement>('[data-p="console"]')!;
    cb.textContent = `Console${consoleRows.length ? ` (${consoleRows.length})` : ""}`;
    if (panel === "problems") {
      list.innerHTML = problems.length
        ? problems.map((p) =>
          `<div class="sbx-dev__row ${p.severity}"${p.file ? ` data-file="${esc(p.file)}" data-line="${p.line ?? 1}" data-col="${p.column ?? 1}"` : ""}>` +
          `<span class="sev">${p.severity === "error" ? "✖" : p.severity === "warning" ? "▲" : "•"}</span>` +
          `<span class="loc">${esc(p.file ? `${p.file.slice(1)}${p.line ? `:${p.line}:${p.column ?? 1}` : ""}` : p.source)}</span><span>${esc(p.message)}</span></div>`
        ).join("")
        : `<div class="sbx-dev__empty">No problems</div>`;
    } else {
      list.innerHTML = consoleRows.length
        ? consoleRows.map((r) => `<div class="sbx-dev__row ${r.level === "error" ? "error" : r.level === "warn" ? "warn" : ""}"><span class="sev">${r.level === "error" ? "✖" : r.level === "warn" ? "▲" : "›"}</span><span>${esc(r.text)}</span></div>`).join("")
        : `<div class="sbx-dev__empty">Nothing logged</div>`;
      list.scrollTop = list.scrollHeight;
    }
  }

  // ---- events -------------------------------------------------------------
  editor.addEventListener("change", () => setFile(current, editor.value));
  editor.addEventListener("save", () => options.onSave?.({ ...files }));
  editor.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void build();
    }
  });
  root.querySelector(".sbx-dev__tabs")!.addEventListener("click", (e) => {
    const t = (e.target as Element).closest<HTMLElement>("[data-path]");
    if (t) openFile(t.dataset.path!);
  });
  root.querySelector(".sbx-dev__tabs")!.addEventListener("dblclick", async (e) => {
    const t = (e.target as Element).closest<HTMLElement>("[data-path]");
    if (!t || options.readOnly) return;
    const from = t.dataset.path!;
    const to = await promptDialog("Rename file (empty to delete)", { value: from.slice(1), heading: "Rename" });
    if (to === null) return;
    if (!to.trim()) {
      if (Object.keys(files).length > 1 && await confirmDialog(`Delete ${from.slice(1)}?`, { danger: true, confirmLabel: "Delete" })) {
        delete files[from];
        void lsp?.setFiles(files).catch(() => {});
        openFile(Object.keys(files)[0]);
        options.onChange?.({ ...files });
        schedule();
      }
      return;
    }
    const target = "/" + to.trim().replace(/^\/+/, "");
    if (target === from || target in files) return;
    files[target] = files[from];
    delete files[from];
    void lsp?.setFiles(files).catch(() => {});
    openFile(target);
    options.onChange?.({ ...files });
    schedule();
  });
  root.querySelector(".sbx-dev__bar")!.addEventListener("click", async (e) => {
    const act = (e.target as Element).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "run") void build();
    if (act === "swap") handle.setLayout(root.classList.contains("sbx-dev--right") ? "code-left" : "code-right");
    if (act === "new" && !options.readOnly) {
      const name = await promptDialog("New file name", { placeholder: "components/Chart.tsx", heading: "New file" });
      if (!name?.trim()) return;
      const p = "/" + name.trim().replace(/^\/+/, "");
      if (!(p in files)) setFile(p, languageOf(p) === "json" ? "{}\n" : "");
      openFile(p);
    }
  });
  root.querySelector(".sbx-dev__ptabs")!.addEventListener("click", (e) => {
    const p = (e.target as Element).closest<HTMLElement>("[data-p]")?.dataset.p;
    if (p === "problems" || p === "console") panel = p;
    if (p === "clear") consoleRows = [];
    if (p === "toggle") {
      const pn = root.querySelector<HTMLElement>(".sbx-dev__panel")!;
      pn.dataset.collapsed = String(pn.dataset.collapsed !== "true");
    }
    renderPanel();
  });
  list.addEventListener("click", (e) => {
    const row = (e.target as Element).closest<HTMLElement>("[data-file]");
    if (!row) return;
    openFile(row.dataset.file!);
    editor.goTo(Number(row.dataset.line), Number(row.dataset.col));
  });
  // splitter
  const split = $<HTMLElement>(".sbx-dev__split");
  split.addEventListener("pointerdown", (e) => {
    split.setPointerCapture(e.pointerId);
    split.classList.add("drag");
    const main = $<HTMLElement>(".sbx-dev__main").getBoundingClientRect();
    previewEl.style.pointerEvents = "none";
    const move = (ev: PointerEvent) => {
      let frac = (ev.clientX - main.left) / main.width;
      if (root.classList.contains("sbx-dev--right")) frac = 1 - frac;
      root.style.setProperty("--dev-split", `${Math.round(Math.min(0.85, Math.max(0.15, frac)) * 1000) / 10}%`);
    };
    const up = () => {
      split.classList.remove("drag");
      previewEl.style.pointerEvents = "";
      split.removeEventListener("pointermove", move);
      split.removeEventListener("pointerup", up);
    };
    split.addEventListener("pointermove", move);
    split.addEventListener("pointerup", up);
  });

  const handle: DevHandle = {
    files: () => ({ ...files }),
    setFile,
    openFile,
    build,
    get preview() {
      return preview;
    },
    setLayout(layout) {
      root.classList.toggle("sbx-dev--right", layout === "code-right");
    },
    destroy() {
      destroyed = true;
      if (timer) clearTimeout(timer);
      preview?.destroy();
      worker?.terminate();
      root.remove();
    },
  };

  const first = options.open ?? ["/index.tsx", "/index.ts", "/index.jsx", "/index.js", "/App.svelte"].find((p) => p in files) ?? Object.keys(files)[0];
  if (first) openFile(first);
  renderPanel();
  void build();
  return handle;
}

export { createLanguageService, startLanguageWorker, UI_ELEMENT_TYPES } from "./language.ts";
export type { LanguageInit, LanguageService, LspDiagnostic } from "./language.ts";
