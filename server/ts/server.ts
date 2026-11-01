/**
 * @panth977/sandbox/server: the parent side of the backend sandbox. Same API on Node,
 * Deno and Bun. It talks to sandboxd, which owns Docker, the limits and the compiler.
 *
 * @module
 */
import net from "node:net";
import tls from "node:tls";
import { Peer, SandboxError } from "../go/kits/js/peer.mjs";

export { SandboxError };

// ---- 1. Schema: one definition gives types, runtime checks and child adapters ----

export interface Type<T> { readonly schema: JsonSchema; readonly __type?: T }
export interface OptionalType<T> extends Type<T | undefined> { readonly optional: true }
export type JsonSchema = Record<string, unknown>;

type Infer<S> = S extends Type<infer T> ? T : never;
type OptionalKeys<S> = { [K in keyof S]: S[K] extends OptionalType<unknown> ? K : never }[keyof S];
type Pretty<T> = { [K in keyof T]: T[K] } & {};
type ObjectOf<S> = Pretty<
  { [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]> } &
  { [K in OptionalKeys<S>]?: Exclude<Infer<S[K]>, undefined> }
>;

const of = <T>(schema: JsonSchema): Type<T> => ({ schema });

/** The schema builders. */
export interface TypeBuilders {
  string(rules?: { min?: number; max?: number; pattern?: string; format?: "email" | "uri" | "date-time" }): Type<string>;
  number(rules?: { min?: number; max?: number }): Type<number>;
  integer(rules?: { min?: number; max?: number }): Type<number>;
  boolean(): Type<boolean>;
  /** Base64 on the wire: Uint8Array here and in Go, a base64 string in Python and JS children. */
  bytes(rules?: { max?: number }): Type<Uint8Array>;
  literal<const V extends string | number | boolean>(value: V): Type<V>;
  enum<const V extends readonly string[]>(...values: V): Type<V[number]>;
  array<T>(item: Type<T>, rules?: { min?: number; max?: number }): Type<T[]>;
  object<S extends Record<string, Type<any>>>(shape: S): Type<ObjectOf<S>>;
  record<T>(value: Type<T>): Type<Record<string, T>>;
  union<const U extends readonly Type<any>[]>(...types: U): Type<Infer<U[number]>>;
  nullable<T>(type: Type<T>): Type<T | null>;
  optional<T>(type: Type<T>): OptionalType<T>;
  void(): Type<void>;
  /** Any JSON. Unchecked: prefer a real type. */
  json(): Type<unknown>;
}

export const t: TypeBuilders = {
  string(rules?: { min?: number; max?: number; pattern?: string; format?: "email" | "uri" | "date-time" }): Type<string> {
    return of({ type: "string", minLength: rules?.min, maxLength: rules?.max, pattern: rules?.pattern, format: rules?.format });
  },
  number(rules?: { min?: number; max?: number }): Type<number> {
    return of({ type: "number", minimum: rules?.min, maximum: rules?.max });
  },
  integer(rules?: { min?: number; max?: number }): Type<number> {
    return of({ type: "integer", minimum: rules?.min, maximum: rules?.max });
  },
  boolean(): Type<boolean> {
    return of({ type: "boolean" });
  },
  /** Base64 on the wire: Uint8Array here and in Go, a base64 string in Python and JS children. */
  bytes(rules?: { max?: number }): Type<Uint8Array> {
    return of({ type: "string", format: "byte", maxLength: rules?.max ? Math.ceil(rules.max * 4 / 3) + 4 : undefined });
  },
  literal<const V extends string | number | boolean>(value: V): Type<V> {
    return of({ const: value });
  },
  enum<const V extends readonly string[]>(...values: V): Type<V[number]> {
    return of({ enum: values });
  },
  array<T>(item: Type<T>, rules?: { min?: number; max?: number }): Type<T[]> {
    return of({ type: "array", items: item.schema, minItems: rules?.min, maxItems: rules?.max });
  },
  object<S extends Record<string, Type<any>>>(shape: S): Type<ObjectOf<S>> {
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(shape)) {
      properties[k] = v.schema;
      if (!(v as OptionalType<unknown>).optional) required.push(k);
    }
    return of({ type: "object", properties, required });
  },
  record<T>(value: Type<T>): Type<Record<string, T>> {
    return of({ type: "object", additionalProperties: value.schema });
  },
  union<const U extends readonly Type<any>[]>(...types: U): Type<Infer<U[number]>> {
    return of({ anyOf: types.map((x) => x.schema) });
  },
  nullable<T>(type: Type<T>): Type<T | null> {
    return of({ anyOf: [type.schema, { type: "null" }] });
  },
  optional<T>(type: Type<T>): OptionalType<T> {
    return { schema: type.schema, optional: true };
  },
  void(): Type<void> {
    return of({ type: "null" });
  },
  /** Any JSON. Unchecked: prefer a real type. */
  json(): Type<unknown> {
    return of({});
  },
};

