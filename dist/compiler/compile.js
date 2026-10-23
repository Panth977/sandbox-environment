/**
 * The compiler: artifact source files → {@link CompiledArtifact}.
 *
 * No bundler. Each reachable file is transformed on its own (TypeScript/JSX
 * via the official `typescript` package, `.svelte` via `svelte/compiler`,
 * CSS/JSON/text into small modules, plain JS untouched), its imports are
 * rewritten to `sbx:` keys, and bare imports (react, svelte…) go into an
 * import map pointing at a CDN. The browser links the result.
 *
 * Plain JS and CSS artifacts compile with zero dependencies. TypeScript and
 * Svelte compilers are loaded lazily, only when such files are present: from a
 * CDN in the browser (or a worker), from `node_modules` in Node.
 *
 * Runs unchanged in browsers, workers, Node and Deno.
 *
 * @module
 */
import { PROTOCOL } from "../protocol.js";

import { rewriteSpecifiers, scanSpecifiers } from "./lexer.js";

/** Source files keyed by path (`/index.tsx`, `/lib/util.ts`, `/manifest.json`…). */

/** The subset of the TypeScript API the compiler uses. */

/** The subset of the Svelte compiler API the compiler uses. */

/** Transform one file. Return JS module source, or null to let the next plugin try. */

/** Versions used when neither the manifest nor the options name one. */
export const DEFAULT_VERSIONS                         = {
  react: "19",
  "react-dom": "19",
  preact: "10",
  svelte: "5",
  typescript: "6",
};

export const esmSh = (name        , version        , subpath        )         =>
  `https://esm.sh/${name}@${version}${subpath}`;

const NODE_BUILTINS = new Set([
  "assert", "buffer", "child_process", "cluster", "crypto", "dgram", "dns", "events", "fs", "http", "http2", "https", "net", "os",
  "path", "process", "querystring", "readline", "stream", "tls", "tty", "url", "util", "v8", "vm", "worker_threads", "zlib",
]);

const EXTS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".svelte", ".json", ".css"];
const ENTRY_CANDIDATES = ["/index.tsx", "/index.ts", "/index.jsx", "/index.js", "/main.tsx", "/main.ts", "/main.js", "/App.svelte", "/index.svelte"];

