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
export declare const SVELTE_RUNE_TYPES: string;
/** Turns a .svelte source into its same-length virtual TS/JS file. */
export declare function svelteToVirtual(src: string): SvelteVirtual;
