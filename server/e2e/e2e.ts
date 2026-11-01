// End-to-end checks against a live sandboxd. Prints one JSON line per check; exits 1 on any failure.
// SANDBOXD=unix:///path node --experimental-strip-types --no-warnings server/e2e/e2e.ts [only]
import { spawn } from "node:child_process";
import { audit, type CompiledCode, createSandbox, SandboxError, type ApiDef } from "../ts/server.ts";
import { apis, exportsSchema, kids } from "./fixtures.ts";

const endpoint = process.env.SANDBOXD ?? "unix:///run/sandboxd.sock";
const only = process.argv[2];
const results: boolean[] = [];
const sandbox = createSandbox({ endpoint });

async function check(name: string, fn: () => Promise<unknown>) {
  if (only && !name.includes(only)) return;
  const t = Date.now();
  try {
    const detail = await Promise.race([fn(), new Promise((_, no) => setTimeout(() => no(new Error("check timed out")), 300000))]);
    results.push(true);
    console.log(JSON.stringify({ ok: true, name, ms: Date.now() - t, detail }));
  } catch (e) {
    results.push(false);
    console.log(JSON.stringify({ ok: false, name, ms: Date.now() - t, error: String((e as Error)?.message ?? e) }));
  }
}
function assert(v: unknown, msg: string): asserts v {
  if (!v) throw new Error(msg);
}

const audits: string[] = [];
const apiDef: ApiDef<typeof apis> = {
  kv: { get: ({ key }) => (key === "greeting" ? "hello" : null) },
  slow: ({ ms }) => new Promise((r) => setTimeout(r, ms)),
  numbers: async function* ({ to }) {
    for (let i = 1; i <= to; i++) yield i;
  },
};

type Code = CompiledCode<typeof apis, typeof exportsSchema>;
const compiled = new Map<string, Code>();
for (const k of kids) {
  await check(`compile ${k.name}`, async () => {
    const r = await sandbox.compile({ environment: k.environment, files: [...k.files], apisSchema: apis, exportsSchema });
    assert(r.ok, JSON.stringify(r.diagnostics));
    compiled.set(k.name, r.compiledCode);
    return { cpuMs: r.usage.cpuMs, wallMs: r.usage.wallMs, bytes: r.compiledCode.bundle.length };
  });
  await check(`run ${k.name}: calls, host API, streams, logs`, async () => {
    const logs: string[] = [];
    const box = sandbox.run({
      compiledCode: compiled.get(k.name)!, apiDef, env: { who: "parent" },
      middleware: [audit((e) => audits.push(e.path))],
      onEvent: (e) => { if (e.type === "log") logs.push(e.text); },
    });
    await box.ready;
    const a = await box.remote.hello({ name: "Panth" });
    assert(a.text === "hello Panth from parent" && a.runtime === k.name, JSON.stringify(a));
    assert(await box.remote.sum({ to: 100 }) === 5050, "sum");
    const seen: number[] = [];
    for await (const n of box.remote.count({ to: 100 })) seen.push(n);
    assert(seen.length === 100 && seen[99] === 100, "stream " + seen.length);
    let early = 0;
    for await (const n of box.remote.count({ to: 1000 })) { if (++early === 3) break; void n; }
    assert(logs.join("").includes("a stray print"), "log not seen: " + logs.join("|"));
    const bad = await box.remote.hello({ name: 1 as unknown as string }).catch((e: SandboxError) => e.code);
    assert(bad === "invalid-argument", "schema not enforced: " + bad);
    const info = await box.stop();
    return { reason: info.reason, calls: info.usage.calls };
  });
  await check(`cpu ${k.name}: waiting is free, sync is not`, async () => {
    const box = sandbox.run({ compiledCode: compiled.get(k.name)!, apiDef, env: { who: "x" }, limits: { cpus: 1, cpuBudgetMs: 3000, cpuBurst: { ms: 100000, windowMs: 1000 } } });
    await box.ready;
    const before = (await box.usage()).cpuMs;
    await box.remote.wait({ ms: 5000 });
    await new Promise((r) => setTimeout(r, 300));
    const u = await box.usage();
    assert(u.hostWaitMs >= 4900, "hostWait " + u.hostWaitMs);
    const waited = u.cpuMs - before;
    assert(waited < 500, "wait cost " + waited);
    const spun = await box.remote.spin({ ms: 20000 }).catch((e: SandboxError) => e.code);
    const info = await box.exited;
    assert(spun === "exited" && info.reason === "cpu-budget", `${spun} ${info.reason}`);
    return { waitCpuMs: waited, killedAtCpuMs: info.usage.cpuMs };
  });
}

