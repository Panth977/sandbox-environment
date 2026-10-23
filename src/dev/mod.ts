/**
 * The development engine: an IDE for one artifact, in any page.
 *
 *   ┌ toolbar: ☰ · open files (closable) ···························· status · ⇄ · Run ┐
 *   │ FILES (tree) │ editor (TypeScript errors, completions, find)  │ live preview      │
 *   │              │                                                 │ (the same sandbox │
 *   │              │                                                 │  viewers get)     │
 *   ├ Problems · Console ─────────────────────────────────────────────────────────────┤
 *   └ Ln 4, Col 12 · TypeScript · ✖ 0 ▲ 1 · Built in 13 ms ───────────────────────────┘
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
import { confirmDialog, installStyles } from "../ui/index.ts";
import { SbxEditor } from "../editor/editor.ts";
import { languageOf } from "../editor/highlight.ts";
import { esc } from "../ui/base.ts";
import type { ConsoleEntry } from "../protocol.ts";
import { createTree, parentOf, TREE_CSS } from "./tree.ts";

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
  /** Show the file explorer (default: true when the dev engine is wider than 720 px). */
  explorer?: boolean;
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
  /** Show or hide the file explorer. */
  setExplorer(show: boolean): void;
  destroy(): void;
}

const CSS = `
.sbx-dev { --dev-tree: 210px; --dev-preview: 44%; display: grid; grid-template-rows: auto minmax(0, 1fr) auto auto; height: 100%; min-height: 420px;
  border: 1px solid var(--sbx-line); border-radius: var(--sbx-radius-lg); overflow: hidden; background: var(--sbx-surface); color: var(--sbx-text);
  font-family: var(--sbx-font); font-size: 13px; }
.sbx-dev button { font-family: inherit; }
.sbx-dev__bar { display: flex; align-items: stretch; gap: 4px; height: 36px; padding: 0 6px 0 0; border-bottom: 1px solid var(--sbx-line); background: var(--sbx-surface-2); min-width: 0; }
.sbx-dev__icon { all: unset; display: inline-grid; place-items: center; width: 30px; height: 30px; margin: 3px 0; border-radius: var(--sbx-radius); cursor: pointer; color: var(--sbx-muted); font-size: 14px; }
.sbx-dev__icon:hover { background: var(--sbx-surface-3); color: var(--sbx-text); }
.sbx-dev__icon[aria-pressed="true"] { color: var(--sbx-accent); }
.sbx-dev__tabs { display: flex; align-items: stretch; overflow-x: auto; flex: 1; min-width: 0; scrollbar-width: thin; }
.sbx-dev__tab { display: inline-flex; align-items: center; gap: 6px; padding: 0 6px 0 12px; border-right: 1px solid var(--sbx-line); color: var(--sbx-muted);
  cursor: pointer; white-space: nowrap; font-size: 12.5px; background: transparent; position: relative; }
.sbx-dev__tab:hover { color: var(--sbx-text); }
.sbx-dev__tab[aria-selected="true"] { background: var(--sbx-surface); color: var(--sbx-text); }
.sbx-dev__tab[aria-selected="true"]::after { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 2px; background: var(--sbx-accent); }
.sbx-dev__tab .sbx-tree__icon { width: auto; min-width: 14px; }
.sbx-dev__tab .x { all: unset; display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 4px; color: var(--sbx-subtle); font-size: 11px; visibility: hidden; }
.sbx-dev__tab:hover .x, .sbx-dev__tab[aria-selected="true"] .x { visibility: visible; }
.sbx-dev__tab .x:hover { background: var(--sbx-surface-3); color: var(--sbx-text); }
.sbx-dev__tab .err { width: 6px; height: 6px; border-radius: 50%; background: var(--sbx-danger); }
.sbx-dev__msg { align-self: center; font-size: 12px; color: var(--sbx-muted); white-space: nowrap; padding: 0 6px; }
.sbx-dev__msg.err { color: var(--sbx-danger); } .sbx-dev__msg.ok { color: var(--sbx-success); }
.sbx-dev__run { align-self: center; }
.sbx-dev__main { display: grid; grid-template-columns: var(--dev-tree) 4px minmax(0, 1fr) 5px var(--dev-preview); min-height: 0; }
.sbx-dev--no-tree .sbx-dev__main { grid-template-columns: 0 0 minmax(0, 1fr) 5px var(--dev-preview); }
.sbx-dev--no-tree .sbx-dev__tree, .sbx-dev--no-tree .sbx-dev__split--tree { visibility: hidden; }
.sbx-dev--right .sbx-dev__main { grid-template-columns: var(--dev-preview) 5px minmax(0, 1fr) 4px var(--dev-tree); }
.sbx-dev--right.sbx-dev--no-tree .sbx-dev__main { grid-template-columns: var(--dev-preview) 5px minmax(0, 1fr) 0 0; }
.sbx-dev--right .sbx-dev__preview { order: 1; } .sbx-dev--right .sbx-dev__split--preview { order: 2; } .sbx-dev--right .sbx-dev__code { order: 3; }
.sbx-dev--right .sbx-dev__split--tree { order: 4; } .sbx-dev--right .sbx-dev__tree { order: 5; border-left: 1px solid var(--sbx-line); border-right: 0; }
.sbx-dev__tree { min-height: 0; overflow: hidden; }
.sbx-dev__code { position: relative; min-width: 0; min-height: 0; background: var(--sbx-surface); }
.sbx-dev__code sbx-editor { position: absolute; inset: 0; height: auto; }
.sbx-dev__empty-editor { position: absolute; inset: 0; display: grid; place-items: center; color: var(--sbx-subtle); font-size: 12.5px; }
.sbx-dev__split { cursor: col-resize; background: var(--sbx-line); }
.sbx-dev__split:hover, .sbx-dev__split.drag { background: var(--sbx-accent); }
.sbx-dev__preview { position: relative; min-width: 0; min-height: 0; overflow: auto; background: var(--sbx-bg); }
.sbx-dev__preview > iframe { position: absolute; inset: 0; height: 100% !important; }
.sbx-dev__panel { border-top: 1px solid var(--sbx-line); display: flex; flex-direction: column; min-height: 0; }
.sbx-dev__panel[data-collapsed="true"] .sbx-dev__list { display: none; }
.sbx-dev__ptabs { display: flex; gap: 4px; padding: 3px 8px; align-items: center; }
.sbx-dev__ptabs button { all: unset; font-size: 12px; padding: 2px 8px; border-radius: 999px; cursor: pointer; color: var(--sbx-muted); }
.sbx-dev__ptabs button[aria-selected="true"] { background: var(--sbx-surface-2); color: var(--sbx-text); }
.sbx-dev__list { overflow: auto; font-family: var(--sbx-font-mono); font-size: 12px; padding: 0 0 6px; height: 120px; }
.sbx-dev__row { display: flex; gap: 8px; padding: 2px 12px; cursor: default; white-space: pre-wrap; }
.sbx-dev__row[data-file] { cursor: pointer; } .sbx-dev__row[data-file]:hover { background: var(--sbx-surface-2); }
.sbx-dev__row .sev { width: 14px; flex: none; } .sbx-dev__row.error .sev, .sbx-dev__row.error { color: var(--sbx-danger); }
.sbx-dev__row.warning .sev, .sbx-dev__row.warn { color: var(--sbx-warning); }
.sbx-dev__row .loc { color: var(--sbx-subtle); flex: none; }
.sbx-dev__none { padding: 6px 12px; color: var(--sbx-subtle); font-size: 12px; }
.sbx-dev__status { display: flex; align-items: center; gap: 14px; height: 24px; padding: 0 10px; border-top: 1px solid var(--sbx-line);
  background: var(--sbx-surface-2); color: var(--sbx-muted); font-size: 11.5px; white-space: nowrap; overflow: hidden; }
.sbx-dev__status button { all: unset; cursor: pointer; } .sbx-dev__status button:hover { color: var(--sbx-text); }
.sbx-dev__status .e { color: var(--sbx-danger); } .sbx-dev__status .w { color: var(--sbx-warning); }
.sbx-dev__status .spacer { flex: 1; }
` + TREE_CSS;

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

