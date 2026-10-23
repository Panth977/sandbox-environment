import type { ArtifactManifest, CompiledArtifact } from "../protocol.js";
/** Source files keyed by path (`/index.tsx`, `/lib/util.ts`, `/manifest.json`…). */
export type SourceFiles = Record<string, string>;
export interface Diagnostic {
    file?: string;
    line?: number;
    column?: number;
    message: string;
    severity: "error" | "warning";
    source: "transform" | "resolve" | "manifest";
}
export interface CompileResult {
    ok: boolean;
    artifact?: CompiledArtifact;
    diagnostics: Diagnostic[];
    /** Files that took part, in load order. */
    files: string[];
}
/** The subset of the TypeScript API the compiler uses. */
export interface TsLike {
    transpileModule(src: string, o: Record<string, unknown>): {
        outputText: string;
        diagnostics?: {
            messageText: unknown;
            start?: number;
            file?: unknown;
            category: number;
        }[];
    };
    flattenDiagnosticMessageText?(m: unknown, nl: string): string;
}
/** The subset of the Svelte compiler API the compiler uses. */
export interface SvelteLike {
    compile(src: string, o: Record<string, unknown>): {
        js: {
            code: string;
        };
        warnings?: {
            message: string;
            start?: {
                line: number;
                column: number;
            };
        }[];
    };
    VERSION?: string;
}
/** Transform one file. Return JS module source, or null to let the next plugin try. */
export interface Plugin {
    name: string;
    test(path: string): boolean;
    transform(code: string, path: string, ctx: PluginContext): Promise<string | null> | string | null;
}
export interface PluginContext {
    options: Required<Pick<CompileOptions, "jsx" | "sourcemap">>;
    manifest: ArtifactManifest;
    typescript(): Promise<TsLike>;
    svelte(): Promise<SvelteLike>;
    warn(message: string, line?: number, column?: number): void;
    /** A problem that makes the file unusable (the build fails, the previous one keeps running). */
    error(message: string, line?: number, column?: number): void;
}
export interface CompileOptions {
    /** Entry file. Default: manifest `entry`, else the first of /index.(tsx|ts|jsx|js|svelte). */
    entry?: string;
    /** Overrides `/manifest.json`. */
    manifest?: ArtifactManifest;
    /** JSX flavour for .tsx/.jsx. Default: from manifest.jsx, else "react" when react is a dependency, else "preact" if listed, else "react". */
    jsx?: "react" | "preact";
    /** Package versions for bare imports (merged over manifest.dependencies and the defaults). */
    dependencies?: Record<string, string>;
    /** Builds the URL for a bare import. Default: esm.sh. */
    cdn?(name: string, version: string, subpath: string): string;
    /** Loads the TypeScript compiler. Default: `import("typescript")`, else from the CDN. */
    typescript?(): Promise<TsLike>;
    /** Loads the Svelte compiler. Default: `import("svelte/compiler")`, else from the CDN (same version as the svelte dependency). */
    svelte?(): Promise<SvelteLike>;
    /** Extra transforms, tried before the built-in ones. */
    plugins?: Plugin[];
    /** Inline source maps (default true). */
    sourcemap?: boolean;
    /** Bare specifiers provided by the runtime (never sent to the CDN). Default: `@panth977/sandbox/*`. */
    provided?(specifier: string): boolean;
}
/** Versions used when neither the manifest nor the options name one. */
export declare const DEFAULT_VERSIONS: Record<string, string>;
export declare const esmSh: (name: string, version: string, subpath: string) => string;
export declare function normalizePath(p: string): string;
/** `react-dom/client` → [`react-dom`, `/client`]; `@scope/pkg/x` → [`@scope/pkg`, `/x`]. */
export declare function splitBare(spec: string): [string, string];
/** Turns a file path into its module key. */
export declare function moduleKey(path: string): string;
/** Compiles source files into an artifact. Never throws; problems come back as diagnostics. */
export declare function compile(input: SourceFiles, options?: CompileOptions): Promise<CompileResult>;
/** The inside of `<body>` of an HTML file (scripts removed: the entry is the script). */
export declare function extractBody(html: string): string;
