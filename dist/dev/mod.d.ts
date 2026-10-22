import type { CompileOptions, CompileResult, SourceFiles } from "../compiler/compile.js";
import type { ArtifactHandle, MountOptions } from "../host/mount.js";
export interface DevOptions extends Omit<MountOptions, "artifact" | "size"> {
    files: SourceFiles;
    /** `.d.ts` text describing the host API for artifact authors. */
    hostTypes?: string;
    compile?: CompileOptions;
    /** URL of the language worker module (`dev/language-worker.js`), or false to turn type checking off. */
    languageWorker?: string | URL | false;
    /** ESM URL of TypeScript for the language worker. */
    typescriptUrl?: string;
    /** Code on the left (default) or right. */
    layout?: "code-left" | "code-right";
    /** Rebuild delay after typing, ms (default 400). */
    debounceMs?: number;
    readOnly?: boolean;
    /** File opened first. Default: the entry. */
    open?: string;
    onChange?(files: SourceFiles): void;
    onSave?(files: SourceFiles): void;
    onBuild?(result: CompileResult): void;
}
export interface DevHandle {
    files(): SourceFiles;
    setFile(path: string, text: string): void;
    openFile(path: string): void;
    build(): Promise<CompileResult>;
    /** The running preview. */
    readonly preview: ArtifactHandle<any> | null;
    setLayout(layout: "code-left" | "code-right"): void;
    destroy(): void;
}
/** Mounts the development engine into `container`. */
export declare function mountDev(container: HTMLElement, options: DevOptions): DevHandle;
export { createLanguageService, startLanguageWorker, UI_ELEMENT_TYPES } from "./language.js";
export type { LanguageInit, LanguageService, LspDiagnostic } from "./language.js";
