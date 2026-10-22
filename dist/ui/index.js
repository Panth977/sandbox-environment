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
import { KIT_CSS } from "./css.js";
import "./select.js";
import "./menu.js";
import "./overlays.js";
import "./controls.js";
import "./table.js";
import "./chart.js";

/** Adds the kit stylesheet to `doc` once. Called on import. */
export function installStyles(doc           = document)       {
  if (typeof doc === "undefined" || doc.getElementById("sbx-kit")) return;
  const s = doc.createElement("style");
  s.id = "sbx-kit";
  s.textContent = KIT_CSS;
  doc.head.prepend(s);
}

if (typeof document !== "undefined") installStyles();

export { BASE_CSS, KIT_CSS, TOKENS_CSS } from "./css.js";
export { SbxSelect } from "./select.js";

export { SbxMenu } from "./menu.js";

export { confirmDialog, promptDialog, SbxDialog, SbxToaster, toast } from "./overlays.js";

export { SbxSwitch, SbxTabs, SbxTooltip } from "./controls.js";

export { SbxTable } from "./table.js";

export { SbxChart } from "./chart.js";
