// Helper of the parent-crash check: starts a spinning sandbox, prints its name, waits to be killed.
import { createSandbox } from "../ts/server.ts";

const sandbox = createSandbox({ endpoint: process.env.SANDBOXD ?? "unix:///run/sandboxd.sock" });
const r = await sandbox.compile({ environment: { runtime: "sh", version: "alpine" }, files: [{ path: "main.sh", content: `echo '{"$sbx":1,"t":"ready","protocols":[1]}'\nwhile :; do :; done` }], apisSchema: {}, exportsSchema: {} });
if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
const box = sandbox.run({ compiledCode: r.compiledCode, apiDef: {}, limits: { cpuBurst: { ms: 100000, windowMs: 1000 } } });
await box.ready;
console.log(box.id);
await new Promise(() => {});
