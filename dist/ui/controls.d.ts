/**
 * Small interactive controls: `<sbx-tabs>`, `<sbx-switch>`, `<sbx-tooltip>`.
 *
 * ```html
 * <sbx-tabs value="overview">
 *   <sbx-tab value="overview">Overview</sbx-tab>
 *   <sbx-tab value="devices" count="12">Devices</sbx-tab>
 *   <section data-tab="overview">…</section>
 *   <section data-tab="devices">…</section>
 * </sbx-tabs>
 *
 * <sbx-switch name="notify" checked>Notify me</sbx-switch>
 *
 * <sbx-tooltip text="Copy link"><button class="sbx-btn sbx-btn--icon">⧉</button></sbx-tooltip>
 * ```
 *
 * @module
 */
import { ElementBase } from "./base.js";
export interface TabDef {
    value: string;
    label: string;
    count?: number | string;
    disabled?: boolean;
}
export declare class SbxTabs extends ElementBase {
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
export declare class SbxSwitch extends ElementBase {
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
export declare class SbxTooltip extends ElementBase {
    #private;
    connectedCallback(): void;
}
