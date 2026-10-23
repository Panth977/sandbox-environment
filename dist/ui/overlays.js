/**
 * Overlays: `<sbx-dialog>`, the `confirmDialog` / `promptDialog` helpers, and
 * toasts (`toast()` + `<sbx-toaster>`).
 *
 * ```html
 * <sbx-dialog id="d" heading="Move devices">
 *   <p>Move 12 devices to the spare pool?</p>
 *   <button slot="footer" class="sbx-btn" data-close="cancel">Cancel</button>
 *   <button slot="footer" class="sbx-btn sbx-btn--primary" data-close="ok">Move</button>
 * </sbx-dialog>
 * <script> d.show(); d.addEventListener("close", (e) => e.detail.returnValue) </script>
 * ```
 *
 * @module
 */
import { ElementBase, define, emit, esc, shadow } from "./base.js";

const DIALOG_CSS = `
:host { display: contents; }
dialog { border: 1px solid var(--sbx-line); border-radius: var(--sbx-radius-lg); padding: 0; background: var(--sbx-surface);
  color: var(--sbx-text); box-shadow: var(--sbx-shadow); width: min(var(--sbx-dialog-width, 480px), calc(100vw - 32px));
  max-height: calc(100vh - 48px); overflow: hidden; display: none; flex-direction: column; }
dialog[open] { display: flex; animation: pop .14s ease-out; }
:host([size="sm"]) dialog { --sbx-dialog-width: 360px; } :host([size="lg"]) dialog { --sbx-dialog-width: 720px; }
:host([size="full"]) dialog { --sbx-dialog-width: 100vw; height: calc(100vh - 48px); }
dialog::backdrop { background: var(--sbx-overlay); }
header { display: flex; align-items: center; gap: 8px; padding: 14px 16px 6px; }
h2 { margin: 0; font-size: 15px; font-weight: 600; flex: 1; }
.x { all: unset; cursor: pointer; color: var(--sbx-muted); width: 24px; height: 24px; display: grid; place-items: center; border-radius: 4px; }
.x:hover { background: var(--sbx-surface-2); color: var(--sbx-text); }
.body { padding: 6px 16px 14px; overflow: auto; font-size: 13px; line-height: 1.5; }
footer { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--sbx-line); }
.nofooter footer { display: none; }
@keyframes pop { from { opacity: 0; transform: translateY(6px) scale(.98); } }
@media (prefers-reduced-motion: reduce) { dialog[open] { animation: none; } }
`;

export class SbxDialog extends ElementBase {
  _init()       {
    this.returnValue = "";
  }

