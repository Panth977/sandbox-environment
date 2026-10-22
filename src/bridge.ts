/**
 * The bridge: typed RPC over any MessagePort-like channel, in both directions.
 *
 * ```ts
 * // host
 * const end = createEndpoint<ArtifactApi>(port, { expose: hostApi, middleware: [audit(log)] });
 * // artifact
 * const end = createEndpoint<HostApi>(port);
 * const devices = await end.remote.devices.list({ orgId: "o1" });
 * for await (const r of end.remote.live.readings("D12")) render(r);
 * ```
 *
 * What crosses the wire:
 *  - calls with any structured-clone-able arguments;
 *  - functions anywhere in arguments or results (they become callable references);
 *  - an `AbortSignal` argument (aborting it cancels the call; the callee gets a signal of its own);
 *  - results that are `AsyncIterable`s or `ReadableStream`s become streams with
 *    credit-based backpressure and cancellation;
 *  - errors as `{ code, message, data }`, re-thrown as {@link SandboxError}.
 *
 * Zero dependencies; works in browsers, workers, Node and Deno.
 *
 * @module
 */
import { isSbx, PROTOCOL } from "./protocol.ts";
import type { ErrorCode, RpcMessage, WireError } from "./protocol.ts";

/** The part of `MessagePort` the bridge uses. Adapt WebSockets, workers or stdio to it. */
export interface PortLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  start?(): void;
  close?(): void;
}

