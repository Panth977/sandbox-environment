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

/** A value with subscribers; the base of the other stores. */
export function writable   (initial   )                                                                            {
  let value = initial;
  const subs = new Set                ();
  return {
    subscribe(run) {
      subs.add(run);
      run(value);
      return () => subs.delete(run);
    },
    set(v) {
      value = v;
      for (const s of subs) s(v);
    },
    update(f) {
      this.set(f(value));
    },
    get: () => value,
  };
}

/** Runs `fn` (once now, again on refresh()) and exposes loading / data / error. */
export function call   (fn                  )               {
  const w = writable              ({ loading: true, data: undefined, error: undefined });
  let seq = 0;
  const refresh = async () => {
    const my = ++seq;
    w.update((s) => ({ ...s, loading: true }));
    try {
      const data = await fn();
      if (my === seq) w.set({ loading: false, data, error: undefined });
    } catch (e) {
      if (my === seq) w.set({ loading: false, data: w.get().data, error: e          });
    }
  };
  void refresh();
  return { subscribe: w.subscribe, refresh };
}

/**
 * Subscribes to a stream while anyone is subscribed to the store; the stream is
 * cancelled when the last subscriber leaves.
 */
export function stream   (open                        , o                    = {})                           {
  const keep = Math.max(1, o.keep ?? 1);
  const w = writable                ({ latest: undefined, values: [], done: false, error: undefined });
  let count = 0;
  let stop                      = null;
  const start = () => {
    let cancelled = false;
    const it = open()[Symbol.asyncIterator]();
    stop = () => {
      cancelled = true;
      void it.return?.();
    };
    (async () => {
      try {
        for (;;) {
          const r = await it.next();
          if (cancelled) return;
          if (r.done) {
            w.update((s) => ({ ...s, done: true }));
            return;
          }
          w.update((s) => ({ ...s, latest: r.value, values: [...s.values, r.value].slice(-keep) }));
        }
      } catch (e) {
        if (!cancelled) w.update((s) => ({ ...s, error: e         , done: true }));
      }
    })();
  };
  return {
    subscribe(run) {
      if (count++ === 0) start();
      const un = w.subscribe(run);
      return () => {
        un();
        if (--count === 0) {
          stop?.();
          stop = null;
        }
      };
    },
  };
}