  _connected()       {
    if (this._root) return;
    this._root = shadow(this, DIALOG_CSS, `
      <dialog part="dialog" aria-labelledby="h">
        <header part="header"><h2 id="h"></h2><button class="x" part="close" aria-label="Close">✕</button></header>
        <div class="body" part="body"><slot></slot></div>
        <footer part="footer"><slot name="footer"></slot></footer>
      </dialog>`);
    const dlg = this._dialog;
    this._root.querySelector(".x") .addEventListener("click", () => this.close("dismiss"));
    dlg.addEventListener("cancel", (e) => {
      e.preventDefault();
      if (this.dismissable) this.close("dismiss");
    });
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg && this.dismissable) {
        const r = dlg.getBoundingClientRect();
        const { clientX: x, clientY: y } = e              ;
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) this.close("dismiss");
      }
    });
    this.addEventListener("click", (e) => {
      const btn = (e.target           ).closest("[data-close]");
      if (btn && this.contains(btn)) this.close(btn.getAttribute("data-close") ?? "");
    });
    const footer = this._root.querySelector                 ('slot[name="footer"]') ;
    const syncFooter = () => this._root.querySelector("dialog") .classList.toggle("nofooter", footer.assignedElements().length === 0);
    footer.addEventListener("slotchange", syncFooter);
    syncFooter();
    this._syncHeading();
    if (this.hasAttribute("open")) this.show();
  }

  _attributeChanged(name        )       {
    if (!this._root) return;
    if (name === "heading") this._syncHeading();
    if (name === "open") this.hasAttribute("open") ? this.show() : this.close();
  }

  get _dialog()                    {
    return this._root.querySelector("dialog") ;
  }

  _syncHeading() {
    const h = this._root.querySelector("h2") ;
    h.textContent = this.getAttribute("heading") ?? "";
    (h.parentElement               ).style.display = h.textContent || !this.hasAttribute("noclose") ? "" : "none";
    (this._root.querySelector(".x")               ).hidden = this.hasAttribute("noclose");
  }

  /** Esc / backdrop / ✕ close it (default). Set the `persistent` attribute to require an explicit choice. */
  get dismissable()          {
    return !this.hasAttribute("persistent");
  }

  get open()          {
    return !!this._root && this._dialog.open;
  }

  /** Opens as a modal. */
  show()       {
    if (!this._root) {
      this.setAttribute("open", "");
      return;
    }
    if (this._dialog.open) return;
    this.returnValue = "";
    this._dialog.showModal();
    if (!this.hasAttribute("open")) this.setAttribute("open", "");
    const auto = this.querySelector             ("[autofocus]") ?? this.querySelector             ('[slot="footer"].sbx-btn--primary');
    auto?.focus();
    emit(this, "open");
  }

  /** Closes with an optional return value (also from `data-close="value"` buttons). */
  close(returnValue = "")       {
    if (!this._root || !this._dialog.open) return;
    this.returnValue = returnValue;
    this._dialog.close(returnValue);
    this.removeAttribute("open");
    emit(this, "close", { returnValue });
  }
}

// ---- toasts --------------------------------------------------------------

const TOASTER_CSS = `
:host { position: fixed; z-index: 2147483000; right: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 8px;
  align-items: flex-end; pointer-events: none; max-width: calc(100vw - 32px); }
:host([position="top"]) { top: 16px; bottom: auto; }
.t { pointer-events: auto; display: flex; align-items: center; gap: 10px; min-width: 220px; max-width: 420px; padding: 10px 12px;
  border-radius: var(--sbx-radius); background: var(--sbx-text); color: var(--sbx-bg); box-shadow: var(--sbx-shadow);
  font-size: 13px; animation: in .16s ease-out; }
.t.success .dot { background: var(--sbx-success); } .t.error .dot { background: var(--sbx-danger); }
.t.warning .dot { background: var(--sbx-warning); } .t.info .dot { background: var(--sbx-accent); }
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.msg { flex: 1; }
.act { all: unset; cursor: pointer; font-weight: 600; color: var(--sbx-accent-soft); }
.x { all: unset; cursor: pointer; opacity: .6; } .x:hover { opacity: 1; }
.t.out { opacity: 0; transform: translateY(6px); transition: opacity .15s, transform .15s; }
@keyframes in { from { opacity: 0; transform: translateY(8px); } }
`;

export class SbxToaster extends ElementBase {
  _init()       {

  }

  _connected()       {
    if (!this._root) this._root = shadow(this, TOASTER_CSS, "");
    this.setAttribute("role", "status");
    this.setAttribute("aria-live", "polite");
  }
  add(message        , o               = {})             {
    if (!this._root) this._connected();
    const kind = o.kind ?? "info";
    const el = document.createElement("div");
    el.className = `t ${kind}`;
    el.setAttribute("part", "toast");
    el.innerHTML = `<span class="dot"></span><span class="msg"></span>${o.action ? `<button class="act"></button>` : ""}<button class="x" aria-label="Dismiss">✕</button>`;
    el.querySelector(".msg") .textContent = message;
    const remove = () => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 160);
    };
    if (o.action) {
      const b = el.querySelector                   (".act") ;
      b.textContent = o.action.label;
      b.addEventListener("click", () => {
        o.action .onClick();
        remove();
      });
    }
    el.querySelector(".x") .addEventListener("click", remove);
    this._root.append(el);
    const t = o.timeout ?? (kind === "error" ? 7000 : 4000);
    if (t > 0) setTimeout(remove, t);
    return remove;
  }
}
