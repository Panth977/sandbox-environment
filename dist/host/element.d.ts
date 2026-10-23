import type { ArtifactHandle, MountOptions } from "./mount.js";
import type { CompiledArtifact, ComponentPackRef, ConsoleEntry, RuntimeErrorEntry, Theme } from "../protocol.js";
import type { Middleware } from "../bridge.js";
/** The options the element passes to `mount()` (its own event wiring aside). */
export type ArtifactElementOptions = Omit<MountOptions, "onConsole" | "onError" | "onReady">;
/** Event detail types, by event name. */
export interface ArtifactElementEvents {
    "sbx-ready": CustomEvent<void>;
    "sbx-error": CustomEvent<RuntimeErrorEntry>;
    "sbx-console": CustomEvent<ConsoleEntry>;
    "sbx-mount": CustomEvent<ArtifactHandle<any>>;
}
declare const Base: typeof HTMLElement;
/** The `<sbx-artifact>` element class. */
export declare class SbxArtifactElement extends Base {
    #private;
    static get observedAttributes(): string[];
    /** All options at once (replaces what was set before). */
    get options(): Partial<ArtifactElementOptions>;
    set options(o: Partial<ArtifactElementOptions>);
    get artifact(): CompiledArtifact | undefined;
    set artifact(v: CompiledArtifact | undefined);
    get api(): object | undefined;
    set api(v: object | undefined);
    get middleware(): Middleware[] | undefined;
    set middleware(v: Middleware[] | undefined);
    get meta(): Record<string, unknown> | undefined;
    set meta(v: Record<string, unknown> | undefined);
    get components(): ComponentPackRef[] | undefined;
    set components(v: ComponentPackRef[] | undefined);
    get ui(): boolean | undefined;
    set ui(v: boolean | undefined);
    get theme(): Theme | undefined;
    set theme(v: Theme | undefined);
    get env(): Record<string, unknown> | undefined;
    set env(v: Record<string, unknown> | undefined);
    get network(): string[] | undefined;
    set network(v: string[] | undefined);
    get networkAlways(): string[] | undefined;
    set networkAlways(v: string[] | undefined);
    get sandbox(): MountOptions["sandbox"];
    set sandbox(v: MountOptions["sandbox"]);
    get mode(): MountOptions["mode"];
    set mode(v: MountOptions["mode"]);
    get size(): MountOptions["size"];
    set size(v: MountOptions["size"]);
    get minHeight(): number | undefined;
    set minHeight(v: number | undefined);
    get bootTimeoutMs(): number | undefined;
    set bootTimeoutMs(v: number | undefined);
    /** The mounted artifact (null before it mounts). */
    get handle(): ArtifactHandle<any> | null;
    /** What the artifact offered with `expose()` (null before it mounts). */
    get remote(): ArtifactHandle<any>["remote"] | null;
    /** Resolves once the current artifact's entry module has run. */
    get ready(): Promise<void>;
    connectedCallback(): void;
    disconnectedCallback(): void;
    attributeChangedCallback(name: string, _old: string | null, value: string | null): void;
}
/** Defines the element under `tag` (default `sbx-artifact`); importing this module already does it. */
export declare function defineArtifactElement(tag?: string): void;
export {};
