/**
 * A small JavaScript scanner that finds module specifiers: static imports,
 * re-exports, side-effect imports and `import("literal")`. It understands
 * comments, strings, template literals (with nesting) and regex literals well
 * enough for compiler output and hand-written ES modules.
 *
 * @module
 */
export interface SpecifierRef {
    /** The specifier text (without quotes). */
    value: string;
    /** Offsets of the string literal's contents (inside the quotes). */
    start: number;
    end: number;
    kind: "static" | "dynamic";
}
/** Finds every module specifier in `src`. */
export declare function scanSpecifiers(src: string): SpecifierRef[];
/** Replaces specifiers using `map` (return undefined to keep one). */
export declare function rewriteSpecifiers(src: string, refs: SpecifierRef[], map: (ref: SpecifierRef) => string | undefined): string;
