/**
 * `<sbx-menu>`: a dropdown menu on a trigger.
 *
 * ```html
 * <sbx-menu placement="bottom-end">
 *   <button slot="trigger" class="sbx-btn">Actions</button>
 *   <sbx-menu-item value="edit" shortcut="E">Edit</sbx-menu-item>
 *   <sbx-menu-separator></sbx-menu-separator>
 *   <sbx-menu-item value="delete" danger>Delete</sbx-menu-item>
 * </sbx-menu>
 * ```
 * or `menu.items = [{ label, value, danger, disabled, shortcut } | { separator: true } | { group: "Title" }]`.
 * Event: `select` (detail `{ value }`).
 *
 * @module
 */
import { ElementBase, Popup, define, emit, esc, moveIndex, shadow, uid } from "./base.js";

const CSS = `
:host { display: inline-block; }
.kbd { margin-left: auto; padding-left: 16px; font-size: 11px; color: var(--sbx-subtle); }
`;

export class SbxMenu extends ElementBase {
  _init()       {
    this._items = [];
    this._fromChildren = true;
    this._active = -1;
    this._id = uid("menu");
    this._mo = null;
  }

  _connected()       {
    if (!this._root) {
      this._root = shadow(this, CSS, `<slot name="trigger"></slot><div class="list" role="menu" id="${this._id}" part="menu"></div>`);
      const list = this._root.querySelector             (".list") ;
      const slot = this._root.querySelector                 ("slot") ;
      const trigger = () => slot.assignedElements()[0]                           ;
      this._popup = new Popup(list, this, {
        placement: (this.getAttribute("placement")             ) ?? "bottom-start",
        onClose: () => trigger()?.setAttribute("aria-expanded", "false"),
      });
      slot.addEventListener("slotchange", () => {
        const t = trigger();
        t?.setAttribute("aria-haspopup", "menu");
        t?.setAttribute("aria-expanded", "false");
      });
      this.addEventListener("click", (e) => {
        if ((e.target           ).closest('[slot="trigger"]')) this._toggle();
      });
      this.addEventListener("keydown", (e) => {
        if (!(e.target           ).closest('[slot="trigger"]')) return;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          if (!this._popup.open) this._open(e.key === "ArrowUp" ? "End" : "Home");
        }
      });
      list.addEventListener("pointerdown", (e) => e.preventDefault());
      list.addEventListener("click", (e) => {
        const it = (e.target           ).closest             (".item");
        if (it) this._choose(Number(it.dataset.i));
      });
      list.addEventListener("pointermove", (e) => {
        const it = (e.target           ).closest             (".item");
        if (it) this._setActive(Number(it.dataset.i));
      });
      list.addEventListener("keydown", (e) => this._key(e));
    }
    this._mo = new MutationObserver(() => this._fromChildren && this._read());
    this._mo.observe(this, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["value", "disabled", "danger", "shortcut", "checked"] });
    this._read();
  }

  _disconnected()       {
    this._mo?.disconnect();
    this._popup?.hide();
  }

  get items()             {
    return this._items;
  }
  set items(v            ) {
    this._fromChildren = false;
    this._items = Array.isArray(v) ? v : [];
    if (this._popup?.open) this._render();
  }

  /** Opens the menu (focus goes to the first item). */
  show()       {
    this._open("Home");
  }
  hide()       {
    this._popup?.hide();
  }

  _read() {
    if (!this._fromChildren) return;
    const items             = [];
    for (const c of Array.from(this.children)) {
      if (c.slot === "trigger") continue;
      const tag = c.tagName.toLowerCase();
      if (tag === "sbx-menu-separator") items.push({ separator: true });
      else if (tag === "sbx-menu-group") items.push({ group: c.getAttribute("label") ?? c.textContent ?? "" });
      else if (tag === "sbx-menu-item") {
        items.push({
          label: c.textContent?.trim() ?? "",
          value: c.getAttribute("value") ?? c.textContent?.trim(),
          danger: c.hasAttribute("danger"),
          disabled: c.hasAttribute("disabled"),
          shortcut: c.getAttribute("shortcut") ?? undefined,
          checked: c.hasAttribute("checked") ? c.getAttribute("checked") !== "false" : undefined,
        });
      }
    }
    this._items = items;
  }

  _render() {
    const list = this._root.querySelector             (".list") ;
    let html = "";
    this._items.forEach((it, i) => {
      if ("separator" in it) html += `<div class="sep" role="separator"></div>`;
      else if ("group" in it) html += `<div class="group" role="presentation">${esc(it.group)}</div>`;
      else {
        html += `<div class="item${it.danger ? " danger" : ""}${i === this._active ? " active" : ""}" role="${it.checked === undefined ? "menuitem" : "menuitemcheckbox"}"` +
          ` tabindex="-1" data-i="${i}"${it.disabled ? ' aria-disabled="true"' : ""}${it.checked !== undefined ? ` aria-checked="${!!it.checked}"` : ""}>` +
          (it.checked !== undefined ? `<span class="check">${it.checked ? "✓" : ""}</span>` : "") +
          `<span>${esc(it.label)}</span>${it.shortcut ? `<span class="kbd">${esc(it.shortcut)}</span>` : ""}</div>`;
      }
    });
    list.innerHTML = html || `<div class="empty">No actions</div>`;
    this._popup.update();
  }

  _enabled(i        )          {
    const it = this._items[i];
    return !!it && "label" in it && !it.disabled;
  }

  _open(from                ) {
    this._read();
    this._active = moveIndex(-1, this._items.length, from, (i) => this._enabled(i));
    this._popup.show();
    this._render();
    (this.querySelector('[slot="trigger"]')                      )?.setAttribute("aria-expanded", "true");
    this._focusActive();
  }

  _toggle() {
    this._popup.open ? this._popup.hide() : this._open("Home");
  }

  _setActive(i        ) {
    if (i === this._active) return;
    this._active = i;
    for (const el of this._root.querySelectorAll             (".item")) el.classList.toggle("active", Number(el.dataset.i) === i);
    this._focusActive();
  }

  _focusActive() {
    this._root.querySelector             (`.item[data-i="${this._active}"]`)?.focus();
  }

  _choose(i        ) {
    const it = this._items[i];
    if (!it || !("label" in it) || it.disabled) return;
    this._popup.hide();
    (this.querySelector('[slot="trigger"]')                      )?.focus();
    emit(this, "select", { value: it.value, item: it });
  }

  _key(e               ) {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      this._setActive(moveIndex(this._active, this._items.length, e.key, (i) => this._enabled(i)));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      this._choose(this._active);
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      this._popup.hide();
      (this.querySelector('[slot="trigger"]')                      )?.focus();
    }
  }
}