export function normalizePath(p        )         {
  const parts           = [];
  for (const seg of ("/" + p).split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return "/" + parts.join("/");
}

function dirOf(p        )         {
  return p.slice(0, p.lastIndexOf("/")) || "/";
}

/** `react-dom/client` → [`react-dom`, `/client`]; `@scope/pkg/x` → [`@scope/pkg`, `/x`]. */
export function splitBare(spec        )                   {
  const parts = spec.split("/");
  const n = spec.startsWith("@") ? 2 : 1;
  return [parts.slice(0, n).join("/"), parts.length > n ? "/" + parts.slice(n).join("/") : ""];
}

/** Turns a file path into its module key. */
export function moduleKey(path        )         {
  if (/\.(m?js)$/.test(path)) return "sbx:" + path;
  if (/\.(tsx?|jsx|mts)$/.test(path)) return "sbx:" + path.replace(/\.(tsx?|jsx|mts)$/, ".js");
  return "sbx:" + path + ".js"; // /App.svelte → sbx:/App.svelte.js, /a.css → sbx:/a.css.js
}

function lineCol(src        , offset        )                                   {
  let line = 1;
  let last = -1;
  for (let i = 0; i < offset && i < src.length; i++) if (src[i] === "\n") (line++, (last = i));
  return { line, column: offset - last };
}

async function tryImport   (spec        )                    {
  try {
    return (await import(/* @vite-ignore */ /* webpackIgnore: true */ spec))     ;
  } catch {
    return null;
  }
}

const isBrowserLike = typeof (globalThis                          ).document !== "undefined" ||
  typeof (globalThis                                   ).WorkerGlobalScope !== "undefined";

// ---- built-in plugins ----------------------------------------------------

const cssModule = (css        ) =>
  `const css = ${JSON.stringify(css)};\nconst style = document.createElement("style");\nstyle.textContent = css;\ndocument.head.append(style);\nexport default css;\n`;

const BUILTIN           = [
  {
    name: "js",
    test: (p) => /\.m?js$/.test(p),
    transform: (code) => code,
  },
  {
    name: "typescript",
    test: (p) => /\.(tsx?|jsx|mts)$/.test(p),
    async transform(code, path, ctx) {
      const ts = await ctx.typescript();
      const isJsx = /\.(tsx|jsx)$/.test(path);
      const compilerOptions                          = {
        target: 99, // ESNext
        module: 99, // ESNext
        inlineSourceMap: ctx.options.sourcemap,
        inlineSources: ctx.options.sourcemap,
        verbatimModuleSyntax: false,
        isolatedModules: true,
        useDefineForClassFields: true,
        experimentalDecorators: false,
      };
      // Only JSX files get JSX settings: TypeScript rejects `jsx: undefined` with a warning.
      if (isJsx) {
        compilerOptions.jsx = 4; // react-jsx
        compilerOptions.jsxImportSource = ctx.options.jsx;
      }
      const r = ts.transpileModule(code, { fileName: path, reportDiagnostics: true, compilerOptions });
      for (const d of r.diagnostics ?? []) {
        const msg = typeof d.messageText === "string" ? d.messageText : ts.flattenDiagnosticMessageText?.(d.messageText, "\n") ?? String(d.messageText);
        const lc = d.start != null ? lineCol(code, d.start) : undefined;
        // Syntax errors (category 1) break the module: fail the build instead of shipping it.
        if (d.category === 1) ctx.error(msg, lc?.line, lc?.column);
        else ctx.warn(msg, lc?.line, lc?.column);
      }
      return r.outputText;
    },
  },
  {
    name: "svelte",
    test: (p) => p.endsWith(".svelte"),
    async transform(code, path, ctx) {
      const svelte = await ctx.svelte();
      const r = svelte.compile(code, { filename: path, generate: "client", css: "injected", dev: false });
      for (const w of r.warnings ?? []) ctx.warn(w.message, w.start?.line, w.start?.column);
      return r.js.code;
    },
  },
  { name: "css", test: (p) => p.endsWith(".css"), transform: (code) => cssModule(code) },
  {
    name: "json",
    test: (p) => p.endsWith(".json"),
    transform: (code) => `export default ${JSON.stringify(JSON.parse(code))};\n`,
  },
  {
    name: "text",
    test: (p) => /\.(txt|svg|html|md)$/.test(p),
    transform: (code) => `export default ${JSON.stringify(code)};\n`,
  },
];

// ---- compile -------------------------------------------------------------

/** Compiles source files into an artifact. Never throws; problems come back as diagnostics. */
export async function compile(input             , options                 = {})                         {
  const files              = {};
  for (const [p, c] of Object.entries(input)) files[normalizePath(p)] = c;
  const diagnostics               = [];
  const err = (d                              ) => diagnostics.push({ ...d, severity: "error" });

  // manifest
  let manifest                   = {};
  if (options.manifest) manifest = { ...options.manifest };
  else if (files["/manifest.json"]) {
    try {
      manifest = JSON.parse(files["/manifest.json"]);
    } catch (e) {
      err({ file: "/manifest.json", message: `Invalid JSON: ${(e         ).message}`, source: "manifest" });
    }
  }
  const deps                         = {
    ...DEFAULT_VERSIONS,
    ...((manifest.dependencies                                      ) ?? {}),
    ...(options.dependencies ?? {}),
  };
  const jsx = options.jsx ?? (manifest.jsx                                  ) ??
    ((manifest.dependencies                                      )?.preact && !(manifest.dependencies                          )?.react ? "preact" : "react");
  const cdn = options.cdn ?? esmSh;
  const provided = options.provided ?? ((s        ) => s === "@panth977/sandbox" || s.startsWith("@panth977/sandbox/"));
  const sourcemap = options.sourcemap ?? true;

  let tsPromise                         = null;
  let sveltePromise                             = null;
  const loadTs = () =>
    (tsPromise ??= (async () => {
      if (options.typescript) return await options.typescript();
      const local = isBrowserLike ? null : await tryImport                               ("typescript");
      const mod = local ?? (await tryImport                               (cdn("typescript", deps.typescript, "")));
      const ts = (mod?.default ?? mod)                 ;
      if (!ts?.transpileModule) throw new Error("TypeScript compiler not available (install `typescript` or allow the CDN)");
      return ts;
    })());
  const loadSvelte = () =>
    (sveltePromise ??= (async () => {
      if (options.svelte) return await options.svelte();
      const local = isBrowserLike ? null : await tryImport            ("svelte/compiler");
      const mod = local ?? (await tryImport            (cdn("svelte", deps.svelte, "/compiler")));
      if (!mod?.compile) throw new Error("Svelte compiler not available (install `svelte` or allow the CDN)");
      return mod;
    })());

  const plugins = [...(options.plugins ?? []), ...BUILTIN];

  // entry
  let entry = options.entry ?? (typeof manifest.entry === "string" ? manifest.entry : undefined);
  entry = entry ? normalizePath(entry) : ENTRY_CANDIDATES.find((c) => c in files);
  if (!entry || !(entry in files)) {
    err({ message: entry ? `Entry ${entry} not found` : "No entry file (add /index.tsx, /index.js, /App.svelte… or manifest.entry)", source: "resolve" });
    return { ok: false, diagnostics, files: [] };
  }

  const modules                         = {};
  const imports                         = {};
  const order           = [];
  const seen = new Set        ();

  const resolveRelative = (from        , spec        )                => {
    const base = normalizePath(spec.startsWith("/") ? spec : dirOf(from) + "/" + spec);
    if (base in files) return base;
    for (const e of EXTS) if (base + e in files) return base + e;
    // `./x.js` written for a `./x.ts` source (TypeScript convention)
    const m = base.match(/^(.*)\.(m?js|jsx)$/);
    if (m) for (const e of [".ts", ".tsx", ".mts"]) if (m[1] + e in files) return m[1] + e;
    for (const e of EXTS) if (`${base}/index${e}` in files) return `${base}/index${e}`;
    return null;
  };

  async function load(path        )                {
    if (seen.has(path)) return;
    seen.add(path);
    order.push(path);
    const src = files[path];
    let js                = null;
    const warn = (message        , line         , column         ) =>
      diagnostics.push({ file: path, line, column, message, severity: "warning", source: "transform" });
    const error = (message        , line         , column         ) =>
      diagnostics.push({ file: path, line, column, message, severity: "error", source: "transform" });
    const ctx                = { options: { jsx, sourcemap }, manifest, typescript: loadTs, svelte: loadSvelte, warn, error };
    try {
      for (const p of plugins) {
        if (!p.test(path)) continue;
        js = await p.transform(src, path, ctx);
        if (js !== null) break;
      }
    } catch (e) {
      const ex = e                                                                                       ;
      err({ file: path, line: ex.start?.line, column: ex.start?.column, message: ex.message ?? String(e), source: "transform" });
      return;
    }
    if (js === null) {
      err({ file: path, message: `No transform for ${path}`, source: "transform" });
      return;
    }
    const refs = scanSpecifiers(js);
    const children           = [];
    const rewritten = rewriteSpecifiers(js, refs, (r) => {
      const spec = r.value;
      if (spec.startsWith(".") || spec.startsWith("/")) {
        const target = resolveRelative(path, spec);
        if (!target) {
          err({ file: path, message: `Cannot find module "${spec}"`, source: "resolve" });
          return undefined;
        }
        children.push(target);
        return moduleKey(target);
      }
      if (/^(https?:|data:|blob:)/.test(spec)) {
        if (spec.startsWith("http")) imports[spec] = spec;
        return undefined;
      }
      if (spec.startsWith("sbx:")) return undefined;
      if (provided(spec)) return undefined;
      const bare = spec.startsWith("node:") ? spec.slice(5) : spec;
      if (spec.startsWith("node:") || NODE_BUILTINS.has(splitBare(bare)[0])) {
        err({ file: path, message: `"${spec}" is a Node.js module; artifacts run in the browser`, source: "resolve" });
        return undefined;
      }
      const [name, sub] = splitBare(spec);
      const version = deps[name] ?? "latest";
      if (!(name in deps)) {
        diagnostics.push({ file: path, message: `"${name}" is not in manifest.dependencies; using latest`, severity: "warning", source: "resolve" });
      }
      imports[spec] = cdn(name, version, sub);
      return undefined;
    });
    modules[moduleKey(path)] = rewritten;
    for (const c of children) await load(c);
  }

  await load(entry);
  const htmlBody = files["/index.html"] ? extractBody(files["/index.html"]) : undefined;
  const ok = !diagnostics.some((d) => d.severity === "error");
  const artifact                   = {
    protocol: PROTOCOL,
    entry: moduleKey(entry),
    modules,
    css: [],
    imports,
    ...(htmlBody !== undefined ? { html: htmlBody } : {}),
    manifest: { ...manifest, entry },
  };
  return { ok, artifact: ok ? artifact : undefined, diagnostics, files: order };
}

/** The inside of `<body>` of an HTML file (scripts removed: the entry is the script). */
export function extractBody(html        )         {
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return (m ? m[1] : html).replace(/<script[\s\S]*?<\/script>/gi, "").trim();
}
