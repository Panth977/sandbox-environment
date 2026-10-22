import type { Language } from "./highlight.js";
export interface EditorDiagnostic {
    from: number;
    to: number;
    severity: "error" | "warning" | "info";
    message: string;
}
export interface CompletionItem {
    label: string;
    /** Text to insert (default: label). */
    insert?: string;
    detail?: string;
    kind?: string;
}
export interface CompletionResult {
    /** Offset where the replaced word starts. */
    from: number;
    items: CompletionItem[];
}
export declare class SbxEditor extends HTMLElement {
    #private;
    /** Completion provider. */
    completions: ((pos: number, value: string) => Promise<CompletionResult | null> | CompletionResult | null) | null;
    /** Hover provider (plain text). */
    hover: ((pos: number, value: string) => Promise<string | null> | string | null) | null;
    connectedCallback(): void;
    disconnectedCallback(): void;
    get value(): string;
    set value(v: string);
    get language(): Language;
    set language(v: Language);
    /** Sets the language from a file name. */
    set path(p: string);
    get diagnostics(): EditorDiagnostic[];
    set diagnostics(v: EditorDiagnostic[]);
    get readOnly(): boolean;
    set readOnly(v: boolean);
    /** Cursor offset. */
    get cursor(): number;
    /** Focuses the text area. */
    focusEditor(): void;
    /** Moves the cursor to line/column (1-based) and focuses. */
    goTo(line: number, column?: number): void;
    /** Replaces the selection (or inserts at the cursor) as one undoable edit. */
    insert(text: string, from?: number, to?: number): void;
}
export { highlight, languageOf } from "./highlight.js";
export type { Language } from "./highlight.js";
