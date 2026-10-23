import "./select.ts";
import "./menu.ts";
import "./overlays.ts";
import "./controls.ts";
import "./table.ts";
import "./chart.ts";
/**
 * Adds the kit stylesheet to `doc` once. Inside a sandbox (an artifact's own
 * document) that is everything; on a host page only the tokens and the
 * `.sbx-*` classes, so the page's own base styles stay untouched.
 */
export declare function installStyles(doc?: Document, o?: {
    elements?: boolean;
}): void;
export { BASE_CSS, ELEMENT_CSS, HOST_CSS, KIT_CSS, TOKENS_CSS } from "./css.js";
export { SbxSelect } from "./select.js";
export type { SelectOption } from "./select.js";
export { SbxMenu } from "./menu.js";
export type { MenuItem } from "./menu.js";
export { confirmDialog, promptDialog, SbxDialog, SbxToaster, toast } from "./overlays.js";
export type { ConfirmOptions, ToastKind, ToastOptions } from "./overlays.js";
export { SbxSwitch, SbxTabs, SbxTooltip } from "./controls.js";
export type { TabDef } from "./controls.js";
export { SbxTable } from "./table.js";
export type { Column } from "./table.js";
export { SbxChart } from "./chart.js";
export type { ChartType } from "./chart.js";
