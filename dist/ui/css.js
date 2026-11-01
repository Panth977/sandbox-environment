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

const LIGHT         = `
  --sbx-bg: #f7f6f3;
  --sbx-surface: #ffffff;
  --sbx-surface-2: #f1efeb;
  --sbx-surface-3: #e8e5df;
  --sbx-line: #e3e0da;
  --sbx-line-strong: #cfcac2;
  --sbx-text: #1f1d1a;
  --sbx-muted: #6b6560;
  --sbx-subtle: #9a938c;
  --sbx-accent: #3f5fe0;
  --sbx-accent-hover: #3452c9;
  --sbx-accent-fg: #ffffff;
  --sbx-accent-soft: #e7ebfc;
  --sbx-danger: #c93a32;
  --sbx-danger-soft: #fbe9e7;
  --sbx-success: #25855a;
  --sbx-success-soft: #e3f4ea;
  --sbx-warning: #b7791f;
  --sbx-warning-soft: #fdf3dc;
  --sbx-overlay: rgb(20 18 16 / 0.42);
  --sbx-shadow: 0 1px 2px rgb(0 0 0 / 0.06), 0 6px 24px rgb(0 0 0 / 0.08);
  --sbx-c1: #3f5fe0; --sbx-c2: #25855a; --sbx-c3: #d9822b; --sbx-c4: #c93a32;
  --sbx-c5: #8b5cf6; --sbx-c6: #0e9aa7; --sbx-c7: #d6409f; --sbx-c8: #7a6f62;
`;

const DARK         = `
  --sbx-bg: #151413;
  --sbx-surface: #1c1b19;
  --sbx-surface-2: #252320;
  --sbx-surface-3: #2f2c29;
  --sbx-line: #2f2c29;
  --sbx-line-strong: #423e3a;
  --sbx-text: #ece9e4;
  --sbx-muted: #a39d96;
  --sbx-subtle: #78726c;
  --sbx-accent: #7089f5;
  --sbx-accent-hover: #859bf7;
  --sbx-accent-fg: #0f1220;
  --sbx-accent-soft: #252c4a;
  --sbx-danger: #ef6b62;
  --sbx-danger-soft: #3a1f1d;
  --sbx-success: #4cc38a;
  --sbx-success-soft: #173026;
  --sbx-warning: #e0a84a;
  --sbx-warning-soft: #362a14;
  --sbx-overlay: rgb(0 0 0 / 0.6);
  --sbx-shadow: 0 1px 2px rgb(0 0 0 / 0.4), 0 8px 28px rgb(0 0 0 / 0.45);
  --sbx-c1: #7089f5; --sbx-c2: #4cc38a; --sbx-c3: #f0a35e; --sbx-c4: #ef6b62;
  --sbx-c5: #a78bfa; --sbx-c6: #3cc6d0; --sbx-c7: #ec6cb9; --sbx-c8: #b3a796;
`;

/** Tokens only (light, dark, system). Useful for host pages that want the same palette. */
export const TOKENS_CSS         = `
:root {
  color-scheme: light;
  ${LIGHT}
  --sbx-radius: 6px;
  --sbx-radius-lg: 10px;
  --sbx-font: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --sbx-font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --sbx-font-size: 14px;
  --sbx-control-h: 32px;
}
:root[data-theme="dark"] { color-scheme: dark; ${DARK} }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) { color-scheme: dark; ${DARK} }
}
`;

