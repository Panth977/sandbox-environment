/**
 * React / Preact hooks for artifacts. Pass your React (or `preact/hooks`)
 * once; nothing here imports a framework, so one module serves both.
 *
 * ```tsx
 * import * as React from "react";
 * import { host } from "@panth977/sandbox/artifact";
 * import { createHooks } from "@panth977/sandbox/react";
 * const { useCall, useStream } = createHooks(React);
 *
 * function Devices() {
 *   const { data, loading, error, refresh } = useCall(() => host.devices.list(), []);
 *   const live = useStream(() => host.live.readings("D12"), [], { keep: 20 });
 *   …
 * }
 * ```
 *
 * @module
 */
/** The hook functions used; React, Preact (`preact/hooks`) and compatibles provide them. */
export interface HookLib {
    useState<S>(initial: S | (() => S)): [S, (v: S | ((prev: S) => S)) => void];
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
    useRef<T>(initial: T): {
        current: T;
    };
    useCallback<F extends (...args: never[]) => unknown>(fn: F, deps: readonly unknown[]): F;
}
export interface UseCallResult<T> {
    data: T | undefined;
    error: Error | undefined;
    loading: boolean;
    refresh(): void;
}
export interface UseStreamResult<T> {
    latest: T | undefined;
    values: T[];
    done: boolean;
    error: Error | undefined;
}
export interface Hooks {
    useCall<T>(fn: () => Promise<T>, deps: readonly unknown[]): UseCallResult<T>;
    useStream<T>(open: () => AsyncIterable<T>, deps: readonly unknown[], o?: {
        keep?: number;
    }): UseStreamResult<T>;
}
export declare function createHooks(R: HookLib): Hooks;
