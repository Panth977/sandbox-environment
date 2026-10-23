/**
 * `<sbx-editor>`: a dependency-free code editor. A native `<textarea>` does
 * the typing (IME, selection, undo, accessibility, mobile keyboards) on top of
 * a highlighted copy of the text; a third layer draws diagnostics.
 *
 * ```js
 * const ed = document.createElement("sbx-editor");
 * ed.language = "tsx";
 * ed.value = source;
 * ed.diagnostics = [{ from: 10, to: 14, severity: "error", message: "…" }];
 * ed.completions = async (pos) => ({ from, items: [{ label: "list", detail: "(q) => Promise<Device[]>" }] });
 * ed.hover = async (pos) => "type info";
 * ed.addEventListener("input", () => save(ed.value));
 * ```
 * Keys: Tab / Shift+Tab indent, Enter keeps indentation, brackets and quotes
 * auto-close, Ctrl/Cmd+/ toggles comments, Ctrl+Space opens completions,
 * Ctrl/Cmd+F finds and replaces, Ctrl/Cmd+S fires a `save` event.
 * Events: `change` `{ value }`, `cursor` `{ line, column, selected }`, `save`.
 *
 * @module
 */
import { ElementBase } from "../ui/base.js";
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
export declare class SbxEditor extends ElementBase {
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
    /** Opens the find bar (Ctrl/Cmd+F), prefilled with the selection. */
    openFind(): void;
    closeFind(): void;
}
export { highlight, languageOf } from "./highlight.js";
export type { Language } from "./highlight.js";
