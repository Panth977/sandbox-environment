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
import { ElementBase, Popup, define, emit, esc, moveIndex, shadow, uid } from "./base.ts";

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

export class SbxSelect extends ElementBase {
  _init(): void {
    this._options = [];
    this._fromChildren = true;
    this._value = undefined;
    this._values = [];
    this._active = -1;
    this._query = "";
    this._listId = uid("lb");
    this._mo = null;
    this._typed = "";
    this._typedAt = 0;
  }

  declare _internals: ElementInternals | null;
  declare _options: SelectOption[];
  declare _fromChildren: boolean;
  declare _value: unknown;
  declare _values: unknown[];
  declare _active: number;
  declare _query: string;
  declare _popup: Popup;
  declare _root: ShadowRoot;
  declare _listId: string;
  declare _mo: MutationObserver | null;
  declare _typed: string;
  declare _typedAt: number;


  _connected(): void {
    if (!this._root) {
      this._root = shadow(this, CSS, `
        <button class="trigger" part="trigger" type="button" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="${this._listId}">
          <span class="label" part="label"></span><span class="clear" role="button" hidden aria-label="Clear">✕</span>${CHEV}
        </button>
        <div class="list" part="listbox" id="${this._listId}" role="listbox"></div>`);
      const trigger = this._trigger;
      const list = this._list;
      this._popup = new Popup(list, trigger, { matchWidth: true, onClose: () => this._closed() });
      trigger.addEventListener("click", (e) => {
        if ((e.target as Element).closest(".clear")) {
          e.stopPropagation();
          this._commit(this.multiple ? [] : undefined);
          return;
        }
        if (!this.disabled) this._popup.open ? this._popup.hide() : this._open();
      });
      trigger.addEventListener("keydown", (e) => this._key(e));
      list.addEventListener("pointerdown", (e) => e.preventDefault());
      list.addEventListener("click", (e) => {
        const item = (e.target as Element).closest<HTMLElement>(".item");
        if (item && item.getAttribute("aria-disabled") !== "true") this._pick(Number(item.dataset.i));
      });
      list.addEventListener("pointermove", (e) => {
        const item = (e.target as Element).closest<HTMLElement>(".item");
        if (item && Number(item.dataset.i) !== this._active) this._setActive(Number(item.dataset.i), false);
      });
    }
    if (this._fromChildren) this._readChildren();
    this._mo = new MutationObserver(() => this._fromChildren && this._readChildren());
    this._mo.observe(this, { childList: true, subtree: true, characterData: true, attributeFilter: ["label", "disabled", "selected"] });
    this._renderLabel();
  }

  _disconnected(): void {
    this._mo?.disconnect();
    this._popup?.hide();
  }

  _attributeChanged(name: string, _old: string | null, val: string | null): void {
    if (name === "value" && val !== null) {
      if (this.multiple) this._values = val ? val.split(",") : [];
      else this._value = val;
    }
    if (this._root) this._renderLabel();
  }

  get _trigger(): HTMLButtonElement {
    return this._root.querySelector(".trigger")!;
  }
  get _list(): HTMLElement {
    return this._root.querySelector(".list")!;
  }

  /** The options. Setting this stops reading child `<option>`s. */
  get options(): SelectOption[] {
    return this._options;
  }
  set options(v: SelectOption[]) {
    this._fromChildren = false;
    this._options = Array.isArray(v) ? v.map((o) => ({ ...o, label: String(o.label ?? o.value) })) : [];
    this._renderLabel();
    if (this._popup?.open) this._renderList();
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
    return this.multiple ? [...this._values] : this._value;
  }
  set value(v: unknown) {
    if (this.multiple) this._values = Array.isArray(v) ? [...v] : v == null ? [] : [v];
    else this._value = v;
    this._sync();
    this._renderLabel();
  }

  /** The selected option object(s). */
  get selected(): SelectOption | SelectOption[] | undefined {
    if (this.multiple) return this._options.filter((o) => this._values.includes(o.value));
    return this._options.find((o) => o.value === this._value);
  }

  _readChildren() {
    const out: SelectOption[] = [];
    const walk = (parent: Element, group?: string) => {
      for (const c of Array.from(parent.children)) {
        if (c.tagName === "OPTGROUP") walk(c, c.getAttribute("label") ?? undefined);
        else if (c.tagName === "OPTION") {
          const o = c as HTMLOptionElement;
          out.push({ label: o.label || o.textContent || o.value, value: o.value, disabled: o.disabled, group });
          if (o.hasAttribute("selected") && !this.hasAttribute("value")) {
            if (this.multiple) !this._values.includes(o.value) && this._values.push(o.value);
            else if (this._value === undefined) this._value = o.value;
          }
        }
      }
    };
    walk(this);
    this._options = out;
    this._sync();
    if (this._root) this._renderLabel();
  }

  _sync() {
    const v = this.multiple ? this._values : this._value;
    if (this._internals) {
      if (this.multiple) {
        const fd = new FormData();
        const name = this.getAttribute("name") ?? "";
        for (const x of this._values) fd.append(name, String(x));
        this._internals.setFormValue(this._values.length ? fd : null);
      } else this._internals.setFormValue(v == null ? null : String(v));
      const missing = this.hasAttribute("required") && (this.multiple ? this._values.length === 0 : v == null || v === "");
      this._internals.setValidity(missing ? { valueMissing: true } : {}, missing ? "Please choose an option" : "");
    }
  }

