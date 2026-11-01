import type { ErrorCode, WireError } from "./protocol.js";
/** The part of `MessagePort` the bridge uses. Adapt WebSockets, workers or stdio to it. */
export interface PortLike {
    postMessage(message: unknown): void;
    addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
    removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
    start?(): void;
    close?(): void;
}
/** The error a remote failure is re-thrown as. Switch on `code`. */
export declare class SandboxError extends Error {
    readonly code: ErrorCode;
    readonly data?: unknown;
    constructor(code: ErrorCode, message: string, data?: unknown);
}
/** Anything thrown → what goes on the wire. Stacks never cross. */
export declare function toWireError(e: unknown): WireError;
type Fn = (...args: any[]) => any;
/** A stream received from the other side. Iterate it, or turn it into a ReadableStream. */
export interface RemoteStream<T> extends AsyncIterable<T> {
    /** Stop the stream; the producer's iterator is closed. */
    cancel(): void;
    /** The same values as a WHATWG ReadableStream. */
    toReadableStream(): ReadableStream<T>;
}
type StreamValue<R> = Awaited<R> extends AsyncIterable<infer V> ? V : Awaited<R> extends ReadableStream<infer V> ? V : never;
/** A remote function: async, and if the original returned a stream, iterable directly. */
export type RemoteFn<F extends Fn> = [StreamValue<ReturnType<F>>] extends [never] ? (...args: Parameters<F>) => Promise<Remoted<Awaited<ReturnType<F>>>> : (...args: Parameters<F>) => RemoteCall<RemoteStream<StreamValue<ReturnType<F>>>> & AsyncIterable<StreamValue<ReturnType<F>>>;
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
export interface RemoteCall<T> extends Promise<T> {
}
/** Lists the callable paths of an API object (for introspection; not a security boundary). */
export declare function apiPaths(api: object, prefix?: string[], depth?: number): string[][];
/**
 * Connects one end of a channel. Both sides call this; each may expose an API
 * and each gets the other's as `remote`.
 */
export declare function createEndpoint<R extends object = Record<string, never>, L extends object = object>(port: PortLike, options?: EndpointOptions<L>): Endpoint<R>;
/**
 * A copy postMessage can send: Proxies (reactive state of Svelte, Vue, MobX…) become plain
 * objects and arrays; Dates, Maps, Sets, binary data, Blobs and ports pass through as they are.
 * Functions and symbols are dropped, as structured clone would refuse them.
 */
export declare function toCloneable<T>(value: T, seen?: WeakMap<object, unknown>): T;
export {};