/** Base element styles (zero specificity): typography, links, code, focus. For artifact documents. */
export const ELEMENT_CSS         = `
:where(html) {
  background: var(--sbx-bg); color: var(--sbx-text);
  font-family: var(--sbx-font); font-size: var(--sbx-font-size); line-height: 1.5;
  -webkit-font-smoothing: antialiased; -webkit-text-size-adjust: 100%;
}
:where(*, *::before, *::after) { box-sizing: border-box; }
[hidden] { display: none !important; }
:where(body) { margin: 0; }
:where(h1, h2, h3, h4, h5, h6) { margin: 0 0 .5em; line-height: 1.25; font-weight: 600; letter-spacing: -0.01em; }
:where(h1) { font-size: 1.75rem; } :where(h2) { font-size: 1.375rem; } :where(h3) { font-size: 1.125rem; }
:where(h4) { font-size: 1rem; } :where(h5, h6) { font-size: .875rem; }
:where(p, ul, ol, dl, blockquote, pre, table, figure) { margin: 0 0 1em; }
:where(ul, ol) { padding-left: 1.4em; }
:where(a) { color: var(--sbx-accent); text-decoration: none; }
:where(a:hover) { text-decoration: underline; }
:where(small) { font-size: .857em; color: var(--sbx-muted); }
:where(code, kbd, samp, pre) { font-family: var(--sbx-font-mono); font-size: .92em; }
:where(code) { background: var(--sbx-surface-2); border-radius: 4px; padding: .1em .35em; }
:where(pre) { background: var(--sbx-surface-2); border: 1px solid var(--sbx-line); border-radius: var(--sbx-radius); padding: 12px 14px; overflow: auto; }
:where(pre code) { background: none; padding: 0; }
:where(blockquote) { border-left: 3px solid var(--sbx-line-strong); padding-left: 12px; color: var(--sbx-muted); }
:where(hr) { border: 0; border-top: 1px solid var(--sbx-line); margin: 16px 0; }
:where(img, svg, video, canvas) { max-width: 100%; }
:where(button, input, select, textarea) { font: inherit; color: inherit; }
:where(:focus-visible) { outline: 2px solid var(--sbx-accent); outline-offset: 2px; }
::selection { background: color-mix(in srgb, var(--sbx-accent) 40%, transparent); }
:where(dialog)::backdrop { background: var(--sbx-overlay); }

`;