const sh = async (script: string) => {
  const r = await sandbox.compile({ environment: { runtime: "sh", version: "alpine" }, files: [{ path: "main.sh", content: script }], apisSchema: {}, exportsSchema: {} });
  assert(r.ok, JSON.stringify(r.diagnostics));
  return r.compiledCode;
};
const ready = `echo '{"$sbx":1,"t":"ready","protocols":[1]}'\n`;
const outcome = async (name: string, script: string, want: string, limits: any = {}) =>
  check(`attack ${name}`, async () => {
    const box = sandbox.run({ compiledCode: await sh(script), apiDef: {}, limits: { cpus: 1, ...limits } });
    const info = await box.exited;
    assert(info.reason === want, `wanted ${want}, got ${info.reason} code ${info.code}`);
    return { reason: info.reason, ms: info.durationMs, cpuMs: info.usage.cpuMs };
  });

await outcome("sync loop: rolling cpu", ready + "while :; do :; done", "cpu-burst", { cpuBurst: { ms: 1000, windowMs: 5000 } });
await outcome("total cpu budget", ready + "while :; do :; done", "cpu-budget", { cpuBudgetMs: 1500, cpuBurst: { ms: 100000, windowMs: 1000 } });
await outcome("wall", ready + "sleep 60", "wall", { wallMs: 1500 });
await outcome("idle", ready + "sleep 60", "idle", { idleMs: 1500 });
await outcome("memory bomb", ready + "x=a; while :; do x=$x$x; done", "memory", { memory: 64 << 20 });
await outcome("endless line", ready + "cat /dev/zero | tr '\\0' a", "frame-cap");
await outcome("frame flood", ready + `yes '{"$sbx":1,"t":"pull","id":9,"n":1}'`, "frame-rate");
await outcome("stdout log flood", ready + "yes spam", "frame-rate");
await outcome("stderr flood", ready + "yes eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee >&2", "log-cap", { framesPerSec: 1 << 30 });
await outcome("bad frame", ready + `echo '{"$sbx":1,"t":'; sleep 9`, "bad-frame");
await outcome("never ready", "exit 3", "crash");

