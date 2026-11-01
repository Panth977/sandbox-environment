/**
 * Shared plumbing for the UI kit's custom elements: shadow styles, safe
 * definition, ids, and anchored popups on the standard Popover API.
 *
 * @module
 */
import { SHADOW_BASE_CSS } from "./css.js";

/**
 * `HTMLElement`, or a stand-in where there is no DOM (Node, SSR, tests), so
 * importing the kit never throws; elements are only defined in a browser.
 */
export const ElementBase                     = typeof HTMLElement !== "undefined"
  ? HTMLElement
  : (class {}                                 );

const sheets = new Map                              ();

/** Attaches an open shadow root with the shared styles plus `css`. */
export function shadow(el             , css        , html        )             {
  const root = el.shadowRoot ?? el.attachShadow({ mode: "open", delegatesFocus: false });
  const text = SHADOW_BASE_CSS + css;
  let sheet = sheets.get(text);
  if (sheet === undefined) {
    try {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(text);
    } catch {
      sheet = null;
    }
    sheets.set(text, sheet);
  }
  if (sheet) {
    root.adoptedStyleSheets = [sheet];
    root.innerHTML = html;
  } else {
    root.innerHTML = `<style>${text}</style>${html}`;
  }
  return root;
}

/** `customElements.define`, but only once (several packs may ship the kit). */
export function define(name        , ctor                          )       {
  if (typeof customElements !== "undefined" && !customElements.get(name)) customElements.define(name, ctor);
}

let n = 0;
export const uid = (p = "sbx")         => `${p}-${(++n).toString(36)}`;

export const esc = (s         )         =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] );

/** Dispatches a bubbling, composed CustomEvent. */
export function emit   (el             , type        , detail    , cancelable = false)          {
  return el.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true, cancelable }));
}

/** Places a `position: fixed` element next to `anchor`, flipping to stay in the viewport. */
export function place(pop             , anchor         , placement            = "bottom-start", gap = 4, matchWidth = false)       {
  const a = anchor.getBoundingClientRect();
  if (matchWidth) pop.style.minWidth = `${Math.round(a.width)}px`;
  const p = pop.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  let vh = document.documentElement.clientHeight;
  let [side, align] = placement.split("-")                                ;
  // In an auto-sized sandbox frame the viewport is only as tall as the content:
  // instead of flipping a dropdown upward, make the document taller so the
  // host grows the frame (see growFor / Popup.hide).
  const framed = typeof window !== "undefined" && window.parent !== window;
  if (framed && side === "bottom" && a.bottom + gap + p.height > vh) {
    const need = Math.ceil(a.bottom + gap + p.height + 8 + scrollY);
    const root = document.documentElement;
    if (!root.dataset.sbxGrow) root.dataset.sbxGrow = root.style.minHeight || "-";
    root.style.minHeight = `${need}px`;
    vh = Math.max(vh, need - scrollY);
  }
  if (side === "bottom" && a.bottom + gap + p.height > vh && a.top - gap - p.height >= 0) side = "top";
  else if (side === "top" && a.top - gap - p.height < 0 && a.bottom + gap + p.height <= vh) side = "bottom";
  if (side === "right" && a.right + gap + p.width > vw) side = "left";
  else if (side === "left" && a.left - gap - p.width < 0) side = "right";
  let top        ;
  let left        ;
  if (side === "bottom" || side === "top") {
    top = side === "bottom" ? a.bottom + gap : a.top - gap - p.height;
    left = align === "start" ? a.left : align === "end" ? a.right - p.width : a.left + a.width / 2 - p.width / 2;
  } else {
    left = side === "right" ? a.right + gap : a.left - gap - p.width;
    top = a.top + a.height / 2 - p.height / 2;
  }
  left = Math.max(4, Math.min(left, vw - p.width - 4));
  top = Math.max(4, Math.min(top, vh - p.height - 4));
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
  pop.dataset.side = side;
}

let openPopups = 0;
const hasPopover = typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype;

/**
 * A light-dismiss popup (Popover API, top layer) anchored to an element.
 * Falls back to a fixed element with an outside-click handler.
 */
export class Popup {
           el             ;
  open = false;
          anchor         ;
          placement           ;
          matchWidth         ;
          onClose            ;
          reposition = () => this.open && place(this.el, this.anchor, this.placement, 4, this.matchWidth);
          outside = (e       ) => {
    const path = e.composedPath();
    if (!path.includes(this.el) && !path.includes(this.anchor)) this.hide();
  };

  constructor(el             , anchor         , o                                                                        = {}) {
    this.el = el;
    this.anchor = anchor;
    this.placement = o.placement ?? "bottom-start";
    this.matchWidth = !!o.matchWidth;
    this.onClose = o.onClose ?? (() => {});
    el.classList.add("pop");
    if (hasPopover) {
      el.setAttribute("popover", "manual");
    } else {
      el.style.display = "none";
      el.style.zIndex = "2147483000";
    }
  }

  show()       {
    if (this.open) return;
    this.open = true;
    openPopups++;
    if (hasPopover) this.el.showPopover();
    else this.el.style.display = "block";
    this.reposition();
    addEventListener("scroll", this.reposition, true);
    addEventListener("resize", this.reposition);
    setTimeout(() => document.addEventListener("pointerdown", this.outside, true));
  }

  hide()       {
    if (!this.open) return;
    this.open = false;
    openPopups--;
    if (hasPopover) {
      try {
        this.el.hidePopover();
      } catch { /* already hidden */ }
    } else this.el.style.display = "none";
    removeEventListener("scroll", this.reposition, true);
    removeEventListener("resize", this.reposition);
    document.removeEventListener("pointerdown", this.outside, true);
    const root = document.documentElement;
    if (root.dataset.sbxGrow && openPopups === 0) {
      root.style.minHeight = root.dataset.sbxGrow === "-" ? "" : root.dataset.sbxGrow;
      delete root.dataset.sbxGrow;
    }
    this.onClose();
  }

  toggle()       {
    this.open ? this.hide() : this.show();
  }

  update()       {
    this.reposition();
  }
}

/** Moves an "active" index through enabled items with arrow keys / Home / End. */
export function moveIndex(current        , count        , key        , enabled                        )         {
  if (count === 0) return -1;
  const step = key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0;
  if (key === "Home" || key === "End") {
    const order = [...Array(count).keys()];
    if (key === "End") order.reverse();
    return order.find(enabled) ?? -1;
  }
  if (!step) return current;
  for (let i = 1; i <= count; i++) {
    const j = (current + step * i + count * 2) % count;
    if (enabled(j)) return j;
  }
  return current;
}
