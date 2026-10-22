export interface LanguageInit {
    /** Module URL of TypeScript (ESM). Default esm.sh `typescript@<version>`. */
    typescriptUrl?: string;
    typescriptVersion?: string;
    /** Base URL for package files, `<base>/<name>@<version>/<path>`. Default jsDelivr npm. */
    packageBase?: string;
}
export interface LspDiagnostic {
    from: number;
    to: number;
    severity: "error" | "warning" | "info";
    message: string;
    line: number;
    column: number;
}
export interface LanguageService {
    init(o: LanguageInit): Promise<{
        version: string;
    }>;
    setFiles(files: Record<string, string>, dependencies?: Record<string, string>): Promise<void>;
    setFile(path: string, text: string): Promise<void>;
    setHostTypes(dts: string): Promise<void>;
    diagnostics(path: string): Promise<LspDiagnostic[]>;
    completions(path: string, pos: number): Promise<{
        from: number;
        items: {
            label: string;
            kind: string;
            detail?: string;
        }[];
    } | null>;
    quickInfo(path: string, pos: number): Promise<string | null>;
}
/** JSX typings for the UI kit's custom elements (React/Preact) and tag-name maps. */
export declare const UI_ELEMENT_TYPES: string;
/** Ambient declarations for non-code imports (a script file, so wildcards apply). */
export declare const ASSET_TYPES: string;
/** Creates the service object (used inside the worker). */
export declare function createLanguageService(): LanguageService;
/** Inside a worker: serve the language service over the bridge. */
export declare function startLanguageWorker(): void;