const LANGUAGE_NAMES: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript JSX", js: "JavaScript", jsx: "JavaScript JSX", css: "CSS", json: "JSON",
  html: "HTML", svelte: "Svelte", md: "Markdown", text: "Plain text",
};

/** What a new file starts with. */
function starter(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
  const comp = name.replace(/(^|[-_\s])(\w)/g, (_m, _a, c: string) => c.toUpperCase());
  switch (languageOf(path)) {
    case "tsx":
    case "jsx":
      return `export function ${comp || "Component"}() {\n  return <div></div>;\n}\n`;
    case "svelte":
      return `<script lang="ts">\n</script>\n\n<div></div>\n`;
    case "json":
      return "{}\n";
    case "css":
      return "";
    default:
      return "";
  }
}

const kindIcon = (path: string) => {
  const ext = path.slice(path.lastIndexOf(".") + 1);
  const map: Record<string, [string, string]> = {
    ts: ["TS", "#3178c6"], tsx: ["TSX", "#3178c6"], js: ["JS", "#c9a400"], jsx: ["JSX", "#c9a400"], svelte: ["S", "#ff3e00"],
    css: ["#", "#7c4dff"], json: ["{}", "#8a8a8a"], html: ["<>", "#e34c26"], md: ["M↓", "#6b6560"],
  };
  const [l, c] = map[ext] ?? ["·", "#8a8a8a"];
  return `<span class="sbx-tree__icon" style="color:${c}">${esc(l)}</span>`;
};