/** The kit's classes (.sbx-*) and pre-upgrade rules. Safe on any page. */
export const BASE_CSS         = `
[hidden] { display: none !important; }
/* text */
.sbx-muted { color: var(--sbx-muted); } .sbx-subtle { color: var(--sbx-subtle); }
.sbx-danger-text { color: var(--sbx-danger); } .sbx-success-text { color: var(--sbx-success); }
.sbx-mono { font-family: var(--sbx-font-mono); }
.sbx-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sbx-title { font-size: 1.25rem; font-weight: 600; margin: 0; }
.sbx-caption { font-size: 12px; color: var(--sbx-muted); }
.sbx-kbd { display: inline-block; font-family: var(--sbx-font-mono); font-size: 11px; padding: 0 5px; border: 1px solid var(--sbx-line-strong); border-bottom-width: 2px; border-radius: 4px; background: var(--sbx-surface); }

/* layout */
.sbx-page { padding: 20px; max-width: 1200px; margin: 0 auto; }
.sbx-stack { display: flex; flex-direction: column; gap: var(--sbx-gap, 12px); }
.sbx-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sbx-gap, 8px); }
.sbx-row--between { justify-content: space-between; } .sbx-row--end { justify-content: flex-end; }
.sbx-row--nowrap { flex-wrap: nowrap; }
.sbx-grid { display: grid; gap: var(--sbx-gap, 12px); grid-template-columns: repeat(auto-fill, minmax(var(--sbx-min, 220px), 1fr)); }
.sbx-spacer { flex: 1; }
.sbx-toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--sbx-line); margin-bottom: 12px; }
.sbx-divider { border: 0; border-top: 1px solid var(--sbx-line); margin: 12px 0; }

/* buttons */
.sbx-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: var(--sbx-control-h); padding: 0 12px; border-radius: var(--sbx-radius);
  border: 1px solid var(--sbx-line); background: var(--sbx-surface); color: var(--sbx-text);
  font-size: 13px; font-weight: 500; white-space: nowrap; cursor: pointer; user-select: none;
  transition: background-color .12s, border-color .12s, color .12s, transform .06s; text-decoration: none;
}
.sbx-btn:hover { background: var(--sbx-surface-2); text-decoration: none; }
.sbx-btn:active { transform: translateY(1px); }
.sbx-btn:disabled, .sbx-btn[aria-disabled="true"] { opacity: .5; pointer-events: none; }
.sbx-btn--primary { background: var(--sbx-accent); color: var(--sbx-accent-fg); border-color: transparent; }
.sbx-btn--primary:hover { background: var(--sbx-accent-hover); }
.sbx-btn--ghost { background: transparent; border-color: transparent; }
.sbx-btn--ghost:hover { background: var(--sbx-surface-2); }
.sbx-btn--danger { background: var(--sbx-danger); color: #fff; border-color: transparent; }
.sbx-btn--danger:hover { background: var(--sbx-danger); filter: brightness(.95); }
.sbx-btn--link { background: none; border-color: transparent; color: var(--sbx-accent); padding: 0; height: auto; }
.sbx-btn--link:hover { background: none; text-decoration: underline; }
.sbx-btn--sm { height: 28px; padding: 0 8px; font-size: 12px; gap: 4px; }
.sbx-btn--lg { height: 40px; padding: 0 16px; font-size: 15px; gap: 8px; }
.sbx-btn--block { display: flex; width: 100%; }
.sbx-btn--icon { width: var(--sbx-control-h); padding: 0; }
.sbx-btn--icon.sbx-btn--sm { width: 28px; } .sbx-btn--icon.sbx-btn--lg { width: 40px; }
.sbx-btn[aria-busy="true"]::before, .sbx-spinner {
  content: ""; display: inline-block; width: 14px; height: 14px; flex: none;
  border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%;
  animation: sbx-spin .7s linear infinite;
}
.sbx-btn[aria-busy="true"] { pointer-events: none; }
.sbx-spinner { color: var(--sbx-accent); }
.sbx-spinner--lg { width: 24px; height: 24px; border-width: 3px; }
@keyframes sbx-spin { to { transform: rotate(360deg); } }
.sbx-btn-group { display: inline-flex; }
.sbx-btn-group > .sbx-btn { border-radius: 0; margin-left: -1px; }
.sbx-btn-group > .sbx-btn:first-child { border-radius: var(--sbx-radius) 0 0 var(--sbx-radius); margin-left: 0; }
.sbx-btn-group > .sbx-btn:last-child { border-radius: 0 var(--sbx-radius) var(--sbx-radius) 0; }
.sbx-btn-group > .sbx-btn[aria-pressed="true"] { background: var(--sbx-accent-soft); color: var(--sbx-accent); position: relative; }

/* form controls */
.sbx-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.sbx-label { font-size: 12px; font-weight: 500; color: var(--sbx-muted); }
.sbx-label[data-required]::after { content: " *"; color: var(--sbx-danger); }
.sbx-hint { font-size: 12px; color: var(--sbx-subtle); }
.sbx-error { font-size: 12px; color: var(--sbx-danger); }
.sbx-input, .sbx-textarea, .sbx-native-select {
  width: 100%; height: var(--sbx-control-h); padding: 0 10px; border-radius: var(--sbx-radius);
  border: 1px solid var(--sbx-line); background: var(--sbx-surface); color: var(--sbx-text); font-size: 13px;
  transition: border-color .12s, box-shadow .12s;
}
.sbx-textarea { height: auto; min-height: 72px; padding: 8px 10px; resize: vertical; line-height: 1.45; }
.sbx-native-select { padding-right: 28px; appearance: none; cursor: pointer;
  background-image: linear-gradient(45deg, transparent 50%, var(--sbx-muted) 50%), linear-gradient(135deg, var(--sbx-muted) 50%, transparent 50%);
  background-position: calc(100% - 14px) 50%, calc(100% - 10px) 50%; background-size: 4px 4px; background-repeat: no-repeat; }
.sbx-input::placeholder, .sbx-textarea::placeholder { color: var(--sbx-subtle); }
.sbx-input:focus, .sbx-textarea:focus, .sbx-native-select:focus { outline: none; border-color: var(--sbx-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--sbx-accent) 18%, transparent); }
.sbx-input[aria-invalid="true"], .sbx-textarea[aria-invalid="true"] { border-color: var(--sbx-danger); }
.sbx-input:disabled, .sbx-textarea:disabled, .sbx-native-select:disabled { opacity: .6; cursor: not-allowed; }
.sbx-input--sm { height: 28px; font-size: 12px; } .sbx-input--lg { height: 40px; font-size: 15px; }
.sbx-check { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
.sbx-check input { accent-color: var(--sbx-accent); width: 15px; height: 15px; margin: 0; cursor: pointer; }
.sbx-input-group { display: flex; align-items: stretch; }
.sbx-input-group > * { border-radius: 0 !important; margin-left: -1px; }
.sbx-input-group > :first-child { border-radius: var(--sbx-radius) 0 0 var(--sbx-radius) !important; margin-left: 0; }
.sbx-input-group > :last-child { border-radius: 0 var(--sbx-radius) var(--sbx-radius) 0 !important; }
.sbx-input-addon { display: inline-flex; align-items: center; padding: 0 10px; border: 1px solid var(--sbx-line); background: var(--sbx-surface-2); color: var(--sbx-muted); font-size: 13px; }
input[type="range"].sbx-range { width: 100%; accent-color: var(--sbx-accent); }

/* surfaces */
.sbx-card { background: var(--sbx-surface); border: 1px solid var(--sbx-line); border-radius: var(--sbx-radius-lg); }
.sbx-card--pad, .sbx-card__body { padding: 16px; }
.sbx-card__header { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--sbx-line); font-weight: 600; }
.sbx-card__footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--sbx-line); }
.sbx-card--hover { transition: border-color .12s, box-shadow .12s; cursor: pointer; }
.sbx-card--hover:hover { border-color: var(--sbx-line-strong); box-shadow: var(--sbx-shadow); }
.sbx-panel { background: var(--sbx-surface-2); border-radius: var(--sbx-radius-lg); padding: 12px; }

/* feedback */
.sbx-badge { display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 7px; border-radius: 999px;
  font-size: 11.5px; font-weight: 500; white-space: nowrap; background: var(--sbx-surface-3); color: var(--sbx-text); }
.sbx-badge--accent { background: var(--sbx-accent-soft); color: var(--sbx-accent); }
.sbx-badge--success { background: var(--sbx-success-soft); color: var(--sbx-success); }
.sbx-badge--warning { background: var(--sbx-warning-soft); color: var(--sbx-warning); }
.sbx-badge--danger { background: var(--sbx-danger-soft); color: var(--sbx-danger); }
.sbx-badge--outline { background: transparent; border: 1px solid var(--sbx-line-strong); color: var(--sbx-muted); }
.sbx-badge--dot::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.sbx-tag { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px; border-radius: var(--sbx-radius);
  border: 1px solid var(--sbx-line); background: var(--sbx-surface); font-size: 12px; }
.sbx-tag button { all: unset; cursor: pointer; color: var(--sbx-subtle); line-height: 1; }
.sbx-tag button:hover { color: var(--sbx-text); }
.sbx-alert { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: var(--sbx-radius);
  border: 1px solid var(--sbx-line); background: var(--sbx-surface-2); font-size: 13px; }
.sbx-alert--info { background: var(--sbx-accent-soft); border-color: color-mix(in srgb, var(--sbx-accent) 30%, transparent); }
.sbx-alert--success { background: var(--sbx-success-soft); border-color: color-mix(in srgb, var(--sbx-success) 30%, transparent); }
.sbx-alert--warning { background: var(--sbx-warning-soft); border-color: color-mix(in srgb, var(--sbx-warning) 30%, transparent); }
.sbx-alert--danger { background: var(--sbx-danger-soft); border-color: color-mix(in srgb, var(--sbx-danger) 30%, transparent); }
.sbx-alert strong { display: block; }
.sbx-progress { appearance: none; width: 100%; height: 6px; border: 0; border-radius: 999px; background: var(--sbx-surface-3); overflow: hidden; }
.sbx-progress::-webkit-progress-bar { background: var(--sbx-surface-3); }
.sbx-progress::-webkit-progress-value { background: var(--sbx-accent); border-radius: 999px; }
.sbx-progress::-moz-progress-bar { background: var(--sbx-accent); border-radius: 999px; }
.sbx-skeleton { display: block; border-radius: var(--sbx-radius); min-height: 12px;
  background: linear-gradient(90deg, var(--sbx-surface-2), var(--sbx-surface-3), var(--sbx-surface-2)); background-size: 200% 100%;
  animation: sbx-shimmer 1.2s ease-in-out infinite; }
@keyframes sbx-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.sbx-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; text-align: center;
  padding: 32px 16px; color: var(--sbx-muted); border: 1px dashed var(--sbx-line-strong); border-radius: var(--sbx-radius-lg); }
.sbx-empty strong { color: var(--sbx-text); font-size: 15px; }

/* data */
.sbx-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.sbx-table th { text-align: left; font-weight: 500; font-size: 12px; color: var(--sbx-muted); padding: 8px 10px;
  border-bottom: 1px solid var(--sbx-line); background: var(--sbx-surface); position: sticky; top: 0; }
.sbx-table td { padding: 8px 10px; border-bottom: 1px solid var(--sbx-line); vertical-align: middle; }
.sbx-table tbody tr:hover { background: var(--sbx-surface-2); }
.sbx-table--compact td, .sbx-table--compact th { padding: 4px 8px; }
.sbx-table--striped tbody tr:nth-child(even) { background: color-mix(in srgb, var(--sbx-surface-2) 60%, transparent); }
.sbx-table .sbx-num, .sbx-num { text-align: right; font-variant-numeric: tabular-nums; }
.sbx-table-wrap { overflow: auto; border: 1px solid var(--sbx-line); border-radius: var(--sbx-radius-lg); background: var(--sbx-surface); }
.sbx-table-wrap .sbx-table tr:last-child td { border-bottom: 0; }
.sbx-kv { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; font-size: 13px; margin: 0; }
.sbx-kv dt { color: var(--sbx-muted); } .sbx-kv dd { margin: 0; }
.sbx-stat { display: flex; flex-direction: column; gap: 2px; padding: 14px 16px; background: var(--sbx-surface);
  border: 1px solid var(--sbx-line); border-radius: var(--sbx-radius-lg); }
.sbx-stat__label { font-size: 12px; color: var(--sbx-muted); }
.sbx-stat__value { font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.sbx-stat__delta { font-size: 12px; color: var(--sbx-muted); }
.sbx-stat__delta--up { color: var(--sbx-success); } .sbx-stat__delta--down { color: var(--sbx-danger); }
.sbx-avatar { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%;
  background: var(--sbx-accent-soft); color: var(--sbx-accent); font-size: 12px; font-weight: 600; overflow: hidden; flex: none; }
.sbx-avatar img { width: 100%; height: 100%; object-fit: cover; }
.sbx-avatar--sm { width: 22px; height: 22px; font-size: 10px; } .sbx-avatar--lg { width: 40px; height: 40px; font-size: 15px; }
.sbx-list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--sbx-line); border-radius: var(--sbx-radius-lg); background: var(--sbx-surface); }
.sbx-list > li { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--sbx-line); }
.sbx-list > li:last-child { border-bottom: 0; }

/* custom elements before they upgrade */
sbx-select:not(:defined), sbx-menu:not(:defined), sbx-tabs:not(:defined), sbx-chart:not(:defined), sbx-table:not(:defined) { display: block; min-height: var(--sbx-control-h); }
sbx-dialog:not(:defined), sbx-tooltip:not(:defined) > [slot] { display: none; }

@media (prefers-reduced-motion: reduce) {
  .sbx-btn, .sbx-input, .sbx-card--hover { transition: none; }
  .sbx-skeleton, .sbx-spinner, .sbx-btn[aria-busy="true"]::before { animation-duration: 2s; }
}
`;

