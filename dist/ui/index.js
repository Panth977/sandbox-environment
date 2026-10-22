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
import { HOST_CSS, KIT_CSS } from "./css.js";
import "./select.js";
import "./menu.js";
import "./overlays.js";
import "./controls.js";
import "./table.js";
import "./chart.js";

/**
 * Adds the kit stylesheet to `doc` once. Inside a sandbox (an artifact's own
 * document) that is everything; on a host page only the tokens and the
 * `.sbx-*` classes, so the page's own base styles stay untouched.
 */
export function installStyles(doc           = document, o                         = {})       {
  if (typeof doc === "undefined" || doc.getElementById("sbx-kit")) return;
  const s = doc.createElement("style");
  s.id = "sbx-kit";
  s.textContent = (o.elements ?? inSandboxDocument()) ? KIT_CSS : HOST_CSS;
  doc.head.prepend(s);
}

/** True inside a sandbox runtime (the runtime sets globalThis.__sbx before loading the kit). */
function inSandboxDocument()          {
  return !!(globalThis                       ).__sbx;
}

if (typeof document !== "undefined") installStyles();

export { BASE_CSS, ELEMENT_CSS, HOST_CSS, KIT_CSS, TOKENS_CSS } from "./css.js";
export { SbxSelect } from "./select.js";

export { SbxMenu } from "./menu.js";

export { confirmDialog, promptDialog, SbxDialog, SbxToaster, toast } from "./overlays.js";

export { SbxSwitch, SbxTabs, SbxTooltip } from "./controls.js";

export { SbxTable } from "./table.js";

export { SbxChart } from "./chart.js";