/** Mounts the development engine into `container`. */
export function mountDev(container: HTMLElement, options: DevOptions): DevHandle {
  installStyles();
  installDevStyles();
  const files: SourceFiles = { ...options.files };
  /** Empty folders made in the explorer (folders with files come from the paths). */
  const folders = new Set<string>();
  const root = document.createElement("div");
  root.className = "sbx-dev" + (options.layout === "code-right" ? " sbx-dev--right" : "");
  root.innerHTML = `
    <div class="sbx-dev__bar">
      <button class="sbx-dev__icon" data-act="explorer" title="Show / hide files" aria-pressed="true">☰</button>
      <div class="sbx-dev__tabs" role="tablist" aria-label="Open files"></div>
      <span class="sbx-dev__msg" aria-live="polite">…</span>
      <button class="sbx-dev__icon" data-act="swap" title="Swap editor and preview">⇄</button>
      <button class="sbx-btn sbx-btn--sm sbx-dev__run" data-act="run" title="Rebuild (Ctrl/Cmd+Enter)">▶ Run</button>
    </div>
    <div class="sbx-dev__main">
      <div class="sbx-dev__tree"></div>
      <div class="sbx-dev__split sbx-dev__split--tree" role="separator" aria-orientation="vertical"></div>
      <div class="sbx-dev__code"><div class="sbx-dev__empty-editor" hidden>Open a file from the explorer</div></div>
      <div class="sbx-dev__split sbx-dev__split--preview" role="separator" aria-orientation="vertical"></div>
      <div class="sbx-dev__preview"></div>
    </div>
    <div class="sbx-dev__panel">
      <div class="sbx-dev__ptabs"><button data-p="problems" aria-selected="true">Problems</button><button data-p="console" aria-selected="false">Console</button>
        <span class="sbx-spacer"></span><button data-p="clear">Clear</button><button data-p="toggle" title="Show / hide">▾</button></div>
      <div class="sbx-dev__list"></div>
    </div>
    <div class="sbx-dev__status">
      <button data-s="pos" title="Cursor">Ln 1, Col 1</button><span data-s="lang"></span>
      <button data-s="problems" title="Problems"><span class="e">✖ 0</span> <span class="w">▲ 0</span></button>
      <span data-s="types" title="Type checking and completions"></span>
      <span class="spacer"></span><span data-s="build"></span>
    </div>`;
  container.append(root);
  const $ = <T extends Element>(sel: string) => root.querySelector(sel) as T;
  const editor = document.createElement("sbx-editor") as SbxEditor;
  editor.readOnly = !!options.readOnly;
  $(".sbx-dev__code").append(editor);
  const emptyEditor = $<HTMLElement>(".sbx-dev__empty-editor");
  const previewEl = $<HTMLElement>(".sbx-dev__preview");
  const msg = $<HTMLElement>(".sbx-dev__msg");
  const list = $<HTMLElement>(".sbx-dev__list");

  let current = "";
  let openTabs: string[] = [];
  let preview: ArtifactHandle<any> | null = null;
  let compileProblems: Problem[] = [];
  const tsProblems = new Map<string, Problem[]>();
  const tsRanges = new Map<string, LspDiagnostic[]>();
  let consoleRows: { level: string; text: string }[] = [];
  let panel: "problems" | "console" = "problems";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let buildSeq = 0;
  let destroyed = false;

  // ---- explorer --------------------------------------------------------------
  const tree = createTree($(".sbx-dev__tree"), {
    open: (p) => openFile(p),
    createFile(p) {
      setFile(p, starter(p));
      openFile(p);
    },
    createFolder(p) {
      folders.add(p);
      renderTree();
    },
    rename(from, to, folder) {
      const moves: [string, string][] = folder
        ? Object.keys(files).filter((f) => f.startsWith(from + "/")).map((f) => [f, to + f.slice(from.length)])
        : [[from, to]];
      for (const [a, b] of moves) {
        files[b] = files[a]!;
        delete files[a];
      }
      if (folder) {
        for (const f of [...folders]) if (f === from || f.startsWith(from + "/")) (folders.delete(f), folders.add(to + f.slice(from.length)));
      }
      const map = new Map(moves);
      openTabs = openTabs.map((t) => map.get(t) ?? t);
      if (map.has(current)) current = map.get(current)!;
      filesChanged();
      openFile(current);
    },
    async remove(path, folder) {
      const victims = folder ? Object.keys(files).filter((f) => f.startsWith(path + "/")) : [path];
      const label = path.slice(1) + (folder ? `/ and its ${victims.length} file${victims.length === 1 ? "" : "s"}` : "");
      if (!(await confirmDialog(`Delete ${label}?`, { heading: "Delete", confirmLabel: "Delete", danger: true }))) return;
      for (const v of victims) delete files[v];
      if (folder) for (const f of [...folders]) if (f === path || f.startsWith(path + "/")) folders.delete(f);
      openTabs = openTabs.filter((t) => t in files);
      if (!(current in files)) current = openTabs[openTabs.length - 1] ?? Object.keys(files)[0] ?? "";
      filesChanged();
      openFile(current);
    },
  });

  function marks(): Record<string, "error" | "warning"> {
    const out: Record<string, "error" | "warning"> = {};
    for (const p of [...compileProblems, ...[...tsProblems.values()].flat()]) {
      if (!p.file) continue;
      if (p.severity === "error") out[p.file] = "error";
      else if (p.severity === "warning" && !out[p.file]) out[p.file] = "warning";
    }
    return out;
  }

  function renderTree() {
    tree.render({ files: Object.keys(files), folders: [...folders].filter((f) => !Object.keys(files).some((x) => x.startsWith(f + "/"))), active: current, marks: marks(), readOnly: !!options.readOnly });
  }

  function filesChanged() {
    void lsp?.setFiles(files, deps()).catch(() => {});
    options.onChange?.({ ...files });
    renderTree();
    renderTabs();
    schedule();
  }

  // ---- language service --------------------------------------------------
  const deps = () => {
    try {
      return JSON.parse(files["/manifest.json"] ?? "{}").dependencies ?? {};
    } catch {
      return {};
    }
  };
  let typesState = "";
  let lsp: Remote<LanguageService> | null = null;
  let worker: Worker | null = null;
  let lspReady: Promise<void> = Promise.resolve();
  if (options.languageWorker !== false) {
    try {
      const url = options.languageWorker ?? new URL("./language-worker.js", import.meta.url);
      worker = moduleWorker(url);
      lsp = createEndpoint<LanguageService>(worker as unknown as Parameters<typeof createEndpoint>[0]).remote;
      typesState = "Loading TypeScript…";
      lspReady = (async () => {
        await lsp!.init({ typescriptUrl: options.typescriptUrl });
        await lsp!.setHostTypes(options.hostTypes ?? "");
        await lsp!.setFiles(files, deps());
        typesState = "Types ready";
      })().catch((e) => {
        lsp = null;
        typesState = "Types unavailable";
        console.warn("[sandbox dev] type checking unavailable:", e);
      }).finally(() => updateStatus());
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
    const tsFiles = Object.keys(files).filter((p) => /\.(tsx?|jsx?|svelte)$/.test(p));
    await Promise.all(tsFiles.map(async (p) => {
      const ds = await lsp!.diagnostics(p).catch(() => []);
      tsRanges.set(p, ds);
      tsProblems.set(p, ds.map((d) => ({ file: p, line: d.line, column: d.column, message: d.message, severity: d.severity, source: "ts" })));
    }));
    for (const p of [...tsProblems.keys()]) if (!(p in files)) (tsProblems.delete(p), tsRanges.delete(p));
    syncEditorDiagnostics();
    renderTree();
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

  // ---- open-file tabs -----------------------------------------------------
  function renderTabs() {
    const m = marks();
    $(".sbx-dev__tabs").innerHTML = openTabs.map((p) =>
      `<div class="sbx-dev__tab" role="tab" data-path="${esc(p)}" aria-selected="${p === current}" title="${esc(p.slice(1))}">` +
      `${kindIcon(p)}<span>${esc(p.slice(p.lastIndexOf("/") + 1))}</span>${m[p] === "error" ? '<span class="err"></span>' : ""}` +
      `<button class="x" data-close="${esc(p)}" title="Close">✕</button></div>`
    ).join("");
    $(".sbx-dev__tabs").querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function openFile(path: string) {
    if (!path || !(path in files)) {
      current = "";
      editor.hidden = true;
      emptyEditor.hidden = false;
      renderTabs();
      renderTree();
      updateStatus();
      return;
    }
    if (!openTabs.includes(path)) openTabs.push(path);
    current = path;
    editor.hidden = false;
    emptyEditor.hidden = true;
    editor.path = path;
    editor.value = files[path];
    syncEditorDiagnostics();
    renderTabs();
    renderTree();
    updateStatus();
  }

  function closeTab(path: string) {
    const i = openTabs.indexOf(path);
    if (i < 0) return;
    openTabs.splice(i, 1);
    if (path === current) openFile(openTabs[Math.min(i, openTabs.length - 1)] ?? "");
    else renderTabs();
  }

  function setFile(path: string, text: string) {
    const isNew = !(path in files);
    files[path] = text;
    if (path === current && editor.value !== text) editor.value = text;
    void lsp?.setFile(path, text).catch(() => {});
    options.onChange?.({ ...files });
    if (isNew) renderTree();
    schedule();
  }

  // ---- build --------------------------------------------------------------
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void build(), options.debounceMs ?? 400);
  }

  let lastBuild = "";
  async function build(): Promise<CompileResult> {
    const my = ++buildSeq;
    msg.className = "sbx-dev__msg";
    msg.textContent = "Building…";
    const t0 = performance.now();
    const result = await compile(files, options.compile);
    if (destroyed || my !== buildSeq) return result;
    compileProblems = result.diagnostics.map((d: Diagnostic) => ({ ...d, severity: d.severity }));
    const ms = Math.round(performance.now() - t0);
    if (result.ok && result.artifact) {
      msg.className = "sbx-dev__msg ok";
      msg.textContent = "";
      lastBuild = `Built in ${ms} ms`;
      consoleRows = [];
      const mountOpts: MountOptions = {
        ...options,
        artifact: result.artifact,
        size: "fill",
        onConsole: (e: ConsoleEntry) => {
          consoleRows.push({ level: e.level, text: e.args.join(" ") });
          if (consoleRows.length > 500) consoleRows.shift();
          renderPanel();
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
      const n = result.diagnostics.filter((d) => d.severity === "error").length;
      msg.className = "sbx-dev__msg err";
      msg.textContent = `Build failed: ${n} error${n === 1 ? "" : "s"}`;
      lastBuild = "Build failed";
      panel = "problems";
    }
    syncEditorDiagnostics();
    renderTree();
    renderTabs();
    renderPanel();
    options.onBuild?.(result);
    void checkTypes();
    return result;
  }

  // ---- panel + status -----------------------------------------------------
  function allProblems(): Problem[] {
    return [...compileProblems, ...[...tsProblems.values()].flat()];
  }

  function renderPanel() {
    for (const b of root.querySelectorAll<HTMLElement>(".sbx-dev__ptabs button[data-p]")) {
      if (b.dataset.p === "problems" || b.dataset.p === "console") b.setAttribute("aria-selected", String(b.dataset.p === panel));
    }
    const problems = allProblems();
    root.querySelector<HTMLElement>('[data-p="problems"]')!.textContent = `Problems${problems.length ? ` (${problems.length})` : ""}`;
    root.querySelector<HTMLElement>('[data-p="console"]')!.textContent = `Console${consoleRows.length ? ` (${consoleRows.length})` : ""}`;
    if (panel === "problems") {
      list.innerHTML = problems.length
        ? problems.map((p) =>
          `<div class="sbx-dev__row ${p.severity}"${p.file ? ` data-file="${esc(p.file)}" data-line="${p.line ?? 1}" data-col="${p.column ?? 1}"` : ""}>` +
          `<span class="sev">${p.severity === "error" ? "✖" : p.severity === "warning" ? "▲" : "•"}</span>` +
          `<span class="loc">${esc(p.file ? `${p.file.slice(1)}${p.line ? `:${p.line}:${p.column ?? 1}` : ""}` : p.source)}</span><span>${esc(p.message)}</span></div>`
        ).join("")
        : `<div class="sbx-dev__none">No problems</div>`;
    } else {
      list.innerHTML = consoleRows.length
        ? consoleRows.map((r) => `<div class="sbx-dev__row ${r.level === "error" ? "error" : r.level === "warn" ? "warn" : ""}"><span class="sev">${r.level === "error" ? "✖" : r.level === "warn" ? "▲" : "›"}</span><span>${esc(r.text)}</span></div>`).join("")
        : `<div class="sbx-dev__none">Nothing logged</div>`;
      list.scrollTop = list.scrollHeight;
    }
    updateStatus();
  }

  let cursor = { line: 1, column: 1, selected: 0 };
  function updateStatus() {
    const problems = allProblems();
    const e = problems.filter((p) => p.severity === "error").length;
    const w = problems.filter((p) => p.severity === "warning").length;
    $<HTMLElement>('[data-s="pos"]').textContent = current
      ? `Ln ${cursor.line}, Col ${cursor.column}${cursor.selected ? ` (${cursor.selected} selected)` : ""}`
      : "";
    $<HTMLElement>('[data-s="lang"]').textContent = current ? LANGUAGE_NAMES[languageOf(current)] ?? "" : "";
    $<HTMLElement>('[data-s="problems"]').innerHTML = `<span class="e">✖ ${e}</span> <span class="w">▲ ${w}</span>`;
    $<HTMLElement>('[data-s="build"]').textContent = lastBuild;
    $<HTMLElement>('[data-s="types"]').textContent = typesState;
  }

  // ---- events -------------------------------------------------------------
  editor.addEventListener("change", () => current && setFile(current, editor.value));
  editor.addEventListener("cursor", (e) => {
    cursor = (e as CustomEvent<typeof cursor>).detail;
    updateStatus();
  });
  editor.addEventListener("save", () => options.onSave?.({ ...files }));
  root.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void build();
    }
  });
  $(".sbx-dev__tabs").addEventListener("click", (e) => {
    const close = (e.target as Element).closest<HTMLElement>("[data-close]");
    if (close) return closeTab(close.dataset.close!);
    const t = (e.target as Element).closest<HTMLElement>("[data-path]");
    if (t) openFile(t.dataset.path!);
  });
  $(".sbx-dev__tabs").addEventListener("auxclick", (e) => {
    const t = (e.target as Element).closest<HTMLElement>("[data-path]");
    if (t && (e as MouseEvent).button === 1) closeTab(t.dataset.path!);
  });
  $(".sbx-dev__bar").addEventListener("click", (e) => {
    const act = (e.target as Element).closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "run") void build();
    if (act === "swap") handle.setLayout(root.classList.contains("sbx-dev--right") ? "code-left" : "code-right");
    if (act === "explorer") handle.setExplorer(root.classList.contains("sbx-dev--no-tree"));
  });
  $(".sbx-dev__ptabs").addEventListener("click", (e) => {
    const p = (e.target as Element).closest<HTMLElement>("[data-p]")?.dataset.p;
    if (p === "problems" || p === "console") panel = p;
    if (p === "clear") consoleRows = [];
    if (p === "toggle") {
      const pn = $<HTMLElement>(".sbx-dev__panel");
      pn.dataset.collapsed = String(pn.dataset.collapsed !== "true");
    }
    renderPanel();
  });
  $(".sbx-dev__status").addEventListener("click", (e) => {
    const s = (e.target as Element).closest<HTMLElement>("[data-s]")?.dataset.s;
    if (s === "problems") {
      panel = "problems";
      $<HTMLElement>(".sbx-dev__panel").dataset.collapsed = "false";
      renderPanel();
    }
    if (s === "pos") editor.focusEditor();
  });
  list.addEventListener("click", (e) => {
    const row = (e.target as Element).closest<HTMLElement>("[data-file]");
    if (!row) return;
    openFile(row.dataset.file!);
    editor.goTo(Number(row.dataset.line), Number(row.dataset.col));
  });

  // splitters: the explorer's width and the preview's share
  function drag(handleEl: HTMLElement, onMove: (x: number, main: DOMRect) => void) {
    handleEl.addEventListener("pointerdown", (e) => {
      handleEl.setPointerCapture(e.pointerId);
      handleEl.classList.add("drag");
      const main = $<HTMLElement>(".sbx-dev__main").getBoundingClientRect();
      previewEl.style.pointerEvents = "none";
      const move = (ev: PointerEvent) => onMove(ev.clientX, main);
      const up = () => {
        handleEl.classList.remove("drag");
        previewEl.style.pointerEvents = "";
        handleEl.removeEventListener("pointermove", move);
        handleEl.removeEventListener("pointerup", up);
      };
      handleEl.addEventListener("pointermove", move);
      handleEl.addEventListener("pointerup", up);
    });
  }
  const right = () => root.classList.contains("sbx-dev--right");
  drag($(".sbx-dev__split--tree"), (x, main) => {
    const w = right() ? main.right - x : x - main.left;
    root.style.setProperty("--dev-tree", `${Math.round(Math.min(420, Math.max(140, w)))}px`);
  });
  drag($(".sbx-dev__split--preview"), (x, main) => {
    let frac = (main.right - x) / main.width;
    if (right()) frac = (x - main.left) / main.width;
    root.style.setProperty("--dev-preview", `${Math.round(Math.min(0.8, Math.max(0.15, frac)) * 1000) / 10}%`);
  });

  const handle: DevHandle = {
    files: () => ({ ...files }),
    setFile(path, text) {
      const isNew = !(path in files);
      setFile(path, text);
      if (isNew) renderTabs();
    },
    openFile,
    build,
    get preview() {
      return preview;
    },
    setLayout(layout) {
      root.classList.toggle("sbx-dev--right", layout === "code-right");
    },
    setExplorer(show) {
      root.classList.toggle("sbx-dev--no-tree", !show);
      $(".sbx-dev__bar [data-act=explorer]").setAttribute("aria-pressed", String(show));
    },
    destroy() {
      destroyed = true;
      if (timer) clearTimeout(timer);
      preview?.destroy();
      worker?.terminate();
      root.remove();
    },
  };

  const width = container.getBoundingClientRect().width;
  handle.setExplorer(options.explorer ?? (width > 720 || width === 0));
  const first = options.open ?? ["/index.tsx", "/index.ts", "/index.jsx", "/index.js", "/App.svelte"].find((p) => p in files) ?? Object.keys(files)[0];
  // the entry and its neighbour App file are open as tabs from the start
  if (first) openTabs.push(first);
  for (const p of ["/App.tsx", "/App.svelte", "/App.jsx"]) if (p in files && p !== first) openTabs.push(p);
  openFile(first ?? "");
  renderPanel();
  void build();
  return handle;
}

export { createLanguageService, startLanguageWorker, UI_ELEMENT_TYPES } from "./language.ts";
export type { LanguageInit, LanguageService, LspDiagnostic } from "./language.ts";
export { createTree, parentOf } from "./tree.ts";
export type { TreeCallbacks, TreeState } from "./tree.ts";
