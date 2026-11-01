import { SandboxError } from "./peer.mjs";
export { SandboxError };
export interface Type<T> {
    readonly schema: JsonSchema;
    readonly __type?: T;
}
export interface OptionalType<T> extends Type<T | undefined> {
    readonly optional: true;
}
export type JsonSchema = Record<string, unknown>;
type Infer<S> = S extends Type<infer T> ? T : never;
type OptionalKeys<S> = {
    [K in keyof S]: S[K] extends OptionalType<unknown> ? K : never;
}[keyof S];
type Pretty<T> = {
    [K in keyof T]: T[K];
} & {};
type ObjectOf<S> = Pretty<{
    [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]>;
} & {
    [K in OptionalKeys<S>]?: Exclude<Infer<S[K]>, undefined>;
}>;
/** The schema builders. */
export interface TypeBuilders {
    string(rules?: {
        min?: number;
        max?: number;
        pattern?: string;
        format?: "email" | "uri" | "date-time";
    }): Type<string>;
    number(rules?: {
        min?: number;
        max?: number;
    }): Type<number>;
    integer(rules?: {
        min?: number;
        max?: number;
    }): Type<number>;
    boolean(): Type<boolean>;
    /** Base64 on the wire: Uint8Array here and in Go, a base64 string in Python and JS children. */
    bytes(rules?: {
        max?: number;
    }): Type<Uint8Array>;
    literal<const V extends string | number | boolean>(value: V): Type<V>;
    enum<const V extends readonly string[]>(...values: V): Type<V[number]>;
    array<T>(item: Type<T>, rules?: {
        min?: number;
        max?: number;
    }): Type<T[]>;
    object<S extends Record<string, Type<any>>>(shape: S): Type<ObjectOf<S>>;
    record<T>(value: Type<T>): Type<Record<string, T>>;
    union<const U extends readonly Type<any>[]>(...types: U): Type<Infer<U[number]>>;
    nullable<T>(type: Type<T>): Type<T | null>;
    optional<T>(type: Type<T>): OptionalType<T>;
    void(): Type<void>;
    /** Any JSON. Unchecked: prefer a real type. */
    json(): Type<unknown>;
}
export declare const t: TypeBuilders;
/** Per-API rules. The parent enforces them; the sandbox cannot change them. */
export interface ApiMeta {
    description?: string;
    /** Limit for one call, or for each gap between stream items. Default: limits.callMs. */
    timeoutMs?: number;
    rateLimit?: {
        perSecond?: number;
        burst?: number;
    };
}
/** One request, one reply: a promise on both sides. */
export interface UnaryApi<I, O> {
    readonly kind: "unary";
    input: Type<I>;
    output: Type<O>;
    meta?: ApiMeta;
}
/** One request, many items: an async iterable on both sides, with backpressure and cancel. */
export interface StreamApi<I, O> {
    readonly kind: "stream";
    input: Type<I>;
    item: Type<O>;
    meta?: ApiMeta;
}
export declare function api<I, O>(input: Type<I>, output: Type<O>, meta?: ApiMeta): UnaryApi<I, O>;
export declare function stream<I, O>(input: Type<I>, item: Type<O>, meta?: ApiMeta): StreamApi<I, O>;
/** Nested namespaces of APIs. */
export interface ApisSchema {
    [name: string]: UnaryApi<any, any> | StreamApi<any, any> | ApisSchema;
}
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
    [K in keyof S]: S[K] extends UnaryApi<infer I, infer O> ? (input: I, ctx: ApiContext) => Promise<O> | O : S[K] extends StreamApi<infer I, infer O> ? (input: I, ctx: ApiContext) => AsyncIterable<O> : ApiDef<S[K]>;
};
export interface CallOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
}
/** How a schema looks to the caller. */
export type ApiClient<S> = {
    [K in keyof S]: S[K] extends UnaryApi<infer I, infer O> ? (input: I, options?: CallOptions) => Promise<O> : S[K] extends StreamApi<infer I, infer O> ? (input: I, options?: CallOptions) => AsyncIterable<O> : ApiClient<S[K]>;
};
export interface SourceFile {
    path: string;
    content: string | Uint8Array;
}
interface EnvironmentBase {
    /** Package name to version. Pinned in compiledCode. */
    dependencies?: Record<string, string>;
    /** Entry file. Default per runtime: main.ts, main.py, main.go. */
    entry?: string;
}
export type Environment = EnvironmentBase & ({
    runtime: "node";
    version: "22" | "24";
} | {
    runtime: "deno";
    version: "2";
} | {
    runtime: "bun";
    version: "1";
} | {
    runtime: "python";
    version: "3.12" | "3.13";
} | {
    runtime: "go";
    version: "1.23" | "1.24";
}
/** Plain shell: no kit, it reads and writes protocol lines itself. */
 | {
    runtime: "sh";
    version: "alpine";
});
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
    file?: string;
    line?: number;
    column?: number;
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
export type CompileResult<A extends ApisSchema, E extends ApisSchema> = {
    ok: true;
    compiledCode: CompiledCode<A, E>;
    diagnostics: Diagnostic[];
    usage: Usage;
} | {
    ok: false;
    compiledCode?: undefined;
    diagnostics: Diagnostic[];
    usage: Usage;
};
export interface Limits {
    /** Max speed, in cores. Slows the code down; never kills it. Default 0.5. */
    cpus?: number;
    /**
     * Rolling CPU limit: CPU time allowed in each window. Time spent waiting
     * (await, sleep, host API, network) uses no CPU, so it does not count. This is
     * what stops a sync loop. Default 2000 per 10000 ms.
     */
    cpuBurst?: {
        ms: number;
        windowMs: number;
    };
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
export type Middleware = (call: {
    path: string;
    input: unknown;
    ctx: ApiContext;
}, next: () => Promise<unknown>) => Promise<unknown>;
export type ExitReason = "exit" | "stopped" | "killed" | "crash" | "cpu-budget" | "cpu-burst" | "wall" | "idle" | "memory" | "pids" | "call-deadline" | "frame-cap" | "frame-rate" | "log-cap" | "network-cap" | "bad-frame" | "start-timeout";
export interface ExitInfo {
    reason: ExitReason;
    code: number | null;
    durationMs: number;
    usage: Usage;
}
export interface Usage {
    /** CPU actually used. */
    cpuMs: number;
    /** Lifetime. */
    wallMs: number;
    /** Time the code spent waiting on the host API. */
    hostWaitMs: number;
    /** Memory held over time, for billing. */
    memoryMbSeconds: number;
    memoryBytes: number;
    memoryPeakBytes: number;
    pids: number;
    netInBytes: number;
    netOutBytes: number;
    calls: number;
}
export type SandboxEvent = {
    type: "ready";
    at: number;
    startMs: number;
} | {
    type: "log";
    at: number;
    stream: "stdout" | "stderr";
    text: string;
} | {
    type: "usage";
    at: number;
    usage: Usage;
} | {
    type: "call";
    at: number;
    direction: "to-host" | "to-sandbox";
    path: string;
    ms: number;
    error?: string;
} | {
    type: "network";
    at: number;
    host: string;
    allowed: boolean;
    bytesIn: number;
    bytesOut: number;
} | {
    type: "limit";
    at: number;
    limit: keyof Limits;
    used: number;
    max: number;
} | {
    type: "exit";
    at: number;
    info: ExitInfo;
};
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
    stop(options?: {
        graceMs?: number;
    }): Promise<ExitInfo>;
    kill(): Promise<ExitInfo>;
}
export interface DevOptions<A extends ApisSchema, E extends ApisSchema> extends Omit<CompileInput<A, E>, "limits">, Omit<RunOptions<A, E>, "compiledCode"> {
    /** Limits of each rebuild. */
    compileLimits?: CompileLimits;
}
export interface DevInstance<E extends ApisSchema> extends Instance<E> {
    /** Rebuild and restart with new files. A failed build keeps the old code running. */
    update(files: SourceFile[]): Promise<{
        ok: boolean;
        diagnostics: Diagnostic[];
    }>;
    diagnostics(): AsyncIterable<Diagnostic[]>;
}
export interface Sandbox {
    compile<A extends ApisSchema, E extends ApisSchema = {}>(input: CompileInput<A, E>): Promise<CompileResult<A, E>>;
    /** compile + run + rebuild on update(). Dev limits apply. */
    runDev<A extends ApisSchema, E extends ApisSchema = {}>(options: DevOptions<A, E>): DevInstance<E>;
    run<A extends ApisSchema, E extends ApisSchema>(options: RunOptions<A, E>): Instance<E>;
    /** Generated type files for editors: sandbox.d.ts, sandbox_api.pyi, or sbx/api.go. */
    typings(input: Omit<CompileInput<ApisSchema, ApisSchema>, "files">): Promise<SourceFile[]>;
    list(): Promise<{
        id: string;
        hash: string;
        startedAt: number;
        usage: Usage;
    }[]>;
    close(): Promise<void>;
}
export interface SandboxOptions {
    /** sandboxd address: unix:///run/sandboxd.sock or tls://host:port. */
    endpoint: string;
    token?: string;
    /** The ceiling of every run and compile through this client. */
    limits?: Limits;
    /** Trusted CA for tls:// endpoints, PEM. */
    ca?: string;
}
/** Connects to sandboxd. One connection: when this process dies, its sandboxes die too. */
export declare function createSandbox(options: SandboxOptions): Sandbox;
/** A stored compiledCode loaded back, typed again. It must match the schema it was built with. */
export declare function asCompiled<A extends ApisSchema, E extends ApisSchema = {}>(json: unknown, schemas: {
    apisSchema: A;
    exportsSchema?: E;
}): CompiledCode<A, E>;
/** Each path needs its scope(s); a path with no rule is refused. `null` means open. */
export declare function scopes(rules: Record<string, string | string[] | null>, granted: Iterable<string> | (() => Iterable<string>)): Middleware;
/** Limits host API calls of one instance, per path. */
export declare function rateLimit(options: {
    perSecond: number;
    burst?: number;
}): Middleware;
export declare function audit(sink: (entry: {
    path: string;
    ms: number;
    error?: string;
}) => void): Middleware;
/** Listed paths return nothing and do not reach apiDef. */
export declare function dryRun(paths: string[]): Middleware;
