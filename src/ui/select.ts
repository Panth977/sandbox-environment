/**
 * `<sbx-select>`: a dropdown select (single or multiple, optionally searchable),
 * keyboard accessible, form-associated.
 *
 * ```html
 * <sbx-select name="org" placeholder="Pick an org" searchable>
 *   <option value="amd">Ahmedabad</option>
 *   <option value="pune">Pune</option>
 * </sbx-select>
 * ```
 * or `el.options = [{ label: "Ahmedabad", value: "amd", group: "West" }]`.
 * Events: `change` (detail `{ value }`). Property `value` (array when `multiple`).
 *
 * @module
 */
import { define, emit, esc, moveIndex, Popup, shadow, uid } from "./base.ts";

export interface SelectOption<V = unknown> {
  label: string;
  value: V;
  disabled?: boolean;
  group?: string;
  description?: string;
}

const CSS = `
:host { display: inline-block; min-width: 160px; vertical-align: middle; }
:host([block]) { display: block; width: 100%; }
.trigger { display: flex; align-items: center; gap: 6px; width: 100%; height: var(--sbx-control-h); padding: 0 8px 0 10px;
  border: 1px solid var(--sbx-line); border-radius: var(--sbx-radius); background: var(--sbx-surface); cursor: pointer; text-align: left; }
:host([size="sm"]) .trigger { height: 28px; font-size: 12px; }
:host([size="lg"]) .trigger { height: 40px; font-size: 15px; }
.trigger:hover { border-color: var(--sbx-line-strong); }
.trigger[aria-expanded="true"], .trigger:focus-visible { outline: none; border-color: var(--sbx-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--sbx-accent) 18%, transparent); }
:host([invalid]) .trigger { border-color: var(--sbx-danger); }
:host([disabled]) .trigger { opacity: .6; cursor: not-allowed; }
.label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.label.placeholder { color: var(--sbx-subtle); }
.chev { flex: none; color: var(--sbx-muted); transition: transform .12s; }
.trigger[aria-expanded="true"] .chev { transform: rotate(180deg); }
.clear { all: unset; flex: none; color: var(--sbx-subtle); cursor: pointer; padding: 0 2px; line-height: 1; }
.clear:hover { color: var(--sbx-text); }
.search { display: block; width: calc(100% - 12px); margin: 2px 6px 4px; height: 28px; padding: 0 8px; border: 1px solid var(--sbx-line);
  border-radius: var(--sbx-radius); background: var(--sbx-surface); font: inherit; color: inherit; }
.search:focus { outline: none; border-color: var(--sbx-accent); }
.desc { display: block; font-size: 11.5px; color: var(--sbx-muted); }
`;

