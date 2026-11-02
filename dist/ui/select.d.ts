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
import { ElementBase, Popup } from "./base.js";
export interface SelectOption<V = unknown> {
    label: string;
    value: V;
    disabled?: boolean;
    group?: string;
    description?: string;
}
export declare class SbxSelect extends ElementBase {
    _init(): void;
    _internals: ElementInternals | null;
    _options: SelectOption[];
    _fromChildren: boolean;
    _value: unknown;
    _values: unknown[];
    _active: number;
    _query: string;
    _popup: Popup;
    _root: ShadowRoot;
    _listId: string;
    _mo: MutationObserver | null;
    _typed: string;
    _typedAt: number;
    _connected(): void;
    _disconnected(): void;
    _attributeChanged(name: string, _old: string | null, val: string | null): void;
    get _trigger(): HTMLButtonElement;
    get _list(): HTMLElement;
    /** The options. Setting this stops reading child `<option>`s. */
    get options(): SelectOption[];
    set options(v: SelectOption[]);
    get multiple(): boolean;
    set multiple(v: boolean);
    get disabled(): boolean;
    set disabled(v: boolean);
    get searchable(): boolean;
    set searchable(v: boolean);
    get placeholder(): string;
    set placeholder(v: string);
    /** Selected value (single) or values (multiple). */
    get value(): unknown;
    set value(v: unknown);
    /** The selected option object(s). */
    get selected(): SelectOption | SelectOption[] | undefined;
    _readChildren(): void;
    _sync(): void;
    _renderLabel(): void;
    _visible(): number[];
    _renderList(): void;
    _open(): void;
    _closed(): void;
    _setActive(i: number, scroll?: boolean): void;
    _scrollActive(): void;
    _pick(i: number): void;
    _commit(v: unknown): void;
    _key(e: KeyboardEvent): void;
    _formReset(): void;
    _formDisabled(disabled: boolean): void;
}
