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
import { isSbx, PROTOCOL } from "./protocol.js";

/** The part of `MessagePort` the bridge uses. Adapt WebSockets, workers or stdio to it. */

/** The error a remote failure is re-thrown as. Switch on `code`. */
export class SandboxError extends Error {
           code           ;
           data          ;
  constructor(code           , message        , data          ) {
    super(message);
    this.name = "SandboxError";
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

/** Anything thrown → what goes on the wire. Stacks never cross. */
export function toWireError(e         )            {
  if (e instanceof SandboxError) return { code: e.code, message: e.message, ...(e.data !== undefined ? { data: e.data } : {}) };
  if (e && typeof e === "object") {
    const o = e                                                         ;
    const code = typeof o.code === "string" ? o.code : o.name === "AbortError" ? "cancelled" : "internal";
    const message = typeof o.message === "string" ? o.message : String(e);
    return { code, message };
  }
  return { code: "internal", message: String(e) };
}

// deno-lint-ignore no-explicit-any

/** A stream received from the other side. Iterate it, or turn it into a ReadableStream. */

/** A remote function: async, and if the original returned a stream, iterable directly. */

/** Functions inside results become async remote functions. */

/** The other side's exposed API, as seen through the bridge. */

/** What a middleware sees. `args` may be replaced before `next()`. */

/** Koa-style: run code before/after, change args, or throw to refuse. */

/** A pending remote call: a Promise that also iterates when the result is a stream. */

const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);
const MAX_DEPTH = 32;

function isPlainObject(v         )                               {
  if (v === null || typeof v !== "object") return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

function isStreamLike(v         )                                                        {
  if (v === null || typeof v !== "object") return false;
  if (typeof ReadableStream !== "undefined" && v instanceof ReadableStream) return true;
  return typeof (v                          )[Symbol.asyncIterator] === "function";
}

function iteratorOf(v                                                  )                         {
  if (typeof (v                          )[Symbol.asyncIterator] === "function") {
    return (v                          )[Symbol.asyncIterator]();
  }
  const reader = (v                           ).getReader();
  return {
    next: () => reader.read()                                    ,
    return: async () => {
      await reader.cancel();
      return { done: true, value: undefined };
    },
  };
}

/** Lists the callable paths of an API object (for introspection; not a security boundary). */
export function apiPaths(api        , prefix           = [], depth = 0)             {
  const out             = [];
  if (depth > 8) return out;
  for (const key of Object.keys(api)) {
    if (FORBIDDEN.has(key) || key.startsWith("_")) continue;
    const v = (api                           )[key];
    if (typeof v === "function") out.push([...prefix, key]);
    else if (v && typeof v === "object") out.push(...apiPaths(v, [...prefix, key], depth + 1));
  }
  return out;
}

function resolvePath(api                    , path          )                                   {
  if (!api || path.length === 0) return null;
  let self          = undefined;
  let cur          = api;
  for (const key of path) {
    if (typeof key !== "string" || FORBIDDEN.has(key) || key.startsWith("_")) return null;
    if (cur === null || (typeof cur !== "object" && typeof cur !== "function")) return null;
    if (!Object.prototype.hasOwnProperty.call(cur, key)) return null;
    self = cur;
    cur = (cur                           )[key];
  }
  return typeof cur === "function" ? { fn: cur      , self } : null;
}

class StreamState {
  queue            = [];
  waiters                                                                                    = [];
  done = false;
  error          = null;
  consumed = 0;
           onPull                     ;
           onCancel            ;
           credit        ;
  constructor(onPull                     , onCancel            , credit        ) {
    this.onPull = onPull;
    this.onCancel = onCancel;
    this.credit = credit;
  }

  push(v         ) {
    const w = this.waiters.shift();
    if (w) {
      this.taken();
      w.resolve({ value: v, done: false });
    } else this.queue.push(v);
  }
  end(error          ) {
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
  next()                                   {
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

function makeRemoteStream(st             )                        {
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
export function createEndpoint                                                                     (
  port          ,
  options                     = {},
)              {
  const credit = Math.max(1, options.credit ?? 16);
  const middleware = options.middleware ?? [];
  let nextId = 1;
  let nextRef = 1;
  let closed = false;

  // Calls this side made and is waiting for.
  const pending = new Map                                                                         ();
  // Streams this side is receiving.
  const streams = new Map                     ();
  // Callbacks this side handed out, by reference.
  const localFns = new Map            ();
  // Calls the other side made and this side is serving.
  const serving = new Map

   ();

  const send = (m            ) => {
    if (closed) return;
    try {
      port.postMessage(m);
    } catch (e) {
      // Reactive state (Svelte $state, Vue reactive, MobX…) is a Proxy, which postMessage cannot copy.
      if ((e                     )?.name !== "DataCloneError") throw e;
      port.postMessage(toCloneable(m));
    }
  };

  const release = typeof FinalizationRegistry !== "undefined"
    ? new FinalizationRegistry        ((ref) => send({ $sbx: PROTOCOL, t: "rel", ref }))
    : null;

  function encode(v         , depth = 0, signals                )          {
    if (depth > MAX_DEPTH) throw new SandboxError("invalid-argument", "Value nested too deeply");
    if (typeof v === "function") {
      const ref = nextRef++;
      localFns.set(ref, v      );
      return { $sbxFn: ref };
    }
    if (typeof AbortSignal !== "undefined" && v instanceof AbortSignal) {
      signals?.push(v);
      return { $sbxSignal: true };
    }
    if (Array.isArray(v)) return v.map((x) => encode(x, depth + 1, signals));
    if (isPlainObject(v)) {
      const o                          = {};
      for (const k of Object.keys(v)) o[k] = encode(v[k], depth + 1, signals);
      return o;
    }
    return v;
  }

  function decode(v         , signal                    , depth = 0)          {
    if (depth > MAX_DEPTH) return v;
    if (Array.isArray(v)) return v.map((x) => decode(x, signal, depth + 1));
    if (isPlainObject(v)) {
      if (typeof v.$sbxFn === "number" && Object.keys(v).length === 1) return remoteFn(v.$sbxFn);
      if (v.$sbxSignal === true && Object.keys(v).length === 1) return signal ?? new AbortController().signal;
      const o                          = {};
      for (const k of Object.keys(v)) o[k] = decode(v[k], signal, depth + 1);
      return o;
    }
    return v;
  }

  function remoteFn(ref        )     {
    const f = (...args           ) => call({ ref }, args);
    release?.register(f, ref);
    return f;
  }

  function call(target                                   , args           )                   {
    if (closed) return Promise.reject(new SandboxError("unavailable", "Bridge is closed"));
    const id = nextId++;
    const signals                = [];
    let wireArgs           ;
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
        reject(new SandboxError("invalid-argument", `Could not send call: ${(e         )?.message ?? e}`));
      }
    });
  }

  function remoteCall(path          , args           )                                               {
    const p = call({ path }, args)                                                ;
    (p                                      )[Symbol.asyncIterator] = function () {
      let inner                                = null;
      const get = async () => {
        if (!inner) {
          const v = await p;
          if (!v || typeof (v                          )[Symbol.asyncIterator] !== "function") {
            throw new SandboxError("invalid-argument", `${path.join(".")} did not return a stream`);
          }
          inner = (v                          )[Symbol.asyncIterator]();
        }
        return inner;
      };
      return {
        next: async () => (await get()).next(),
        return: async () => {
          if (inner?.return) return inner.return();
          p.then((v) => (v                                     )?.cancel?.(), () => {});
          return { value: undefined, done: true };
        },
      };
    };
    return p;
  }

  function proxy(path          )          {
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

  async function serve(m                                    ) {
    const state = {
      ac: new AbortController(),
      credit: 0,
      wake: null                       ,
      cancelled: false,
      it: undefined                                      ,
    };
    serving.set(m.id, state);
    const isCallback = typeof m.ref === "number";
    const path = Array.isArray(m.path) ? m.path.map(String) : [];
    let target                                   = null;
    if (isCallback) {
      const fn = localFns.get(m.ref );
      target = fn ? { fn, self: undefined } : null;
    } else target = resolvePath(options.expose, path);
    try {
      if (!target) {
        throw new SandboxError("not-found", isCallback ? "Callback was released" : `No such function: ${path.join(".")}`);
      }
      const args = Array.isArray(m.args) ? (decode(m.args, state.ac.signal)             ) : [];
      const ctx              = { path, args, signal: state.ac.signal, callback: isCallback, meta: { ...options.meta } };
      const t = target;
      let i = 0;
      const next = ()                   => {
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

  async function pump(id        , state                                                                   , it                        ) {
    try {
      while (!state.cancelled) {
        while (state.credit <= 0 && !state.cancelled) await new Promise      ((r) => (state.wake = r));
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

  function onMessage(ev              ) {
    const m = ev.data              ;
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
        const v = m.v                                   ;
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
    remote: proxy([])             ,
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

/**
 * A copy postMessage can send: Proxies (reactive state of Svelte, Vue, MobX…) become plain
 * objects and arrays; Dates, Maps, Sets, binary data, Blobs and ports pass through as they are.
 * Functions and symbols are dropped, as structured clone would refuse them.
 */
export function toCloneable   (value   , seen                           = new WeakMap())    {
  if (value === null || typeof value !== "object") return (typeof value === "function" || typeof value === "symbol" ? undefined : value)     ;
  const v = value                     ;
  if (seen.has(v)) return seen.get(v)     ;
  const passThrough = [Date, RegExp, ArrayBuffer, DataView, globalThis.Blob, globalThis.MessagePort, globalThis.ImageData, globalThis.ReadableStream]
    .some((C) => typeof C === "function" && v instanceof (C                               ));
  if (passThrough || ArrayBuffer.isView(v)) return value;
  if (Array.isArray(v)) {
    const out            = [];
    seen.set(v, out);
    for (const x of v) out.push(toCloneable(x, seen));
    return out     ;
  }
  if (v instanceof Map) {
    const out = new Map();
    seen.set(v, out);
    for (const [k, x] of v) out.set(toCloneable(k, seen), toCloneable(x, seen));
    return out     ;
  }
  if (v instanceof Set) {
    const out = new Set();
    seen.set(v, out);
    for (const x of v) out.add(toCloneable(x, seen));
    return out     ;
  }
  if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack }     ;
  const out                          = {};
  seen.set(v, out);
  for (const k of Object.keys(v)) {
    const x = (v                           )[k];
    if (typeof x !== "function" && typeof x !== "symbol") out[k] = toCloneable(x, seen);
  }
  return out     ;
}
