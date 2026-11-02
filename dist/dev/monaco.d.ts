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
/** The `monaco` namespace (typed loosely: the kit carries no Monaco types). */
export type Monaco = any;
/** The Monaco version the kit is built and tested against. */
export declare const MONACO_VERSION = "0.57.0";
export declare const MONACO_BASE = "https://cdn.jsdelivr.net/npm/monaco-editor@0.57.0/min";
/**
 * Loads Monaco once per page and resolves with the `monaco` namespace.
 * `base` is a `…/monaco-editor@<version>/min` folder (default jsDelivr);
 * a page that already has `window.monaco` gets that one.
 */
export declare function loadMonaco(base?: string): Promise<Monaco>;
/** Monaco's language id for a file path. */
export declare function monacoLanguage(path: string): string;
/** A Svelte grammar: HTML-ish markup, `{…}` expressions and `<script>` as TypeScript, `<style>` as CSS. */
export declare function registerSvelte(monaco: Monaco): void;
