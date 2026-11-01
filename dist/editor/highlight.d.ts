/**
 * Syntax highlighting for the editor: small, fast, regex-driven tokenizers
 * for TS/JS/JSX, CSS, JSON, HTML and Svelte. Output is HTML with
 * `<span class="t-…">` around tokens.
 *
 * @module
 */
export type Language = "ts" | "tsx" | "js" | "jsx" | "css" | "json" | "html" | "svelte" | "md" | "text";
export declare function languageOf(path: string): Language;
/** Highlights `src` as `lang`; returns HTML. */
export declare function highlight(src: string, lang: Language): string;
export declare const HIGHLIGHT_CSS = "\n.t-comment { color: var(--sbx-ed-comment, #8b949e); font-style: italic; }\n.t-string { color: var(--sbx-ed-string, #0a7f3f); }\n.t-number { color: var(--sbx-ed-number, #b35900); }\n.t-keyword { color: var(--sbx-ed-keyword, #a626a4); }\n.t-type { color: var(--sbx-ed-type, #1d6fb8); }\n.t-tag { color: var(--sbx-ed-tag, #c4342d); }\n.t-prop { color: var(--sbx-ed-prop, #1d6fb8); }\n.t-decorator { color: var(--sbx-ed-keyword, #a626a4); }\n.t-punct, .t-op { color: var(--sbx-ed-punct, inherit); }\n:host([theme=\"dark\"]) .t-comment { color: #7d8590; }\n:host([theme=\"dark\"]) .t-string { color: #7ee2a8; }\n:host([theme=\"dark\"]) .t-number { color: #f0b072; }\n:host([theme=\"dark\"]) .t-keyword { color: #d2a8ff; }\n:host([theme=\"dark\"]) .t-type, :host([theme=\"dark\"]) .t-prop { color: #79c0ff; }\n:host([theme=\"dark\"]) .t-tag { color: #ff8f86; }\n";
