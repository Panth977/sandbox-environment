// @ts-self-types="./peer.d.ts"
// One side of the process bridge: calls, streams with credit, cancel, errors.
// Plain ES module: it runs as-is on Node, Deno and Bun, and the parent SDK uses it too.
const CREDIT = 16;

export class SandboxError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = "SandboxError";
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

const wireError = (e) => ({
  code: typeof e?.code === "string" ? e.code : e?.name === "AbortError" ? "cancelled" : "internal",
  message: typeof e?.message === "string" ? e.message : String(e),
});

export class Peer {
  /** @param send (message) => void  @param handler (path) => { kind, fn } | undefined */
  constructor(send, handler) {
    this.send = (m) => send({ $sbx: 1, ...m });
    this.handler = handler;
    this.next = 1;
    this.out = new Map(); // my calls
    this.in = new Map(); // calls I am answering
  }

  fail(id, e) {
    this.send({ t: "err", id, e: wireError(e) });
  }

  /** Every pending call fails: the other side is gone. */
  closeAll(error) {
    for (const o of this.out.values()) o.fail(error);
    this.out.clear();
    for (const i of this.in.values()) i.abort.abort();
    this.in.clear();
  }

  guard(id, options, fail) {
    const stop = (code, msg) => {
      this.send({ t: "cancel", id });
      fail(new SandboxError(code, msg));
    };
    const timer = options?.timeoutMs > 0 ? setTimeout(() => stop("deadline", "call timed out"), options.timeoutMs) : undefined;
    const onAbort = () => stop("cancelled", "cancelled");
    options?.signal?.addEventListener("abort", onAbort, { once: true });
    return () => {
      clearTimeout(timer);
      options?.signal?.removeEventListener("abort", onAbort);
    };
  }

  call(path, input, options) {
    return new Promise((resolve, reject) => {
      if (options?.signal?.aborted) return reject(new SandboxError("cancelled", "cancelled"));
      const id = this.next++;
      const done = () => {
        this.out.delete(id);
        clear();
      };
      const fail = (e) => {
        done();
        reject(e);
      };
      const clear = this.guard(id, options, fail);
      this.out.set(id, { ok: (v) => (done(), resolve(v)), fail });
      this.send({ t: "call", id, path: path.split("."), args: [input ?? null] });
    });
  }

  stream(path, input, options) {
    const self = this;
    return {
      [Symbol.asyncIterator]() {
        const id = self.next++;
        const queue = [];
        let wake, ended = false, failure, seen = 0, clear;
        const poke = () => {
          wake?.();
          wake = undefined;
        };
        const finish = () => {
          ended = true;
          self.out.delete(id);
          clear();
          poke();
        };
        const fail = (e) => {
          failure = e;
          finish();
        };
        clear = self.guard(id, options, fail);
        self.out.set(id, { next: (v) => (queue.push(v), poke()), end: finish, fail });
        self.send({ t: "call", id, path: path.split("."), args: [input ?? null] });
        return {
          async next() {
            for (;;) {
              if (queue.length) {
                if (++seen >= CREDIT / 2) {
                  self.send({ t: "pull", id, n: seen });
                  seen = 0;
                }
                return { value: queue.shift(), done: false };
              }
              if (failure) throw failure;
              if (ended) return { value: undefined, done: true };
              await new Promise((r) => (wake = r));
            }
          },
          async return() {
            if (!ended) self.send({ t: "cancel", id });
            finish();
            return { value: undefined, done: true };
          },
        };
      },
    };
  }

  async serve(m) {
    const path = m.path.join(".");
    const h = this.handler(path);
    if (!h) return this.send({ t: "err", id: m.id, e: { code: "not-found", message: "no handler: " + path } });
    const abort = new AbortController();
    const state = { abort, credit: CREDIT, wake: undefined };
    this.in.set(m.id, state);
    const ctx = { signal: abort.signal, path };
    try {
      if (h.kind === "stream") {
        for await (const v of h.fn(m.args?.[0], ctx)) {
          while (state.credit <= 0 && !abort.signal.aborted) await new Promise((r) => (state.wake = r));
          if (abort.signal.aborted) return;
          state.credit--;
          this.send({ t: "next", id: m.id, v: v ?? null });
        }
        this.send({ t: "end", id: m.id });
      } else {
        const v = await h.fn(m.args?.[0], ctx);
        this.send({ t: "ok", id: m.id, v: v ?? null });
      }
    } catch (e) {
      if (!abort.signal.aborted) this.fail(m.id, e);
    } finally {
      this.in.delete(m.id);
    }
  }

  /** Feed one message from the other side. */
  receive(m) {
    switch (m.t) {
      case "call":
        this.serve(m);
        break;
      case "ok":
        this.out.get(m.id)?.ok?.(m.v);
        break;
      case "next":
        this.out.get(m.id)?.next?.(m.v);
        break;
      case "end":
        this.out.get(m.id)?.end?.();
        break;
      case "err":
        this.out.get(m.id)?.fail(new SandboxError(m.e?.code ?? "internal", m.e?.message ?? "failed"));
        break;
      case "pull": {
        const s = this.in.get(m.id);
        if (s) {
          s.credit += m.n;
          s.wake?.();
          s.wake = undefined;
        }
        break;
      }
      case "cancel": {
        const s = this.in.get(m.id);
        if (s) {
          s.abort.abort();
          s.wake?.();
          this.in.delete(m.id);
        }
        break;
      }
    }
  }
}
