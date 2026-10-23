/**
 * Small interactive controls: `<sbx-tabs>`, `<sbx-switch>`, `<sbx-tooltip>`.
 *
 * ```html
 * <sbx-tabs value="overview">
 *   <sbx-tab value="overview">Overview</sbx-tab>
 *   <sbx-tab value="devices" count="12">Devices</sbx-tab>
 *   <section data-tab="overview">…</section>
 *   <section data-tab="devices">…</section>
 * </sbx-tabs>
 *
 * <sbx-switch name="notify" checked>Notify me</sbx-switch>
 *
 * <sbx-tooltip text="Copy link"><button class="sbx-btn sbx-btn--icon">⧉</button></sbx-tooltip>
 * ```
 *
 * @module
 */
import { ElementBase, Popup, define, emit, esc, shadow, uid } from "./base.js";

// ---- tabs ----------------------------------------------------------------

const TABS_CSS = `
:host { display: block; }
.bar { position: relative; display: flex; gap: 2px; border-bottom: 1px solid var(--sbx-line); overflow-x: auto; scrollbar-width: none; }
:host([variant="pills"]) .bar { border-bottom: 0; gap: 4px; }
button { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 10px;
  font-size: 13px; color: var(--sbx-muted); cursor: pointer; white-space: nowrap; border-radius: var(--sbx-radius) var(--sbx-radius) 0 0; }
button:hover { color: var(--sbx-text); }
button[aria-selected="true"] { color: var(--sbx-text); font-weight: 500; }
button[aria-disabled="true"] { opacity: .45; cursor: default; }
button:focus-visible { outline: 2px solid var(--sbx-accent); outline-offset: -2px; }
:host([variant="pills"]) button { height: 28px; border-radius: 999px; }
:host([variant="pills"]) button[aria-selected="true"] { background: var(--sbx-accent-soft); color: var(--sbx-accent); }
.count { font-size: 11px; color: var(--sbx-subtle); }
.ink { position: absolute; bottom: -1px; height: 2px; background: var(--sbx-accent); border-radius: 2px; transition: left .18s, width .18s; }
:host([variant="pills"]) .ink { display: none; }
.panels { padding-top: var(--sbx-tabs-gap, 12px); }
`;

export class SbxTabs extends ElementBase {
  static get observedAttributes()           {
    return ["value"];
  }
  #root             ;
  #tabs           = [];
  #fromChildren = true;
  #mo                          = null;
  #id = uid("tabs");

  connectedCallback()       {
    if (!this.#root) {
      this.#root = shadow(this, TABS_CSS, `<div class="bar" role="tablist" part="tablist"></div><div class="panels" part="panels"><slot></slot></div>`);
      const bar = this.#root.querySelector             (".bar") ;
      bar.addEventListener("click", (e) => {
        const b = (e.target           ).closest                   ("button");
        if (b && b.getAttribute("aria-disabled") !== "true") this.#select(b.dataset.value , true);
      });
      bar.addEventListener("keydown", (e) => {
        const enabled = this.#tabs.filter((t) => !t.disabled);
        const i = enabled.findIndex((t) => t.value === this.value);
        let j = -1;
        if (e.key === "ArrowRight") j = (i + 1) % enabled.length;
        else if (e.key === "ArrowLeft") j = (i - 1 + enabled.length) % enabled.length;
        else if (e.key === "Home") j = 0;
        else if (e.key === "End") j = enabled.length - 1;
        if (j >= 0) {
          e.preventDefault();
          this.#select(enabled[j].value, true);
          this.#root.querySelector             (`button[data-value="${CSS.escape(enabled[j].value)}"]`)?.focus();
        }
      });
      new ResizeObserver(() => this.#ink()).observe(bar);
    }
    this.#mo = new MutationObserver(() => this.#fromChildren && this.#read());
    this.#mo.observe(this, { childList: true, subtree: true, characterData: true, attributeFilter: ["value", "count", "disabled"] });
    this.#read();
  }

  disconnectedCallback()       {
    this.#mo?.disconnect();
  }

  attributeChangedCallback()       {
    if (this.#root) this.#render();
  }

  get tabs()           {
    return this.#tabs;
  }
  set tabs(v          ) {
    this.#fromChildren = false;
    this.#tabs = Array.isArray(v) ? v : [];
    this.#render();
  }

  get value()         {
    return this.getAttribute("value") ?? this.#tabs.find((t) => !t.disabled)?.value ?? "";
  }
  set value(v        ) {
    this.setAttribute("value", v);
  }

  #read() {
    if (!this.#fromChildren) return;
    const tabs           = [];
    for (const c of Array.from(this.children)) {
      if (c.tagName.toLowerCase() !== "sbx-tab") continue;
      (c               ).slot = "__tab";
      tabs.push({
        value: c.getAttribute("value") ?? c.textContent?.trim() ?? "",
        label: c.textContent?.trim() ?? "",
        count: c.getAttribute("count") ?? undefined,
        disabled: c.hasAttribute("disabled"),
      });
    }
    this.#tabs = tabs;
    this.#render();
  }

  #select(v        , user         ) {
    if (v === this.value) return;
    this.setAttribute("value", v);
    if (user) emit(this, "change", { value: v });
  }

  #render() {
    if (!this.#root) return;
    const cur = this.value;
    this.#root.querySelector(".bar") .innerHTML = this.#tabs.map((t) =>
      `<button role="tab" part="tab" id="${this.#id}-${esc(t.value)}" data-value="${esc(t.value)}" aria-selected="${t.value === cur}" tabindex="${t.value === cur ? 0 : -1}"` +
      `${t.disabled ? ' aria-disabled="true"' : ""}>${esc(t.label)}${t.count != null && t.count !== "" ? `<span class="count">${esc(t.count)}</span>` : ""}</button>`
    ).join("") + `<span class="ink" part="indicator"></span>`;
    for (const panel of Array.from(this.querySelectorAll             (":scope > [data-tab]"))) {
      panel.hidden = panel.dataset.tab !== cur;
      panel.setAttribute("role", "tabpanel");
    }
    requestAnimationFrame(() => this.#ink());
  }

  #ink() {
    const ink = this.#root?.querySelector             (".ink");
    const b = this.#root?.querySelector             ('button[aria-selected="true"]');
    if (!ink) return;
    if (!b) {
      ink.style.width = "0";
      return;
    }
    ink.style.left = `${b.offsetLeft}px`;
    ink.style.width = `${b.offsetWidth}px`;
  }
}

