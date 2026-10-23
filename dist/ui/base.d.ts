/**
 * `HTMLElement`, or a stand-in where there is no DOM (Node, SSR, tests), so
 * importing the kit never throws; elements are only defined in a browser.
 */
export declare const ElementBase: typeof HTMLElement;
/** Attaches an open shadow root with the shared styles plus `css`. */
export declare function shadow(el: HTMLElement, css: string, html: string): ShadowRoot;
/** `customElements.define`, but only once (several packs may ship the kit). */
export declare function define(name: string, ctor: CustomElementConstructor): void;
export declare const uid: (p?: string) => string;
export declare const esc: (s: unknown) => string;
/** Dispatches a bubbling, composed CustomEvent. */
export declare function emit<T>(el: HTMLElement, type: string, detail?: T, cancelable?: boolean): boolean;
export type Placement = "bottom-start" | "bottom-end" | "top-start" | "top-end" | "bottom" | "top" | "right" | "left";
/** Places a `position: fixed` element next to `anchor`, flipping to stay in the viewport. */
export declare function place(pop: HTMLElement, anchor: Element, placement?: Placement, gap?: number, matchWidth?: boolean): void;
/**
 * A light-dismiss popup (Popover API, top layer) anchored to an element.
 * Falls back to a fixed element with an outside-click handler.
 */
export declare class Popup {
    readonly el: HTMLElement;
    open: boolean;
    private anchor;
    private placement;
    private matchWidth;
    private onClose;
    private reposition;
    private outside;
    constructor(el: HTMLElement, anchor: Element, o?: {
        placement?: Placement;
        matchWidth?: boolean;
        onClose?: () => void;
    });
    show(): void;
    hide(): void;
    toggle(): void;
    update(): void;
}
/** Moves an "active" index through enabled items with arrow keys / Home / End. */
export declare function moveIndex(current: number, count: number, key: string, enabled: (i: number) => boolean): number;
