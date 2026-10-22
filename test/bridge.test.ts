import { test } from "node:test";
import assert from "node:assert/strict";
import { createEndpoint, SandboxError } from "../src/bridge.ts";
import { audit, confirm, rateLimit, scopes } from "../src/middleware.ts";
import type { AuditEntry } from "../src/middleware.ts";

interface HostApi {
  add(a: number, b: number): number;
  devices: {
    list(q?: { orgId?: string }): Promise<{ id: string }[]>;
    remove(id: string): Promise<void>;
  };
  count(n: number, delayMs?: number): AsyncIterable<number>;
  readable(n: number): ReadableStream<number>;
  later(ms: number, signal: AbortSignal): Promise<string>;
  onTick(cb: (n: number) => void): Promise<() => void>;
  fail(): never;
  _secret(): string;
}

interface ArtifactApi {
  getState(): { ready: boolean };
}

function pair<H extends object, A extends object>(host: H, artifact?: A, opts: Parameters<typeof createEndpoint>[1] = {}) {
  const ch = new MessageChannel();
  const h = createEndpoint<ArtifactApi>(ch.port1 as never, { expose: host, ...opts });
  const a = createEndpoint<HostApi>(ch.port2 as never, { expose: artifact });
  return { h, a, close: () => (h.close(), a.close()) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hostImpl(log: string[] = []): HostApi {
  let ticks: ((n: number) => void) | null = null;
  return {
    add: (a, b) => a + b,
    devices: {
      list: async (q) => [{ id: `d1-${q?.orgId ?? "all"}` }],
      remove: async (id) => void log.push(`remove ${id}`),
    },
    async *count(n, delayMs = 0) {
      try {
        for (let i = 0; i < n; i++) {
          if (delayMs) await sleep(delayMs);
          log.push(`produce ${i}`);
          yield i;
        }
      } finally {
        log.push("producer closed");
      }
    },
    readable(n) {
      let i = 0;
      return new ReadableStream({ pull: (c) => (i < n ? c.enqueue(i++) : c.close()) });
    },
    later: (ms, signal) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve("done"), ms);
        signal.addEventListener("abort", () => {
          clearTimeout(t);
          log.push("host saw abort");
          reject(new Error("aborted"));
        });
      }),
    onTick: async (cb) => {
      ticks = cb;
      setTimeout(() => ticks?.(1), 5);
      return () => {
        ticks = null;
        log.push("unsubscribed");
      };
    },
    fail: () => {
      throw new SandboxError("permission-denied", "nope", { why: "test" });
    },
    _secret: () => "leak",
  };
}

test("calls, nested namespaces, results", async () => {
  const { a, close } = pair(hostImpl());
  assert.equal(await a.remote.add(2, 3), 5);
  assert.deepEqual(await a.remote.devices.list({ orgId: "o1" }), [{ id: "d1-o1" }]);
  close();
});

test("errors keep code, message and data; no stack", async () => {
  const { a, close } = pair(hostImpl());
  await assert.rejects(a.remote.fail(), (e: SandboxError) => {
    assert.equal(e.name, "SandboxError");
    assert.equal(e.code, "permission-denied");
    assert.equal(e.message, "nope");
    assert.deepEqual(e.data, { why: "test" });
    return true;
  });
  close();
});

test("unknown and private paths are not reachable", async () => {
  const { a, close } = pair(hostImpl());
  await assert.rejects((a.remote as any).nope(), { code: "not-found" });
  await assert.rejects((a.remote as any)._secret(), { code: "not-found" });
  await assert.rejects((a.remote as any).add.constructor(), { code: "not-found" });
  await assert.rejects((a.remote as any).__proto__.toString(), { code: "not-found" });
  close();
});

test("the remote proxy is not a thenable", async () => {
  const { a, close } = pair(hostImpl());
  const r = await Promise.resolve(a.remote);
  assert.equal(typeof (r as any).then, "undefined");
  close();
});

test("streams: async iterable with backpressure", async () => {
  const log: string[] = [];
  const ch = new MessageChannel();
  const h = createEndpoint(ch.port1 as never, { expose: hostImpl(log) });
  const a = createEndpoint<HostApi>(ch.port2 as never, { credit: 4 });
  const seen: number[] = [];
  for await (const v of a.remote.count(10)) {
    seen.push(v);
    if (v === 0) {
      await sleep(20);
      // with credit 4 the producer must not run far ahead of the consumer
      assert.ok(log.filter((l) => l.startsWith("produce")).length <= 4, log.join(","));
    }
  }
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  h.close();
  a.close();
});

test("streams: breaking out cancels the producer", async () => {
  const log: string[] = [];
  const { a, close } = pair(hostImpl(log));
  for await (const v of a.remote.count(1000, 1)) if (v === 2) break;
  await sleep(30);
  assert.ok(log.includes("producer closed"));
  assert.ok(log.filter((l) => l.startsWith("produce")).length < 40);
  close();
});

