/**
 * The render engine: put a compiled artifact into any element, sandboxed,
 * two-way connected to the host's API. Framework-free; the Svelte adapter and
 * others are thin wrappers around {@link mount}.
 *
 * ```ts
 * import { mount } from "@panth977/sandbox/host";
 *
 * const handle = mount(document.getElementById("slot")!, {
 *   artifact,                               // from the compiler
 *   api: { devices: { list: async (q) => http.get("/devices", q) } },
 *   middleware: [scopes(rules, granted)],
 *   theme: { mode: "dark" },
 *   onConsole: (e) => console.log("[artifact]", ...e.args),
 * });
 * await handle.ready;
 * ```
 *
 * @module
 */
import { apiPaths, createEndpoint, SandboxError, toCloneable } from "../bridge.js";

import { isSbx, PROTOCOL } from "../protocol.js";

import { RUNTIME_ENTRY, RUNTIME_MODULES, RUNTIME_SPECIFIERS } from "../generated/runtime_modules.js";
import { buildCsp, originOf, randomNonce, sandboxHtml } from "./html.js";

/** Sandbox flags a host may add. `allow-same-origin` and top navigation are never allowed. */

const ALLOWED_FLAGS = new Set        ([
  "allow-downloads",
  "allow-forms",
  "allow-modals",
  "allow-popups",
  "allow-popups-to-escape-sandbox",
  "allow-pointer-lock",
  "allow-presentation",
  "allow-orientation-lock",
]);

function effectiveNetwork(o              )           {
  const asked = o.artifact.manifest?.network ?? [];
  const allow = o.network ?? [];
  const granted = allow.includes("*") ? asked : asked.filter((x) => allow.includes(x));
  return [...granted, ...(o.networkAlways ?? [])];
}

function scriptOrigins(o              )           {
  const out           = [];
  for (const url of Object.values(o.artifact.imports ?? {})) {
    const origin = originOf(url);
    if (origin) out.push(origin);
  }
  for (const p of o.components ?? []) {
    const origin = p.url ? originOf(p.url) : null;
    if (origin) out.push(origin);
  }
  return out;
}

/** Calls under `$sbx` are the runtime's own; user middleware never sees them. */
function skipInternal(mw            )             {
  return (ctx, next) => (!ctx.callback && ctx.path[0] === "$sbx" ? next() : mw(ctx, next));
}

/** Runtime modules + specifiers, optionally without the UI kit. */
function runtimeFor(ui         )                                                                          {
  if (ui) return { modules: RUNTIME_MODULES, specifiers: RUNTIME_SPECIFIERS };
  const modules                         = {};
  for (const [k, v] of Object.entries(RUNTIME_MODULES)) if (!k.startsWith("sbx:/@sbx/ui/")) modules[k] = v;
  const specifiers                         = {};
  for (const [k, v] of Object.entries(RUNTIME_SPECIFIERS)) if (v in modules) specifiers[k] = v;
  return { modules, specifiers };
}