define("sbx-tabs", SbxTabs);
define("sbx-tab", class extends ElementBase {});

// ---- switch --------------------------------------------------------------

const SWITCH_CSS = `
:host { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; user-select: none; vertical-align: middle; }
:host([disabled]) { opacity: .5; cursor: not-allowed; }
.track { position: relative; width: 30px; height: 18px; border-radius: 999px; background: var(--sbx-line-strong); transition: background .15s; flex: none; }
.thumb { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgb(0 0 0 / .25); transition: transform .15s; }
:host([checked]) .track { background: var(--sbx-accent); }
:host([checked]) .thumb { transform: translateX(12px); }
:host(:focus-visible) { outline: none; } :host(:focus-visible) .track { outline: 2px solid var(--sbx-accent); outline-offset: 2px; }
`;

export class SbxSwitch extends ElementBase {
  static formAssociated = true;
  static get observedAttributes()           {
    return ["checked", "disabled"];
  }
  #internals                          = null;
  #root             ;

  constructor() {
    super();
    try {
      this.#internals = this.attachInternals();
    } catch { /* older browser */ }
  }

  connectedCallback()       {
    if (!this.#root) {
      this.#root = shadow(this, SWITCH_CSS, `<span class="track" part="track"><span class="thumb" part="thumb"></span></span><slot></slot>`);
      this.addEventListener("click", () => this.#toggle());
      this.addEventListener("keydown", (e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          this.#toggle();
        }
      });
    }
    this.setAttribute("role", "switch");
    if (!this.hasAttribute("tabindex")) this.tabIndex = 0;
    this.#sync();
  }

  attributeChangedCallback()       {
    this.#sync();
  }

  get checked()          {
    return this.hasAttribute("checked");
  }
  set checked(v         ) {
    this.toggleAttribute("checked", !!v);
  }
  get disabled()          {
    return this.hasAttribute("disabled");
  }
  set disabled(v         ) {
    this.toggleAttribute("disabled", !!v);
  }
  get value()         {
    return this.getAttribute("value") ?? "on";
  }

  #toggle() {
    if (this.disabled) return;
    this.checked = !this.checked;
    emit(this, "input", { checked: this.checked });
    emit(this, "change", { checked: this.checked });
  }

  #sync() {
    this.setAttribute("aria-checked", String(this.checked));
    this.setAttribute("aria-disabled", String(this.disabled));
    this.#internals?.setFormValue(this.checked ? this.value : null);
  }

  formResetCallback()       {
    this.checked = this.hasAttribute("default-checked");
  }
}

define("sbx-switch", SbxSwitch);

// ---- tooltip -------------------------------------------------------------

const TIP_CSS = `
:host { display: inline-block; }
.tip { min-width: 0; padding: 4px 8px; max-width: 280px; font-size: 12px; line-height: 1.4; border-radius: 4px; border: 0;
  background: var(--sbx-text); color: var(--sbx-bg); box-shadow: var(--sbx-shadow); pointer-events: none; overflow: visible; max-height: none; }
`;

export class SbxTooltip extends ElementBase {
  #root             ;
  #popup        ;
  #timer                                       = null;
  #id = uid("tip");

  connectedCallback()       {
    if (this.#root) return;
    this.#root = shadow(this, TIP_CSS, `<slot></slot><div class="tip" role="tooltip" id="${this.#id}" part="tooltip"></div>`);
    const tip = this.#root.querySelector             (".tip") ;
    this.#popup = new Popup(tip, this, { placement: (this.getAttribute("placement")             ) ?? "top" });
    tip.classList.add("tip");
    const show = () => {
      const text = this.getAttribute("text");
      if (!text) return;
      tip.textContent = text;
      this.#timer = setTimeout(() => this.#popup.show(), Number(this.getAttribute("delay") ?? 350));
    };
    const hide = () => {
      if (this.#timer) clearTimeout(this.#timer);
      this.#popup.hide();
    };
    this.addEventListener("pointerenter", show);
    this.addEventListener("pointerleave", hide);
    this.addEventListener("focusin", show);
    this.addEventListener("focusout", hide);
    this.addEventListener("keydown", (e) => e.key === "Escape" && hide());
    // aria-describedby cannot point into a shadow root; describe the trigger directly.
    const text = this.getAttribute("text");
    if (text) this.firstElementChild?.setAttribute("aria-description", text);
  }
}

define("sbx-tooltip", SbxTooltip);
