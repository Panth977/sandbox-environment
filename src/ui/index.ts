/**
 * The UI kit. Importing it installs the stylesheet (tokens, typography,
 * `.sbx-*` classes) and defines the custom elements:
 * `<sbx-select>`, `<sbx-menu>`, `<sbx-dialog>`, `<sbx-tabs>`, `<sbx-switch>`,
 * `<sbx-tooltip>`, `<sbx-table>`, `<sbx-chart>`, `<sbx-toaster>`.
 *
 * Inside a sandbox the runtime loads it before the artifact, so plain HTML
 * like `<button class="sbx-btn sbx-btn--primary">` just works. Host pages can
 * import it too, to look the same as their artifacts.
 *
 * @module
 */
import { KIT_CSS } from "./css.ts";
import "./select.ts";
import "./menu.ts";
import "./overlays.ts";
import "./controls.ts";
import "./table.ts";
import "./chart.ts";

/** Adds the kit stylesheet to `doc` once. Called on import. */
export function installStyles(doc: Document = document): void {
  if (typeof doc === "undefined" || doc.getElementById("sbx-kit")) return;
  const s = doc.createElement("style");
  s.id = "sbx-kit";
  s.textContent = KIT_CSS;
  doc.head.prepend(s);
}

if (typeof document !== "undefined") installStyles();

export { BASE_CSS, KIT_CSS, TOKENS_CSS } from "./css.ts";
export { SbxSelect } from "./select.ts";
export type { SelectOption } from "./select.ts";
export { SbxMenu } from "./menu.ts";
export type { MenuItem } from "./menu.ts";
export { confirmDialog, promptDialog, SbxDialog, SbxToaster, toast } from "./overlays.ts";
export type { ConfirmOptions, ToastKind, ToastOptions } from "./overlays.ts";
export { SbxSwitch, SbxTabs, SbxTooltip } from "./controls.ts";
export type { TabDef } from "./controls.ts";
export { SbxTable } from "./table.ts";
export type { Column } from "./table.ts";
export { SbxChart } from "./chart.ts";
export type { ChartType } from "./chart.ts";