/** Per-API rules. The parent enforces them; the sandbox cannot change them. */
export interface ApiMeta {
  description?: string;
  /** Limit for one call, or for each gap between stream items. Default: limits.callMs. */
  timeoutMs?: number;
  rateLimit?: { perSecond?: number; burst?: number };
}

/** One request, one reply: a promise on both sides. */
export interface UnaryApi<I, O> { readonly kind: "unary"; input: Type<I>; output: Type<O>; meta?: ApiMeta }
/** One request, many items: an async iterable on both sides, with backpressure and cancel. */
export interface StreamApi<I, O> { readonly kind: "stream"; input: Type<I>; item: Type<O>; meta?: ApiMeta }

export function api<I, O>(input: Type<I>, output: Type<O>, meta?: ApiMeta): UnaryApi<I, O> {
  return { kind: "unary", input, output, meta };
}
export function stream<I, O>(input: Type<I>, item: Type<O>, meta?: ApiMeta): StreamApi<I, O> {
  return { kind: "stream", input, item, meta };
}

/** Nested namespaces of APIs. */
export interface ApisSchema { [name: string]: UnaryApi<any, any> | StreamApi<any, any> | ApisSchema }

/** Handed to each implementation. */
export interface ApiContext {
  /** Aborted on caller cancel, deadline, or sandbox exit. */
  signal: AbortSignal;
  instanceId: string;
  /** Dotted path of the API, e.g. "devices.list". */
  path: string;
}

/** What a developer must implement for a schema. Missing or wrong = compile error. */
export type ApiDef<S> = {
  [K in keyof S]:
    S[K] extends UnaryApi<infer I, infer O> ? (input: I, ctx: ApiContext) => Promise<O> | O :
    S[K] extends StreamApi<infer I, infer O> ? (input: I, ctx: ApiContext) => AsyncIterable<O> :
    ApiDef<S[K]>;
};

export interface CallOptions { signal?: AbortSignal; timeoutMs?: number }

/** How a schema looks to the caller. */
export type ApiClient<S> = {
  [K in keyof S]:
    S[K] extends UnaryApi<infer I, infer O> ? (input: I, options?: CallOptions) => Promise<O> :
    S[K] extends StreamApi<infer I, infer O> ? (input: I, options?: CallOptions) => AsyncIterable<O> :
    ApiClient<S[K]>;
};

// ---- 2. What runs ----

export interface SourceFile { path: string; content: string | Uint8Array }

interface EnvironmentBase {
  /** Package name to version. Pinned in compiledCode. */
  dependencies?: Record<string, string>;
  /** Entry file. Default per runtime: main.ts, main.py, main.go. */
  entry?: string;
}
export type Environment = EnvironmentBase & (
  | { runtime: "node"; version: "22" | "24" }
  | { runtime: "deno"; version: "2" }
  | { runtime: "bun"; version: "1" }
  | { runtime: "python"; version: "3.12" | "3.13" }
  | { runtime: "go"; version: "1.23" | "1.24" }
  /** Plain shell: no kit, it reads and writes protocol lines itself. */
  | { runtime: "sh"; version: "alpine" }
);

