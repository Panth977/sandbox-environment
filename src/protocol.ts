/**
 * The wire protocol between a host page and a sandboxed artifact.
 *
 * Every message is a plain, structured-clone-able object tagged with
 * `$sbx: PROTOCOL`. Two layers use it:
 *
 *  - the boot layer (window.postMessage, before a private port exists):
 *    `ready` from the sandbox, `boot` from the host;
 *  - the RPC layer (on the private MessagePort): calls, results, streams,
 *    callbacks and cancellation, see {@link RpcMessage}.
 *
 * The protocol version is negotiated at boot so an old artifact keeps running
 * on a newer host for as long as the host still speaks its version.
 *
 * @module
 */

/** Current protocol version. Bumped only on a breaking wire change. */
export const PROTOCOL = 1;

/** Error codes every implementation understands. Hosts may add their own. */
export type ErrorCode =
  | "permission-denied"
  | "not-found"
  | "invalid-argument"
  | "cancelled"
  | "quota"
  | "unavailable"
  | "internal"
  | (string & {});

/** How an error crosses the wire. Never carries a stack trace from the host. */
export interface WireError {
  code: ErrorCode;
  message: string;
  data?: unknown;
}

/** A function argument, replaced by a reference the other side can call. */
export interface FnRef {
  $sbxFn: number;
}

/** An AbortSignal argument; aborting it cancels the call. The callee receives the call's own signal in its place. */
export interface SignalRef {
  $sbxSignal: true;
}

/** A result that is a stream; values follow as `next` messages. */
export interface StreamRef {
  $sbxStream: number;
}

export type RpcMessage =
  /** Call a function at `path` on the other side's exposed object (or callback `ref`). */
  | { $sbx: 1; t: "call"; id: number; path?: string[]; ref?: number; args: unknown[] }
  /** A call resolved. */
  | { $sbx: 1; t: "ok"; id: number; v: unknown }
  /** A call, or a stream, failed. */
  | { $sbx: 1; t: "err"; id: number; e: WireError }
  /** One stream value. */
  | { $sbx: 1; t: "next"; id: number; v: unknown }
  /** Stream finished. */
  | { $sbx: 1; t: "end"; id: number }
  /** Stream consumer grants `n` more values (credit-based backpressure). */
  | { $sbx: 1; t: "pull"; id: number; n: number }
  /** Cancel a call, a stream or a signal. */
  | { $sbx: 1; t: "cancel"; id: number }
  /** The receiver of a callback reference no longer needs it. */
  | { $sbx: 1; t: "rel"; ref: number };

/** Sandbox → host, on window, once the runtime script is running. */
export interface ReadyMessage {
  $sbx: 1;
  t: "ready";
  protocols: number[];
}

/** Host → sandbox, on window, with the private port transferred. */
export interface BootMessage {
  $sbx: 1;
  t: "boot";
  protocol: number;
  boot: BootPayload;
}

/** Everything the runtime needs to start an artifact. */
export interface BootPayload {
  /** The compiled artifact. */
  artifact: CompiledArtifact;
  /** ES modules of the runtime itself (protocol, bridge, runtime, artifact API, UI kit), keyed by `sbx:` URL. */
  runtime: Record<string, string>;
  /** Key of the runtime module the loader starts. */
  runtimeEntry: string;
  /** Public import names → module keys, e.g. `@panth977/sandbox/artifact` → `sbx:/@sbx/artifact/artifact.js`. */
  specifiers: Record<string, string>;
  /** Component packs to load before the artifact: module URLs or inline sources. */
  components: ComponentPackRef[];
  /** CSS custom properties and color scheme. */
  theme: Theme;
  /** Values the host makes available as `env` inside the artifact. */
  env: Record<string, unknown>;
  /** Paths of the host API, so the artifact can list what exists (calls still go through the proxy). */
  apiShape: string[][];
  /** Report height changes (auto-size mode). */
  autoSize: boolean;
}

/** A theme: color scheme plus CSS custom properties set on `:root`. */
export interface Theme {
  mode?: "light" | "dark";
  vars?: Record<string, string>;
}

/** A component pack: an ES module that defines custom elements when imported. */
export interface ComponentPackRef {
  /** Module URL (must be allowed by the sandbox CSP), or… */
  url?: string;
  /** …the module source itself (loaded as a blob). */
  source?: string;
  /** Optional CSS injected into the artifact document (with the module, when it loads). */
  css?: string;
  /**
   * Lazy, plain pack: the custom-element tags the module defines itself. The
   * module is imported the first time one of these tags appears in the
   * document, not at boot.
   */
  tags?: string[];
  /**
   * Lazy, kit-style pack: the definitions, registered synchronously at boot
   * (properties, attributes, methods). The module is imported on first render
   * and must export `elements: { [tag]: ImplementationClass }` written like
   * the kit's own components (see ui/lazy.ts).
   */
  elements?: Record<string, PackElementSchema>;
}

/** A pack element's synchronous definition. */
export interface PackElementSchema {
  props?: string[];
  attrs?: string[];
  methods?: string[];
  formAssociated?: boolean;
}

/** What the compiler produces and the render engine runs. Plain data, JSON-serialisable. */
export interface CompiledArtifact {
  /** Protocol the artifact was compiled for. */
  protocol: number;
  /** Entry module key, e.g. `sbx:/index.js`. */
  entry: string;
  /** Module sources keyed by `sbx:` URL. Imports between them already use those keys. */
  modules: Record<string, string>;
  /** Global stylesheets (CSS text) injected before the entry runs. CSS imported from JS is a module instead. */
  css: string[];
  /** Bare specifiers → URLs (vendor libraries such as react or svelte). */
  imports: Record<string, string>;
  /** Static HTML placed in `<body>` before the entry runs (default: `<div id="root"></div>`). */
  html?: string;
  /** Manifest: name, scopes the artifact asks for, network origins it needs. */
  manifest: ArtifactManifest;
}

export interface ArtifactManifest {
  name?: string;
  version?: string | number;
  /** Capabilities the artifact asks for; the host decides what to grant. */
  scopes?: string[];
  /** Origins the artifact may `fetch` (CSP connect-src), intersected with the host's allowlist. */
  network?: string[];
  [key: string]: unknown;
}

/** Sandbox → host, on window, when the runtime itself could not start. */
export interface FatalMessage {
  $sbx: 1;
  t: "fatal";
  message: string;
}

/** Sandbox → host relays (on the private port, as calls to the host's `$sbx` namespace). */
export interface ConsoleEntry {
  level: "log" | "info" | "warn" | "error" | "debug";
  args: string[];
}

export interface RuntimeErrorEntry {
  message: string;
  source?: string;
  line?: number;
  column?: number;
  stack?: string;
}

export function isSbx(x: unknown): x is { $sbx: number; t: string } {
  return typeof x === "object" && x !== null && (x as { $sbx?: unknown }).$sbx === PROTOCOL &&
    typeof (x as { t?: unknown }).t === "string";
}
