/**
 * Svelte files for the TypeScript language service: a `.svelte` source turned
 * into a virtual TS (or JS) file of the SAME length, so every offset in the
 * editor is the same offset in the virtual file — completions, hover and
 * diagnostics need no position mapping.
 *
 *   <script lang="ts"> … </script>   kept as is (instance and module scripts)
 *   {expr} · attr={expr}             kept, braces turned into `;` (template
 *                                     expressions see the script's variables)
 *   {#if expr} {:else if expr}        the expression kept, the keyword blanked
 *   everything else                   blanked to spaces (newlines kept)
 *
 * After the original text come declarations the template needs: one
 * `$store` per store the code auto-subscribes to. Rune declarations
 * ($state, $derived, $props…) are an ambient file, SVELTE_RUNE_TYPES.
 *
 * @module
 */

export interface SvelteVirtual {
  /** Same length as the source for the first `source.length` characters. */
  code: string;
  /** `<script lang="ts">` present. */
  ts: boolean;
  /** [start, end) of script contents: diagnostics outside them are template noise. */
  scripts: [number, number][];
}

/** Ambient declarations for Svelte 5 runes. */
export const SVELTE_RUNE_TYPES: string = `
declare function $state<T>(initial: T): T;
declare function $state<T>(): T | undefined;
declare namespace $state {
  function raw<T>(initial: T): T;
  function raw<T>(): T | undefined;
  function snapshot<T>(state: T): T;
}
declare function $derived<T>(expression: T): T;
declare namespace $derived { function by<T>(fn: () => T): T; }
declare function $effect(fn: () => void | (() => void)): void;
declare namespace $effect {
  function pre(fn: () => void | (() => void)): void;
  function root(fn: () => void | (() => void)): () => void;
  function tracking(): boolean;
}
declare function $props<T = Record<string, any>>(): T;
declare function $bindable<T>(fallback?: T): T;
declare function $inspect<T extends any[]>(...values: T): { with(fn: (type: "init" | "update", ...values: T) => void): void };
declare function $host<El extends HTMLElement = HTMLElement>(): El;
type __SbxStoreValue<S> = S extends { subscribe(run: (value: infer V) => any, ...args: any[]): any } ? V : never;
`;

const RUNES = new Set(["state", "derived", "effect", "props", "bindable", "inspect", "host"]);

const blank = (s: string) => s.replace(/[^\n]/g, " ");

/** End of a `{…}` starting at `i` (index of the closing brace), honouring nesting and strings. */
function matchBrace(src: string, i: number): number {
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      for (j++; j < src.length && src[j] !== q; j++) if (src[j] === "\\") j++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return j;
  }
  return -1;
}

/** One template expression block `{…}` → same-length TS. */
function mustache(block: string): string {
  const inner = block.slice(1, -1);
  // {#if x} {:else if x} {#await p} {#key k} {@html x} {@const a = b} {@render s()}
  const m = /^(\s*(?:#if|:else\s+if|#await|#key|@html|@render|@debug)\s)/.exec(inner);
  if (m) return ";" + blank(m[1]) + inner.slice(m[1].length) + ";";
  const each = /^(\s*#each\s)([\s\S]*?)(\sas\s[\s\S]*)?$/.exec(inner);
  if (each) return ";" + blank(each[1]) + each[2] + blank(each[3] ?? "") + ";";
  const cnst = /^(\s*@const\s)([\s\S]*)$/.exec(inner);
  if (cnst) return ";" + blank(cnst[1]) + blank(cnst[2]) + ";";
  if (/^\s*[:/#@]/.test(inner)) return blank(block); // {:else} {/if} {#snippet …} …
  return ";" + inner + ";";
}

/** Turns a .svelte source into its same-length virtual TS/JS file. */
export function svelteToVirtual(src: string): SvelteVirtual {
  let out = "";
  let ts = false;
  const scripts: [number, number][] = [];
  let i = 0;
  const tag = /<(script|style)\b([^>]*)>/gi;
  while (i < src.length) {
    tag.lastIndex = i;
    const t = tag.exec(src);
    const stop = t ? t.index : src.length;
    // template between i and stop
    let j = i;
    while (j < stop) {
      if (src.startsWith("<!--", j)) {
        const e = src.indexOf("-->", j);
        const end = e < 0 ? stop : Math.min(stop, e + 3);
        out += blank(src.slice(j, end));
        j = end;
        continue;
      }
      if (src[j] === "{") {
        const e = matchBrace(src, j);
        if (e > 0 && e < stop) {
          out += mustache(src.slice(j, e + 1));
          j = e + 1;
          continue;
        }
      }
      out += src[j] === "\n" ? "\n" : " ";
      j++;
    }
    if (!t) break;
    const open = t[0];
    const bodyStart = t.index + open.length;
    const close = src.toLowerCase().indexOf(`</${t[1].toLowerCase()}`, bodyStart);
    const bodyEnd = close < 0 ? src.length : close;
    const closeEnd = close < 0 ? src.length : src.indexOf(">", close) + 1 || src.length;
    out += blank(open);
    if (t[1].toLowerCase() === "script") {
      if (/\blang\s*=\s*["']?ts\b/i.test(t[2])) ts = true;
      out += src.slice(bodyStart, bodyEnd);
      scripts.push([bodyStart, bodyEnd]);
    } else out += blank(src.slice(bodyStart, bodyEnd));
    out += blank(src.slice(bodyEnd, closeEnd));
    i = closeEnd;
  }
  // stores read with $name, declared by the script
  const declared = new Set<string>();
  for (const [a, b] of scripts) {
    for (const m of src.slice(a, b).matchAll(/\b(?:const|let|var|import)\s+(?:\{[^}]*\}|[A-Za-z_$][\w$]*)/g)) {
      for (const n of m[0].matchAll(/[A-Za-z_$][\w$]*/g)) declared.add(n[0]);
    }
  }
  const stores = new Set<string>();
  for (const m of out.matchAll(/(?<![\w$])\$([A-Za-z_][\w$]*)/g)) {
    if (!RUNES.has(m[1]) && declared.has(m[1])) stores.add(m[1]);
  }
  let tail = "\n";
  for (const s of stores) tail += `declare const $${s}: __SbxStoreValue<typeof ${s}>;\n`;
  return { code: out + tail + "export {};\n", ts, scripts };
}
