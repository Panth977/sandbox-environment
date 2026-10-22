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
import { apiPaths, createEndpoint, SandboxError } from "../bridge.ts";
import type { Endpoint, Middleware, Remote } from "../bridge.ts";
import { isSbx, PROTOCOL } from "../protocol.ts";
import type {
  BootPayload,
  CompiledArtifact,
  ComponentPackRef,
  ConsoleEntry,
  RuntimeErrorEntry,
  Theme,
} from "../protocol.ts";
import { RUNTIME_ENTRY, RUNTIME_MODULES, RUNTIME_SPECIFIERS } from "../generated/runtime_modules.ts";
import { buildCsp, originOf, randomNonce, sandboxHtml } from "./html.ts";

/** Sandbox flags a host may add. `allow-same-origin` and top navigation are never allowed. */
export type SandboxFlag =
  | "allow-downloads"
  | "allow-forms"
  | "allow-modals"
  | "allow-popups"
  | "allow-popups-to-escape-sandbox"
  | "allow-pointer-lock"
  | "allow-presentation"
  | "allow-orientation-lock";

const ALLOWED_FLAGS = new Set<string>([
  "allow-downloads",
  "allow-forms",
  "allow-modals",
  "allow-popups",
  "allow-popups-to-escape-sandbox",
  "allow-pointer-lock",
  "allow-presentation",
  "allow-orientation-lock",
]);

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
  mode?: "srcdoc" | { url: string };
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

function effectiveNetwork(o: MountOptions): string[] {
  const asked = o.artifact.manifest?.network ?? [];
  const allow = o.network ?? [];
  const granted = allow.includes("*") ? asked : asked.filter((x) => allow.includes(x));
  return [...granted, ...(o.networkAlways ?? [])];
}

function scriptOrigins(o: MountOptions): string[] {
  const out: string[] = [];
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
function skipInternal(mw: Middleware): Middleware {
  return (ctx, next) => (!ctx.callback && ctx.path[0] === "$sbx" ? next() : mw(ctx, next));
}

/** Runtime modules + specifiers, optionally without the UI kit. */
function runtimeFor(ui: boolean): { modules: Record<string, string>; specifiers: Record<string, string> } {
  if (ui) return { modules: RUNTIME_MODULES, specifiers: RUNTIME_SPECIFIERS };
  const modules: Record<string, string> = {};
  for (const [k, v] of Object.entries(RUNTIME_MODULES)) if (!k.startsWith("sbx:/@sbx/ui/")) modules[k] = v;
  const specifiers: Record<string, string> = {};
  for (const [k, v] of Object.entries(RUNTIME_SPECIFIERS)) if (v in modules) specifiers[k] = v;
  return { modules, specifiers };
}

/** Mounts an artifact into `container`. */
export function mount<A extends object = Record<string, never>>(container: Element, options: MountOptions): ArtifactHandle<A> {
  let opts = options;
  let iframe!: HTMLIFrameElement;
  let endpoint: Endpoint<A> | null = null;
  const controls = () =>
    (endpoint?.remote as unknown as Remote<{ $sbx: { theme(t: Theme): void; env(e: Record<string, unknown>): void } }> | undefined)?.$sbx;
  let onWindowMessage: ((e: MessageEvent) => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let readyResolve!: () => void;
  let ready!: Promise<void>;
  let destroyed = false;

  const remoteProxy = new Proxy({}, {
    get(_t, key) {
      if (typeof key === "symbol" || key === "then") return undefined;
      if (!endpoint) {
        return () => Promise.reject(new SandboxError("unavailable", "Artifact is not running"));
      }
      return (endpoint.remote as Record<string, unknown>)[key];
    },
  }) as Remote<A>;

  function start() {
    const o = opts;
    ready = new Promise<void>((r) => (readyResolve = r));
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
      console: (e: ConsoleEntry) => o.onConsole?.(e),
      error: (e: RuntimeErrorEntry) => o.onError?.(e),
      size: (h: number) => {
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
      open: (url: string) => {
        if (o.onOpen) return o.onOpen(url);
        try {
          const u = new URL(url);
          if (u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:") {
            globalThis.open?.(u.href, "_blank", "noopener,noreferrer");
          }
        } catch { /* ignore malformed */ }
      },
    };
    const exposed: Record<string, unknown> = { ...(o.api ?? {}), $sbx: internal };

    let booted = false;
    onWindowMessage = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow || !isSbx(e.data)) return;
      const d = e.data as { t: string; protocols?: number[]; message?: string };
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
      const boot: BootPayload = {
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
      iframe.contentWindow!.postMessage({ $sbx: PROTOCOL, t: "boot", protocol: PROTOCOL, boot }, "*", [ch.port2]);
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
