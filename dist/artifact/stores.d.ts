/**
 * Reactive helpers for artifacts, built on the store contract
 * (`subscribe(fn) → unsubscribe`). Svelte's `$store` syntax, and anything that
 * understands the contract, works with them directly; no framework import.
 *
 * ```svelte
 * <script>
 *   import { host } from "@panth977/sandbox/artifact";
 *   import { call, stream } from "@panth977/sandbox/stores";
 *   const devices = call(() => host.devices.list());
 *   const live = stream(() => host.live.readings("D12"), { keep: 50 });
 * </script>
 * {#if $devices.loading}Loading…{:else}{$devices.data.length} devices{/if}
 * ```
 *
 * @module
 */
/** The store contract. */
export interface Readable<T> {
    subscribe(run: (value: T) => void): () => void;
}
export interface CallState<T> {
    loading: boolean;
    data: T | undefined;
    error: Error | undefined;
}
export interface CallStore<T> extends Readable<CallState<T>> {
    /** Run the call again. */
    refresh(): Promise<void>;
}
/** A value with subscribers; the base of the other stores. */
export declare function writable<T>(initial: T): Readable<T> & {
    set(v: T): void;
    update(f: (v: T) => T): void;
    get(): T;
};
/** Runs `fn` (once now, again on refresh()) and exposes loading / data / error. */
export declare function call<T>(fn: () => Promise<T>): CallStore<T>;
export interface StreamState<T> {
    /** Latest value (or the last `keep` values when `keep` is set). */
    latest: T | undefined;
    values: T[];
    done: boolean;
    error: Error | undefined;
}
/**
 * Subscribes to a stream while anyone is subscribed to the store; the stream is
 * cancelled when the last subscriber leaves.
 */
export declare function stream<T>(open: () => AsyncIterable<T>, o?: {
    keep?: number;
}): Readable<StreamState<T>>;
