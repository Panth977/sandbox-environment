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

/** The host's API. Empty here; augment it with your host's interface. */
// deno-lint-ignore no-empty-interface

/** Values the host passed as `env`. Augment for typed keys. */

function state()               {
  const s = globalThis.__sbx;
  if (!s) throw new Error("@panth977/sandbox/artifact used outside a sandbox runtime");
  return s;
}

const hostProxy = new Proxy({}, {
  get(_t, key) {
    if (typeof key === "symbol" || key === "then") return undefined;
    if (key === "$sbx") return undefined;
    return (state().endpoint.remote                           )[key];
  },
});

/** The host's API, typed by {@link HostApi}. Every call is async; stream results are async-iterable. */
export const host                  = hostProxy                   ;

/** The host-provided environment (live: reads the latest value). */
export const env      = new Proxy({}       , {
  get: (_t, key) => (typeof key === "string" ? state().env[key] : undefined),
  has: (_t, key) => typeof key === "string" && key in state().env,
  ownKeys: () => Reflect.ownKeys(state().env),
  getOwnPropertyDescriptor: (_t, key) =>
    typeof key === "string" && key in state().env
      ? { configurable: true, enumerable: true, value: state().env[key] }
      : undefined,
});

/** The artifact's manifest as compiled. */
export function manifest()                   {
  return state().boot.artifact.manifest;
}

/**
 * Offer functions to the host (`handle.remote.<name>()` on the host side).
 * Call it as often as you like; later calls add or replace names.
 */
export function expose(api                         )       {
  const target = state().exposed;
  for (const [k, v] of Object.entries(api)) {
    if (k === "$sbx" || k.startsWith("_")) throw new Error(`Cannot expose "${k}": reserved name`);
    target[k] = v;
  }
}

/** The current theme. */
export function theme()        {
  return state().theme;
}

/** Called on every theme change from the host. Returns an unsubscribe function. */
export function onTheme(cb                    )             {
  const s = state();
  s.themeListeners.add(cb);
  return () => s.themeListeners.delete(cb);
}

/** Called when the host replaces `env`. Returns an unsubscribe function. */
export function onEnv(cb                  )             {
  const s = state();
  s.envListeners.add(cb);
  return () => s.envListeners.delete(cb);
}

/** True inside a sandbox runtime. */
export function inSandbox()          {
  return !!globalThis.__sbx;
}

export { SandboxError } from "../bridge.js";
