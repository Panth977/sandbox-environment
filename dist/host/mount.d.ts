import type { Middleware, Remote } from "../bridge.js";
import type { CompiledArtifact, ComponentPackRef, ConsoleEntry, RuntimeErrorEntry, Theme } from "../protocol.js";
/** Sandbox flags a host may add. `allow-same-origin` and top navigation are never allowed. */
export type SandboxFlag = "allow-downloads" | "allow-forms" | "allow-modals" | "allow-popups" | "allow-popups-to-escape-sandbox" | "allow-pointer-lock" | "allow-presentation" | "allow-orientation-lock";
export interface MountOptions {
    /** The compiled artifact (see the compiler). */
    artifact: CompiledArtifact;
    /**
     * The API the artifact sees as `host`. Plain objects of functions (own
     * properties; names starting with `_` and `$sbx` are not reachable).
     * Functions may return values, Promises, AsyncIterables or ReadableStreams.
     */
    api?: object;
    /** Run on every call from the artifact (scopes, confirm, audit, rate limit…). */
    middleware?: Middleware[];
    /** Shared with middleware as `ctx.meta` (e.g. artifact id, viewer). */
    meta?: Record<string, unknown>;
    /** Custom-element packs loaded before the artifact (e.g. the host's own components, or `uiPack()`). */
    components?: ComponentPackRef[];
    /** Include the built-in UI kit (`@panth977/sandbox/ui`). Default true. */
    ui?: boolean;
    theme?: Theme;
    env?: Record<string, unknown>;
    /**
     * Origins the host allows artifacts to reach. The effective list is the
     * artifact manifest's `network` filtered by this; `"*"` accepts whatever the
     * manifest asks for. Default: none.
     */
    network?: string[];
    /** Origins always reachable regardless of the manifest (e.g. the host's own CDN). */
    networkAlways?: string[];
    /** Extra sandbox flags. */
    sandbox?: SandboxFlag[];
    /** `srcdoc` (default, no extra infrastructure) or the URL of a `runtime.html` on a dedicated origin. */
    mode?: "srcdoc" | {
        url: string;
    };
    /** `auto`: the iframe height follows the content. `fill`: 100% of the container. Default `auto`. */
    size?: "auto" | "fill";
    /** Minimum height in px for `auto` (default 0). */
    minHeight?: number;
    title?: string;
    /** ms to wait for the artifact to start before reporting an error (default 15000). */
    bootTimeoutMs?: number;
    onConsole?(entry: ConsoleEntry): void;
    onError?(error: RuntimeErrorEntry): void;
    onReady?(): void;
    onResize?(height: number): void;
    /** A link was clicked inside the artifact. Default: open http(s) links in a new tab. */
    onOpen?(url: string): void;
}
export interface ArtifactHandle<A extends object = Record<string, never>> {
    readonly iframe: HTMLIFrameElement;
    /** What the artifact offered with `expose()`. */
    readonly remote: Remote<A>;
    /** Resolves once the artifact's entry module has run. */
    readonly ready: Promise<void>;
    setTheme(theme: Theme): Promise<void>;
    setEnv(env: Record<string, unknown>): Promise<void>;
    /** Fresh iframe, same options; optionally a new artifact (the dev engine does this on every build). */
    reload(artifact?: CompiledArtifact): void;
    destroy(): void;
}
/** Mounts an artifact into `container`. */
export declare function mount<A extends object = Record<string, never>>(container: Element, options: MountOptions): ArtifactHandle<A>;
