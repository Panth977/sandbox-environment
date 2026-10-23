/**
 * The development engine: an IDE for one artifact, in any page.
 *
 *   ┌ toolbar: ☰ · open files (closable) ···························· status · ⇄ · Run ┐
 *   │ FILES (tree) │ Monaco (the VS Code editor) + TypeScript        │ live preview      │
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
 * The editor is Monaco, loaded on demand from a CDN (`monacoBase`); the
 * language features (completions, hover, signatures, go to definition,
 * rename, format, errors) come from the kit's TypeScript worker, so `.svelte`
 * files get the same as `.ts`.
 *
 * @module
 */
import { compile } from "../compiler/compile.js";

import { mount } from "../host/mount.js";

import { createEndpoint } from "../bridge.js";

import { confirmDialog, installStyles } from "../ui/index.js";
import { languageOf } from "../editor/highlight.js";
import { loadMonaco, monacoLanguage, registerSvelte } from "./monaco.js";

import { esc } from "../ui/base.js";

import { createTree, parentOf, TREE_CSS } from "./tree.js";
import { addEngine, themeFrom } from "./providers.js";
import { CDN_DIST } from "../generated/version.js";

let engineSeq = 0;

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
.sbx-dev__monaco { position: absolute; inset: 0; }
.sbx-dev__monaco[hidden] { display: block; visibility: hidden; }
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

/**
 * The language worker next to this module when it is served as-is (a CDN, a static folder);
 * from the release on jsDelivr when a bundler moved this code (webpack, esbuild, Vite builds).
 */
function defaultWorkerUrl()         {
  const here = String(import.meta.url);
  return /^https?:/.test(here) && /\/dev\/mod\.js(\?|$)/.test(here)
    ? new URL("./language-" + "worker.js", here).href
    : `${CDN_DIST}/dev/language-worker.js`;
}

/** A module worker from any URL (cross-origin module URLs are wrapped in a same-origin blob worker). */
function moduleWorker(url              )         {
  const src = `import ${JSON.stringify(String(url))};`;
  return new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })), { type: "module" });
}

const LANGUAGE_NAMES                         = {
  ts: "TypeScript", tsx: "TypeScript JSX", js: "JavaScript", jsx: "JavaScript JSX", css: "CSS", json: "JSON",
  html: "HTML", svelte: "Svelte", md: "Markdown", text: "Plain text",
};

