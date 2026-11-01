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

export function createHooks(R         )        {
  /** Runs an async call when `deps` change; latest call wins. */
  function useCall   (fn                  , deps                    )                   {
    const [state, setState] = R.useState                                                                     ({
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
        (error       ) => my === seq.current && setState((s) => ({ data: s.data, error, loading: false })),
      );
      // deno-lint-ignore react-hooks/exhaustive-deps
    }, [...deps, tick]);
    const refresh = R.useCallback(() => setTick((t) => t + 1), []);
    return { ...state, refresh };
  }

  /** Subscribes to a stream while mounted (and re-subscribes when `deps` change). */
  function useStream   (open                        , deps                    , o                    = {})                     {
    const keep = Math.max(1, o.keep ?? 1);
    const [state, setState] = R.useState                    ({ latest: undefined, values: [], done: false, error: undefined });
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
          if (!cancelled) setState((s) => ({ ...s, error: error         , done: true }));
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
