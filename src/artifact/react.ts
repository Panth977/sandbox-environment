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
  useRef<T>(initial: T): { current: T };
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

export function createHooks(R: HookLib) {
  /** Runs an async call when `deps` change; latest call wins. */
  function useCall<T>(fn: () => Promise<T>, deps: readonly unknown[]): UseCallResult<T> {
    const [state, setState] = R.useState<{ data: T | undefined; error: Error | undefined; loading: boolean }>({
      data: undefined,
      error: undefined,
      loading: true,
    });
    const [tick, setTick] = R.useState(0);
    const seq = R.useRef(0);
    R.useEffect(() => {
      const my = ++seq.current;
      setState((s) => ({ ...s, loading: true }));
      fn().then(
        (data) => my === seq.current && setState({ data, error: undefined, loading: false }),
        (error: Error) => my === seq.current && setState((s) => ({ data: s.data, error, loading: false })),
      );
      // deno-lint-ignore react-hooks/exhaustive-deps
    }, [...deps, tick]);
    const refresh = R.useCallback(() => setTick((t) => t + 1), []);
    return { ...state, refresh };
  }

  /** Subscribes to a stream while mounted (and re-subscribes when `deps` change). */
  function useStream<T>(open: () => AsyncIterable<T>, deps: readonly unknown[], o: { keep?: number } = {}): UseStreamResult<T> {
    const keep = Math.max(1, o.keep ?? 1);
    const [state, setState] = R.useState<UseStreamResult<T>>({ latest: undefined, values: [], done: false, error: undefined });
    R.useEffect(() => {
      let cancelled = false;
      setState({ latest: undefined, values: [], done: false, error: undefined });
      const it = open()[Symbol.asyncIterator]();
      (async () => {
        try {
          for (;;) {
            const r = await it.next();
            if (cancelled) return;
            if (r.done) return setState((s) => ({ ...s, done: true }));
            setState((s) => ({ ...s, latest: r.value, values: [...s.values, r.value].slice(-keep) }));
          }
        } catch (error) {
          if (!cancelled) setState((s) => ({ ...s, error: error as Error, done: true }));
        }
      })();
      return () => {
        cancelled = true;
        void it.return?.();
      };
      // deno-lint-ignore react-hooks/exhaustive-deps
    }, deps);
    return state;
  }

  return { useCall, useStream };
}