export interface CompileInput<A extends ApisSchema, E extends ApisSchema> {
  environment: Environment;
  files: SourceFile[];
  /** APIs the parent offers; the sandbox calls them. */
  apisSchema: A;
  /** APIs the sandbox offers; the parent calls them (handlers, webhooks, listeners). */
  exportsSchema?: E;
  /** The compiler is user-controlled work, so it has CPU limits of its own. See CompileLimits. */
  limits?: CompileLimits;
}

/**
 * Limits of one compile: typecheck, install and build together.
 * Default: 2 cores, 180 s CPU budget, 300 s wall, 1 GiB memory, 512 processes, 512 MiB disk.
 */
export type CompileLimits = Pick<Limits, "cpus" | "cpuBudgetMs" | "wallMs" | "memory" | "pids" | "disk">;

export interface Diagnostic {
  file?: string; line?: number; column?: number;
  message: string;
  severity: "error" | "warning";
  source: "typecheck" | "build" | "resolve" | "schema";
}

/** Plain JSON. Store it anywhere; run it later on any sandboxd of the same CPU architecture. */
export interface CompiledCode<A extends ApisSchema = ApisSchema, E extends ApisSchema = ApisSchema> {
  format: 1;
  /** sha256 of everything else. run() refuses code that does not match. */
  hash: string;
  environment: Environment;
  /** Exact image the code runs on, by digest. */
  image: string;
  cmd: string[];
  envVars?: string[];
  /** Build output: tar.gz in base64. */
  bundle: string;
  apisSchema: Record<string, JsonSchema>;
  exportsSchema: Record<string, JsonSchema>;
  readonly __apis?: A;
  readonly __exports?: E;
}

export type CompileResult<A extends ApisSchema, E extends ApisSchema> =
  | { ok: true; compiledCode: CompiledCode<A, E>; diagnostics: Diagnostic[]; usage: Usage }
  | { ok: false; compiledCode?: undefined; diagnostics: Diagnostic[]; usage: Usage };

// ---- 3. Fail-safes. Every field has a safe default; none can be turned off ----

export interface Limits {
  /** Max speed, in cores. Slows the code down; never kills it. Default 0.5. */
  cpus?: number;
  /**
   * Rolling CPU limit: CPU time allowed in each window. Time spent waiting
   * (await, sleep, host API, network) uses no CPU, so it does not count. This is
   * what stops a sync loop. Default 2000 per 10000 ms.
   */
  cpuBurst?: { ms: number; windowMs: number };
  /** Total CPU time for the whole run. Waiting does not count. Default none for run(), 60000 for runDev(). */
  cpuBudgetMs?: number;
  /** Lifetime before stop, waiting included. Default 300000. Services pass a higher value. */
  wallMs?: number;
  /** Time with no call in flight before stop. Default none. */
  idleMs?: number;
  /** Bytes. Held while waiting too. Default 128 MiB. */
  memory?: number;
  /** Default 128. Includes the runtime's own threads, so keep room for them. */
  pids?: number;
  /** Scratch disk in bytes. Default 8 MiB. */
  disk?: number;
  /** One call, waiting included. Protects the caller, not the CPU. Default 30000. */
  callMs?: number;
  /** One message in bytes. Default 1 MiB. */
  frameBytes?: number;
  /** Messages per second. Default 2000. */
  framesPerSec?: number;
  /** Log bytes per run. Default 16 MiB. */
  logBytes?: number;
  /** Calls in flight, both directions. Default 64. */
  concurrency?: number;
}

export interface NetworkPolicy {
  /** Hosts it may reach, through the egress proxy. Default none. */
  allow: string[];
  /** Total bytes per run. Default 64 MiB. */
  bytes?: number;
}

export type Middleware = (call: { path: string; input: unknown; ctx: ApiContext }, next: () => Promise<unknown>) => Promise<unknown>;

export type ExitReason =
  | "exit" | "stopped" | "killed" | "crash"
  | "cpu-budget" | "cpu-burst" | "wall" | "idle" | "memory" | "pids" | "call-deadline"
  | "frame-cap" | "frame-rate" | "log-cap" | "network-cap" | "bad-frame"
  | "start-timeout";

