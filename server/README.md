# Backend sandbox

Let anyone write a small backend (handlers, webhooks, listeners) in Node, Deno, Bun, Python, Go or plain shell, and run it from your Node, Deno, Bun or Go app under hard limits. It is the backend twin of the browser kit: your app exposes typed APIs, the code calls them, and it never holds your tokens.

```
your app (Node, Deno, Bun, Go)         worker machine: no secrets, no private network
  SDK  ---- unix socket or TLS ---->   sandboxd
  apiDef <-- host API calls --------     limits, caps, schema checks, compiler, sweeper
                                          | stdin/stdout, one JSON message per line
                                          v
                                       docker run --runtime=runsc
                                          your user's code
```

`sandboxd` owns Docker, so your app never holds that power. Every limit lives there, once, for every language.

## Use

```ts
import { api, createSandbox, stream, t, type ApiDef } from "@panth977/sandbox/server/node"; // or /server/deno

const sandbox = createSandbox({ endpoint: "unix:///run/sandboxd.sock" });

const apisSchema = {                       // what the code may call
  devices: {
    list: api(t.object({ org: t.string() }), t.array(t.string())),   // promise
    readings: stream(t.object({ id: t.string() }), t.number()),      // stream
  },
};
const exportsSchema = {                    // what you may call in the code
  onWebhook: api(t.object({ id: t.string() }), t.object({ handled: t.boolean() })),
};
const environment = { runtime: "python", version: "3.13" } as const;
const files = [{ path: "main.py", content: source }];

const apiDef: ApiDef<typeof apisSchema> = {
  devices: {
    list: ({ org }) => db.devices(org),
    readings: async function* ({ id }) { yield* db.readings(id); },
  },
};

const { ok, compiledCode, diagnostics } = await sandbox.compile({ environment, files, apisSchema, exportsSchema });
if (!ok) throw new Error(diagnostics[0].message);

const instance = sandbox.run({ compiledCode, apiDef, limits: { memory: 128 << 20 }, network: { allow: ["api.open-meteo.com"] } });
await instance.ready;
await instance.remote.onWebhook({ id: "d1" });
```

`sandbox.runDev({ environment, files, apisSchema, apiDef })` compiles and runs, and `update(files)` rebuilds. A failed build keeps the old code running.

The code, in Python:

```python
from sandbox_api import expose, host

class App:
    async def on_webhook(self, *, id):
        devices = await host.devices.list(org="o7")
        return {"handled": id in devices}

expose(App())
```

In Node, Deno and Bun, `import { expose, host, env } from "@panth977/sandbox/backend"`. In Go, `import "app/sbx"` and `sbx.Serve(app{})`; names come from the path, such as `sbx.HostDevicesListInput` and `sbx.OnWebhookInput`. `print` and `console.log` are safe: lines that are not protocol frames become log events.

A Go parent uses the same model: see `go/sandbox` and `go/e2eparent/main.go`.

## Limits

CPU limits count CPU time, read from the kernel. Waiting on `await`, a sleep or a host API uses almost none, so waiting is free in every language.

| Limit | Default | Counts waiting | On breach |
| --- | --- | --- | --- |
| `cpus` | 0.5 | no | slowed, not killed |
| `cpuBurst` | 2 s per 10 s, from `ready` on (15 s CPU cap before it) | no | `cpu-burst` |
| `cpuBudgetMs` | none (60 s in `runDev`) | no | `cpu-budget` |
| `wallMs` | 300 s | yes | `wall` |
| `idleMs` | none | yes | `idle` |
| `callMs` | 30 s | yes | `call-deadline` for parent calls; `deadline` error for host calls |
| `memory` | 128 MiB | held | `memory` |
| `pids` | 128 | held | `pids`: under gVisor the whole sandbox ends, with no output |
| `disk` | 8 MiB | held | write fails |
| `frameBytes` | 1 MiB | | `frame-cap` |
| `framesPerSec` | 2000 | | `frame-rate` |
| `logBytes` | 16 MiB | | `log-cap` |
| `concurrency` | 64 | | call fails with `quota` |
| `network.allow` | none | | connection refused |
| `network.bytes` | 64 MiB | | `network-cap` |

A zero or negative value means the default: no limit can be turned off. `createSandbox({ limits })` lowers the ceiling for every run on that client, and `sandboxd` has its own ceiling above that.

`compile` is limited too, because install scripts and compilers are code the user controls. Typecheck, install and build share 2 cores, 180 s of CPU, 300 s wall, 1 GiB memory and 512 MiB disk by default. Pass `limits` to change them. CPU used comes back as `usage`.

## Run sandboxd

Linux with Docker and [gVisor](https://gvisor.dev/docs/user_guide/install/):

```sh
cd server/go && CGO_ENABLED=0 go build -o sandboxd ./cmd/sandboxd
sudo ./sandboxd --socket /run/sandboxd.sock --data-dir /var/lib/sandboxd
```

The Docker daemon needs `{"runtimes": {"runsc": {"path": "/usr/local/bin/runsc"}}}`. `sandboxd` refuses any other runtime unless you pass `--unsafe-no-gvisor`, which is for local development only. Remote parents: `--tls-addr :7443 --tls-cert c.pem --tls-key k.pem` with `SANDBOXD_TOKEN` set.

## Safety

- Run it on a dedicated machine with no secrets and no route to private networks. Never on the server of your app.
- Patch gVisor and Docker automatically. Both have had serious bugs.
- Docker access is root, so only `sandboxd` gets it, and the socket is mode 600.
- Open-internet use needs the Firecracker driver and an outside security test first. Today's design suits invited users.

## Test

```sh
deno task server:test                          # Go unit tests
SANDBOXD=unix:///run/sandboxd.sock deno task server:e2e   # live, all runtimes and attacks
SANDBOXD=unix:///run/sandboxd.sock go run ./server/go/e2eparent
```
