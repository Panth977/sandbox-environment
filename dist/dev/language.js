/**
 * TypeScript language service for the dev engine, meant to run in a Web
 * Worker. Diagnostics, completions and hover info for the artifact's files,
 * with types for `@panth977/sandbox/*`, the UI kit's tags, the host API
 * (`hostTypes`), and npm packages (fetched from a CDN on demand).
 *
 * @module
 */
import { createEndpoint } from "../bridge.js";
import { TYPE_ENTRIES, TYPE_SOURCES } from "../generated/type_sources.js";
import { scanSpecifiers } from "../compiler/lexer.js";
import { splitBare } from "../compiler/compile.js";

/* deno-lint-ignore-file no-explicit-any */

/** JSX typings for the UI kit's custom elements (React/Preact) and tag-name maps. */
export const UI_ELEMENT_TYPES         = `
export {};
declare global {
  type SbxBase = { id?: string; class?: string; className?: string; style?: any; slot?: string; key?: any; ref?: any; children?: any;
    [event: \`on\${string}\`]: any; [data: \`data-\${string}\`]: any; [aria: \`aria-\${string}\`]: any; };
  interface SbxElements {
    "sbx-select": SbxBase & { value?: any; options?: { label: string; value: any; disabled?: boolean; group?: string; description?: string }[];
      placeholder?: string; multiple?: boolean; searchable?: boolean; clearable?: boolean; disabled?: boolean; name?: string; required?: boolean;
      size?: "sm" | "md" | "lg"; block?: boolean };
    "sbx-menu": SbxBase & { placement?: string; items?: any[] };
    "sbx-menu-item": SbxBase & { value?: string; danger?: boolean; disabled?: boolean; shortcut?: string; checked?: boolean };
    "sbx-menu-separator": SbxBase; "sbx-menu-group": SbxBase & { label?: string };
    "sbx-dialog": SbxBase & { heading?: string; open?: boolean; size?: "sm" | "md" | "lg" | "full"; persistent?: boolean; noclose?: boolean };
    "sbx-tabs": SbxBase & { value?: string; variant?: "line" | "pills"; tabs?: { value: string; label: string; count?: number | string; disabled?: boolean }[] };
    "sbx-tab": SbxBase & { value?: string; count?: number | string; disabled?: boolean };
    "sbx-switch": SbxBase & { checked?: boolean; disabled?: boolean; name?: string; value?: string };
    "sbx-tooltip": SbxBase & { text?: string; placement?: string; delay?: number };
    "sbx-table": SbxBase & { columns?: any[]; rows?: any[]; selectable?: boolean; compact?: boolean; striped?: boolean; loading?: boolean; empty?: string; "max-height"?: string | number };
    "sbx-chart": SbxBase & { type?: "line" | "area" | "bar" | "pie" | "donut"; data?: any[]; x?: string; y?: string | string[];
      labels?: Record<string, string>; height?: number; stacked?: boolean; unit?: string; "no-legend"?: boolean };
    "sbx-toaster": SbxBase & { position?: "top" | "bottom" };
  }
}
declare module "react" { namespace JSX { interface IntrinsicElements extends SbxElements {} } }
declare module "preact" { namespace JSX { interface IntrinsicElements extends SbxElements {} } }
`;

/** Ambient declarations for non-code imports (a script file, so wildcards apply). */
export const ASSET_TYPES         = `
declare module "*.svelte" { const Component: any; export default Component; }
declare module "*.css" { const css: string; export default css; }
declare module "*.svg" { const text: string; export default text; }
declare module "*.txt" { const text: string; export default text; }
declare module "*.md" { const text: string; export default text; }
`;

const KIND                         = { method: "m", function: "f", property: "p", var: "v", let: "v", const: "c", class: "C", interface: "I", type: "T", keyword: "k", module: "M" };

