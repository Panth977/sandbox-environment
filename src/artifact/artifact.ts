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
import type { Remote } from "../bridge.ts";
import type { ArtifactManifest, Theme } from "../protocol.ts";
import type { RuntimeGlobals, RuntimeState } from "../runtime/runtime.ts";

/** The host's API. Empty here; augment it with your host's interface. */
// deno-lint-ignore no-empty-interface
export interface HostApi {}

/** Values the host passed as `env`. Augment for typed keys. */
export interface Env {
  [key: string]: unknown;
}

function state(): RuntimeState {
  const s = (globalThis as unknown as RuntimeGlobals).__sbx;
  if (!s) throw new Error("@panth977/sandbox/artifact used outside a sandbox runtime");
  return s;
}

const hostProxy = new Proxy({}, {
  get(_t, key) {
    if (typeof key === "symbol" || key === "then") return undefined;
    if (key === "$sbx") return undefined;
    return (state().endpoint.remote as Record<string, unknown>)[key];
  },
});

/** The host's API, typed by {@link HostApi}. Every call is async; stream results are async-iterable. */
export const host: Remote<HostApi> = hostProxy as Remote<HostApi>;

/** The host-provided environment (live: reads the latest value). */
export const env: Env = new Proxy({} as Env, {
  get: (_t, key) => (typeof key === "string" ? state().env[key] : undefined),
  has: (_t, key) => typeof key === "string" && key in state().env,
  ownKeys: () => Reflect.ownKeys(state().env),
  getOwnPropertyDescriptor: (_t, key) =>
    typeof key === "string" && key in state().env
      ? { configurable: true, enumerable: true, value: state().env[key] }
      : undefined,
});

/** The artifact's manifest as compiled. */
export function manifest(): ArtifactManifest {
  return state().boot.artifact.manifest;
}

/**
 * Offer functions to the host (`handle.remote.<name>()` on the host side).
 * Call it as often as you like; later calls add or replace names.
 */
export function expose(api: Record<string, unknown>): void {
  const target = state().exposed;
  for (const [k, v] of Object.entries(api)) {
    if (k === "$sbx" || k.startsWith("_")) throw new Error(`Cannot expose "${k}": reserved name`);
    target[k] = v;
  }
}

/** The current theme. */
export function theme(): Theme {
  return state().theme;
}

/** Called on every theme change from the host. Returns an unsubscribe function. */
export function onTheme(cb: (t: Theme) => void): () => void {
  const s = state();
  s.themeListeners.add(cb);
  return () => s.themeListeners.delete(cb);
}

/** Called when the host replaces `env`. Returns an unsubscribe function. */
export function onEnv(cb: (e: Env) => void): () => void {
  const s = state();
  s.envListeners.add(cb);
  return () => s.envListeners.delete(cb);
}

/** True inside a sandbox runtime. */
export function inSandbox(): boolean {
  return !!(globalThis as unknown as RuntimeGlobals).__sbx;
}

export { SandboxError } from "../bridge.ts";
export type { Remote, RemoteStream } from "../bridge.ts";