export interface ExitInfo { reason: ExitReason; code: number | null; durationMs: number; usage: Usage }
export interface Usage {
  /** CPU actually used. */
  cpuMs: number;
  /** Lifetime. */
  wallMs: number;
  /** Time the code spent waiting on the host API. */
  hostWaitMs: number;
  /** Memory held over time, for billing. */
  memoryMbSeconds: number;
  memoryBytes: number; memoryPeakBytes: number; pids: number;
  netInBytes: number; netOutBytes: number; calls: number;
}

export type SandboxEvent =
  | { type: "ready"; at: number; startMs: number }
  | { type: "log"; at: number; stream: "stdout" | "stderr"; text: string }
  | { type: "usage"; at: number; usage: Usage }
  | { type: "call"; at: number; direction: "to-host" | "to-sandbox"; path: string; ms: number; error?: string }
  | { type: "network"; at: number; host: string; allowed: boolean; bytesIn: number; bytesOut: number }
  | { type: "limit"; at: number; limit: keyof Limits; used: number; max: number }
  | { type: "exit"; at: number; info: ExitInfo };

export interface RunOptions<A extends ApisSchema, E extends ApisSchema> {
  compiledCode: CompiledCode<A, E>;
  /** Your implementation of apisSchema. */
  apiDef: ApiDef<A>;
  limits?: Limits;
  network?: NetworkPolicy;
  /** Plain values, visible as `env` inside. Never put tokens here: keep them in apiDef. */
  env?: Record<string, string | number | boolean>;
  middleware?: Middleware[];
  onEvent?: (event: SandboxEvent) => void;
}

export interface Instance<E extends ApisSchema = ApisSchema> {
  readonly id: string;
  /** Resolves once the code is serving; rejects if it dies first. */
  readonly ready: Promise<void>;
  /** Call what the sandbox exported. */
  readonly remote: ApiClient<E>;
  /** Resolves on every exit, fail-safe or not. Never rejects. */
  readonly exited: Promise<ExitInfo>;
  usage(): Promise<Usage>;
  events(): AsyncIterable<SandboxEvent>;
  /** Ask nicely, then kill after graceMs. Default 2000. */
  stop(options?: { graceMs?: number }): Promise<ExitInfo>;
  kill(): Promise<ExitInfo>;
}

export interface DevOptions<A extends ApisSchema, E extends ApisSchema> extends Omit<CompileInput<A, E>, "limits">, Omit<RunOptions<A, E>, "compiledCode"> {
  /** Limits of each rebuild. */
  compileLimits?: CompileLimits;
}

export interface DevInstance<E extends ApisSchema> extends Instance<E> {
  /** Rebuild and restart with new files. A failed build keeps the old code running. */
  update(files: SourceFile[]): Promise<{ ok: boolean; diagnostics: Diagnostic[] }>;
  diagnostics(): AsyncIterable<Diagnostic[]>;
}

export interface Sandbox {
  compile<A extends ApisSchema, E extends ApisSchema = {}>(input: CompileInput<A, E>): Promise<CompileResult<A, E>>;
  /** compile + run + rebuild on update(). Dev limits apply. */
  runDev<A extends ApisSchema, E extends ApisSchema = {}>(options: DevOptions<A, E>): DevInstance<E>;
  run<A extends ApisSchema, E extends ApisSchema>(options: RunOptions<A, E>): Instance<E>;
  /** Generated type files for editors: sandbox.d.ts, sandbox_api.pyi, or sbx/api.go. */
  typings(input: Omit<CompileInput<ApisSchema, ApisSchema>, "files">): Promise<SourceFile[]>;
  list(): Promise<{ id: string; hash: string; startedAt: number; usage: Usage }[]>;
  close(): Promise<void>;
}

// ---- 4. Runtime ----

export interface SandboxOptions {
  /** sandboxd address: unix:///run/sandboxd.sock or tls://host:port. */
  endpoint: string;
  token?: string;
  /** The ceiling of every run and compile through this client. */
  limits?: Limits;
  /** Trusted CA for tls:// endpoints, PEM. */
  ca?: string;
}

type Spec = { kind: string; input: JsonSchema; output?: JsonSchema; item?: JsonSchema; description?: string; timeoutMs?: number; rateLimit?: unknown };