/** What a new file starts with. */
function starter(path        )         {
  const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
  const comp = name.replace(/(^|[-_\s])(\w)/g, (_m, _a, c        ) => c.toUpperCase());
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

const kindIcon = (path        ) => {
  const ext = path.slice(path.lastIndexOf(".") + 1);
  const map                                   = {
    ts: ["TS", "#3178c6"], tsx: ["TSX", "#3178c6"], js: ["JS", "#c9a400"], jsx: ["JSX", "#c9a400"], svelte: ["S", "#ff3e00"],
    css: ["#", "#7c4dff"], json: ["{}", "#8a8a8a"], html: ["<>", "#e34c26"], md: ["M↓", "#6b6560"],
  };
  const [l, c] = map[ext] ?? ["·", "#8a8a8a"];
  return `<span class="sbx-tree__icon" style="color:${c}">${esc(l)}</span>`;
};

/** Mounts the development engine into `container`. */
export function mountDev(container             , options            )            {
  installStyles();
  installDevStyles();
  const files              = { ...options.files };
  /** Empty folders made in the explorer (folders with files come from the paths). */
  const folders = new Set        ();
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
      <div class="sbx-dev__code"><div class="sbx-dev__monaco"></div><div class="sbx-dev__empty-editor">Loading the editor…</div></div>
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
  const $ =                    (sel        ) => root.querySelector(sel)     ;
  const editorEl = $             (".sbx-dev__monaco");
  const emptyEditor = $             (".sbx-dev__empty-editor");
  const previewEl = $             (".sbx-dev__preview");
  const msg = $             (".sbx-dev__msg");
  const list = $             (".sbx-dev__list");

  let current = "";
  let openTabs           = [];
  let preview                             = null;
  let compileProblems            = [];
  const tsProblems = new Map                   ();
  const tsRanges = new Map                         ();
  let consoleRows                                    = [];
  let panel                         = "problems";
  let timer                                       = null;
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
      const moves                     = folder
        ? Object.keys(files).filter((f) => f.startsWith(from + "/")).map((f) => [f, to + f.slice(from.length)])
        : [[from, to]];
      for (const [a, b] of moves) {
        files[b] = files[a] ;
        delete files[a];
      }
      if (folder) {
        for (const f of [...folders]) if (f === from || f.startsWith(from + "/")) (folders.delete(f), folders.add(to + f.slice(from.length)));
      }
      const map = new Map(moves);
      openTabs = openTabs.map((t) => map.get(t) ?? t);
      if (map.has(current)) current = map.get(current) ;
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

  function marks()                                      {
    const out                                      = {};
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
    syncModels();
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
  let lsp                                 = null;
  let worker                = null;
  let lspReady                = Promise.resolve();
  if (options.languageWorker !== false) {
    try {
      const url = options.languageWorker ?? defaultWorkerUrl();
      worker = moduleWorker(url);
      lsp = createEndpoint                 (worker                                                   ).remote;
      typesState = "Loading TypeScript…";
      lspReady = (async () => {
        await lsp .init({ typescriptUrl: options.typescriptUrl });
        await lsp .setHostTypes(options.hostTypes ?? "");
        await lsp .setFiles(files, deps());
        typesState = "Types ready";
      })().catch((e) => {
        lsp = null;
        typesState = "Types unavailable";
        console.warn("[sandbox dev] type checking unavailable:", e);
      }).finally(() => updateStatus());
    } catch (e) {
      console.warn("[sandbox dev] language worker failed to start:", e);
    }
  }

  async function checkTypes() {
    await lspReady;
    if (!lsp) return;
    const tsFiles = Object.keys(files).filter((p) => /\.(tsx?|jsx?|svelte)$/.test(p));
    await Promise.all(tsFiles.map(async (p) => {
      const ds = await lsp .diagnostics(p).catch(() => []);
      tsRanges.set(p, ds);
      tsProblems.set(p, ds.map((d) => ({ file: p, line: d.line, column: d.column, message: d.message, severity: d.severity, source: "ts" })));
    }));
    for (const p of [...tsProblems.keys()]) if (!(p in files)) (tsProblems.delete(p), tsRanges.delete(p));
    syncEditorDiagnostics();
    renderTree();
    renderTabs();
    renderPanel();
  }

  // ---- the editor (Monaco) -------------------------------------------------
  const engineId = `e${++engineSeq}`;
  let monaco                = null;
  let editor      = null;
  const models = new Map             ();
  const viewStates = new Map                 ();
  const disposers                 = [];
  /** Set while the engine itself writes a model, so the change is not echoed back. */
  let writing = false;

  function modelFor(path        )      {
    if (!monaco) return null;
    let m = models.get(path);
    if (m) return m;
    const uri = monaco.Uri.from({ scheme: "sbx", authority: engineId, path });
    m = monaco.editor.getModel(uri) ?? monaco.editor.createModel(files[path] ?? "", monacoLanguage(path), uri);
    m.updateOptions({ tabSize: 2, insertSpaces: true });
    m.onDidChangeContent(() => {
      if (writing || !(path in files)) return;
      setFile(path, m.getValue(), true);
    });
    models.set(path, m);
    return m;
  }

  function dropModel(path        ) {
    models.get(path)?.dispose();
    models.delete(path);
    viewStates.delete(path);
  }

  function syncModels() {
    if (!monaco) return;
    for (const p of [...models.keys()]) if (!(p in files)) dropModel(p);
    for (const p of Object.keys(files)) {
      const m = modelFor(p);
      if (m.getValue() !== files[p]) {
        writing = true;
        try {
          m.setValue(files[p]);
        } finally {
          writing = false;
        }
      }
    }
  }

  const ready                = loadMonaco(options.monacoBase).then((m) => {
    if (destroyed) return;
    monaco = m;
    registerSvelte(m);
    // Monaco's own TypeScript would answer twice: the kit's worker does it (it knows the host API, packages and Svelte).
    for (const d of [m.typescript?.typescriptDefaults, m.typescript?.javascriptDefaults, m.languages.typescript?.typescriptDefaults, m.languages.typescript?.javascriptDefaults]) {
      d?.setModeConfiguration?.({
        completionItems: false, hovers: false, documentSymbols: false, definitions: false, references: false, documentHighlights: false,
        rename: false, diagnostics: false, documentRangeFormattingEdits: false, signatureHelp: false, onTypeFormattingEdits: false,
        codeActions: false, inlayHints: false,
      });
    }
    disposers.push(addEngine(m, engineId, {
      lsp: async () => {
        await lspReady;
        return lsp;
      },
      model: (p) => (p in files ? modelFor(p) : null),
      reveal: (p, sel) => {
        if (!(p in files)) return;
        openFile(p);
        if (sel && editor) {
          const r = "startLineNumber" in sel ? sel : { startLineNumber: sel.lineNumber, startColumn: sel.column, endLineNumber: sel.lineNumber, endColumn: sel.column };
          editor.setSelection(r);
          editor.revealRangeInCenterIfOutsideViewport(r);
          editor.focus();
        }
      },
    }));
    const mono = getComputedStyle(root).getPropertyValue("--sbx-font-mono").trim();
    editor = m.editor.create(editorEl, {
      model: null,
      theme: themeFrom(m, root),
      automaticLayout: true,
      readOnly: !!options.readOnly,
      fontSize: 13,
      lineHeight: 20,
      ...(mono ? { fontFamily: mono } : {}),
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      tabSize: 2,
      fixedOverflowWidgets: true,
      renderLineHighlight: "line",
      smoothScrolling: true,
      padding: { top: 6 },
      suggest: { showStatusBar: true, preview: true },
      quickSuggestions: { other: true, comments: false, strings: true },
    });
    // Monaco scrolls virtually; a browser scrolling its containers natively (bringing the focused
    // input into view) would shift the text off its grid. Undo any native scroll inside the editor.
    editorEl.addEventListener("scroll", (e) => {
      const t = e.target               ;
      if (t !== editorEl && (t.scrollLeft || t.scrollTop) && t.classList?.contains("monaco-scrollable-element")) {
        t.scrollLeft = 0;
        t.scrollTop = 0;
      }
    }, true);
    // The detail pane beside the completion list (members of an object, docs) is open by default.
    const suggest = editor.getContribution("editor.contrib.suggestController");
    let detailsShown = false;
    suggest?.widget?.value?.onDidShow?.(() => {
      if (detailsShown) return;
      detailsShown = true;
      editor.trigger("sbx", "toggleSuggestionDetails", {});
    });
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => options.onSave?.({ ...files }));
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.Enter, () => void build());
    editor.onDidChangeCursorSelection((e     ) => {
      const sel = e.selection;
      const model = editor.getModel();
      cursor = {
        line: sel.positionLineNumber,
        column: sel.positionColumn,
        selected: model ? model.getValueLengthInRange(sel) : 0,
      };
      updateStatus();
    });
    // follow the page's theme (the host sets the kit's CSS variables)
    const retheme = () => editor && m.editor.setTheme(themeFrom(m, root));
    const mo = new MutationObserver(retheme);
    for (const el of [container, document.documentElement, document.body]) mo.observe(el, { attributes: true, attributeFilter: ["style", "class", "data-theme"] });
    disposers.push(() => mo.disconnect());
    syncModels();
    openFile(current);
    syncEditorDiagnostics();
  }).catch((e) => {
    emptyEditor.textContent = "The editor could not load. Check the connection and reload.";
    console.warn("[sandbox dev] editor failed to load:", e);
  });

  function syncEditorDiagnostics() {
    if (!monaco) return;
    const sev = (s        ) => s === "error" ? monaco.MarkerSeverity.Error : s === "warning" ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info;
    for (const [path, m] of models) {
      const ts = (tsRanges.get(path) ?? []).map((d               ) => {
        const a = m.getPositionAt(d.from);
        const b = m.getPositionAt(Math.max(d.to, d.from + 1));
        return { startLineNumber: a.lineNumber, startColumn: a.column, endLineNumber: b.lineNumber, endColumn: b.column, message: d.message, severity: sev(d.severity), source: "ts" };
      });
      const seen = new Set(ts.map((x) => `${x.startLineNumber}:${x.startColumn}:${x.message}`));
      const comp = compileProblems.filter((p) => p.file === path && p.line && !seen.has(`${p.line}:${p.column ?? 1}:${p.message}`)).map((p) => {
        const line = Math.min(p.line , m.getLineCount());
        const col = p.column ?? 1;
        const w = m.getWordAtPosition({ lineNumber: line, column: col });
        return { startLineNumber: line, startColumn: w?.startColumn ?? col, endLineNumber: line, endColumn: w?.endColumn ?? col + 1, message: p.message, severity: sev(p.severity), source: p.source };
      });
      monaco.editor.setModelMarkers(m, "sbx", [...ts, ...comp]);
    }
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

  function openFile(path        ) {
    if (editor && current && models.has(current) && editor.getModel() === models.get(current)) viewStates.set(current, editor.saveViewState());
    if (!path || !(path in files)) {
      current = "";
      editor?.setModel(null);
      editorEl.hidden = true;
      emptyEditor.hidden = false;
      if (monaco) emptyEditor.textContent = "Open a file from the explorer";
      renderTabs();
      renderTree();
      updateStatus();
      return;
    }
    if (!openTabs.includes(path)) openTabs.push(path);
    const switching = path !== current || !editor?.getModel();
    current = path;
    if (editor) {
      editorEl.hidden = false;
      emptyEditor.hidden = true;
      if (switching) {
        editor.setModel(modelFor(path));
        const vs = viewStates.get(path);
        if (vs) editor.restoreViewState(vs);
      }
    }
    renderTabs();
    renderTree();
    updateStatus();
  }

  function closeTab(path        ) {
    const i = openTabs.indexOf(path);
    if (i < 0) return;
    openTabs.splice(i, 1);
    if (path === current) openFile(openTabs[Math.min(i, openTabs.length - 1)] ?? "");
    else renderTabs();
  }

  function setFile(path        , text        , fromEditor = false) {
    const isNew = !(path in files);
    files[path] = text;
    if (!fromEditor && monaco) {
      const m = modelFor(path);
      if (m.getValue() !== text) {
        writing = true;
        try {
          // an edit (not setValue) keeps undo working across outside changes
          m.pushEditOperations([], [{ range: m.getFullModelRange(), text }], () => null);
        } finally {
          writing = false;
        }
      }
    }
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
  async function build()                         {
    const my = ++buildSeq;
    msg.className = "sbx-dev__msg";
    msg.textContent = "Building…";
    const t0 = performance.now();
    const result = await compile(files, options.compile);
    if (destroyed || my !== buildSeq) return result;
    compileProblems = result.diagnostics.map((d            ) => ({ ...d, severity: d.severity }));
    const ms = Math.round(performance.now() - t0);
    if (result.ok && result.artifact) {
      msg.className = "sbx-dev__msg ok";
      msg.textContent = "";
      lastBuild = `Built in ${ms} ms`;
      consoleRows = [];
      const mountOpts               = {
        ...options,
        artifact: result.artifact,
        size: "fill",
        onConsole: (e              ) => {
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
  function allProblems()            {
    // The compiler and the type checker often report the same syntax error: show it once.
    const seen = new Set        ();
    return [...compileProblems, ...[...tsProblems.values()].flat()].filter((p) => {
      const k = `${p.file}:${p.line}:${p.column}:${p.message}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function renderPanel() {
    for (const b of root.querySelectorAll             (".sbx-dev__ptabs button[data-p]")) {
      if (b.dataset.p === "problems" || b.dataset.p === "console") b.setAttribute("aria-selected", String(b.dataset.p === panel));
    }
    const problems = allProblems();
    root.querySelector             ('[data-p="problems"]') .textContent = `Problems${problems.length ? ` (${problems.length})` : ""}`;
    root.querySelector             ('[data-p="console"]') .textContent = `Console${consoleRows.length ? ` (${consoleRows.length})` : ""}`;
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
    $             ('[data-s="pos"]').textContent = current
      ? `Ln ${cursor.line}, Col ${cursor.column}${cursor.selected ? ` (${cursor.selected} selected)` : ""}`
      : "";
    $             ('[data-s="lang"]').textContent = current ? LANGUAGE_NAMES[languageOf(current)] ?? "" : "";
    $             ('[data-s="problems"]').innerHTML = `<span class="e">✖ ${e}</span> <span class="w">▲ ${w}</span>`;
    $             ('[data-s="build"]').textContent = lastBuild;
    $             ('[data-s="types"]').textContent = typesState;
  }

  // ---- events -------------------------------------------------------------
  root.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void build();
    }
  });
  $(".sbx-dev__tabs").addEventListener("click", (e) => {
    const close = (e.target           ).closest             ("[data-close]");
    if (close) return closeTab(close.dataset.close );
    const t = (e.target           ).closest             ("[data-path]");
    if (t) openFile(t.dataset.path );
  });
  $(".sbx-dev__tabs").addEventListener("auxclick", (e) => {
    const t = (e.target           ).closest             ("[data-path]");
    if (t && (e              ).button === 1) closeTab(t.dataset.path );
  });
  $(".sbx-dev__bar").addEventListener("click", (e) => {
    const act = (e.target           ).closest             ("[data-act]")?.dataset.act;
    if (act === "run") void build();
    if (act === "swap") handle.setLayout(root.classList.contains("sbx-dev--right") ? "code-left" : "code-right");
    if (act === "explorer") handle.setExplorer(root.classList.contains("sbx-dev--no-tree"));
  });
  $(".sbx-dev__ptabs").addEventListener("click", (e) => {
    const p = (e.target           ).closest             ("[data-p]")?.dataset.p;
    if (p === "problems" || p === "console") panel = p;
    if (p === "clear") consoleRows = [];
    if (p === "toggle") {
      const pn = $             (".sbx-dev__panel");
      pn.dataset.collapsed = String(pn.dataset.collapsed !== "true");
    }
    renderPanel();
  });
  $(".sbx-dev__status").addEventListener("click", (e) => {
    const s = (e.target           ).closest             ("[data-s]")?.dataset.s;
    if (s === "problems") {
      panel = "problems";
      $             (".sbx-dev__panel").dataset.collapsed = "false";
      renderPanel();
    }
    if (s === "pos") editor?.focus();
  });
  list.addEventListener("click", (e) => {
    const row = (e.target           ).closest             ("[data-file]");
    if (!row) return;
    openFile(row.dataset.file );
    handle.goTo(Number(row.dataset.line), Number(row.dataset.col));
  });

  // splitters: the explorer's width and the preview's share
  function drag(handleEl             , onMove                                    ) {
    handleEl.addEventListener("pointerdown", (e) => {
      handleEl.setPointerCapture(e.pointerId);
      handleEl.classList.add("drag");
      const main = $             (".sbx-dev__main").getBoundingClientRect();
      previewEl.style.pointerEvents = "none";
      const move = (ev              ) => onMove(ev.clientX, main);
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

  const handle            = {
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
    ready,
    get editor() {
      return editor;
    },
    goTo(line, column = 1) {
      if (!editor) return;
      const pos = { lineNumber: line, column };
      editor.setPosition(pos);
      editor.revealPositionInCenterIfOutsideViewport(pos);
      editor.focus();
    },
    destroy() {
      destroyed = true;
      if (timer) clearTimeout(timer);
      preview?.destroy();
      worker?.terminate();
      for (const d of disposers) d();
      editor?.dispose();
      for (const p of [...models.keys()]) dropModel(p);
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

export { createLanguageService, startLanguageWorker, UI_ELEMENT_TYPES } from "./language.js";

export { createTree, parentOf } from "./tree.js";
