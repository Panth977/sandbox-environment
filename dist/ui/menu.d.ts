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
import { ElementBase, Popup } from "./base.js";
export type MenuItem = {
    label: string;
    value: unknown;
    danger?: boolean;
    disabled?: boolean;
    shortcut?: string;
    checked?: boolean;
} | {
    separator: true;
} | {
    group: string;
};
export declare class SbxMenu extends ElementBase {
    _init(): void;
    _items: MenuItem[];
    _fromChildren: boolean;
    _root: ShadowRoot;
    _popup: Popup;
    _active: number;
    _id: string;
    _mo: MutationObserver | null;
    _connected(): void;
    _disconnected(): void;
    get items(): MenuItem[];
    set items(v: MenuItem[]);
    /** Opens the menu (focus goes to the first item). */
    show(): void;
    hide(): void;
    _read(): void;
    _render(): void;
    _enabled(i: number): boolean;
    _open(from: "Home" | "End"): void;
    _toggle(): void;
    _setActive(i: number): void;
    _focusActive(): void;
    _choose(i: number): void;
    _key(e: KeyboardEvent): void;
}