/** Tokens + element styles + classes: everything, for an artifact's own document. */
export const KIT_CSS         = TOKENS_CSS + ELEMENT_CSS + BASE_CSS;

/** Tokens + classes only: for host pages that have their own base styles. */
export const HOST_CSS         = TOKENS_CSS + BASE_CSS;

/** Shared styles for the custom elements' shadow roots (they read the tokens above). */
export const SHADOW_BASE_CSS         = `
[hidden] { display: none !important; }
:host([hidden]) { display: none !important; }
:host { font-family: var(--sbx-font); font-size: 13px; color: var(--sbx-text); }
* { box-sizing: border-box; }
button { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--sbx-accent); outline-offset: 2px; }
.pop { position: fixed; margin: 0; inset: auto; padding: 4px 0; min-width: 160px; max-height: min(320px, 60vh); overflow: auto;
  background: var(--sbx-surface); color: var(--sbx-text); border: 1px solid var(--sbx-line); border-radius: var(--sbx-radius);
  box-shadow: var(--sbx-shadow); }
.item { display: flex; align-items: center; gap: 8px; min-height: 32px; padding: 6px 12px; cursor: pointer; font-size: 13px; user-select: none; }
.item[aria-selected="true"], .item.active { background: var(--sbx-surface-2); }
.item[aria-disabled="true"] { opacity: .45; cursor: default; }
.item .check { width: 14px; color: var(--sbx-accent); flex: none; }
.item.danger { color: var(--sbx-danger); }
.group { padding: 6px 12px 2px; font-size: 11px; font-weight: 600; color: var(--sbx-subtle); text-transform: uppercase; letter-spacing: .04em; }
.sep { height: 1px; background: var(--sbx-line); margin: 4px 0; }
.empty { padding: 8px 12px; color: var(--sbx-subtle); font-size: 12px; }
`;
