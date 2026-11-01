import { api, stream, t } from "../ts/server.ts";

export const apis = {
  kv: { get: api(t.object({ key: t.string() }), t.nullable(t.string())) },
  slow: api(t.object({ ms: t.integer() }), t.void()),
  numbers: stream(t.object({ to: t.integer({ max: 1000 }) }), t.number()),
};

export const exportsSchema = {
  hello: api(t.object({ name: t.string() }), t.object({ text: t.string(), runtime: t.string() })),
  wait: api(t.object({ ms: t.integer() }), t.boolean()),
  spin: api(t.object({ ms: t.integer() }), t.boolean()),
  sum: api(t.object({ to: t.integer() }), t.number()),
  count: stream(t.object({ to: t.integer() }), t.number()),
};

const js = (name: string) => `import { expose, host, env } from "@panth977/sandbox/backend";
expose({
  async hello({ name }) {
    const g = await host.kv.get({ key: "greeting" });
    console.log("a stray print");
    return { text: g + " " + name + " from " + env.who, runtime: "${name}" };
  },
  async wait({ ms }) { await host.slow({ ms }); return true; },
  spin({ ms }) { const e = Date.now() + ms; while (Date.now() < e); return true; },
  async sum({ to }) { let s = 0; for await (const n of host.numbers({ to })) s += n; return s; },
  async *count({ to }) { for (let i = 1; i <= to; i++) yield i; },
});
`;

const py = `import time
from sandbox_api import env, expose, host

class App:
    async def hello(self, *, name):
        g = await host.kv.get(key="greeting")
        print("a stray print")
        return {"text": f"{g} {name} from {env['who']}", "runtime": "python"}
    async def wait(self, *, ms):
        await host.slow(ms=ms)
        return True
    def spin(self, *, ms):
        e = time.time() + ms / 1000
        while time.time() < e:
            pass
        return True
    async def sum(self, *, to):
        s = 0
        async for n in host.numbers(to=to):
            s += n
        return s
    async def count(self, *, to):
        for i in range(1, to + 1):
            yield i

expose(App())
`;

const go = `package main

import (
	"context"
	"fmt"
	"iter"
	"time"

	"app/sbx"
)

type app struct{}

func (app) Hello(ctx context.Context, in sbx.HelloInput) (sbx.HelloOutput, error) {
	g, err := sbx.Host.Kv.Get(ctx, sbx.HostKvGetInput{Key: "greeting"})
	if err != nil {
		return sbx.HelloOutput{}, err
	}
	fmt.Println("a stray print")
	return sbx.HelloOutput{Text: *g + " " + in.Name + " from " + sbx.Env()["who"].(string), Runtime: "go"}, nil
}
func (app) Wait(ctx context.Context, in sbx.WaitInput) (bool, error) {
	return true, sbx.Host.Slow(ctx, sbx.HostSlowInput{Ms: in.Ms})
}
func (app) Spin(ctx context.Context, in sbx.SpinInput) (bool, error) {
	e := time.Now().Add(time.Duration(in.Ms) * time.Millisecond)
	for time.Now().Before(e) {
	}
	return true, nil
}
func (app) Sum(ctx context.Context, in sbx.SumInput) (float64, error) {
	s := 0.0
	for n, err := range sbx.Host.Numbers(ctx, sbx.HostNumbersInput{To: in.To}) {
		if err != nil {
			return 0, err
		}
		s += n
	}
	return s, nil
}
func (app) Count(ctx context.Context, in sbx.CountInput) iter.Seq2[float64, error] {
	return func(yield func(float64, error) bool) {
		for i := int64(1); i <= in.To; i++ {
			if !yield(float64(i), nil) {
				return
			}
		}
	}
}
func main() { sbx.Serve(app{}) }
`;

export const kids = [
  { name: "node", environment: { runtime: "node", version: "22" }, files: [{ path: "main.ts", content: js("node") }] },
  { name: "deno", environment: { runtime: "deno", version: "2" }, files: [{ path: "main.ts", content: js("deno") }] },
  { name: "bun", environment: { runtime: "bun", version: "1" }, files: [{ path: "main.ts", content: js("bun") }] },
  { name: "python", environment: { runtime: "python", version: "3.13" }, files: [{ path: "main.py", content: py }] },
  { name: "go", environment: { runtime: "go", version: "1.24" }, files: [{ path: "main.go", content: go }] },
] as const;