test("streams: cancelling an idle live stream closes the producer", async () => {
  let closed = false;
  let push: ((v: number) => void) | null = null;
  const api = {
    live(): AsyncIterable<number> {
      const queue: number[] = [];
      let wake: (() => void) | null = null;
      push = (v) => (queue.push(v), wake?.());
      return {
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            while (!queue.length) await new Promise<void>((r) => (wake = r));
            return { value: queue.shift()!, done: false };
          },
          return: async () => ((closed = true), { value: undefined, done: true }),
        }),
      };
    },
  };
  const { a, close } = pair(api);
  const got: number[] = [];
  const run = (async () => {
    for await (const v of (a.remote as any).live()) {
      got.push(v);
      if (got.length === 1) break;
    }
  })();
  await sleep(10);
  push!(1);
  await run;
  await sleep(20);
  assert.deepEqual(got, [1]);
  assert.equal(closed, true);
  close();
});

test("streams: ReadableStream result and toReadableStream()", async () => {
  const { a, close } = pair(hostImpl());
  const s = await a.remote.readable(3);
  const reader = s.toReadableStream().getReader();
  const got: number[] = [];
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    got.push(r.value);
  }
  assert.deepEqual(got, [0, 1, 2]);
  close();
});

test("AbortSignal cancels the remote call", async () => {
  const log: string[] = [];
  const { a, close } = pair(hostImpl(log));
  const ac = new AbortController();
  const p = a.remote.later(1000, ac.signal);
  setTimeout(() => ac.abort(), 10);
  await assert.rejects(p, { code: "cancelled" });
  await sleep(10);
  assert.ok(log.includes("host saw abort"));
  close();
});

test("callbacks both ways, and functions in results", async () => {
  const log: string[] = [];
  const { a, close } = pair(hostImpl(log));
  const got: number[] = [];
  const unsub = await a.remote.onTick((n) => void got.push(n));
  await sleep(20);
  assert.deepEqual(got, [1]);
  await unsub();
  assert.ok(log.includes("unsubscribed"));
  close();
});

test("bidirectional: host calls the artifact", async () => {
  const { h, close } = pair(hostImpl(), { getState: () => ({ ready: true }) });
  assert.deepEqual(await h.remote.getState(), { ready: true });
  close();
});

test("close rejects pending calls with unavailable", async () => {
  const { a, close } = pair(hostImpl());
  const ac = new AbortController();
  const p = a.remote.later(1000, ac.signal);
  a.close();
  await assert.rejects(p, { code: "unavailable" });
  close();
});

test("middleware: scopes, confirm, audit, rate limit", async () => {
  const entries: AuditEntry[] = [];
  const asked: string[] = [];
  let answer = false;
  let t = 0;
  const { a, close } = pair(hostImpl(), undefined, {
    middleware: [
      audit((e) => entries.push(e)),
      rateLimit({ perSecond: 1, burst: 4, now: () => t }),
      scopes({ add: null, "devices.list": "devices:read", "devices.*": ["devices:read", "devices:write"] }, ["devices:read"]),
      confirm({ "devices.remove": (args) => `Remove ${args[0]}?` }, (q) => (asked.push(q), answer)),
    ],
  });
  assert.equal(await a.remote.add(1, 1), 2);
  assert.deepEqual(await a.remote.devices.list(), [{ id: "d1-all" }]);
  await assert.rejects(a.remote.devices.remove("d9"), { code: "permission-denied" });
  await assert.rejects((a.remote as any).count(1), { code: "permission-denied" }); // no rule → refused
  await assert.rejects(a.remote.add(1, 2), { code: "quota" }); // 4 used up, clock frozen
  t = 10_000;
  assert.equal(await a.remote.add(1, 2), 3);
  assert.equal(entries.length, 6);
  assert.deepEqual(entries.map((e) => e.ok), [true, true, false, false, false, true]);
  assert.deepEqual(asked, []);
  close();

  const granted = new Set(["devices:read", "devices:write"]);
  const p2 = pair(hostImpl(), undefined, {
    middleware: [
      scopes({ "devices.*": ["devices:write"] }, () => granted),
      confirm({ "devices.remove": (args) => `Remove ${args[0]}?` }, (q) => (asked.push(q), answer)),
    ],
  });
  await assert.rejects(p2.a.remote.devices.remove("d9"), { code: "cancelled" });
  answer = true;
  await p2.a.remote.devices.remove("d9");
  assert.deepEqual(asked, ["Remove d9?", "Remove d9?"]);
  granted.delete("devices:write");
  await assert.rejects(p2.a.remote.devices.remove("d9"), { code: "permission-denied" });
  p2.close();
});

test("non-protocol messages are ignored", async () => {
  const ch = new MessageChannel();
  const seen: unknown[] = [];
  const h = createEndpoint(ch.port1 as never, { expose: hostImpl(), onUnknown: (d) => seen.push(d) });
  ch.port2.postMessage({ hello: 1 });
  ch.port2.postMessage({ $sbx: 1, t: "call", id: 1, path: ["add"], args: [1, 2] });
  const reply = await new Promise((r) => ch.port2.addEventListener("message", (e) => r(e.data), { once: true }));
  ch.port2.start();
  assert.deepEqual(reply, { $sbx: 1, t: "ok", id: 1, v: 3 });
  assert.deepEqual(seen, [{ hello: 1 }]);
  h.close();
  ch.port2.close();
});