  _renderLabel() {
    if (!this._root) return;
    const label = this._root.querySelector(".label")!;
    const sel = this.selected;
    let text = "";
    if (Array.isArray(sel)) text = sel.length === 0 ? "" : sel.length <= 2 ? sel.map((o) => o.label).join(", ") : `${sel.length} selected`;
    else text = sel?.label ?? "";
    label.textContent = text || this.placeholder;
    label.classList.toggle("placeholder", !text);
    const clear = this._root.querySelector<HTMLElement>(".clear")!;
    clear.hidden = !(this.hasAttribute("clearable") && text);
    this._trigger.disabled = this.disabled;
  }

  _visible(): number[] {
    const q = this._query.trim().toLowerCase();
    return this._options.map((_, i) => i).filter((i) => !q || this._options[i].label.toLowerCase().includes(q));
  }

  _renderList() {
    const list = this._list;
    const vis = this._visible();
    let html = this.searchable ? `<input class="search" part="search" placeholder="Search…" aria-label="Search options" value="${esc(this._query)}">` : "";
    let group: string | undefined;
    for (const i of vis) {
      const o = this._options[i];
      if (o.group && o.group !== group) html += `<div class="group" role="presentation">${esc(o.group)}</div>`;
      group = o.group;
      const on = this.multiple ? this._values.includes(o.value) : o.value === this._value;
      html += `<div class="item${i === this._active ? " active" : ""}" part="option" role="option" id="${this._listId}-${i}" data-i="${i}"` +
        ` aria-selected="${on}"${o.disabled ? ' aria-disabled="true"' : ""}><span class="check">${on ? CHECK : ""}</span>` +
        `<span>${esc(o.label)}${o.description ? `<span class="desc">${esc(o.description)}</span>` : ""}</span></div>`;
    }
    if (!vis.length) html += `<div class="empty">No options</div>`;
    const hadFocus = this._root.activeElement?.classList.contains("search");
    list.innerHTML = html;
    if (this.searchable) {
      const s = list.querySelector<HTMLInputElement>(".search")!;
      s.addEventListener("input", () => {
        this._query = s.value;
        const v = this._visible();
        this._active = v.find((i) => !this._options[i].disabled) ?? -1;
        this._renderList();
      });
      s.addEventListener("keydown", (e) => this._key(e));
      if (hadFocus || this._popup.open) {
        s.focus();
        s.setSelectionRange(s.value.length, s.value.length);
      }
    }
    this._popup.update();
  }

  _open() {
    this._query = "";
    const sel = this.multiple ? this._values[0] : this._value;
    const idx = this._options.findIndex((o) => o.value === sel);
    this._active = idx >= 0 ? idx : this._options.findIndex((o) => !o.disabled);
    this._trigger.setAttribute("aria-expanded", "true");
    this._popup.show();
    this._renderList();
    this._scrollActive();
    if (this.searchable) this._list.querySelector<HTMLInputElement>(".search")?.focus();
  }

  _closed() {
    this._trigger?.setAttribute("aria-expanded", "false");
    this._trigger?.removeAttribute("aria-activedescendant");
  }

  _setActive(i: number, scroll = true) {
    this._active = i;
    for (const el of this._list.querySelectorAll(".item")) el.classList.toggle("active", Number((el as HTMLElement).dataset.i) === i);
    if (i >= 0) this._trigger.setAttribute("aria-activedescendant", `${this._listId}-${i}`);
    if (scroll) this._scrollActive();
  }

  _scrollActive() {
    this._list.querySelector(".item.active")?.scrollIntoView({ block: "nearest" });
  }

  _pick(i: number) {
    const o = this._options[i];
    if (!o || o.disabled) return;
    if (this.multiple) {
      const has = this._values.includes(o.value);
      this._commit(has ? this._values.filter((v) => v !== o.value) : [...this._values, o.value]);
      this._renderList();
    } else {
      this._commit(o.value);
      this._popup.hide();
      this._trigger.focus();
    }
  }

  _commit(v: unknown) {
    if (this.multiple) this._values = Array.isArray(v) ? v : [];
    else this._value = v;
    this._sync();
    this._renderLabel();
    emit(this, "input", { value: this.value });
    emit(this, "change", { value: this.value });
  }

  _key(e: KeyboardEvent): void {
    const open = this._popup.open;
    const vis = this._visible();
    const enabled = (j: number) => !this._options[vis[j]]?.disabled;
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      if (!open) return this._open();
      const pos = vis.indexOf(this._active);
      const next = moveIndex(pos, vis.length, e.key, enabled);
      if (next >= 0) this._setActive(vis[next]);
    } else if (e.key === "Enter" || (e.key === " " && !this.searchable)) {
      e.preventDefault();
      if (!open) this._open();
      else if (this._active >= 0) this._pick(this._active);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      this._popup.hide();
      this._trigger.focus();
    } else if (e.key === "Tab" && open) {
      this._popup.hide();
    } else if (!this.searchable && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      const now = Date.now();
      this._typed = now - this._typedAt > 600 ? e.key.toLowerCase() : this._typed + e.key.toLowerCase();
      this._typedAt = now;
      const i = this._options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(this._typed));
      if (i >= 0) open ? this._setActive(i) : this._commit(this.multiple ? this._values : this._options[i].value);
    }
  }

  // form-associated callbacks
  _formReset(): void {
    this._values = [];
    this._value = undefined;
    this._sync();
    this._renderLabel();
  }
  _formDisabled(disabled: boolean): void {
    this.disabled = disabled;
  }
}

