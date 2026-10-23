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
import { SVELTE_RUNE_TYPES, svelteToVirtual } from "./svelte.js";

/* deno-lint-ignore-file no-explicit-any */

/** A span in one of the artifact's files. */

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
    libs.set("/types/sbx-svelte.d.ts", SVELTE_RUNE_TYPES);
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
      getScriptFileNames: () => [...files.keys(), "/types/sbx-ui.d.ts", "/types/sbx-assets.d.ts", "/types/sbx-svelte.d.ts", "/types/host.d.ts"],
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

  /** What a symbol is, for people: method / object (of members) / property, a short type, and an object's members. */
  function describe(checker     , sym     )                                                                                     {
    if (!sym) return null;
    let type     ;
    try {
      type = typeof checker.getTypeOfSymbol === "function"
        ? checker.getTypeOfSymbol(sym)
        : checker.getTypeOfSymbolAtLocation(sym, sym.valueDeclaration ?? sym.declarations?.[0]);
    } catch {
      return null;
    }
    if (!type) return null;
    const cut = (s        , n = 60) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
    const sigs = type.getCallSignatures?.() ?? [];
    if (sigs.length) return { kind: "method", short: cut(checker.signatureToString(sigs[0])) };
    const objectish = (type.flags & ts.TypeFlags.Object) !== 0 && !checker.isArrayType?.(type);
    const props = objectish ? type.getProperties() : [];
    if (props.length) {
      const names = props.map((p     ) => p.name);
      const members = props.slice(0, 40).map((p     ) => {
        let t     ;
        try {
          t = typeof checker.getTypeOfSymbol === "function" ? checker.getTypeOfSymbol(p) : checker.getTypeOfSymbolAtLocation(p, p.valueDeclaration ?? p.declarations?.[0]);
        } catch {
          return p.name;
        }
        const cs = t?.getCallSignatures?.() ?? [];
        const text = cs.length ? `${p.name}${checker.signatureToString(cs[0])}` : `${p.name}: ${cut(checker.typeToString(t), 80)}`;
        // A mapped type's member (Remote<…>) carries no comment itself: ask the original declaration.
        let doc = "";
        try {
          doc = ts.displayPartsToString(p.getDocumentationComment(checker)) ||
            ts.displayPartsToString((p       ).links?.syntheticOrigin?.getDocumentationComment?.(checker) ?? []);
        } catch { /* no docs */ }
        return doc ? { text, doc: doc.split("\n")[0] } : { text };
      });
      return { kind: "object", short: `{ ${names.slice(0, 4).join(", ")}${names.length > 4 ? ", …" : ""} }`, members };
    }
    return { kind: "property", short: cut(checker.typeToString(type)) };
  }

  const isTsLike = (p        ) => /\.(tsx?|jsx?|mjs)$/.test(p);
  // .svelte files are checked as a same-length virtual TS file (./svelte.ts): offsets map 1:1.
  const isSvelte = (p        ) => p.endsWith(".svelte");
  const VIRTUAL = ".__sbx.ts";
  const svelteMeta = new Map                                                      ();
  /** The language-service path for an editor path. */
  const lsPath = (p        ) => (isSvelte(p) ? p + VIRTUAL : p);
  function put(path        , text        ) {
    if (isSvelte(path)) {
      const v = svelteToVirtual(text);
      svelteMeta.set(path, { ts: v.ts, scripts: v.scripts });
      const cur = files.get(path + VIRTUAL);
      files.set(path + VIRTUAL, { text: v.code, version: (cur?.version ?? 0) + 1 });
      return v.code;
    }
    const cur = files.get(path);
    files.set(path, { text, version: (cur?.version ?? 0) + 1 });
    return text;
  }
  const handled = (p        ) => isTsLike(p) || isSvelte(p) || p.endsWith(".json");

  /** An editor path for a language-service file name, or null outside the artifact. */
  const userPath = (f        )                => {
    const p = f.endsWith(VIRTUAL) ? f.slice(0, -VIRTUAL.length) : f;
    return files.has(f) && !f.startsWith("/node_modules/") ? p : null;
  };
  const locations = (list                   )                =>
    (list ?? []).flatMap((d     ) => {
      const path = userPath(d.fileName);
      return path ? [{ path, from: d.textSpan.start, to: d.textSpan.start + d.textSpan.length }] : [];
    });

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
      svelteMeta.clear();
      const code                     = [];
      for (const [p, text] of Object.entries(next)) if (handled(p)) code.push([p, put(p, text)]);
      projectVersion++;
      await Promise.all(code.filter(([p]) => !p.endsWith(".json")).map(([p, t]) => acquireFor(t, /\.(tsx|jsx)$/.test(p))));
    },
    async setFile(path, text) {
      if (!handled(path)) return;
      const code = put(path, text);
      projectVersion++;
      if (!path.endsWith(".json")) await acquireFor(code, /\.(tsx|jsx)$/.test(path));
    },
    async setHostTypes(dts) {
      // must be a module so `declare module "@panth977/sandbox/artifact"` augments instead of replacing
      const text = dts || "";
      libs.set("/types/host.d.ts", /^\s*(import|export)\b/m.test(text) ? text : text + "\nexport {};\n");
      projectVersion++;
    },
    async diagnostics(path) {
      if (!service || !files.has(lsPath(path))) return [];
      if (isSvelte(path)) {
        // Only what is said about the <script> blocks: template expressions lack each-block
        // variables and the like, and the Svelte compiler reports the template itself.
        const meta = svelteMeta.get(path) ;
        const v = lsPath(path);
        const ds = [...service.getSyntacticDiagnostics(v), ...(meta.ts ? service.getSemanticDiagnostics(v) : [])];
        return ds.filter((d     ) => meta.scripts.some(([a, b]) => (d.start ?? -1) >= a && (d.start ?? -1) < b)).map(toDiag);
      }
      if (!isTsLike(path)) return [];
      const syn = service.getSyntacticDiagnostics(path);
      const sem = /\.(tsx?)$/.test(path) ? service.getSemanticDiagnostics(path) : [];
      return [...syn, ...sem].map(toDiag);
    },
    async completions(path, pos) {
      const p = lsPath(path);
      if (!service || !files.has(p)) return null;
      const r = service.getCompletionsAtPosition(p, pos, { includeCompletionsWithInsertText: true });
      if (!r) return null;
      const text = files.get(p) .text;
      let from = pos;
      while (from > 0 && /[\w$]/.test(text[from - 1])) from--;
      const sorted = r.entries
        .filter((e     ) => !e.name.startsWith("__"))
        .sort((a     , b     ) => (a.sortText < b.sortText ? -1 : a.sortText > b.sortText ? 1 : a.name.localeCompare(b.name)))
        .slice(0, 300);
      const checker = service.getProgram()?.getTypeChecker();
      const items = sorted.map((e     , i        ) => {
        // Member access lists (host.kv.…) are short: say what each one IS — a method, an object of
        // methods, a value — with its short type. Long global lists keep the plain kind.
        const shape = checker && i < 80 && r.isMemberCompletion ? describe(checker, service.getCompletionEntrySymbol(p, pos, e.name, e.source)) : null;
        return shape
          ? { label: e.name, kind: shape.kind, detail: shape.short }
          : { label: e.name, kind: e.kind ?? "", detail: e.kind };
      });
      return { from, items };
    },
    async completionDetails(path, pos, name) {
      const p = lsPath(path);
      if (!service || !files.has(p)) return null;
      const d = service.getCompletionEntryDetails(p, pos, name, {}, undefined, undefined, undefined);
      if (!d) return null;
      const checker = service.getProgram()?.getTypeChecker();
      const shape = checker ? describe(checker, service.getCompletionEntrySymbol(p, pos, name, undefined)) : null;
      const doc = [ts.displayPartsToString(d.documentation ?? []), ...(d.tags ?? []).map((t     ) => `@${t.name} ${ts.displayPartsToString(t.text ?? [])}`.trim())]
        .filter(Boolean).join("\n");
      return {
        kind: shape?.kind ?? d.kind,
        title: shape?.kind === "object" ? `(object) ${name}: ${shape.short}` : ts.displayPartsToString(d.displayParts),
        ...(shape?.members ? { members: shape.members } : {}),
        ...(doc ? { doc } : {}),
      };
    },
    async quickInfo(path, pos) {
      const p = lsPath(path);
      if (!service || !files.has(p)) return null;
      const q = service.getQuickInfoAtPosition(p, pos);
      if (!q) return null;
      let sig = ts.displayPartsToString(q.displayParts);
      // An object of members (host.tickets, host.kv …): list them, one per line.
      const checker = service.getProgram()?.getTypeChecker();
      const sf = service.getProgram()?.getSourceFile(p);
      const token = sf && typeof ts.getTokenAtPosition === "function" ? ts.getTokenAtPosition(sf, q.textSpan.start) : null;
      const sym = checker && token ? checker.getSymbolAtLocation(token) : null;
      const shape = checker && sym ? describe(checker, sym) : null;
      if (shape?.kind === "object" && shape.members) {
        sig = `${sig.split(":")[0]}: {\n${shape.members.map((m) => (m.doc ? `  /** ${m.doc} */\n` : "") + "  " + m.text + ";").join("\n")}\n}`;
      }
      const doc = ts.displayPartsToString(q.documentation ?? []);
      return doc ? `${sig}\n\n${doc}` : sig;
    },
    async signatureHelp(path, pos) {
      const p = lsPath(path);
      if (!service || !files.has(p)) return null;
      const h = service.getSignatureHelpItems(p, pos, {});
      if (!h) return null;
      const signatures = h.items.map((it     ) => {
        let label = ts.displayPartsToString(it.prefixDisplayParts);
        const params = it.parameters.map((x     , i        ) => {
          if (i) label += ts.displayPartsToString(it.separatorDisplayParts);
          const start = label.length;
          label += ts.displayPartsToString(x.displayParts);
          const doc = ts.displayPartsToString(x.documentation ?? []);
          return doc ? { label: [start, label.length]                    , doc } : { label: [start, label.length]                     };
        });
        label += ts.displayPartsToString(it.suffixDisplayParts);
        const doc = ts.displayPartsToString(it.documentation ?? []);
        return doc ? { label, doc, params } : { label, params };
      });
      return { signatures, active: h.selectedItemIndex, param: h.argumentIndex };
    },
    async definition(path, pos) {
      const p = lsPath(path);
      if (!service || !files.has(p)) return [];
      return locations(service.getDefinitionAtPosition(p, pos));
    },
    async references(path, pos) {
      const p = lsPath(path);
      if (!service || !files.has(p)) return [];
      return locations(service.getReferencesAtPosition(p, pos));
    },
    async rename(path, pos, name) {
      const p = lsPath(path);
      if (!service || !files.has(p)) return { error: "Nothing to rename here" };
      const info = service.getRenameInfo(p, pos, { allowRenameOfImportPath: false });
      if (!info?.canRename) return { error: info?.localizedErrorMessage ?? "This cannot be renamed" };
      const locs = service.findRenameLocations(p, pos, false, false, { providePrefixAndSuffixTextForRename: true }) ?? [];
      const edits                = [];
      for (const l of locs) {
        const up = userPath(l.fileName);
        if (!up) return { error: "It is declared outside the artifact's files" };
        edits.push({ path: up, from: l.textSpan.start, to: l.textSpan.start + l.textSpan.length, text: (l.prefixText ?? "") + name + (l.suffixText ?? "") });
      }
      return { edits };
    },
    async format(path, options = {}) {
      // .svelte files are formatted as their virtual TS would be: skip them.
      if (!service || !files.has(path) || !isTsLike(path)) return [];
      const edits = service.getFormattingEditsForDocument(path, {
        indentSize: options.tabSize ?? 2, tabSize: options.tabSize ?? 2, convertTabsToSpaces: options.insertSpaces ?? true,
        newLineCharacter: "\n", insertSpaceAfterCommaDelimiter: true, insertSpaceAfterSemicolonInForStatements: true,
        insertSpaceBeforeAndAfterBinaryOperators: true, insertSpaceAfterKeywordsInControlFlowStatements: true,
        insertSpaceAfterFunctionKeywordForAnonymousFunctions: true, insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: true,
        insertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces: false, placeOpenBraceOnNewLineForFunctions: false,
        placeOpenBraceOnNewLineForControlBlocks: false, semicolons: "ignore",
      });
      return edits.map((e     ) => ({ path, from: e.span.start, to: e.span.start + e.span.length, text: e.newText }));
    },
  };
}

/** Inside a worker: serve the language service over the bridge. */
export function startLanguageWorker()       {
  const scope = globalThis                                                                                                                                                                                           ;
  createEndpoint(scope, { expose: createLanguageService() });
}