function flatten(schema: ApisSchema | undefined, prefix = "", out: Record<string, Spec> = {}): Record<string, Spec> {
  for (const [k, v] of Object.entries(schema ?? {})) {
    const path = prefix + k;
    const a = v as UnaryApi<any, any> | StreamApi<any, any>;
    if (a.kind === "unary" || a.kind === "stream") {
      out[path] = {
        kind: a.kind,
        input: a.input.schema,
        ...(a.kind === "unary" ? { output: a.output.schema } : { item: a.item.schema }),
        description: a.meta?.description,
        timeoutMs: a.meta?.timeoutMs,
        rateLimit: a.meta?.rateLimit,
      };
    } else flatten(v as ApisSchema, path + ".", out);
  }
  return out;
}

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Turns Uint8Array into base64 strings on the way out, by value. */
function toWire(v: unknown): unknown {
  if (v instanceof Uint8Array) return b64(v);
  if (Array.isArray(v)) return v.map(toWire);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toWire(x)]));
  return v;
}

/** Restores t.bytes() fields on the way in, by schema. */
function fromWire(s: JsonSchema | undefined, v: any): any {
  if (!s || v == null) return v;
  if (s.format === "byte" && typeof v === "string") return unb64(v);
  if (Array.isArray(v) && s.items) return v.map((x) => fromWire(s.items as JsonSchema, x));
  if (typeof v === "object" && s.properties) {
    const p = s.properties as Record<string, JsonSchema>;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fromWire(p[k], x)]));
  }
  if (typeof v === "object" && s.additionalProperties) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fromWire(s.additionalProperties as JsonSchema, x)]));
  }
  if (Array.isArray(s.anyOf)) return fromWire((s.anyOf as JsonSchema[]).find((o) => o.type !== "null"), v);
  return v;
}

class Link {
  private sock: net.Socket;
  private rid = 1;
  private waits = new Map<number, { ok: (v: any) => void; no: (e: Error) => void }>();
  private buf = "";
  private ready: Promise<unknown>;
  closed: Error | null = null;
  routes = new Map<string, (m: any) => void>();

  constructor(o: SandboxOptions) {
    const u = new URL(o.endpoint);
    if (u.protocol === "unix:") this.sock = net.connect(u.pathname);
    else if (u.protocol === "tls:") {
      this.sock = tls.connect({ host: u.hostname, port: Number(u.port), ca: o.ca, servername: u.hostname });
    } else throw new SandboxError("invalid-argument", "endpoint must be unix:// or tls://");
    this.sock.setEncoding("utf8");
    this.sock.on("data", (d: string) => this.data(d));
    const down = (e?: Error) => this.down(e ?? new SandboxError("unavailable", "sandboxd connection closed"));
    this.sock.on("error", down);
    this.sock.on("close", () => down());
    this.ready = this.request({ op: "hello", token: o.token, limits: o.limits });
  }

  private down(e: Error) {
    if (this.closed) return;
    this.closed = e;
    for (const w of this.waits.values()) w.no(e);
    this.waits.clear();
    for (const r of this.routes.values()) r({ op: "down" });
  }

  private data(d: string) {
    this.buf += d;
    let i;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      const m = JSON.parse(line);
      if (m.op === "reply") {
        const w = this.waits.get(m.rid);
        this.waits.delete(m.rid);
        if (m.error) w?.no(new SandboxError("unavailable", m.error));
        else w?.ok(m.result);
      } else this.routes.get(m.id)?.(m);
    }
  }

  send(m: unknown) {
    if (!this.closed) this.sock.write(JSON.stringify(m) + "\n");
  }

  request(m: Record<string, unknown>): Promise<any> {
    if (this.closed) return Promise.reject(this.closed);
    return new Promise((ok, no) => {
      const rid = this.rid++;
      this.waits.set(rid, { ok, no });
      this.send({ ...m, rid });
    });
  }

  async call(m: Record<string, unknown>): Promise<any> {
    await this.ready;
    return this.request(m);
  }

  close() {
    this.sock.end();
  }
}

