/**
 * `<sbx-table>`: a data table with sorting, selection, sticky header,
 * loading and empty states. Renders into its own light DOM with the kit's
 * `.sbx-table` classes, so your CSS can style it.
 *
 * ```js
 * table.columns = [
 *   { key: "name", label: "Device", sortable: true },
 *   { key: "pm25", label: "PM2.5", align: "right", sortable: true, format: (v) => v.toFixed(1) },
 * ];
 * table.rows = devices;
 * table.addEventListener("rowclick", (e) => open(e.detail.row));
 * ```
 * Attributes: `selectable`, `compact`, `striped`, `loading`, `empty` (text), `max-height`.
 * Events: `rowclick` `{ row, index }`, `selectionchange` `{ rows }`, `sort` `{ key, dir }`.
 *
 * @module
 */
import { ElementBase } from "./base.js";
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
export declare class SbxTable extends ElementBase {
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
