// Go parent check: drives a Python child through sandboxd with the Go SDK.
package main

import (
	"context"
	"fmt"
	"iter"
	"os"
	"time"

	s "github.com/Panth977/sandbox-environment/server/go/sandbox"
)

type KeyIn struct {
	Key string `json:"key"`
}
type CountIn struct {
	To int `json:"to"`
}
type NameIn struct {
	Name string `json:"name"`
}
type HelloOut struct {
	Text string `json:"text"`
}

const child = `from sandbox_api import expose, host

class App:
    async def hello(self, *, name):
        g = await host.get(key="greeting")
        total = 0
        async for n in host.numbers(to=10):
            total += n
        return {"text": f"{g} {name} {total}"}
    async def count(self, *, to):
        for i in range(to):
            yield i

expose(App())
`

func must(err error) {
	if err != nil {
		fmt.Println("FAIL:", err)
		os.Exit(1)
	}
}

func main() {
	ctx, stop := context.WithTimeout(context.Background(), 2*time.Minute)
	defer stop()
	sandbox, err := s.New(s.Options{Endpoint: os.Getenv("SANDBOXD")})
	must(err)
	defer sandbox.Close()
	apis := s.Schema{"get": s.Unary[KeyIn, string](), "numbers": s.Stream[CountIn, int]()}
	exports := s.Schema{"hello": s.Unary[NameIn, HelloOut](), "count": s.Stream[CountIn, int]()}
	apiDef := s.ApiDef{
		"get": s.Handle(func(c s.Context, in KeyIn) (string, error) { return "hello", nil }),
		"numbers": s.HandleStream(func(c s.Context, in CountIn) iter.Seq2[int, error] {
			return func(y func(int, error) bool) {
				for i := 1; i <= in.To; i++ {
					if !y(i, nil) {
						return
					}
				}
			}
		}),
	}
	r, err := sandbox.Compile(ctx, s.CompileInput{Environment: s.Environment{Runtime: "python", Version: "3.13"},
		Files: []s.File{{Path: "main.py", Content: []byte(child)}}, ApisSchema: apis, ExportsSchema: exports})
	must(err)
	if !r.OK {
		must(fmt.Errorf("%v", r.Diagnostics))
	}
	box, err := sandbox.Run(ctx, s.RunOptions{CompiledCode: r.CompiledCode, ApiDef: apiDef, Limits: s.Limits{CPUs: 0.5}})
	must(err)
	must(box.Ready(ctx))
	out, err := s.Call[HelloOut](ctx, box.Remote(), "hello", NameIn{"Panth"})
	must(err)
	if out.Text != "hello Panth 55" {
		must(fmt.Errorf("got %q", out.Text))
	}
	n := 0
	for v, err := range s.CallStream[int](ctx, box.Remote(), "count", CountIn{100}) {
		must(err)
		n += v
	}
	if n != 4950 {
		must(fmt.Errorf("stream sum %d", n))
	}
	_, err = sandbox.Run(ctx, s.RunOptions{CompiledCode: r.CompiledCode, ApiDef: s.ApiDef{"get": apiDef["get"]}})
	if err == nil {
		must(fmt.Errorf("missing handler accepted"))
	}
	bad := s.ApiDef{"get": s.Handle(func(c s.Context, in KeyIn) (int, error) { return 1, nil }), "numbers": apiDef["numbers"]}
	_, err = sandbox.Run(ctx, s.RunOptions{CompiledCode: r.CompiledCode, ApiDef: bad})
	if err == nil {
		must(fmt.Errorf("wrong handler type accepted"))
	}
	info, err := box.Kill(ctx)
	must(err)
	fmt.Println("OK go parent, python child:", out.Text, "exit", info.Reason, "calls", info.Usage.Calls)
}
