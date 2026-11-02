/**
 * The API an artifact imports. Inside the sandbox it is linked to the running
 * runtime; outside a sandbox (tests, SSR tools) every call throws.
 *
 * ```ts
 * import { host, env, expose, onTheme } from "@panth977/sandbox/artifact";
 *
 * const devices = await host.devices.list({ orgId: env.orgId as string });
 * for await (const reading of host.live.readings("D12")) chart.push(reading);
 * expose({ getSelection: () => selected });   // the host can call this
 * ```
 *
 * Type the host API by augmenting {@link HostApi} (hosts usually ship this as a .d.ts):
 *
 * ```ts
 * declare module "@panth977/sandbox/artifact" {
 *   interface HostApi { devices: { list(q?: { orgId?: string }): Promise<Device[]> } }
 * }
 * ```
 *
 * @module
 */
import type { Remote } from "../bridge.js";
import type { ArtifactManifest, Theme } from "../protocol.js";
/** The host's API. Empty here; augment it with your host's interface. */
export interface HostApi {
}
/** Values the host passed as `env`. Augment for typed keys. */
export interface Env {
    [key: string]: unknown;
}
/** The host's API, typed by {@link HostApi}. Every call is async; stream results are async-iterable. */
export declare const host: Remote<HostApi>;
/** The host-provided environment (live: reads the latest value). */
export declare const env: Env;
/** The artifact's manifest as compiled. */
export declare function manifest(): ArtifactManifest;
/**
 * Offer functions to the host (`handle.remote.<name>()` on the host side).
 * Call it as often as you like; later calls add or replace names.
 */
export declare function expose(api: Record<string, unknown>): void;
/** The current theme. */
export declare function theme(): Theme;
/** Called on every theme change from the host. Returns an unsubscribe function. */
export declare function onTheme(cb: (t: Theme) => void): () => void;
/** Called when the host replaces `env`. Returns an unsubscribe function. */
export declare function onEnv(cb: (e: Env) => void): () => void;
/** True inside a sandbox runtime. */
export declare function inSandbox(): boolean;
export { SandboxError } from "../bridge.js";
export type { Remote, RemoteStream } from "../bridge.js";
