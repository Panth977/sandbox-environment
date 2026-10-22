export interface Column<R = Record<string, unknown>> {
    key: string;
    label?: string;
    align?: "left" | "right" | "center";
    width?: string;
    sortable?: boolean;
    /** Cell content: a string, a Node, or null for empty. */
    format?(value: unknown, row: R): string | Node | null | undefined;
    /** Sort by this instead of the raw value. */
    sortValue?(row: R): string | number;
}
type Row = Record<string, unknown>;
export declare class SbxTable extends HTMLElement {
    #private;
    static get observedAttributes(): string[];
    connectedCallback(): void;
    attributeChangedCallback(): void;
    get columns(): Column[];
    set columns(v: Column[]);
    get rows(): Row[];
    set rows(v: Row[]);
    /** Selected rows (with the `selectable` attribute). */
    get selection(): Row[];
    set selection(v: Row[]);
    /** Rows in display order. */
    get sortedRows(): Row[];
    sortBy(key: string, dir?: "asc" | "desc"): void;
}
export {};
