/**
 * The UI kit. Importing it installs the stylesheet (tokens, typography,
 * `.sbx-*` classes) and defines the custom elements:
 * `<sbx-select>`, `<sbx-menu>`, `<sbx-dialog>`, `<sbx-tabs>`, `<sbx-switch>`,
 * `<sbx-tooltip>`, `<sbx-table>`, `<sbx-chart>`, `<sbx-toaster>`.
 *
 * LAZY: the definitions (tag, properties, attributes, methods) are registered
 * here, synchronously and small; each component's code is a separate module
 * that loads the first time that tag is rendered (./lazy.ts). A page that only
 * uses buttons and a table never downloads the chart, select or dialog code.
 *
 * Inside a sandbox the runtime loads it before the artifact, so plain HTML
 * like `<button class="sbx-btn sbx-btn--primary">` just works. Host pages can
 * import it too, to look the same as their artifacts.
 *
 * @module
 */
import { HOST_CSS, KIT_CSS } from "./css.ts";
import { define, ElementBase } from "./base.ts";
import { defineLazy } from "./lazy.ts";

// ---- the definitions: sync; the code: on first render ----------------------
defineLazy("sbx-select", {
  props: ["options", "value", "multiple", "disabled", "searchable", "placeholder"],
  attrs: ["placeholder", "multiple", "disabled", "value", "searchable", "clearable"],
  formAssociated: true,
  load: () => import("./select.ts").then((m) => ({ impl: m.SbxSelect })),
});
defineLazy("sbx-menu", {
  props: ["items"],
  methods: ["show", "hide"],
  load: () => import("./menu.ts").then((m) => ({ impl: m.SbxMenu })),
});
defineLazy("sbx-dialog", {
  attrs: ["open", "heading"],
  methods: ["show", "close"],
  load: () => import("./overlays.ts").then((m) => ({ impl: m.SbxDialog })),
});
defineLazy("sbx-toaster", {
  methods: ["add"],
  load: () => import("./overlays.ts").then((m) => ({ impl: m.SbxToaster })),
});
defineLazy("sbx-tabs", {
  props: ["tabs", "value"],
  attrs: ["value"],
  load: () => import("./controls.ts").then((m) => ({ impl: m.SbxTabs })),
});
defineLazy("sbx-switch", {
  props: ["checked", "disabled"],
  attrs: ["checked", "disabled"],
  formAssociated: true,
  load: () => import("./controls.ts").then((m) => ({ impl: m.SbxSwitch })),
});
defineLazy("sbx-tooltip", {
  load: () => import("./controls.ts").then((m) => ({ impl: m.SbxTooltip })),
});
defineLazy("sbx-table", {
  props: ["columns", "rows", "selection"],
  attrs: ["selectable", "compact", "striped", "loading", "empty", "max-height"],
  methods: ["sortBy"],
  load: () => import("./table.ts").then((m) => ({ impl: m.SbxTable })),
});
defineLazy("sbx-chart", {
  props: ["type", "data", "x", "y", "labels"],
  attrs: ["type", "height", "stacked", "no-legend", "unit", "x", "y"],
  load: () => import("./chart.ts").then((m) => ({ impl: m.SbxChart })),
});
// Data-only children (read by their parent): defined right away.
define("sbx-tab", class extends ElementBase {});
for (const tag of ["sbx-menu-item", "sbx-menu-separator", "sbx-menu-group"]) {
  define(tag, class extends ElementBase {
    connectedCallback(): void {
      this.hidden = true;
    }
  });
}

/**
 * Adds the kit stylesheet to `doc` once. Inside a sandbox (an artifact's own
 * document) that is everything; on a host page only the tokens and the
 * `.sbx-*` classes, so the page's own base styles stay untouched.
 */
export function installStyles(doc: Document = document, o: { elements?: boolean } = {}): void {
  if (typeof doc === "undefined" || doc.getElementById("sbx-kit")) return;
  const s = doc.createElement("style");
  s.id = "sbx-kit";
  s.textContent = (o.elements ?? inSandboxDocument()) ? KIT_CSS : HOST_CSS;
  doc.head.prepend(s);
}

/** True inside a sandbox runtime (the runtime sets globalThis.__sbx before loading the kit). */
function inSandboxDocument(): boolean {
  return !!(globalThis as { __sbx?: unknown }).__sbx;
}

if (typeof document !== "undefined") installStyles();

export { BASE_CSS, ELEMENT_CSS, HOST_CSS, KIT_CSS, TOKENS_CSS } from "./css.ts";
export { confirmDialog, promptDialog, toast } from "./helpers.ts";
export type { ConfirmOptions } from "./helpers.ts";
export { defineLazy, lazyStats, whenLoaded } from "./lazy.ts";
export type { LazySchema } from "./lazy.ts";
// Element types only (importing the classes would load their code).
export type { SbxSelect, SelectOption } from "./select.ts";
export type { MenuItem, SbxMenu } from "./menu.ts";
export type { SbxDialog, SbxToaster, ToastKind, ToastOptions } from "./overlays.ts";
export type { SbxSwitch, SbxTabs, SbxTooltip, TabDef } from "./controls.ts";
export type { Column, SbxTable } from "./table.ts";
export type { ChartType, SbxChart } from "./chart.ts";
