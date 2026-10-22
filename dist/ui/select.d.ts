export interface SelectOption<V = unknown> {
    label: string;
    value: V;
    disabled?: boolean;
    group?: string;
    description?: string;
}
export declare class SbxSelect extends HTMLElement {
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
