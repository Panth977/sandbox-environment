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
import { define, emit, esc, moveIndex, Popup, shadow, uid } from "./base.js";

const CSS = `
:host { display: inline-block; }
.kbd { margin-left: auto; padding-left: 16px; font-size: 11px; color: var(--sbx-subtle); }
`;

export class SbxMenu extends HTMLElement {
  #items             = [];
  #fromChildren = true;
  #root             ;
  #popup        ;
  #active = -1;
  #id = uid("menu");
  #mo                          = null;

  connectedCallback()       {
    if (!this.#root) {
      this.#root = shadow(this, CSS, `<slot name="trigger"></slot><div class="list" role="menu" id="${this.#id}" part="menu"></div>`);
      const list = this.#root.querySelector             (".list") ;
      const slot = this.#root.querySelector                 ("slot") ;
      const trigger = () => slot.assignedElements()[0]                           ;
      this.#popup = new Popup(list, this, {
        placement: (this.getAttribute("placement")             ) ?? "bottom-start",
        onClose: () => trigger()?.setAttribute("aria-expanded", "false"),
      });
      slot.addEventListener("slotchange", () => {
        const t = trigger();
        t?.setAttribute("aria-haspopup", "menu");
        t?.setAttribute("aria-expanded", "false");
      });
      this.addEventListener("click", (e) => {
        if ((e.target           ).closest('[slot="trigger"]')) this.#toggle();
      });
      this.addEventListener("keydown", (e) => {
        if (!(e.target           ).closest('[slot="trigger"]')) return;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          if (!this.#popup.open) this.#open(e.key === "ArrowUp" ? "End" : "Home");
        }
      });
      list.addEventListener("pointerdown", (e) => e.preventDefault());
      list.addEventListener("click", (e) => {
        const it = (e.target           ).closest             (".item");
        if (it) this.#choose(Number(it.dataset.i));
      });
      list.addEventListener("pointermove", (e) => {
        const it = (e.target           ).closest             (".item");
        if (it) this.#setActive(Number(it.dataset.i));
      });
      list.addEventListener("keydown", (e) => this.#key(e));
    }
    this.#mo = new MutationObserver(() => this.#fromChildren && this.#read());
    this.#mo.observe(this, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["value", "disabled", "danger", "shortcut", "checked"] });
    this.#read();
  }

  disconnectedCallback()       {
    this.#mo?.disconnect();
    this.#popup?.hide();
  }

  get items()             {
    return this.#items;
  }
  set items(v            ) {
    this.#fromChildren = false;
    this.#items = Array.isArray(v) ? v : [];
    if (this.#popup?.open) this.#render();
  }

  /** Opens the menu (focus goes to the first item). */
  show()       {
    this.#open("Home");
  }
  hide()       {
    this.#popup?.hide();
  }

  #read() {
    if (!this.#fromChildren) return;
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
    this.#items = items;
  }

  #render() {
    const list = this.#root.querySelector             (".list") ;
    let html = "";
    this.#items.forEach((it, i) => {
      if ("separator" in it) html += `<div class="sep" role="separator"></div>`;
      else if ("group" in it) html += `<div class="group" role="presentation">${esc(it.group)}</div>`;
      else {
        html += `<div class="item${it.danger ? " danger" : ""}${i === this.#active ? " active" : ""}" role="${it.checked === undefined ? "menuitem" : "menuitemcheckbox"}"` +
          ` tabindex="-1" data-i="${i}"${it.disabled ? ' aria-disabled="true"' : ""}${it.checked !== undefined ? ` aria-checked="${!!it.checked}"` : ""}>` +
          (it.checked !== undefined ? `<span class="check">${it.checked ? "✓" : ""}</span>` : "") +
          `<span>${esc(it.label)}</span>${it.shortcut ? `<span class="kbd">${esc(it.shortcut)}</span>` : ""}</div>`;
      }
    });
    list.innerHTML = html || `<div class="empty">No actions</div>`;
    this.#popup.update();
  }

  #enabled = (i        ) => {
    const it = this.#items[i];
    return !!it && "label" in it && !it.disabled;
  };

  #open(from                ) {
    this.#read();
    this.#active = moveIndex(-1, this.#items.length, from, this.#enabled);
    this.#popup.show();
    this.#render();
    (this.querySelector('[slot="trigger"]')                      )?.setAttribute("aria-expanded", "true");
    this.#focusActive();
  }

  #toggle() {
    this.#popup.open ? this.#popup.hide() : this.#open("Home");
  }

  #setActive(i        ) {
    if (i === this.#active) return;
    this.#active = i;
    for (const el of this.#root.querySelectorAll             (".item")) el.classList.toggle("active", Number(el.dataset.i) === i);
    this.#focusActive();
  }

  #focusActive() {
    this.#root.querySelector             (`.item[data-i="${this.#active}"]`)?.focus();
  }

  #choose(i        ) {
    const it = this.#items[i];
    if (!it || !("label" in it) || it.disabled) return;
    this.#popup.hide();
    (this.querySelector('[slot="trigger"]')                      )?.focus();
    emit(this, "select", { value: it.value, item: it });
  }

  #key(e               ) {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      this.#setActive(moveIndex(this.#active, this.#items.length, e.key, this.#enabled));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      this.#choose(this.#active);
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      this.#popup.hide();
      (this.querySelector('[slot="trigger"]')                      )?.focus();
    }
  }
}

/** Data-only children of `<sbx-menu>`. */
class SbxMenuData extends HTMLElement {
  connectedCallback()       {
    this.hidden = true;
  }
}

define("sbx-menu", SbxMenu);
define("sbx-menu-item", class extends SbxMenuData {});
define("sbx-menu-separator", class extends SbxMenuData {});
define("sbx-menu-group", class extends SbxMenuData {});
