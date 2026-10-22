export interface TabDef {
    value: string;
    label: string;
    count?: number | string;
    disabled?: boolean;
}
export declare class SbxTabs extends HTMLElement {
    #private;
    static get observedAttributes(): string[];
    connectedCallback(): void;
    disconnectedCallback(): void;
    attributeChangedCallback(): void;
    get tabs(): TabDef[];
    set tabs(v: TabDef[]);
    get value(): string;
    set value(v: string);
}
export declare class SbxSwitch extends HTMLElement {
    #private;
    static formAssociated: boolean;
    static get observedAttributes(): string[];
    constructor();
    connectedCallback(): void;
    attributeChangedCallback(): void;
    get checked(): boolean;
    set checked(v: boolean);
    get disabled(): boolean;
    set disabled(v: boolean);
    get value(): string;
    formResetCallback(): void;
}
export declare class SbxTooltip extends HTMLElement {
    #private;
    connectedCallback(): void;
}
