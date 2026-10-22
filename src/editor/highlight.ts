/**
 * Syntax highlighting for the editor: small, fast, regex-driven tokenizers
 * for TS/JS/JSX, CSS, JSON, HTML and Svelte. Output is HTML with
 * `<span class="t-…">` around tokens.
 *
 * @module
 */

export type Language = "ts" | "tsx" | "js" | "jsx" | "css" | "json" | "html" | "svelte" | "md" | "text";

export function languageOf(path: string): Language {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "mjs" || ext === "cjs") return "js";
  if (["ts", "tsx", "js", "jsx", "css", "json", "html", "svelte", "md"].includes(ext)) return ext as Language;
  return "text";
}

const escHtml = (s: string) => s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));

const JS_KEYWORDS = new Set(
  ("abstract as async await break case catch class const continue debugger declare default delete do else enum export extends " +
    "false finally for from function get if implements import in infer instanceof interface is keyof let namespace new null of " +
    "private protected public readonly return satisfies set static super switch this throw true try type typeof undefined unique " +
    "var void while with yield").split(" "),
);
const JS_TYPES = new Set("string number boolean any unknown never object symbol bigint void".split(" "));

interface Rule {
  re: RegExp;
  cls: string | ((m: string) => string);
}

function tokenize(src: string, rules: Rule[]): string {
  // one sticky regex per rule, tried in order at each position
  const sticky = rules.map((r) => ({ re: new RegExp(r.re.source, "y" + r.re.flags.replace(/[gy]/g, "")), cls: r.cls }));
  let out = "";
  let i = 0;
  let plain = "";
  while (i < src.length) {
    let matched = false;
    for (const r of sticky) {
      r.re.lastIndex = i;
      const m = r.re.exec(src);
      if (m && m[0].length) {
        if (plain) {
          out += escHtml(plain);
          plain = "";
        }
        const cls = typeof r.cls === "function" ? r.cls(m[0]) : r.cls;
        out += cls ? `<span class="t-${cls}">${escHtml(m[0])}</span>` : escHtml(m[0]);
        i += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) plain += src[i++];
  }
  return out + escHtml(plain);
}

const JS_RULES: Rule[] = [
  { re: /\/\/[^\n]*/, cls: "comment" },
  { re: /\/\*[\s\S]*?(?:\*\/|$)/, cls: "comment" },
  { re: /`(?:\\[\s\S]|[^`\\])*`?/, cls: "string" },
  { re: /"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?/, cls: "string" },
  { re: /<\/?[A-Za-z][\w.:-]*/, cls: "tag" }, // JSX tags (also matches `a < b` rarely; acceptable for display)
  { re: /\b(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?n?)\b/, cls: "number" },
  { re: /@[A-Za-z_$][\w$]*/, cls: "decorator" },
  {
    re: /[A-Za-z_$][\w$]*/,
    cls: (w) => (JS_KEYWORDS.has(w) ? "keyword" : JS_TYPES.has(w) ? "type" : /^[A-Z]/.test(w) ? "type" : ""),
  },
  { re: /=>|[{}()[\];,.]/, cls: "punct" },
  { re: /[+\-*/%=!<>&|^~?:]+/, cls: "op" },
];

const CSS_RULES: Rule[] = [
  { re: /\/\*[\s\S]*?(?:\*\/|$)/, cls: "comment" },
  { re: /"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?/, cls: "string" },
  { re: /@[\w-]+/, cls: "keyword" },
  { re: /#[\da-fA-F]{3,8}\b/, cls: "number" },
  { re: /-?\d*\.?\d+(?:px|rem|em|%|vh|vw|s|ms|deg|fr)?/, cls: "number" },
  { re: /--[\w-]+/, cls: "type" },
  { re: /[\w-]+(?=\s*:)/, cls: "prop" },
  { re: /[.#]?[A-Za-z_][\w-]*/, cls: "" },
  { re: /[{}();:,]/, cls: "punct" },
];

const JSON_RULES: Rule[] = [
  { re: /"(?:\\.|[^"\\\n])*"(?=\s*:)/, cls: "prop" },
  { re: /"(?:\\.|[^"\\\n])*"?/, cls: "string" },
  { re: /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, cls: "number" },
  { re: /\b(?:true|false|null)\b/, cls: "keyword" },
  { re: /[{}[\],:]/, cls: "punct" },
];

const HTML_RULES: Rule[] = [
  { re: /<!--[\s\S]*?(?:-->|$)/, cls: "comment" },
  { re: /<\/?[A-Za-z][\w:-]*/, cls: "tag" },
  { re: /\/?>/, cls: "tag" },
  { re: /"(?:[^"])*"?|'(?:[^'])*'?/, cls: "string" },
  { re: /\{[#:/@][a-z]+/, cls: "keyword" }, // svelte blocks
  { re: /[\w:-]+(?==)/, cls: "prop" },
];

/** Highlights `src` as `lang`; returns HTML. */
export function highlight(src: string, lang: Language): string {
  switch (lang) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
      return tokenize(src, JS_RULES);
    case "css":
      return tokenize(src, CSS_RULES);
    case "json":
      return tokenize(src, JSON_RULES);
    case "html":
    case "svelte":
      return highlightMarkup(src);
    default:
      return escHtml(src);
  }
}

/** HTML / Svelte: markup, with <script> and <style> bodies highlighted as code. */
function highlightMarkup(src: string): string {
  let out = "";
  let i = 0;
  const re = /<(script|style)\b[^>]*>/gi;
  for (;;) {
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) break;
    const openEnd = m.index + m[0].length;
    const close = src.toLowerCase().indexOf(`</${m[1].toLowerCase()}`, openEnd);
    const bodyEnd = close < 0 ? src.length : close;
    out += tokenize(src.slice(i, openEnd), HTML_RULES);
    out += tokenize(src.slice(openEnd, bodyEnd), m[1].toLowerCase() === "style" ? CSS_RULES : JS_RULES);
    i = bodyEnd;
  }
  return out + tokenize(src.slice(i), HTML_RULES);
}

export const HIGHLIGHT_CSS = `
.t-comment { color: var(--sbx-ed-comment, #8b949e); font-style: italic; }
.t-string { color: var(--sbx-ed-string, #0a7f3f); }
.t-number { color: var(--sbx-ed-number, #b35900); }
.t-keyword { color: var(--sbx-ed-keyword, #a626a4); }
.t-type { color: var(--sbx-ed-type, #1d6fb8); }
.t-tag { color: var(--sbx-ed-tag, #c4342d); }
.t-prop { color: var(--sbx-ed-prop, #1d6fb8); }
.t-decorator { color: var(--sbx-ed-keyword, #a626a4); }
.t-punct, .t-op { color: var(--sbx-ed-punct, inherit); }
:host([theme="dark"]) .t-comment { color: #7d8590; }
:host([theme="dark"]) .t-string { color: #7ee2a8; }
:host([theme="dark"]) .t-number { color: #f0b072; }
:host([theme="dark"]) .t-keyword { color: #d2a8ff; }
:host([theme="dark"]) .t-type, :host([theme="dark"]) .t-prop { color: #79c0ff; }
:host([theme="dark"]) .t-tag { color: #ff8f86; }
`;
