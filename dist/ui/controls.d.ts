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
import { ElementBase, Popup } from "./base.js";
export interface TabDef {
    value: string;
    label: string;
    count?: number | string;
    disabled?: boolean;
}
export declare class SbxTabs extends ElementBase {
    _init(): void;
    _root: ShadowRoot;
    _tabs: TabDef[];
    _fromChildren: boolean;
    _mo: MutationObserver | null;
    _id: string;
    _connected(): void;
    _disconnected(): void;
    _attributeChanged(): void;
    get tabs(): TabDef[];
    set tabs(v: TabDef[]);
    get value(): string;
    set value(v: string);
    _read(): void;
    _select(v: string, user: boolean): void;
    _render(): void;
    _ink(): void;
}
export declare class SbxSwitch extends ElementBase {
    _init(): void;
    _internals: ElementInternals | null;
    _root: ShadowRoot;
    _connected(): void;
    _attributeChanged(): void;
    get checked(): boolean;
    set checked(v: boolean);
    get disabled(): boolean;
    set disabled(v: boolean);
    get value(): string;
    _toggle(): void;
    _sync(): void;
    _formReset(): void;
}
export declare class SbxTooltip extends ElementBase {
    _init(): void;
    _root: ShadowRoot;
    _popup: Popup;
    _timer: ReturnType<typeof setTimeout> | null;
    _id: string;
    _connected(): void;
}
