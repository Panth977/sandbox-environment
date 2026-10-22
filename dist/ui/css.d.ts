/**
 * The UI kit's stylesheet: design tokens, base typography and the CSS classes
 * for native elements (buttons, inputs, cards, badges, tables, layout…).
 * Interactive widgets are custom elements (see the other ui/ modules); they
 * read the same tokens.
 *
 * Theme it by setting the `--sbx-*` variables (the host's `theme.vars`), and
 * switch light/dark with `<html data-theme="dark">` (no attribute = follow the
 * system). Base element styles use `:where()`, so any of your own CSS wins.
 *
 * @module
 */
/** Tokens only (light, dark, system). Useful for host pages that want the same palette. */
export declare const TOKENS_CSS: string;
/** Base element styles (zero specificity) and the kit's classes. */
export declare const BASE_CSS: string;
/** Tokens + base + classes. */
export declare const KIT_CSS: string;
/** Shared styles for the custom elements' shadow roots (they read the tokens above). */
export declare const SHADOW_BASE_CSS: string;