await check("attack fork bomb", async () => {
  const box = sandbox.run({ compiledCode: await sh(ready + "b(){ b|b& };b; sleep 2; echo survived; sleep 30"), apiDef: {}, limits: { wallMs: 8000 } });
  const logs: string[] = [];
  const info = await box.exited;
  for await (const e of box.events()) if (e.type === "log") logs.push(e.text);
  assert(info.usage.pids <= 128, "pids " + info.usage.pids);
  return { reason: info.reason, code: info.code, peakPids: info.usage.pids, log: logs.join(" ").slice(0, 120) };
});
await check("attack start-up cannot burn CPU forever", async () => {
  const box = sandbox.run({ compiledCode: await sh("while :; do :; done"), apiDef: {}, limits: { cpus: 2 } });
  const info = await box.exited;
  assert(info.reason === "cpu-burst", info.reason);
  return { ms: info.durationMs, cpuMs: info.usage.cpuMs };
});
await check("attack disk, paths, network", async () => {
  const box = sandbox.run({
    compiledCode: await sh(ready + `dd if=/dev/zero of=/tmp/f bs=1M count=100 2>&1 | tail -1
ls -la /tmp/f | awk '{print "size", $5}'
touch /app/x 2>&1; touch /x 2>&1; cat /etc/shadow 2>&1 | head -1; id
wget -T2 -qO- http://169.254.169.254/ 2>&1 | head -1
wget -T2 -qO- http://1.1.1.1 2>&1 | head -1
exit 0`), apiDef: {},
  });
  await box.exited;
  let log = "";
  for await (const e of box.events()) if (e.type === "log") log += e.text + "\n";
  assert(log.includes("size 8388608"), "disk cap: " + log);
  assert((log.match(/Read-only|Permission denied/g) ?? []).length >= 3, "paths: " + log);
  assert((log.match(/unreachable|bad address|can't connect/gi) ?? []).length >= 2, "network: " + log);
  return { log: log.slice(0, 300) };
});
await check("host API refuses what the schema lacks", async () => {
  const box = sandbox.run({ compiledCode: await sh(ready + `echo '{"$sbx":1,"t":"call","id":1,"path":["fs","rm"],"args":[{}]}'
read reply; echo "$reply" >&2; sleep 1`), apiDef: {} });
  await box.exited;
  let log = "";
  for await (const e of box.events()) if (e.type === "log") log += e.text;
  assert(log.includes("permission-denied"), log);
  return null;
});
await check("compile: CPU counts, a compile bomb stops", async () => {
  const r = await sandbox.compile({ environment: { runtime: "go", version: "1.24" }, files: kids[4].files.map((f) => ({ ...f })), apisSchema: apis, exportsSchema, limits: { cpuBudgetMs: 500 } });
  assert(!r.ok && /CPU budget/.test(r.diagnostics[0]?.message ?? ""), JSON.stringify(r.diagnostics));
  return { cpuMs: r.usage.cpuMs, message: r.diagnostics[0].message };
});
await check("compile: type error comes back with a line", async () => {
  const r = await sandbox.compile({ environment: { runtime: "node", version: "22" }, files: [{ path: "main.ts", content: `import { host, expose } from "@panth977/sandbox/backend";\nconst n: number = await host.kv.get({ key: 1 });\nexpose({} as any);\n` }], apisSchema: apis, exportsSchema });
  assert(!r.ok && r.diagnostics[0].line === 2 && r.diagnostics[0].file === "main.ts" && r.diagnostics[0].message.length > 5, JSON.stringify(r.diagnostics));
  return r.diagnostics[0];
});
await check("compile: Go and Python errors have lines", async () => {
  const a = await sandbox.compile({ environment: { runtime: "go", version: "1.24" }, files: [{ path: "main.go", content: "package main\nfunc main() { nope() }\n" }], apisSchema: {}, exportsSchema: {} });
  assert(!a.ok && a.diagnostics[0].line === 2, JSON.stringify(a.diagnostics));
  const b = await sandbox.compile({ environment: { runtime: "python", version: "3.13" }, files: [{ path: "main.py", content: "x = 1\ndef (:\n" }], apisSchema: {}, exportsSchema: {} });
  assert(!b.ok && b.diagnostics[0].line === 2, JSON.stringify(b.diagnostics));
  return null;
});
await check("compile: unsafe paths refused", async () => {
  const r = await sandbox.compile({ environment: { runtime: "sh", version: "alpine" }, files: [{ path: "../../etc/x", content: "" }], apisSchema: {}, exportsSchema: {} });
  assert(!r.ok, "accepted");
  return null;
});
await check("run: tampered code refused", async () => {
  const c = { ...(await sh(ready)), cmd: ["sh", "-c", "evil"] };
  const box = sandbox.run({ compiledCode: c, apiDef: {} });
  const e = await box.ready.catch((x: Error) => x.message);
  assert(String(e).includes("hash"), String(e));
  return null;
});
await check("run: apiDef must cover the schema", async () => {
  const code = compiled.get("node");
  if (!code) return "skipped";
  const box = sandbox.run({ compiledCode: code, apiDef: { kv: apiDef.kv } as any });
  const e = await box.ready.catch((x: Error) => x.message);
  assert(String(e).includes("does not implement"), String(e));
  return null;
});
await check("runDev: bad update keeps old code", async () => {
  const dev = sandbox.runDev({ environment: kids[0].environment, files: [...kids[0].files], apisSchema: apis, exportsSchema, apiDef, env: { who: "dev" } });
  await dev.ready;
  const a = await dev.remote.hello({ name: "A" });
  const bad = await dev.update([{ path: "main.ts", content: "const x: number = 'no';" }]);
  assert(!bad.ok, "bad build accepted");
  const b = await dev.remote.hello({ name: "B" });
  const good = await dev.update([{ path: "main.ts", content: kids[0].files[0].content.replace('"node"', '"node2"').replace("runtime: \"node\"", "runtime: \"node2\"") }]);
  assert(good.ok, JSON.stringify(good.diagnostics));
  const c = await dev.remote.hello({ name: "C" });
  assert(c.runtime === "node2", JSON.stringify(c));
  await dev.kill();
  return { a: a.text, b: b.text, c: c.runtime };
});
await check("dependencies: npm and pip through the proxy", async () => {
  const a = await sandbox.compile({ environment: { runtime: "node", version: "22", dependencies: { ms: "2.1.3" } }, files: [{ path: "main.ts", content: `import ms from "ms";\nimport { expose } from "@panth977/sandbox/backend";\nexpose({ hello: () => ({ text: String(ms("2s")), runtime: "node" }) });\n` }], apisSchema: {}, exportsSchema: { hello: exportsSchema.hello } });
  assert(a.ok, JSON.stringify(a.diagnostics));
  const box = sandbox.run({ compiledCode: a.compiledCode, apiDef: {} });
  await box.ready;
  const r = await box.remote.hello({ name: "x" });
  await box.kill();
  assert(r.text === "2000", JSON.stringify(r));
  const b = await sandbox.compile({ environment: { runtime: "python", version: "3.13", dependencies: { "idna": "3.10" } }, files: [{ path: "main.py", content: `import idna\nfrom sandbox_api import expose\nclass A:\n    async def hello(self, *, name):\n        return {"text": idna.encode("ex.com").decode(), "runtime": "python"}\nexpose(A())\n` }], apisSchema: {}, exportsSchema: { hello: exportsSchema.hello } });
  assert(b.ok, JSON.stringify(b.diagnostics));
  const box2 = sandbox.run({ compiledCode: b.compiledCode, apiDef: {} });
  await box2.ready;
  const r2 = await box2.remote.hello({ name: "x" });
  await box2.kill();
  assert(r2.text === "ex.com", JSON.stringify(r2));
  return { npmCpu: a.usage.cpuMs, pipCpu: b.usage.cpuMs };
});
await check("network: allowlist, denied host, metadata, direct IP", async () => {
  const node = await sandbox.compile({ environment: { runtime: "node", version: "22" }, files: [{ path: "main.ts", content: `import { expose } from "@panth977/sandbox/backend";
import net from "node:net";
const connect = (host: string) => new Promise<string>((ok) => {
  const u = new URL(process.env.HTTPS_PROXY!);
  const c = net.connect(+u.port, u.hostname, () => c.write("CONNECT " + host + " HTTP/1.1\\r\\nHost: " + host + "\\r\\n\\r\\n"));
  c.setTimeout(8000, () => { c.destroy(); ok("timeout"); });
  c.once("data", (d) => { ok(String(d).split("\\r\\n")[0]); c.destroy(); });
  c.on("error", (e) => ok(String(e)));
});
const direct = () => new Promise<string>((ok) => { const c = net.connect(443, "1.1.1.1", () => { c.destroy(); ok("connected"); }); c.setTimeout(3000, () => { c.destroy(); ok("timeout"); }); c.on("error", (e) => ok("refused")); });
expose({ hello: async ({ name }) => ({ text: JSON.stringify([await connect("github.com:443"), await connect("example.com:443"), await connect("169.254.169.254:443"), await direct()]), runtime: name }) });
` }], apisSchema: {}, exportsSchema: { hello: exportsSchema.hello } });
  assert(node.ok, JSON.stringify(node.diagnostics));
  const events: any[] = [];
  const box = sandbox.run({ compiledCode: node.compiledCode, apiDef: {}, network: { allow: ["github.com"] }, onEvent: (e) => { if (e.type === "network") events.push(e); }, limits: { callMs: 20000 } });
  await box.ready;
  const r = await box.remote.hello({ name: "x" }, { timeoutMs: 20000 });
  const [allowed, denied, meta, direct] = JSON.parse(r.text);
  await new Promise((r) => setTimeout(r, 500));
  await box.kill();
  assert(allowed.includes("200"), "allowed: " + r.text);
  assert(denied.includes("403") && meta.includes("403"), "denied: " + r.text);
  assert(direct !== "connected", "direct: " + direct);
  return { r: r.text, events: events.length };
});
await check("parent kill -9: its sandbox dies", async () => {
  const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", new URL("./orphan.ts", import.meta.url).pathname], { env: { ...process.env }, stdio: ["ignore", "pipe", "inherit"] });
  const name = await new Promise<string>((ok) => child.stdout!.once("data", (d) => ok(String(d).trim())));
  child.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 2500));
  const box = (await sandbox.list()).length;
  const { execSync } = await import("node:child_process");
  const left = execSync(`docker ps -q --filter name=${name}`).toString().trim();
  assert(!left, "still running " + name);
  return { name, mine: box };
});

await sandbox.close();
const bad = results.filter((r) => !r).length;
console.log(JSON.stringify({ total: results.length, failed: bad, audited: audits.length }));
process.exit(bad ? 1 : 0);