/** The error a remote failure is re-thrown as. Switch on `code`. */
export class SandboxError extends Error {
  readonly code: ErrorCode;
  readonly data?: unknown;
  constructor(code: ErrorCode, message: string, data?: unknown) {
    super(message);
    this.name = "SandboxError";
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

/** Anything thrown → what goes on the wire. Stacks never cross. */
export function toWireError(e: unknown): WireError {
  if (e instanceof SandboxError) return { code: e.code, message: e.message, ...(e.data !== undefined ? { data: e.data } : {}) };
  if (e && typeof e === "object") {
    const o = e as { code?: unknown; message?: unknown; name?: unknown };
    const code = typeof o.code === "string" ? o.code : o.name === "AbortError" ? "cancelled" : "internal";
    const message = typeof o.message === "string" ? o.message : String(e);
    return { code, message };
  }
  return { code: "internal", message: String(e) };
}

// deno-lint-ignore no-explicit-any
type Fn = (...args: any[]) => any;

/** A stream received from the other side. Iterate it, or turn it into a ReadableStream. */
export interface RemoteStream<T> extends AsyncIterable<T> {
  /** Stop the stream; the producer's iterator is closed. */
  cancel(): void;
  /** The same values as a WHATWG ReadableStream. */
  toReadableStream(): ReadableStream<T>;
}

type StreamValue<R> = Awaited<R> extends AsyncIterable<infer V> ? V
  : Awaited<R> extends ReadableStream<infer V> ? V
  : never;

/** A remote function: async, and if the original returned a stream, iterable directly. */
export type RemoteFn<F extends Fn> = [StreamValue<ReturnType<F>>] extends [never]
  ? (...args: Parameters<F>) => Promise<Remoted<Awaited<ReturnType<F>>>>
  : (...args: Parameters<F>) => RemoteCall<RemoteStream<StreamValue<ReturnType<F>>>> & AsyncIterable<StreamValue<ReturnType<F>>>;

/** Functions inside results become async remote functions. */
export type Remoted<T> = T extends Fn ? RemoteFn<T> : T;

/** The other side's exposed API, as seen through the bridge. */
export type Remote<T> = {
  [K in keyof T]: T[K] extends Fn ? RemoteFn<T[K]> : T[K] extends object ? Remote<T[K]> : never;
};

/** What a middleware sees. `args` may be replaced before `next()`. */
export interface CallContext {
  /** Path of the called function, e.g. `["devices", "list"]`; `[]` for callbacks. */
  path: string[];
  args: unknown[];
  /** Aborted when the caller cancels or the endpoint closes. */
  signal: AbortSignal;
  /** True when the call targets a callback this side handed out, not the exposed API. */
  callback: boolean;
  /** Free-form data middlewares share (e.g. the viewer, the artifact id). */
  meta: Record<string, unknown>;
}

/** Koa-style: run code before/after, change args, or throw to refuse. */
export type Middleware = (ctx: CallContext, next: () => Promise<unknown>) => Promise<unknown>;

export interface EndpointOptions<L extends object> {
  /** The API this side offers. Only own, non-underscore-prefixed properties are reachable. */
  expose?: L;
  middleware?: Middleware[];
  /** Values handed to every CallContext.meta. */
  meta?: Record<string, unknown>;
  /** Stream credit (values in flight before the consumer pulls more). Default 16. */
  credit?: number;
  /** Called on a message that is not part of the protocol (useful for logging). */
  onUnknown?(data: unknown): void;
}

export interface Endpoint<R extends object> {
  /** The other side's API. */
  remote: Remote<R>;
  /** Stop: pending calls reject with `unavailable`, streams end, the port closes. */
  close(): void;
  /** True after close(). */
  readonly closed: boolean;
}

/** A pending remote call: a Promise that also iterates when the result is a stream. */
export interface RemoteCall<T> extends Promise<T> {}

const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);
const MAX_DEPTH = 32;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

function isStreamLike(v: unknown): v is AsyncIterable<unknown> | ReadableStream<unknown> {
  if (v === null || typeof v !== "object") return false;
  if (typeof ReadableStream !== "undefined" && v instanceof ReadableStream) return true;
  return typeof (v as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function";
}

function iteratorOf(v: AsyncIterable<unknown> | ReadableStream<unknown>): AsyncIterator<unknown> {
  if (typeof (v as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function") {
    return (v as AsyncIterable<unknown>)[Symbol.asyncIterator]();
  }
  const reader = (v as ReadableStream<unknown>).getReader();
  return {
    next: () => reader.read() as Promise<IteratorResult<unknown>>,
    return: async () => {
      await reader.cancel();
      return { done: true, value: undefined };
    },
  };
}

/** Lists the callable paths of an API object (for introspection; not a security boundary). */
export function apiPaths(api: object, prefix: string[] = [], depth = 0): string[][] {
  const out: string[][] = [];
  if (depth > 8) return out;
  for (const key of Object.keys(api)) {
    if (FORBIDDEN.has(key) || key.startsWith("_")) continue;
    const v = (api as Record<string, unknown>)[key];
    if (typeof v === "function") out.push([...prefix, key]);
    else if (v && typeof v === "object") out.push(...apiPaths(v, [...prefix, key], depth + 1));
  }
  return out;
}

function resolvePath(api: object | undefined, path: string[]): { fn: Fn; self: unknown } | null {
  if (!api || path.length === 0) return null;
  let self: unknown = undefined;
  let cur: unknown = api;
  for (const key of path) {
    if (typeof key !== "string" || FORBIDDEN.has(key) || key.startsWith("_")) return null;
    if (cur === null || (typeof cur !== "object" && typeof cur !== "function")) return null;
    if (!Object.prototype.hasOwnProperty.call(cur, key)) return null;
    self = cur;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "function" ? { fn: cur as Fn, self } : null;
}

class StreamState {
  queue: unknown[] = [];
  waiters: { resolve: (r: IteratorResult<unknown>) => void; reject: (e: unknown) => void }[] = [];
  done = false;
  error: unknown = null;
  consumed = 0;
  readonly onPull: (n: number) => void;
  readonly onCancel: () => void;
  readonly credit: number;
  constructor(onPull: (n: number) => void, onCancel: () => void, credit: number) {
    this.onPull = onPull;
    this.onCancel = onCancel;
    this.credit = credit;
  }

  push(v: unknown) {
    const w = this.waiters.shift();
    if (w) {
      this.taken();
      w.resolve({ value: v, done: false });
    } else this.queue.push(v);
  }
  end(error?: unknown) {
    if (this.done) return;
    this.done = true;
    if (error) this.error = error;
    for (const w of this.waiters.splice(0)) error ? w.reject(error) : w.resolve({ value: undefined, done: true });
  }
  taken() {
    this.consumed++;
    if (!this.done && this.consumed >= Math.max(1, this.credit >> 1)) {
      this.onPull(this.consumed);
      this.consumed = 0;
    }
  }
  next(): Promise<IteratorResult<unknown>> {
    if (this.queue.length) {
      const value = this.queue.shift();
      this.taken();
      return Promise.resolve({ value, done: false });
    }
    if (this.done) return this.error ? Promise.reject(this.error) : Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }
  cancel() {
    if (this.done) return;
    this.onCancel();
    this.queue.length = 0;
    this.end();
  }
}

function makeRemoteStream(st: StreamState): RemoteStream<unknown> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: () => st.next(),
        return: () => {
          st.cancel();
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
    cancel: () => st.cancel(),
    toReadableStream() {
      return new ReadableStream({
        pull: async (controller) => {
          const r = await st.next();
          if (r.done) controller.close();
          else controller.enqueue(r.value);
        },
        cancel: () => st.cancel(),
      });
    },
  };
}

/**
 * Connects one end of a channel. Both sides call this; each may expose an API
 * and each gets the other's as `remote`.
 */
export function createEndpoint<R extends object = Record<string, never>, L extends object = object>(
  port: PortLike,
  options: EndpointOptions<L> = {},
): Endpoint<R> {
  const credit = Math.max(1, options.credit ?? 16);
  const middleware = options.middleware ?? [];
  let nextId = 1;
  let nextRef = 1;
  let closed = false;

  // Calls this side made and is waiting for.
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  // Streams this side is receiving.
  const streams = new Map<number, StreamState>();
  // Callbacks this side handed out, by reference.
  const localFns = new Map<number, Fn>();
  // Calls the other side made and this side is serving.
  const serving = new Map<
    number,
    { ac: AbortController; credit: number; wake: (() => void) | null; cancelled: boolean; it?: AsyncIterator<unknown> }
  >();

  const send = (m: RpcMessage) => {
    if (!closed) port.postMessage(m);
  };

  const release = typeof FinalizationRegistry !== "undefined"
    ? new FinalizationRegistry<number>((ref) => send({ $sbx: PROTOCOL, t: "rel", ref }))
    : null;

  function encode(v: unknown, depth = 0, signals?: AbortSignal[]): unknown {
    if (depth > MAX_DEPTH) throw new SandboxError("invalid-argument", "Value nested too deeply");
    if (typeof v === "function") {
      const ref = nextRef++;
      localFns.set(ref, v as Fn);
      return { $sbxFn: ref };
    }
    if (typeof AbortSignal !== "undefined" && v instanceof AbortSignal) {
      signals?.push(v);
      return { $sbxSignal: true };
    }
    if (Array.isArray(v)) return v.map((x) => encode(x, depth + 1, signals));
    if (isPlainObject(v)) {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(v)) o[k] = encode(v[k], depth + 1, signals);
      return o;
    }
    return v;
  }

  function decode(v: unknown, signal: AbortSignal | null, depth = 0): unknown {
    if (depth > MAX_DEPTH) return v;
    if (Array.isArray(v)) return v.map((x) => decode(x, signal, depth + 1));
    if (isPlainObject(v)) {
      if (typeof v.$sbxFn === "number" && Object.keys(v).length === 1) return remoteFn(v.$sbxFn);
      if (v.$sbxSignal === true && Object.keys(v).length === 1) return signal ?? new AbortController().signal;
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(v)) o[k] = decode(v[k], signal, depth + 1);
      return o;
    }
    return v;
  }

  function remoteFn(ref: number): Fn {
    const f = (...args: unknown[]) => call({ ref }, args);
    release?.register(f, ref);
    return f;
  }

  function call(target: { path?: string[]; ref?: number }, args: unknown[]): Promise<unknown> {
    if (closed) return Promise.reject(new SandboxError("unavailable", "Bridge is closed"));
    const id = nextId++;
    const signals: AbortSignal[] = [];
    let wireArgs: unknown[];
    try {
      wireArgs = args.map((a) => encode(a, 0, signals));
    } catch (e) {
      return Promise.reject(e);
    }
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      for (const s of signals) {
        const onAbort = () => {
          if (!pending.has(id) && !streams.has(id)) return;
          send({ $sbx: PROTOCOL, t: "cancel", id });
          const p = pending.get(id);
          pending.delete(id);
          p?.reject(new SandboxError("cancelled", "Cancelled"));
          streams.get(id)?.end(new SandboxError("cancelled", "Cancelled"));
          streams.delete(id);
        };
        if (s.aborted) queueMicrotask(onAbort);
        else s.addEventListener("abort", onAbort, { once: true });
      }
      try {
        send({ $sbx: PROTOCOL, t: "call", id, ...target, args: wireArgs });
      } catch (e) {
        pending.delete(id);
        reject(new SandboxError("invalid-argument", `Could not send call: ${(e as Error)?.message ?? e}`));
      }
    });
  }

  function remoteCall(path: string[], args: unknown[]): RemoteCall<unknown> & AsyncIterable<unknown> {
    const p = call({ path }, args) as RemoteCall<unknown> & AsyncIterable<unknown>;
    (p as unknown as Record<symbol, unknown>)[Symbol.asyncIterator] = function () {
      let inner: AsyncIterator<unknown> | null = null;
      const get = async () => {
        if (!inner) {
          const v = await p;
          if (!v || typeof (v as AsyncIterable<unknown>)[Symbol.asyncIterator] !== "function") {
            throw new SandboxError("invalid-argument", `${path.join(".")} did not return a stream`);
          }
          inner = (v as AsyncIterable<unknown>)[Symbol.asyncIterator]();
        }
        return inner;
      };
      return {
        next: async () => (await get()).next(),
        return: async () => {
          if (inner?.return) return inner.return();
          p.then((v) => (v as RemoteStream<unknown> | undefined)?.cancel?.(), () => {});
          return { value: undefined, done: true };
        },
      };
    };
    return p;
  }

  function proxy(path: string[]): unknown {
    return new Proxy(function () {}, {
      get(_t, key) {
        if (typeof key === "symbol" || key === "then") return undefined;
        return proxy([...path, key]);
      },
      apply(_t, _this, args) {
        return remoteCall(path, args);
      },
    });
  }

  async function serve(m: Extract<RpcMessage, { t: "call" }>) {
    const state = {
      ac: new AbortController(),
      credit: 0,
      wake: null as (() => void) | null,
      cancelled: false,
      it: undefined as AsyncIterator<unknown> | undefined,
    };
    serving.set(m.id, state);
    const isCallback = typeof m.ref === "number";
    const path = Array.isArray(m.path) ? m.path.map(String) : [];
    let target: { fn: Fn; self: unknown } | null = null;
    if (isCallback) {
      const fn = localFns.get(m.ref!);
      target = fn ? { fn, self: undefined } : null;
    } else target = resolvePath(options.expose, path);
    try {
      if (!target) {
        throw new SandboxError("not-found", isCallback ? "Callback was released" : `No such function: ${path.join(".")}`);
      }
      const args = Array.isArray(m.args) ? (decode(m.args, state.ac.signal) as unknown[]) : [];
      const ctx: CallContext = { path, args, signal: state.ac.signal, callback: isCallback, meta: { ...options.meta } };
      const t = target;
      let i = 0;
      const next = (): Promise<unknown> => {
        const mw = middleware[i++];
        if (mw) return mw(ctx, next);
        return Promise.resolve().then(() => t.fn.apply(t.self, ctx.args));
      };
      const result = await next();
      if (state.cancelled) return;
      if (isStreamLike(result)) {
        send({ $sbx: PROTOCOL, t: "ok", id: m.id, v: { $sbxStream: m.id } });
        state.it = iteratorOf(result);
        await pump(m.id, state, state.it);
      } else {
        send({ $sbx: PROTOCOL, t: "ok", id: m.id, v: encode(result) });
      }
    } catch (e) {
      if (!state.cancelled) send({ $sbx: PROTOCOL, t: "err", id: m.id, e: toWireError(e) });
    } finally {
      serving.delete(m.id);
    }
  }

  async function pump(id: number, state: { credit: number; wake: (() => void) | null; cancelled: boolean }, it: AsyncIterator<unknown>) {
    try {
      while (!state.cancelled) {
        while (state.credit <= 0 && !state.cancelled) await new Promise<void>((r) => (state.wake = r));
        if (state.cancelled) break;
        const r = await it.next();
        if (state.cancelled) break;
        if (r.done) {
          send({ $sbx: PROTOCOL, t: "end", id });
          return;
        }
        send({ $sbx: PROTOCOL, t: "next", id, v: encode(r.value) });
        state.credit--;
      }
      await it.return?.();
    } catch (e) {
      if (!state.cancelled) send({ $sbx: PROTOCOL, t: "err", id, e: toWireError(e) });
    }
  }

  function onMessage(ev: MessageEvent) {
    const m = ev.data as RpcMessage;
    if (!isSbx(m)) {
      options.onUnknown?.(ev.data);
      return;
    }
    switch (m.t) {
      case "call":
        if (typeof m.id === "number") void serve(m);
        break;
      case "ok": {
        const p = pending.get(m.id);
        if (!p) break;
        pending.delete(m.id);
        const v = m.v as { $sbxStream?: unknown } | null;
        if (isPlainObject(v) && typeof v.$sbxStream === "number" && Object.keys(v).length === 1) {
          const st = new StreamState(
            (n) => send({ $sbx: PROTOCOL, t: "pull", id: m.id, n }),
            () => {
              streams.delete(m.id);
              send({ $sbx: PROTOCOL, t: "cancel", id: m.id });
            },
            credit,
          );
          streams.set(m.id, st);
          send({ $sbx: PROTOCOL, t: "pull", id: m.id, n: credit });
          p.resolve(makeRemoteStream(st));
        } else p.resolve(decode(m.v, null));
        break;
      }
      case "err": {
        const e = new SandboxError(m.e?.code ?? "internal", m.e?.message ?? "Unknown error", m.e?.data);
        const p = pending.get(m.id);
        if (p) {
          pending.delete(m.id);
          p.reject(e);
        }
        const st = streams.get(m.id);
        if (st) {
          streams.delete(m.id);
          st.end(e);
        }
        break;
      }
      case "next":
        streams.get(m.id)?.push(decode(m.v, null));
        break;
      case "end": {
        const st = streams.get(m.id);
        streams.delete(m.id);
        st?.end();
        break;
      }
      case "pull": {
        const s = serving.get(m.id);
        if (s && typeof m.n === "number" && m.n > 0) {
          s.credit += m.n;
          const w = s.wake;
          s.wake = null;
          w?.();
        }
        break;
      }
      case "cancel": {
        const s = serving.get(m.id);
        if (s) {
          s.cancelled = true;
          s.ac.abort(new SandboxError("cancelled", "Cancelled by caller"));
          const w = s.wake;
          s.wake = null;
          w?.();
          // The producer may be waiting for its next value (a live subscription): close it now.
          if (s.it) Promise.resolve().then(() => s.it?.return?.()).catch(() => {});
        }
        break;
      }
      case "rel":
        localFns.delete(m.ref);
        break;
    }
  }

  port.addEventListener("message", onMessage);
  port.start?.();

  return {
    remote: proxy([]) as Remote<R>,
    get closed() {
      return closed;
    },
    close() {
      if (closed) return;
      closed = true;
      port.removeEventListener("message", onMessage);
      const err = new SandboxError("unavailable", "Bridge closed");
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      for (const st of streams.values()) st.end(err);
      streams.clear();
      for (const s of serving.values()) {
        s.cancelled = true;
        s.ac.abort(err);
        s.wake?.();
        if (s.it) Promise.resolve().then(() => s.it?.return?.()).catch(() => {});
      }
      serving.clear();
      localFns.clear();
      port.close?.();
    },
  };
}
