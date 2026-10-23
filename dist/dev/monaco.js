/**
 * Monaco (the editor of VS Code) for the dev engine, loaded on demand from a
 * CDN — no bundler, no install. Monaco is a peer tool like TypeScript: the
 * kit's runtime never depends on it, only the dev engine loads it.
 *
 * The `min` build is an AMD bundle: its loader is put on the page once, and
 * its workers (classic scripts) are started from a same-origin blob that
 * `importScripts` the CDN file, since a page cannot start a cross-origin
 * worker directly.
 *
 * @module
 */
/* deno-lint-ignore-file no-explicit-any */

/** The `monaco` namespace (typed loosely: the kit carries no Monaco types). */

/** The Monaco version the kit is built and tested against. */
export const MONACO_VERSION = "0.57.0";
export const MONACO_BASE = `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min`;

/** Worker files of the pinned version (`min/vs/assets`, content-hashed). */
const WORKERS                         = {
  editor: "editor.worker-_vAIFJDs.js",
  json: "json.worker-Csf_TLih.js",
  css: "css.worker-BpD9FCKP.js",
  html: "html.worker-CLuInTTy.js",
  ts: "ts.worker-g3pjEjl4.js",
};

function workerFor(base        , label        )         {
  const file = label === "json" ? WORKERS.json
    : label === "css" || label === "scss" || label === "less" ? WORKERS.css
    : label === "html" || label === "handlebars" || label === "razor" ? WORKERS.html
    : label === "typescript" || label === "javascript" ? WORKERS.ts
    : WORKERS.editor;
  const src = `importScripts(${JSON.stringify(`${base}/vs/assets/${file}`)});`;
  return new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })), { name: label });
}

let loading                         = null;

/**
 * Loads Monaco once per page and resolves with the `monaco` namespace.
 * `base` is a `…/monaco-editor@<version>/min` folder (default jsDelivr);
 * a page that already has `window.monaco` gets that one.
 */
export function loadMonaco(base         = MONACO_BASE)                  {
  const g = globalThis       ;
  if (g.monaco?.editor) return Promise.resolve(g.monaco);
  if (loading) return loading;
  base = base.replace(/\/$/, "");
  loading = new Promise        ((resolve, reject) => {
    g.MonacoEnvironment = {
      ...(g.MonacoEnvironment ?? {}),
      getWorker: (_id        , label        ) => workerFor(base, label),
    };
    const ready = () => {
      const req = g.require;
      req.config({ paths: { vs: `${base}/vs` } });
      req(["vs/editor/editor.main"], (m        ) => {
        // Keep other scripts' UMD wrappers from registering with Monaco's loader.
        if (g.define?.amd) g.define.amd = undefined;
        resolve(g.monaco ?? m);
      }, (e         ) => reject(e));
    };
    if (typeof g.require?.config === "function" && g.define?.amd !== undefined) return ready();
    const s = document.createElement("script");
    s.src = `${base}/vs/loader.js`;
    s.async = true;
    s.onload = ready;
    s.onerror = () => reject(new Error(`Could not load the editor from ${base}`));
    document.head.append(s);
  }).catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

/** Monaco's language id for a file path. */
export function monacoLanguage(path        )         {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return ({
    ts: "typescript", tsx: "typescript", mts: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript",
    json: "json", css: "css", html: "html", svelte: "svelte", md: "markdown", svg: "xml",
  }                          )[ext] ?? "plaintext";
}

let svelteDone = false;
/** A Svelte grammar: HTML-ish markup, `{…}` expressions and `<script>` as TypeScript, `<style>` as CSS. */
export function registerSvelte(monaco        )       {
  if (svelteDone) return;
  svelteDone = true;
  monaco.languages.register({ id: "svelte", extensions: [".svelte"], aliases: ["Svelte"] });
  monaco.languages.setLanguageConfiguration("svelte", {
    comments: { blockComment: ["<!--", "-->"] },
    brackets: [["<!--", "-->"], ["<", ">"], ["{", "}"], ["(", ")"], ["[", "]"]],
    autoClosingPairs: [{ open: "{", close: "}" }, { open: "[", close: "]" }, { open: "(", close: ")" }, { open: '"', close: '"' }, { open: "'", close: "'" }, { open: "`", close: "`" }],
    surroundingPairs: [{ open: "<", close: ">" }, { open: '"', close: '"' }, { open: "{", close: "}" }],
  });
  monaco.languages.setMonarchTokensProvider("svelte", {
    defaultToken: "",
    tokenPostfix: ".svelte",
    tokenizer: {
      root: [
        [/<!--/, "comment", "@comment"],
        [/(<)(script)/, ["delimiter", { token: "tag", next: "@scriptOpen" }]],
        [/(<)(style)/, ["delimiter", { token: "tag", next: "@styleOpen" }]],
        [/\{[#:/@]?/, { token: "delimiter.bracket", next: "@expr", nextEmbedded: "typescript" }],
        [/(<\/?)([\w:.-]+)/, ["delimiter", { token: "tag", next: "@tag" }]],
        [/[^<{]+/, ""],
        [/</, "delimiter"],
      ],
      comment: [[/-->/, "comment", "@pop"], [/[^-]+/, "comment.content"], [/./, "comment.content"]],
      expr: [[/\}/, { token: "delimiter.bracket", next: "@pop", nextEmbedded: "@pop" }]],
      tag: [
        [/\/?>/, "delimiter", "@pop"],
        [/\{/, { token: "delimiter.bracket", next: "@expr", nextEmbedded: "typescript" }],
        [/"[^"]*"|'[^']*'/, "attribute.value"],
        [/[\w:|.@-]+/, "attribute.name"],
        [/=/, "delimiter"],
        [/\s+/, ""],
      ],
      scriptOpen: [
        [/>/, { token: "delimiter", next: "@script", nextEmbedded: "typescript" }],
        [/"[^"]*"|'[^']*'/, "attribute.value"],
        [/[\w:-]+/, "attribute.name"],
        [/=/, "delimiter"],
        [/\s+/, ""],
      ],
      script: [[/<\/script\s*>/, { token: "@rematch", next: "@scriptEnd", nextEmbedded: "@pop" }]],
      scriptEnd: [[/(<\/)(script)(\s*)(>)/, ["delimiter", "tag", "", { token: "delimiter", next: "@root" }]]],
      styleOpen: [
        [/>/, { token: "delimiter", next: "@style", nextEmbedded: "css" }],
        [/"[^"]*"|'[^']*'/, "attribute.value"],
        [/[\w:-]+/, "attribute.name"],
        [/=/, "delimiter"],
        [/\s+/, ""],
      ],
      style: [[/<\/style\s*>/, { token: "@rematch", next: "@styleEnd", nextEmbedded: "@pop" }]],
      styleEnd: [[/(<\/)(style)(\s*)(>)/, ["delimiter", "tag", "", { token: "delimiter", next: "@root" }]]],
    },
  });
}