function apply(chain: Middleware[], call: { path: string; input: unknown; ctx: ApiContext }, last: () => Promise<unknown>) {
  const go = (i: number): Promise<unknown> => (i < chain.length ? chain[i](call, () => go(i + 1)) : last());
  return go(0);
}

function missing(spec: Record<string, Spec>, def: unknown): string | undefined {
  for (const p of Object.keys(spec)) {
    if (typeof p.split(".").reduce((o: any, k) => o?.[k], def) !== "function") return p;
  }
  return undefined;
}

function startInstance(link: Link, o: RunOptions<any, any>): Instance<any> {
  const apis = o.compiledCode.apisSchema as Record<string, Spec>;
  const exportsSpec = o.compiledCode.exportsSchema as Record<string, Spec>;
  let id = "";
  const ref = "r" + Math.random().toString(36).slice(2);
  let live = false;
  const backlog: SandboxEvent[] = [];
  const listeners = new Set<(e: SandboxEvent | null) => void>();
  let endExit!: (i: ExitInfo) => void;
  const exited = new Promise<ExitInfo>((r) => (endExit = r));
  let okReady!: () => void, noReady!: (e: Error) => void;
  const ready = new Promise<void>((a, b) => ((okReady = a), (noReady = b)));
  ready.catch(() => {});

  const peer = new Peer(
    (m) => link.send({ op: "frame", id: ref, m }),
    (path) => {
      const s = apis[path];
      const fn = path.split(".").reduce((x: any, k) => x?.[k], o.apiDef);
      if (!s || typeof fn !== "function") return undefined;
      const ctxOf = (signal: AbortSignal): ApiContext => ({ signal, instanceId: id, path });
      const chain = o.middleware ?? [];
      if (s.kind === "stream") {
        return {
          kind: "stream",
          fn: (input: unknown, c: { signal: AbortSignal }) => {
            const ctx = ctxOf(c.signal);
            return (async function* () {
              const value = fromWire(s.input, input);
              let source: AsyncIterable<unknown> | undefined;
              await apply(chain, { path, input: value, ctx }, () => {
                source = fn(value, ctx);
                return Promise.resolve();
              });
              for await (const v of source ?? []) yield toWire(v);
            })();
          },
        };
      }
      return {
        kind: "unary",
        fn: async (input: unknown, c: { signal: AbortSignal }) => {
          const ctx = ctxOf(c.signal);
          const value = fromWire(s.input, input);
          return toWire(await apply(chain, { path, input: value, ctx }, () => Promise.resolve(fn(value, ctx))));
        },
      };
    },
  );

  const emit = (e: SandboxEvent) => {
    try {
      o.onEvent?.(e);
    } catch { /* a monitor must not break the sandbox */ }
    backlog.push(e);
    if (backlog.length > 1000) backlog.shift();
    for (const l of listeners) l(e);
  };

  const exit = (info: ExitInfo) => {
    peer.closeAll(new SandboxError("exited", "sandbox ended: " + info.reason));
    noReady(new SandboxError("exited", "sandbox ended before it was ready: " + info.reason));
    endExit(info);
    for (const l of listeners) l(null);
    link.routes.delete(ref);
  };

  const route = (m: any) => {
    if (m.op === "frame") peer.receive(m.m);
    else if (m.op === "event") {
      emit(m.event);
      if (m.event.type === "ready") okReady();
      if (m.event.type === "exit") exit(m.event.info);
    } else if (m.op === "down") {
      exit({ reason: "crash", code: null, durationMs: 0, usage: {} as Usage });
    }
  };

  const remote = (prefix = ""): any =>
    new Proxy({}, {
      get(_, key) {
        if (typeof key !== "string" || key === "then") return undefined;
        const path = prefix + key;
        const s = exportsSpec[path];
        if (!s) return remote(path + ".");
        const wait = async () => {
          await ready;
        };
        if (s.kind === "stream") {
          return (input: unknown, opts?: CallOptions) => ({
            async *[Symbol.asyncIterator]() {
              await wait();
              for await (const v of peer.stream(path, toWire(input), opts)) yield fromWire(s.item, v);
            },
          });
        }
        return async (input: unknown, opts?: CallOptions) => {
          await wait();
          return fromWire(s.output, await peer.call(path, toWire(input), opts));
        };
      },
    });

  const gone = missing(apis, o.apiDef);
  if (gone) {
    const e = new SandboxError("invalid-argument", "apiDef does not implement " + gone);
    noReady(e);
    endExit({ reason: "crash", code: null, durationMs: 0, usage: {} as Usage });
  } else {
    link.routes.set(ref, route);
    link.call({ op: "run", id: ref, run: { compiledCode: o.compiledCode, limits: o.limits, network: o.network, env: o.env } }).then((r) => {
      id = r.id;
      live = true;
    }).catch((e) => {
      noReady(e);
      endExit({ reason: "crash", code: null, durationMs: 0, usage: {} as Usage });
    });
  }

  const started = async () => {
    await ready.catch(() => {});
    return live;
  };

  return {
    get id() {
      return id;
    },
    ready,
    remote: remote(),
    exited,
    async usage() {
      await started();
      return link.call({ op: "usage", id: ref });
    },
    async *events() {
      const queue: (SandboxEvent | null)[] = [...backlog];
      let wake: (() => void) | undefined;
      const l = (e: SandboxEvent | null) => {
        queue.push(e);
        wake?.();
      };
      listeners.add(l);
      try {
        for (;;) {
          if (queue.length) {
            const e = queue.shift()!;
            if (e === null) return;
            yield e;
            if (e.type === "exit") return;
          } else await new Promise<void>((r) => (wake = r));
        }
      } finally {
        listeners.delete(l);
      }
    },
    async stop(options) {
      if (await started()) link.send({ op: "stop", id: ref, graceMs: options?.graceMs });
      return exited;
    },
    async kill() {
      if (await started()) link.send({ op: "kill", id: ref });
      return exited;
    },
  };
}

