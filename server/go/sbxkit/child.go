package sbxkit

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"iter"
	"os"
	"sync"
)

var (
	outMu    sync.Mutex
	unaries  = map[string]UnaryFn{}
	streams  = map[string]StreamFn{}
	child    *Peer
	childOne sync.Once
)

func peer() *Peer {
	childOne.Do(func() {
		child = NewPeer(func(f Frame) {
			b, err := json.Marshal(f)
			if err != nil {
				return
			}
			outMu.Lock()
			defer outMu.Unlock()
			fmt.Fprintf(os.Stdout, "\n%s\n", b)
		}, func(path string) (UnaryFn, StreamFn) { return unaries[path], streams[path] })
	})
	return child
}

// Call invokes a host API.
func Call[O any](ctx context.Context, path string, in any) (O, error) {
	var out O
	raw, err := peer().Call(ctx, path, in)
	if err != nil {
		return out, err
	}
	return out, json.Unmarshal(raw, &out)
}

// Stream invokes a streaming host API.
func Stream[O any](ctx context.Context, path string, in any) iter.Seq2[O, error] {
	return func(yield func(O, error) bool) {
		for raw, err := range peer().Stream(ctx, path, in) {
			var v O
			if err == nil {
				err = json.Unmarshal(raw, &v)
			}
			if !yield(v, err) || err != nil {
				return
			}
		}
	}
}

func decode[I any](raw json.RawMessage) (I, error) {
	var in I
	if len(raw) == 0 || string(raw) == "null" {
		return in, nil
	}
	return in, json.Unmarshal(raw, &in)
}

// Handle registers one export.
func Handle[I, O any](path string, fn func(context.Context, I) (O, error)) {
	unaries[path] = func(ctx context.Context, raw json.RawMessage) (any, error) {
		in, err := decode[I](raw)
		if err != nil {
			return nil, err
		}
		return fn(ctx, in)
	}
}

// HandleStream registers one streaming export.
func HandleStream[I, O any](path string, fn func(context.Context, I) iter.Seq2[O, error]) {
	streams[path] = func(ctx context.Context, raw json.RawMessage, emit func(any) error) error {
		in, err := decode[I](raw)
		if err != nil {
			return err
		}
		for v, err := range fn(ctx, in) {
			if err != nil {
				return err
			}
			if err := emit(v); err != nil {
				return err
			}
		}
		return nil
	}
}

// Serve reads frames until the parent closes the sandbox.
func Serve() error {
	p := peer()
	p.send(Frame{Sbx: 1, T: "ready", Protocols: []int{1}})
	s := bufio.NewScanner(os.Stdin)
	s.Buffer(make([]byte, 64*1024), 64<<20)
	for s.Scan() {
		var f Frame
		if len(s.Bytes()) > 0 && json.Unmarshal(s.Bytes(), &f) == nil {
			p.Receive(f)
		}
	}
	return s.Err()
}

// Env is what the parent passed as env.
func Env() map[string]any {
	m := map[string]any{}
	json.Unmarshal([]byte(os.Getenv("SBX_ENV")), &m)
	return m
}