const CHEV = `<svg class="chev" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHECK = `<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export class SbxSelect extends HTMLElement {
  static formAssociated = true;
  static get observedAttributes(): string[] {
    return ["placeholder", "multiple", "disabled", "value", "searchable", "clearable"];
  }

  #internals: ElementInternals | null = null;
  #options: SelectOption[] = [];
  #fromChildren = true;
  #value: unknown = undefined;
  #values: unknown[] = [];
  #active = -1;
  #query = "";
  #popup!: Popup;
  #root!: ShadowRoot;
  #listId = uid("lb");
  #mo: MutationObserver | null = null;
  #typed = "";
  #typedAt = 0;

  constructor() {
    super();
    try {
      this.#internals = this.attachInternals();
    } catch { /* not form-associated in this browser */ }
  }

  connectedCallback(): void {
    if (!this.#root) {
      this.#root = shadow(this, CSS, `
        <button class="trigger" part="trigger" type="button" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="${this.#listId}">
          <span class="label" part="label"></span><span class="clear" role="button" hidden aria-label="Clear">✕</span>${CHEV}
        </button>
        <div class="list" part="listbox" id="${this.#listId}" role="listbox"></div>`);
      const trigger = this.#trigger;
      const list = this.#list;
      this.#popup = new Popup(list, trigger, { matchWidth: true, onClose: () => this.#closed() });
      trigger.addEventListener("click", (e) => {
        if ((e.target as Element).closest(".clear")) {
          e.stopPropagation();
          this.#commit(this.multiple ? [] : undefined);
          return;
        }
        if (!this.disabled) this.#popup.open ? this.#popup.hide() : this.#open();
      });
      trigger.addEventListener("keydown", (e) => this.#key(e));
      list.addEventListener("pointerdown", (e) => e.preventDefault());
      list.addEventListener("click", (e) => {
        const item = (e.target as Element).closest<HTMLElement>(".item");
        if (item && item.getAttribute("aria-disabled") !== "true") this.#pick(Number(item.dataset.i));
      });
      list.addEventListener("pointermove", (e) => {
        const item = (e.target as Element).closest<HTMLElement>(".item");
        if (item && Number(item.dataset.i) !== this.#active) this.#setActive(Number(item.dataset.i), false);
      });
    }
    if (this.#fromChildren) this.#readChildren();
    this.#mo = new MutationObserver(() => this.#fromChildren && this.#readChildren());
    this.#mo.observe(this, { childList: true, subtree: true, characterData: true, attributeFilter: ["label", "disabled", "selected"] });
    this.#renderLabel();
  }

  disconnectedCallback(): void {
    this.#mo?.disconnect();
    this.#popup?.hide();
  }

  attributeChangedCallback(name: string, _old: string | null, val: string | null): void {
    if (name === "value" && val !== null) {
      if (this.multiple) this.#values = val ? val.split(",") : [];
      else this.#value = val;
    }
    if (this.#root) this.#renderLabel();
  }

  get #trigger(): HTMLButtonElement {
    return this.#root.querySelector(".trigger")!;
  }
  get #list(): HTMLElement {
    return this.#root.querySelector(".list")!;
  }

  /** The options. Setting this stops reading child `<option>`s. */
  get options(): SelectOption[] {
    return this.#options;
  }
  set options(v: SelectOption[]) {
    this.#fromChildren = false;
    this.#options = Array.isArray(v) ? v.map((o) => ({ ...o, label: String(o.label ?? o.value) })) : [];
    this.#renderLabel();
    if (this.#popup?.open) this.#renderList();
  }

  get multiple(): boolean {
    return this.hasAttribute("multiple");
  }
  set multiple(v: boolean) {
    this.toggleAttribute("multiple", !!v);
  }
  get disabled(): boolean {
    return this.hasAttribute("disabled");
  }
  set disabled(v: boolean) {
    this.toggleAttribute("disabled", !!v);
  }
  get searchable(): boolean {
    return this.hasAttribute("searchable");
  }
  set searchable(v: boolean) {
    this.toggleAttribute("searchable", !!v);
  }
  get placeholder(): string {
    return this.getAttribute("placeholder") ?? "Select…";
  }
  set placeholder(v: string) {
    this.setAttribute("placeholder", v);
  }

  /** Selected value (single) or values (multiple). */
  get value(): unknown {
    return this.multiple ? [...this.#values] : this.#value;
  }
  set value(v: unknown) {
    if (this.multiple) this.#values = Array.isArray(v) ? [...v] : v == null ? [] : [v];
    else this.#value = v;
    this.#sync();
    this.#renderLabel();
  }

  /** The selected option object(s). */
  get selected(): SelectOption | SelectOption[] | undefined {
    if (this.multiple) return this.#options.filter((o) => this.#values.includes(o.value));
    return this.#options.find((o) => o.value === this.#value);
  }

  #readChildren() {
    const out: SelectOption[] = [];
    const walk = (parent: Element, group?: string) => {
      for (const c of Array.from(parent.children)) {
        if (c.tagName === "OPTGROUP") walk(c, c.getAttribute("label") ?? undefined);
        else if (c.tagName === "OPTION") {
          const o = c as HTMLOptionElement;
          out.push({ label: o.label || o.textContent || o.value, value: o.value, disabled: o.disabled, group });
          if (o.hasAttribute("selected") && !this.hasAttribute("value")) {
            if (this.multiple) !this.#values.includes(o.value) && this.#values.push(o.value);
            else if (this.#value === undefined) this.#value = o.value;
          }
        }
      }
    };
    walk(this);
    this.#options = out;
    this.#sync();
    if (this.#root) this.#renderLabel();
  }

  #sync() {
    const v = this.multiple ? this.#values : this.#value;
    if (this.#internals) {
      if (this.multiple) {
        const fd = new FormData();
        const name = this.getAttribute("name") ?? "";
        for (const x of this.#values) fd.append(name, String(x));
        this.#internals.setFormValue(this.#values.length ? fd : null);
      } else this.#internals.setFormValue(v == null ? null : String(v));
      const missing = this.hasAttribute("required") && (this.multiple ? this.#values.length === 0 : v == null || v === "");
      this.#internals.setValidity(missing ? { valueMissing: true } : {}, missing ? "Please choose an option" : "");
    }
  }

  #renderLabel() {
    if (!this.#root) return;
    const label = this.#root.querySelector(".label")!;
    const sel = this.selected;
    let text = "";
    if (Array.isArray(sel)) text = sel.length === 0 ? "" : sel.length <= 2 ? sel.map((o) => o.label).join(", ") : `${sel.length} selected`;
    else text = sel?.label ?? "";
    label.textContent = text || this.placeholder;
    label.classList.toggle("placeholder", !text);
    const clear = this.#root.querySelector<HTMLElement>(".clear")!;
    clear.hidden = !(this.hasAttribute("clearable") && text);
    this.#trigger.disabled = this.disabled;
  }

  #visible(): number[] {
    const q = this.#query.trim().toLowerCase();
    return this.#options.map((_, i) => i).filter((i) => !q || this.#options[i].label.toLowerCase().includes(q));
  }

  #renderList() {
    const list = this.#list;
    const vis = this.#visible();
    let html = this.searchable ? `<input class="search" part="search" placeholder="Search…" aria-label="Search options" value="${esc(this.#query)}">` : "";
    let group: string | undefined;
    for (const i of vis) {
      const o = this.#options[i];
      if (o.group && o.group !== group) html += `<div class="group" role="presentation">${esc(o.group)}</div>`;
      group = o.group;
      const on = this.multiple ? this.#values.includes(o.value) : o.value === this.#value;
      html += `<div class="item${i === this.#active ? " active" : ""}" part="option" role="option" id="${this.#listId}-${i}" data-i="${i}"` +
        ` aria-selected="${on}"${o.disabled ? ' aria-disabled="true"' : ""}><span class="check">${on ? CHECK : ""}</span>` +
        `<span>${esc(o.label)}${o.description ? `<span class="desc">${esc(o.description)}</span>` : ""}</span></div>`;
    }
    if (!vis.length) html += `<div class="empty">No options</div>`;
    const hadFocus = this.#root.activeElement?.classList.contains("search");
    list.innerHTML = html;
    if (this.searchable) {
      const s = list.querySelector<HTMLInputElement>(".search")!;
      s.addEventListener("input", () => {
        this.#query = s.value;
        const v = this.#visible();
        this.#active = v.find((i) => !this.#options[i].disabled) ?? -1;
        this.#renderList();
      });
      s.addEventListener("keydown", (e) => this.#key(e));
      if (hadFocus || this.#popup.open) {
        s.focus();
        s.setSelectionRange(s.value.length, s.value.length);
      }
    }
    this.#popup.update();
  }

  #open() {
    this.#query = "";
    const sel = this.multiple ? this.#values[0] : this.#value;
    const idx = this.#options.findIndex((o) => o.value === sel);
    this.#active = idx >= 0 ? idx : this.#options.findIndex((o) => !o.disabled);
    this.#trigger.setAttribute("aria-expanded", "true");
    this.#popup.show();
    this.#renderList();
    this.#scrollActive();
    if (this.searchable) this.#list.querySelector<HTMLInputElement>(".search")?.focus();
  }

  #closed() {
    this.#trigger?.setAttribute("aria-expanded", "false");
    this.#trigger?.removeAttribute("aria-activedescendant");
  }

  #setActive(i: number, scroll = true) {
    this.#active = i;
    for (const el of this.#list.querySelectorAll(".item")) el.classList.toggle("active", Number((el as HTMLElement).dataset.i) === i);
    if (i >= 0) this.#trigger.setAttribute("aria-activedescendant", `${this.#listId}-${i}`);
    if (scroll) this.#scrollActive();
  }

  #scrollActive() {
    this.#list.querySelector(".item.active")?.scrollIntoView({ block: "nearest" });
  }

  #pick(i: number) {
    const o = this.#options[i];
    if (!o || o.disabled) return;
    if (this.multiple) {
      const has = this.#values.includes(o.value);
      this.#commit(has ? this.#values.filter((v) => v !== o.value) : [...this.#values, o.value]);
      this.#renderList();
    } else {
      this.#commit(o.value);
      this.#popup.hide();
      this.#trigger.focus();
    }
  }

  #commit(v: unknown) {
    if (this.multiple) this.#values = Array.isArray(v) ? v : [];
    else this.#value = v;
    this.#sync();
    this.#renderLabel();
    emit(this, "input", { value: this.value });
    emit(this, "change", { value: this.value });
  }

  #key(e: KeyboardEvent) {
    const open = this.#popup.open;
    const vis = this.#visible();
    const enabled = (j: number) => !this.#options[vis[j]]?.disabled;
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      if (!open) return this.#open();
      const pos = vis.indexOf(this.#active);
      const next = moveIndex(pos, vis.length, e.key, enabled);
      if (next >= 0) this.#setActive(vis[next]);
    } else if (e.key === "Enter" || (e.key === " " && !this.searchable)) {
      e.preventDefault();
      if (!open) this.#open();
      else if (this.#active >= 0) this.#pick(this.#active);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      this.#popup.hide();
      this.#trigger.focus();
    } else if (e.key === "Tab" && open) {
      this.#popup.hide();
    } else if (!this.searchable && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      const now = Date.now();
      this.#typed = now - this.#typedAt > 600 ? e.key.toLowerCase() : this.#typed + e.key.toLowerCase();
      this.#typedAt = now;
      const i = this.#options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(this.#typed));
      if (i >= 0) open ? this.#setActive(i) : this.#commit(this.multiple ? this.#values : this.#options[i].value);
    }
  }

  // form-associated callbacks
  formResetCallback(): void {
    this.#values = [];
    this.#value = undefined;
    this.#sync();
    this.#renderLabel();
  }
  formDisabledCallback(disabled: boolean): void {
    this.disabled = disabled;
  }
}

define("sbx-select", SbxSelect);
