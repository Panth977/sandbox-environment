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
import { ElementBase } from "./base.js";
export interface SelectOption<V = unknown> {
    label: string;
    value: V;
    disabled?: boolean;
    group?: string;
    description?: string;
}
export declare class SbxSelect extends ElementBase {
    #private;
    static formAssociated: boolean;
    static get observedAttributes(): string[];
    constructor();
    connectedCallback(): void;
    disconnectedCallback(): void;
    attributeChangedCallback(name: string, _old: string | null, val: string | null): void;
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
    formResetCallback(): void;
    formDisabledCallback(disabled: boolean): void;
}