function compileWire(input: CompileInput<any, any>) {
  return {
    environment: input.environment,
    files: input.files.map((f) =>
      typeof f.content === "string"
        ? { path: f.path, content: f.content }
        : { path: f.path, content: b64(f.content), encoding: "base64" }
    ),
    apisSchema: flatten(input.apisSchema),
    exportsSchema: flatten(input.exportsSchema),
    limits: input.limits,
  };
}

/** Connects to sandboxd. One connection: when this process dies, its sandboxes die too. */
export function createSandbox(options: SandboxOptions): Sandbox {
  const link = new Link(options);
  const sandbox: Sandbox = {
    compile: (input) => link.call({ op: "compile", compile: compileWire(input) }),
    run: (o) => startInstance(link, o),
    runDev<A extends ApisSchema, E extends ApisSchema = {}>(o: DevOptions<A, E>): DevInstance<E> {
      const devLimits = { cpuBudgetMs: 60000, ...o.limits };
      let files = o.files;
      let current: Instance<E> | undefined;
      let readyOk!: () => void, readyNo!: (e: Error) => void;
      const ready = new Promise<void>((a, b) => ((readyOk = a), (readyNo = b)));
      ready.catch(() => {});
      let exitOk!: (i: ExitInfo) => void;
      const exited = new Promise<ExitInfo>((r) => (exitOk = r));
      const latest: Diagnostic[][] = [];
      const wakes = new Set<() => void>();
      const publish = (d: Diagnostic[]) => {
        latest.push(d);
        for (const w of wakes) w();
      };
      const build = async () => {
        const r = await sandbox.compile({ environment: o.environment, files, apisSchema: o.apisSchema, exportsSchema: o.exportsSchema, limits: o.compileLimits });
        publish(r.diagnostics);
        if (!r.ok) return r;
        await current?.kill();
        current = sandbox.run({ ...o, compiledCode: r.compiledCode, limits: devLimits } as RunOptions<A, E>);
        current.exited.then((i) => {
          if (stopped) exitOk(i);
        });
        await current.ready;
        return r;
      };
      let stopped = false;
      build().then((r) => {
        if (r.ok) readyOk();
        else readyNo(new SandboxError("invalid-argument", r.diagnostics[0]?.message ?? "compile failed"));
      }, readyNo);
      const need = () => {
        if (!current) throw new SandboxError("unavailable", "not running");
        return current;
      };
      const remote = new Proxy({}, { get: (_, k: string) => (need().remote as any)[k] }) as ApiClient<E>;
      return {
        get id() {
          return current?.id ?? "";
        },
        ready,
        remote,
        exited,
        usage: () => need().usage(),
        events: () => need().events(),
        stop(a) {
          stopped = true;
          return need().stop(a);
        },
        kill() {
          stopped = true;
          return need().kill();
        },
        async update(next) {
          files = next;
          const r = await build();
          return { ok: r.ok, diagnostics: r.diagnostics };
        },
        async *diagnostics() {
          let i = 0;
          for (;;) {
            while (i < latest.length) yield latest[i++];
            await new Promise<void>((r) => wakes.add(r));
          }
        },
      };
    },
    typings: (input) => link.call({ op: "typings", compile: { ...compileWire({ ...input, files: [] }) } }),
    list: () => link.call({ op: "list" }),
    close: () => Promise.resolve(link.close()),
  };
  return sandbox;
}