/** Mounts an artifact into `container`. */
export function mount                                          (container         , options              )                    {
  let opts = options;
  let iframe                    ;
  let endpoint                     = null;
  const controls = () =>
    (endpoint?.remote                                                                                                             )?.$sbx;
  let onWindowMessage                                     = null;
  let timer                                       = null;
  let readyResolve             ;
  let ready                ;
  let destroyed = false;

  const remoteProxy = new Proxy({}, {
    get(_t, key) {
      if (typeof key === "symbol" || key === "then") return undefined;
      if (!endpoint) {
        return () => Promise.reject(new SandboxError("unavailable", "Artifact is not running"));
      }
      return (endpoint.remote                           )[key];
    },
  })             ;

  function start() {
    const o = opts;
    ready = new Promise      ((r) => (readyResolve = r));
    ready.catch(() => {});
    const nonce = randomNonce();
    const csp = buildCsp({ nonce, scripts: scriptOrigins(o), network: effectiveNetwork(o) });
    iframe = document.createElement("iframe");
    const flags = ["allow-scripts", ...(o.sandbox ?? []).filter((f) => ALLOWED_FLAGS.has(f))];
    iframe.setAttribute("sandbox", flags.join(" "));
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.setAttribute("title", o.title ?? o.artifact.manifest?.name ?? "artifact");
    iframe.setAttribute("allow", "clipboard-write");
    iframe.style.cssText = "border:0;display:block;width:100%;background:transparent;";
    const fill = o.size === "fill";
    iframe.style.height = fill ? "100%" : `${o.minHeight ?? 0}px`;

    const internal = {
      console: (e              ) => o.onConsole?.(e),
      error: (e                   ) => o.onError?.(e),
      size: (h        ) => {
        if (!fill && typeof h === "number" && h >= 0) {
          iframe.style.height = `${Math.max(o.minHeight ?? 0, Math.min(h, 100_000))}px`;
        }
        o.onResize?.(h);
      },
      ready: () => {
        if (timer) clearTimeout(timer);
        readyResolve();
        o.onReady?.();
      },
      open: (url        ) => {
        if (o.onOpen) return o.onOpen(url);
        try {
          const u = new URL(url);
          if (u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:") {
            globalThis.open?.(u.href, "_blank", "noopener,noreferrer");
          }
        } catch { /* ignore malformed */ }
      },
    };
    const exposed                          = { ...(o.api ?? {}), $sbx: internal };

    let booted = false;
    onWindowMessage = (e              ) => {
      if (e.source !== iframe.contentWindow || !isSbx(e.data)) return;
      const d = e.data                                                         ;
      if (d.t === "fatal") {
        o.onError?.({ message: `Sandbox runtime failed: ${d.message}` });
        return;
      }
      if (d.t !== "ready" || booted) return;
      if (!Array.isArray(d.protocols) || !d.protocols.includes(PROTOCOL)) {
        o.onError?.({ message: `Sandbox speaks protocol ${d.protocols}, host speaks ${PROTOCOL}` });
        return;
      }
      booted = true;
      const ch = new MessageChannel();
      endpoint = createEndpoint(ch.port1, {
        expose: exposed,
        middleware: (o.middleware ?? []).map(skipInternal),
        meta: { ...o.meta },
      });
      const rt = runtimeFor(o.ui !== false);
      const boot              = {
        artifact: o.artifact,
        runtime: rt.modules,
        runtimeEntry: RUNTIME_ENTRY,
        specifiers: rt.specifiers,
        components: o.components ?? [],
        theme: o.theme ?? {},
        env: o.env ?? {},
        apiShape: apiPaths(o.api ?? {}),
        autoSize: !fill,
      };
      const msg = { $sbx: PROTOCOL, t: "boot", protocol: PROTOCOL, boot };
      try {
        iframe.contentWindow .postMessage(msg, "*", [ch.port2]);
      } catch (e) {
        // the artifact, theme or env may be reactive state (a Proxy): send a plain copy
        if ((e                     )?.name !== "DataCloneError") throw e;
        iframe.contentWindow .postMessage({ ...msg, boot: toCloneable(boot) }, "*", [ch.port2]);
      }
    };
    globalThis.addEventListener("message", onWindowMessage);

    if (!o.mode || o.mode === "srcdoc") iframe.srcdoc = sandboxHtml({ csp, nonce, title: o.title });
    else iframe.src = o.mode.url;
    container.append(iframe);

    timer = setTimeout(() => {
      o.onError?.({ message: `Artifact did not start within ${o.bootTimeoutMs ?? 15000} ms` });
    }, o.bootTimeoutMs ?? 15000);
  }

  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (onWindowMessage) globalThis.removeEventListener("message", onWindowMessage);
    onWindowMessage = null;
    endpoint?.close();
    endpoint = null;
    iframe?.remove();
  }

  start();

  return {
    get iframe() {
      return iframe;
    },
    remote: remoteProxy,
    get ready() {
      return ready;
    },
    async setTheme(theme) {
      opts = { ...opts, theme };
      await controls()?.theme(theme);
    },
    async setEnv(env) {
      opts = { ...opts, env };
      await controls()?.env(env);
    },
    reload(artifact) {
      if (destroyed) return;
      if (artifact) opts = { ...opts, artifact };
      stop();
      start();
    },
    destroy() {
      destroyed = true;
      stop();
    },
  };
}
