import type { ArtifactHandle, MountOptions } from "./mount.js";
export interface ArtifactActionOptions extends MountOptions {
    /** Receives the handle once mounted (e.g. to call `handle.remote.*`). */
    onHandle?(handle: ArtifactHandle<any>): void;
}
/** Svelte action: `use:artifact={options}`. */
export declare function artifact(node: HTMLElement, options: ArtifactActionOptions): {
    update(o: ArtifactActionOptions): void;
    destroy(): void;
};
/** Svelte 5 attachment: `{@attach sandbox(options)}`. */
export declare function sandbox(options: ArtifactActionOptions): (node: HTMLElement) => () => void;