/** Creates the service object (used inside the worker). */
export function createLanguageService()                  {
  let ts     = null;
  let version = "6";
  let packageBase = "https://cdn.jsdelivr.net/npm";
  const files = new Map                                           ();
  const libs = new Map                (); // absolute path → text (libs, node_modules, generated)
  let deps                         = {};
  const acquired = new Map                       ();
  const pkgInfo = new Map                                                          ();
  let service      = null;
  let projectVersion = 0;

  const fetchText = async (url        )                         => {
    try {
      const r = await fetch(url);
      return r.ok ? await r.text() : null;
    } catch {
      return null;
    }
  };

  async function loadLibs() {
    const want = ["lib.esnext.full.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts", "lib.dom.asynciterable.d.ts"];
    const seen = new Set        ();
    const load = async (name        )                => {
      if (seen.has(name)) return;
      seen.add(name);
      const text = await fetchText(`${packageBase}/typescript@${version}/lib/${name}`);
      if (text === null) return;
      libs.set(`/lib/${name}`, text);
      const refs = [...text.matchAll(/\/\/\/\s*<reference\s+lib="([^"]+)"/g)].map((m) => `lib.${m[1].toLowerCase()}.d.ts`);
      await Promise.all(refs.map(load));
    };
    await Promise.all(want.map(load));
  }

  function addOwnTypes() {
    for (const [rel, text] of Object.entries(TYPE_SOURCES)) libs.set(`/node_modules/@panth977/sandbox/src/${rel}`, text);
    libs.set("/types/sbx-ui.d.ts", UI_ELEMENT_TYPES);
    libs.set("/types/sbx-assets.d.ts", ASSET_TYPES);
    if (!libs.has("/types/host.d.ts")) libs.set("/types/host.d.ts", "export {};\n");
  }

  const paths                           = {};
  for (const [name, rel] of Object.entries(TYPE_ENTRIES)) paths[name] = [`/node_modules/@panth977/sandbox/src/${rel}`];

  function compilerOptions() {
    return {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: deps.preact && !deps.react ? "preact" : "react",
      strict: true,
      noEmit: true,
      allowJs: true,
      checkJs: false,
      allowImportingTsExtensions: true,
      resolveJsonModule: true,
      esModuleInterop: true,
      skipLibCheck: true,
      lib: ["lib.esnext.full.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts", "lib.dom.asynciterable.d.ts"],
      baseUrl: "/",
      paths,
      types: [],
      typeRoots: ["/node_modules/@types"],
    };
  }

  function makeService() {
    const host = {
      getProjectVersion: () => String(projectVersion),
      getScriptFileNames: () => [...files.keys(), "/types/sbx-ui.d.ts", "/types/sbx-assets.d.ts", "/types/host.d.ts"],
      getScriptVersion: (f        ) => String(files.get(f)?.version ?? 0),
      getScriptSnapshot: (f        ) => {
        const t = files.get(f)?.text ?? libs.get(f);
        return t === undefined ? undefined : ts.ScriptSnapshot.fromString(t);
      },
      getCurrentDirectory: () => "/",
      getCompilationSettings: compilerOptions,
      getDefaultLibFileName: () => "/lib/lib.esnext.full.d.ts",
      fileExists: (f        ) => files.has(f) || libs.has(f),
      readFile: (f        ) => files.get(f)?.text ?? libs.get(f),
      directoryExists: (d        ) => {
        const p = d.endsWith("/") ? d : d + "/";
        for (const k of files.keys()) if (k.startsWith(p)) return true;
        for (const k of libs.keys()) if (k.startsWith(p)) return true;
        return false;
      },
      getDirectories: () => [],
      useCaseSensitiveFileNames: () => true,
    };
    service = ts.createLanguageService(host, ts.createDocumentRegistry());
  }

  // ---- automatic type acquisition --------------------------------------
  async function acquire(pkg        )                {
    if (acquired.has(pkg)) return acquired.get(pkg);
    const job = (async () => {
      const ver = deps[pkg] ?? "latest";
      const own = await fetchText(`${packageBase}/${pkg}@${ver}/package.json`);
      let json      = null;
      try {
        json = own ? JSON.parse(own) : null;
      } catch { /* ignore */ }
      const typesEntry = json && (json.types || json.typings || (typeof json.exports?.["."]?.types === "string" ? json.exports["."].types : null));
      if (json && typesEntry) {
        await pullTypes(pkg, json.version ?? ver, typesEntry, `/node_modules/${pkg}`, json);
        return;
      }
      const at = pkg.startsWith("@") ? pkg.slice(1).replace("/", "__") : pkg;
      const tj = await fetchText(`${packageBase}/@types/${at}@${typesVersion(ver)}/package.json`);
      if (!tj) return;
      let tjson     ;
      try {
        tjson = JSON.parse(tj);
      } catch {
        return;
      }
      await pullTypes(`@types/${at}`, tjson.version, tjson.types || tjson.typings || "index.d.ts", `/node_modules/@types/${at}`, tjson);
    })();
    acquired.set(pkg, job);
    return job;
  }

  const typesVersion = (v        ) => (/^\d/.test(v) ? v.split(".")[0] : "latest");

  async function pullTypes(name        , ver        , entry        , root        , pkgJson     ) {
    libs.set(`${root}/package.json`, JSON.stringify({ ...pkgJson, name: pkgJson.name ?? name, version: ver, types: entry.replace(/^\.\//, "") }));
    const seen = new Set        ();
    let budget = 120;
    const visit = async (rel        )                => {
      if (typeof rel !== "string") return;
      rel = rel.replace(/^\.\//, "");
      if (seen.has(rel) || budget-- <= 0) return;
      seen.add(rel);
      const text = await fetchText(`${packageBase}/${name}@${ver}/${rel}`);
      if (text === null) return;
      libs.set(`${root}/${rel}`, text);
      const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/") + 1) : "";
      const next           = [];
      const bare           = [];
      for (const m of text.matchAll(/\/\/\/\s*<reference\s+path="([^"]+)"/g)) next.push(dir + m[1]);
      for (const m of text.matchAll(/\/\/\/\s*<reference\s+types="([^"]+)"/g)) bare.push(m[1]);
      for (const r of scanSpecifiers(text)) {
        if (r.value.startsWith(".")) {
          const base = normalize(dir + r.value);
          next.push(/\.d\.[mc]?ts$/.test(base) ? base : base.replace(/\.(m?js)$/, "") + ".d.ts");
        } else bare.push(splitBare(r.value)[0]);
      }
      for (const m of text.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
        if (m[1].startsWith(".")) next.push(normalize(dir + m[1]).replace(/\.(m?js)$/, "") + ".d.ts");
        else bare.push(splitBare(m[1])[0]);
      }
      await Promise.all(next.map((n) => visit(n).then(async () => {
        // `./x` may be a directory with index.d.ts
        if (!libs.has(`${root}/${n.replace(/^\.\//, "")}`) && n.endsWith(".d.ts")) await visit(n.replace(/\.d\.ts$/, "/index.d.ts"));
      })));
      await Promise.all(bare.filter((b) => b !== name && !b.startsWith("@types/") && b !== pkgJson.name).map((b) => acquire(b)));
    };
    pkgInfo.set(pkgJson.name?.startsWith("@types/") ? pkgJson.name.slice(7).replace(/^(.+)__/, "@$1/") : pkgJson.name ?? name, {
      json: pkgJson,
      visit: async (rel) => {
        budget = Math.max(budget, 40);
        await visit(rel);
      },
    });
    await visit(entry);
    projectVersion++;
  }

  /** Types for `pkg/sub` (package exports map, else sub.d.ts / sub/index.d.ts). */
  async function acquireSub(pkg        , sub        ) {
    await acquire(pkg);
    const info = pkgInfo.get(pkg);
    if (!info || !sub) return;
    const key = "." + sub;
    const exp = info.json.exports?.[key];
    const pick = (e     )                =>
      typeof e === "string" ? (/\.d\.[mc]?ts$/.test(e) ? e : null) : e && typeof e === "object" ? (pickTypes(e.types) ?? pick(e.import) ?? pick(e.default) ?? pick(e.require)) : null;
    const pickTypes = (t     )                => (typeof t === "string" ? t : t && typeof t === "object" ? (pickTypes(t.import) ?? pickTypes(t.default) ?? pickTypes(t.require)) : null);
    const typed = pick(exp);
    const rel = sub.slice(1);
    for (const cand of [typed, `${rel}.d.ts`, `${rel}/index.d.ts`].filter(Boolean)            ) {
      await info.visit(cand);
    }
    projectVersion++;
  }

  const normalize = (p        ) => {
    const out           = [];
    for (const s of p.split("/")) {
      if (!s || s === ".") continue;
      if (s === "..") out.pop();
      else out.push(s);
    }
    return out.join("/");
  };

  async function acquireFor(text        , jsx         ) {
    const specs = new Set        ();
    for (const r of scanSpecifiers(text)) {
      const v = r.value;
      if (v.startsWith(".") || v.startsWith("/") || v.startsWith("@panth977/sandbox") || /^[a-z]+:/.test(v)) continue;
      specs.add(v);
    }
    if (jsx) specs.add(deps.preact && !deps.react ? "preact/jsx-runtime" : "react/jsx-runtime");
    await Promise.all([...specs].map((v) => {
      const [pkg, sub] = splitBare(v);
      return sub ? acquireSub(pkg, sub) : acquire(pkg);
    }));
  }

  function toDiag(d     )                {
    const file = d.file;
    const start = d.start ?? 0;
    const lc = file ? file.getLineAndCharacterOfPosition(start) : { line: 0, character: 0 };
    return {
      from: start,
      to: start + (d.length ?? 0),
      severity: d.category === ts.DiagnosticCategory.Error ? "error" : d.category === ts.DiagnosticCategory.Warning ? "warning" : "info",
      message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
      line: lc.line + 1,
      column: lc.character + 1,
    };
  }

  const isTsLike = (p        ) => /\.(tsx?|jsx?|mjs)$/.test(p);

  return {
    async init(o) {
      version = o.typescriptVersion ?? version;
      packageBase = o.packageBase ?? packageBase;
      const mod = await import(/* @vite-ignore */ o.typescriptUrl ?? `https://esm.sh/typescript@${version}`);
      ts = mod.default ?? mod;
      await loadLibs();
      addOwnTypes();
      makeService();
      return { version: ts.version };
    },
    async setFiles(next, dependencies = {}) {
      deps = dependencies;
      files.clear();
      for (const [p, text] of Object.entries(next)) if (isTsLike(p) || p.endsWith(".json")) files.set(p, { text, version: 1 });
      projectVersion++;
      await Promise.all([...files.entries()].filter(([p]) => isTsLike(p)).map(([p, f]) => acquireFor(f.text, /\.(tsx|jsx)$/.test(p))));
    },
    async setFile(path, text) {
      if (!isTsLike(path) && !path.endsWith(".json")) return;
      const cur = files.get(path);
      files.set(path, { text, version: (cur?.version ?? 0) + 1 });
      projectVersion++;
      if (isTsLike(path)) await acquireFor(text, /\.(tsx|jsx)$/.test(path));
    },
    async setHostTypes(dts) {
      // must be a module so `declare module "@panth977/sandbox/artifact"` augments instead of replacing
      const text = dts || "";
      libs.set("/types/host.d.ts", /^\s*(import|export)\b/m.test(text) ? text : text + "\nexport {};\n");
      projectVersion++;
    },
    async diagnostics(path) {
      if (!service || !files.has(path) || !isTsLike(path)) return [];
      const syn = service.getSyntacticDiagnostics(path);
      const sem = /\.(tsx?)$/.test(path) ? service.getSemanticDiagnostics(path) : [];
      return [...syn, ...sem].map(toDiag);
    },
    async completions(path, pos) {
      if (!service || !files.has(path)) return null;
      const r = service.getCompletionsAtPosition(path, pos, { includeCompletionsWithInsertText: true });
      if (!r) return null;
      const text = files.get(path) .text;
      let from = pos;
      while (from > 0 && /[\w$]/.test(text[from - 1])) from--;
      const items = r.entries
        .filter((e     ) => !e.name.startsWith("__"))
        .sort((a     , b     ) => (a.sortText < b.sortText ? -1 : a.sortText > b.sortText ? 1 : a.name.localeCompare(b.name)))
        .slice(0, 300)
        .map((e     ) => ({ label: e.name, kind: KIND[e.kind] ?? e.kind?.[0] ?? "", detail: e.kind }));
      return { from, items };
    },
    async quickInfo(path, pos) {
      if (!service || !files.has(path)) return null;
      const q = service.getQuickInfoAtPosition(path, pos);
      if (!q) return null;
      const sig = ts.displayPartsToString(q.displayParts);
      const doc = ts.displayPartsToString(q.documentation ?? []);
      return doc ? `${sig}\n\n${doc}` : sig;
    },
  };
}

/** Inside a worker: serve the language service over the bridge. */
export function startLanguageWorker()       {
  const scope = globalThis                                                                                                                                                                                           ;
  createEndpoint(scope, { expose: createLanguageService() });
}