/** A stored compiledCode loaded back, typed again. It must match the schema it was built with. */
export function asCompiled<A extends ApisSchema, E extends ApisSchema = {}>(
  json: unknown,
  schemas: { apisSchema: A; exportsSchema?: E },
): CompiledCode<A, E> {
  const c = (typeof json === "string" ? JSON.parse(json) : json) as CompiledCode<A, E>;
  if (c?.format !== 1) throw new SandboxError("invalid-argument", "not compiled code");
  for (const [name, want, have] of [["apis", flatten(schemas.apisSchema), c.apisSchema], ["exports", flatten(schemas.exportsSchema), c.exportsSchema]] as const) {
    const a = Object.keys(want).sort().join(), b = Object.keys(have ?? {}).sort().join();
    if (a !== b) throw new SandboxError("invalid-argument", `compiled ${name} do not match the schema: rebuild`);
  }
  return c;
}

/** Each path needs its scope(s); a path with no rule is refused. `null` means open. */
export function scopes(rules: Record<string, string | string[] | null>, granted: Iterable<string> | (() => Iterable<string>)): Middleware {
  const find = (path: string) => {
    const parts = path.split(".");
    for (let i = parts.length; i >= 0; i--) {
      const k = i === parts.length ? path : [...parts.slice(0, i), "*"].join(".");
      if (k in rules) return { rule: rules[k] };
    }
    return undefined;
  };
  return (call, next) => {
    const hit = find(call.path);
    if (!hit) throw new SandboxError("permission-denied", "no rule for " + call.path);
    const have = new Set(typeof granted === "function" ? granted() : granted);
    for (const s of [hit.rule ?? []].flat()) {
      if (!have.has(s)) throw new SandboxError("permission-denied", "missing scope " + s);
    }
    return next();
  };
}

/** Limits host API calls of one instance, per path. */
export function rateLimit(options: { perSecond: number; burst?: number }): Middleware {
  const burst = options.burst ?? options.perSecond;
  const buckets = new Map<string, { n: number; at: number }>();
  return (call, next) => {
    const k = call.ctx.instanceId + ":" + call.path;
    const now = Date.now();
    const b = buckets.get(k) ?? { n: burst, at: now };
    b.n = Math.min(burst, b.n + (now - b.at) / 1000 * options.perSecond);
    b.at = now;
    buckets.set(k, b);
    if (b.n < 1) throw new SandboxError("quota", "rate limit: " + call.path);
    b.n--;
    return next();
  };
}

export function audit(sink: (entry: { path: string; ms: number; error?: string }) => void): Middleware {
  return async (call, next) => {
    const at = Date.now();
    try {
      const v = await next();
      sink({ path: call.path, ms: Date.now() - at });
      return v;
    } catch (e) {
      sink({ path: call.path, ms: Date.now() - at, error: String((e as Error)?.message ?? e) });
      throw e;
    }
  };
}

/** Listed paths return nothing and do not reach apiDef. */
export function dryRun(paths: string[]): Middleware {
  return (call, next) => (paths.includes(call.path) ? Promise.resolve(null) : next());
}
