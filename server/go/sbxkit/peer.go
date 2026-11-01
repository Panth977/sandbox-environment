// Package sbxkit is the process bridge in Go: the parent SDK uses Peer, and sandboxd
// copies this package into Go builds, where the generated sbx package calls it.
package sbxkit

import (
	"context"
	"encoding/json"
	"errors"
	"iter"
	"strings"
	"sync"
)

const credit = 16

// Error is a remote failure.
type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

// Frame is one protocol message.
type Frame struct {
	Sbx       int               `json:"$sbx"`
	T         string            `json:"t"`
	ID        int64             `json:"id,omitempty"`
	Path      []string          `json:"path,omitempty"`
	Args      []json.RawMessage `json:"args,omitempty"`
	V         json.RawMessage   `json:"v,omitempty"`
	N         int64             `json:"n,omitempty"`
	E         *Error            `json:"e,omitempty"`
	Protocols []int             `json:"protocols,omitempty"`
}

// UnaryFn answers one call. StreamFn emits items until done.
type UnaryFn func(ctx context.Context, in json.RawMessage) (any, error)
type StreamFn func(ctx context.Context, in json.RawMessage, emit func(any) error) error

// Lookup finds the handler of a path; exactly one return is non-nil.
type Lookup func(path string) (UnaryFn, StreamFn)

type result struct {
	v    json.RawMessage
	err  error
	done bool
}

type serving struct {
	cancel context.CancelFunc
	mu     sync.Mutex
	cond   *sync.Cond
	credit int64
	off    bool
}

// Peer is one side of the bridge.
type Peer struct {
	send   func(Frame)
	lookup Lookup
	mu     sync.Mutex
	next   int64
	out    map[int64]chan result
	in     map[int64]*serving
}

// NewPeer builds a peer. send must be safe for concurrent use.
func NewPeer(send func(Frame), lookup Lookup) *Peer {
	return &Peer{send: send, lookup: lookup, next: 1, out: map[int64]chan result{}, in: map[int64]*serving{}}
}

func (p *Peer) begin(buffer int) (int64, chan result) {
	p.mu.Lock()
	defer p.mu.Unlock()
	id := p.next
	p.next++
	ch := make(chan result, buffer)
	p.out[id] = ch
	return id, ch
}

func (p *Peer) drop(id int64) {
	p.mu.Lock()
	delete(p.out, id)
	p.mu.Unlock()
}

func callFrame(id int64, path string, in any) (Frame, error) {
	b, err := json.Marshal(in)
	if err != nil {
		return Frame{}, err
	}
	return Frame{Sbx: 1, T: "call", ID: id, Path: strings.Split(path, "."), Args: []json.RawMessage{b}}, nil
}

// Call makes one unary call.
func (p *Peer) Call(ctx context.Context, path string, in any) (json.RawMessage, error) {
	id, ch := p.begin(1)
	f, err := callFrame(id, path, in)
	if err != nil {
		p.drop(id)
		return nil, err
	}
	p.send(f)
	select {
	case r := <-ch:
		p.drop(id)
		return r.v, r.err
	case <-ctx.Done():
		p.drop(id)
		p.send(Frame{Sbx: 1, T: "cancel", ID: id})
		return nil, ctx.Err()
	}
}

// Stream makes one streaming call.
func (p *Peer) Stream(ctx context.Context, path string, in any) iter.Seq2[json.RawMessage, error] {
	return func(yield func(json.RawMessage, error) bool) {
		id, ch := p.begin(credit * 2)
		defer p.drop(id)
		f, err := callFrame(id, path, in)
		if err != nil {
			yield(nil, err)
			return
		}
		p.send(f)
		seen := int64(0)
		for {
			select {
			case r := <-ch:
				if r.err != nil {
					yield(nil, r.err)
					return
				}
				if r.done {
					return
				}
				if seen++; seen >= credit/2 {
					p.send(Frame{Sbx: 1, T: "pull", ID: id, N: seen})
					seen = 0
				}
				if !yield(r.v, nil) {
					p.send(Frame{Sbx: 1, T: "cancel", ID: id})
					return
				}
			case <-ctx.Done():
				p.send(Frame{Sbx: 1, T: "cancel", ID: id})
				yield(nil, ctx.Err())
				return
			}
		}
	}
}

func toError(err error) *Error {
	var e *Error
	if errors.As(err, &e) {
		return e
	}
	return &Error{Code: "internal", Message: err.Error()}
}

func (p *Peer) serve(f Frame) {
	path := strings.Join(f.Path, ".")
	unary, stream := p.lookup(path)
	if unary == nil && stream == nil {
		p.send(Frame{Sbx: 1, T: "err", ID: f.ID, E: &Error{"not-found", "no handler: " + path}})
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s := &serving{cancel: cancel, credit: credit}
	s.cond = sync.NewCond(&s.mu)
	p.mu.Lock()
	p.in[f.ID] = s
	p.mu.Unlock()
	go func() {
		defer func() {
			cancel()
			p.mu.Lock()
			delete(p.in, f.ID)
			p.mu.Unlock()
		}()
		var in json.RawMessage
		if len(f.Args) > 0 {
			in = f.Args[0]
		}
		if unary != nil {
			v, err := unary(ctx, in)
			if ctx.Err() != nil {
				return
			}
			if err != nil {
				p.send(Frame{Sbx: 1, T: "err", ID: f.ID, E: toError(err)})
				return
			}
			b, err := json.Marshal(v)
			if err != nil {
				p.send(Frame{Sbx: 1, T: "err", ID: f.ID, E: toError(err)})
				return
			}
			p.send(Frame{Sbx: 1, T: "ok", ID: f.ID, V: b})
			return
		}
		err := stream(ctx, in, func(v any) error {
			s.mu.Lock()
			for s.credit <= 0 && !s.off {
				s.cond.Wait()
			}
			off := s.off
			s.credit--
			s.mu.Unlock()
			if off {
				return context.Canceled
			}
			b, err := json.Marshal(v)
			if err != nil {
				return err
			}
			p.send(Frame{Sbx: 1, T: "next", ID: f.ID, V: b})
			return nil
		})
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			p.send(Frame{Sbx: 1, T: "err", ID: f.ID, E: toError(err)})
			return
		}
		p.send(Frame{Sbx: 1, T: "end", ID: f.ID})
	}()
}

// Receive feeds one frame from the other side.
func (p *Peer) Receive(f Frame) {
	switch f.T {
	case "call":
		p.serve(f)
	case "ok", "next", "end", "err":
		p.mu.Lock()
		ch := p.out[f.ID]
		p.mu.Unlock()
		if ch == nil {
			return
		}
		r := result{v: f.V}
		if f.T == "end" {
			r.done = true
		}
		if f.E != nil {
			r.err = f.E
		}
		ch <- r
	case "pull", "cancel":
		p.mu.Lock()
		s := p.in[f.ID]
		p.mu.Unlock()
		if s == nil {
			return
		}
		s.mu.Lock()
		if f.T == "pull" {
			s.credit += f.N
		} else {
			s.off = true
			s.cancel()
		}
		s.cond.Broadcast()
		s.mu.Unlock()
	}
}

// CloseAll fails every call in flight: the other side is gone.
func (p *Peer) CloseAll(err error) {
	p.mu.Lock()
	out := p.out
	p.out = map[int64]chan result{}
	in := p.in
	p.mu.Unlock()
	for _, ch := range out {
		select {
		case ch <- result{err: err}:
		default:
		}
	}
	for _, s := range in {
		s.mu.Lock()
		s.off = true
		s.cancel()
		s.cond.Broadcast()
		s.mu.Unlock()
	}
}
