/**
 * Adds the kit stylesheet to `doc` once. Inside a sandbox (an artifact's own
 * document) that is everything; on a host page only the tokens and the
 * `.sbx-*` classes, so the page's own base styles stay untouched.
 */
export declare function installStyles(doc?: Document, o?: {
    elements?: boolean;
}): void;
export { BASE_CSS, ELEMENT_CSS, HOST_CSS, KIT_CSS, TOKENS_CSS } from "./css.js";
export { confirmDialog, promptDialog, toast } from "./helpers.js";
export type { ConfirmOptions } from "./helpers.js";
export { defineLazy, lazyStats, whenLoaded } from "./lazy.js";
export type { LazySchema } from "./lazy.js";
export type { SbxSelect, SelectOption } from "./select.js";
export type { MenuItem, SbxMenu } from "./menu.js";
export type { SbxDialog, SbxToaster, ToastKind, ToastOptions } from "./overlays.js";
export type { SbxSwitch, SbxTabs, SbxTooltip, TabDef } from "./controls.js";
export type { Column, SbxTable } from "./table.js";
export type { ChartType, SbxChart } from "./chart.js";
