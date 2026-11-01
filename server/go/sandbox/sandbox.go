// Package sandbox is the Go parent adapter of the backend sandbox: same model and same
// wire as the TypeScript one. Schemas come from Go types.
package sandbox

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"iter"
	"net"
	"net/url"
	"reflect"
	"strings"
	"sync"
	"time"

	"github.com/Panth977/sandbox-environment/server/go/internal/wire"
	"github.com/Panth977/sandbox-environment/server/go/sbxkit"
)

// Error is a remote failure; switch on Code.
type Error = sbxkit.Error

// ApiMeta holds per-API rules. sandboxd enforces them.
type ApiMeta struct {
	Description string
	Timeout     time.Duration
	PerSecond   float64
	Burst       float64
}

// Spec is one API in a schema.
type Spec struct {
	kind string
	in   reflect.Type
	out  reflect.Type
	meta ApiMeta
}

func first(m []ApiMeta) ApiMeta {
	if len(m) > 0 {
		return m[0]
	}
	return ApiMeta{}
}

// Void is the input or output of an API with none.
type Void struct{}

// Unary is one request, one reply.
func Unary[I, O any](meta ...ApiMeta) Spec {
	return Spec{"unary", reflect.TypeFor[I](), reflect.TypeFor[O](), first(meta)}
}

// Stream is one request, many items.
func Stream[I, O any](meta ...ApiMeta) Spec {
	return Spec{"stream", reflect.TypeFor[I](), reflect.TypeFor[O](), first(meta)}
}

// Schema maps a dotted path ("devices.list") to a Spec.
type Schema map[string]Spec

func schemaOf(t reflect.Type) map[string]any {
	if t == reflect.TypeFor[Void]() {
		return map[string]any{"type": "null"}
	}
	if t == reflect.TypeFor[time.Time]() {
		return map[string]any{"type": "string", "format": "date-time"}
	}
	switch t.Kind() {
	case reflect.Pointer:
		return map[string]any{"anyOf": []any{schemaOf(t.Elem()), map[string]any{"type": "null"}}}
	case reflect.String:
		return map[string]any{"type": "string"}
	case reflect.Bool:
		return map[string]any{"type": "boolean"}
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64, reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return map[string]any{"type": "integer"}
	case reflect.Float32, reflect.Float64:
		return map[string]any{"type": "number"}
	case reflect.Slice, reflect.Array:
		if t.Elem().Kind() == reflect.Uint8 {
			return map[string]any{"type": "string", "format": "byte"}
		}
		return map[string]any{"type": "array", "items": schemaOf(t.Elem())}
	case reflect.Map:
		return map[string]any{"type": "object", "additionalProperties": schemaOf(t.Elem())}
	case reflect.Struct:
		props, req := map[string]any{}, []string{}
		for i := range t.NumField() {
			f := t.Field(i)
			if !f.IsExported() {
				continue
			}
			name, opts, _ := strings.Cut(f.Tag.Get("json"), ",")
			if name == "-" {
				continue
			}
			if name == "" {
				name = f.Name
			}
			ft := f.Type
			if !strings.Contains(opts, "omitempty") && ft.Kind() != reflect.Pointer {
				req = append(req, name)
			} else if ft.Kind() == reflect.Pointer {
				ft = ft.Elem()
			}
			props[name] = schemaOf(ft)
		}
		return map[string]any{"type": "object", "properties": props, "required": req}
	}
	return map[string]any{}
}

func raw(v any) json.RawMessage { b, _ := json.Marshal(v); return b }

func (s Schema) wire() wire.Schema {
	out := wire.Schema{}
	for p, sp := range s {
		a := wire.ApiSpec{Kind: sp.kind, Input: raw(schemaOf(sp.in)), Description: sp.meta.Description, TimeoutMs: sp.meta.Timeout.Milliseconds()}
		if sp.kind == "unary" {
			a.Output = raw(schemaOf(sp.out))
		} else {
			a.Item = raw(schemaOf(sp.out))
		}
		if sp.meta.PerSecond > 0 {
			a.RateLimit = &wire.RateLimit{PerSecond: sp.meta.PerSecond, Burst: sp.meta.Burst}
		}
		out[p] = a
	}
	return out
}

// Context is handed to each implementation; cancelled on caller cancel, deadline or sandbox exit.
type Context struct {
	context.Context
	InstanceID string
	Path       string
}

// Handler is one implementation. Build it with Handle or HandleStream.
type Handler struct {
	in, out reflect.Type
	unary   func(Context, json.RawMessage) (any, error)
	stream  func(Context, json.RawMessage, func(any) error) error
}

func decode[I any](b json.RawMessage) (I, error) {
	var in I
	if len(b) == 0 || string(b) == "null" {
		return in, nil
	}
	err := json.Unmarshal(b, &in)
	return in, err
}

// Handle implements a Unary API.
func Handle[I, O any](fn func(ctx Context, in I) (O, error)) Handler {
	return Handler{in: reflect.TypeFor[I](), out: reflect.TypeFor[O](), unary: func(c Context, b json.RawMessage) (any, error) {
		in, err := decode[I](b)
		if err != nil {
			return nil, err
		}
		return fn(c, in)
	}}
}

// HandleStream implements a Stream API.
func HandleStream[I, O any](fn func(ctx Context, in I) iter.Seq2[O, error]) Handler {
	return Handler{in: reflect.TypeFor[I](), out: reflect.TypeFor[O](), stream: func(c Context, b json.RawMessage, emit func(any) error) error {
		in, err := decode[I](b)
		if err != nil {
			return err
		}
		for v, err := range fn(c, in) {
			if err != nil {
				return err
			}
			if err := emit(v); err != nil {
				return err
			}
		}
		return nil
	}}
}

// ApiDef maps each path in the schema to its Handler.
type ApiDef map[string]Handler

// File is one source file.
type File struct {
	Path    string
	Content []byte
}

// Environment says what the code runs on.
type Environment struct {
	Runtime      string // "node" | "deno" | "bun" | "python" | "go" | "sh"
	Version      string
	Dependencies map[string]string
	Entry        string
}

// CompileLimits bound one compile. Zero means the default.
type CompileLimits struct {
	CPUs            float64
	CPUBudget, Wall time.Duration
	Memory, Disk    int64
	Pids            int64
}

// CompileInput is what Compile takes.
type CompileInput struct {
	Environment   Environment
	Files         []File
	ApisSchema    Schema
	ExportsSchema Schema
	Limits        CompileLimits
}

// Diagnostic is one compile problem.
type Diagnostic = wire.Diagnostic

// CompiledCode is plain JSON, the same format every adapter reads.
type CompiledCode = json.RawMessage

// CompileResult is what Compile returns. Bad user code is a result, not an error.
type CompileResult struct {
	OK           bool
	CompiledCode CompiledCode
	Diagnostics  []Diagnostic
	Usage        Usage
}

// CPUBurst allows CPU time in any rolling Window.
type CPUBurst struct{ CPU, Window time.Duration }

// Limits are the fail-safes of a run. Zero means the safe default; none can be turned off.
type Limits struct {
	CPUs                        float64
	CPUBurst                    CPUBurst
	CPUBudget, Wall, Idle, Call time.Duration
	Memory, Disk, FrameBytes    int64
	LogBytes                    int64
	Pids, FramesPerSec          int64
	Concurrency                 int64
}

func (l Limits) wire() *wire.Limits {
	w := &wire.Limits{CPUs: l.CPUs, CPUBudgetMs: l.CPUBudget.Milliseconds(), WallMs: l.Wall.Milliseconds(), IdleMs: l.Idle.Milliseconds(),
		CallMs: l.Call.Milliseconds(), Memory: l.Memory, Disk: l.Disk, FrameBytes: l.FrameBytes, LogBytes: l.LogBytes, Pids: l.Pids,
		FramesPerSec: l.FramesPerSec, Concurrency: l.Concurrency}
	if l.CPUBurst.CPU > 0 {
		w.CPUBurst = &wire.CPUBurst{Ms: l.CPUBurst.CPU.Milliseconds(), WindowMs: l.CPUBurst.Window.Milliseconds()}
	}
	return w
}

// Network is the egress policy. Empty Allow means no network at all.
type Network struct {
	Allow []string
	Bytes int64
}

type (
	// Usage is what a sandbox consumed.
	Usage = wire.Usage
	// ExitInfo says how a sandbox ended.
	ExitInfo = wire.ExitInfo
	// Event is one entry of the live monitor stream.
	Event = wire.Event
)

// Exit reasons of ExitInfo.
const (
	ExitNormal    = "exit"
	ExitCrash     = "crash"
	ExitCPUBudget = "cpu-budget"
	ExitCPUBurst  = "cpu-burst"
	ExitWall      = "wall"
	ExitIdle      = "idle"
	ExitMemory    = "memory"
	ExitPids      = "pids"
)

// Middleware wraps host API calls.
type Middleware func(ctx Context, in json.RawMessage, next func() (any, error)) (any, error)

// RunOptions starts stored code.
type RunOptions struct {
	CompiledCode CompiledCode
	ApiDef       ApiDef
	Limits       Limits
	Network      Network
	Env          map[string]any
	Middleware   []Middleware
	OnEvent      func(Event)
}

// DevOptions is compile plus run.
type DevOptions struct {
	CompileInput
	ApiDef     ApiDef
	Limits     Limits
	Network    Network
	Env        map[string]any
	Middleware []Middleware
	OnEvent    func(Event)
}

// Instance is one running sandbox.
type Instance interface {
	ID() string
	Ready(ctx context.Context) error
	Exited() <-chan ExitInfo
	Usage(ctx context.Context) (Usage, error)
	Stop(ctx context.Context, grace time.Duration) (ExitInfo, error)
	Kill(ctx context.Context) (ExitInfo, error)
	Remote() Remote
}

// DevInstance rebuilds on Update. A failed build keeps the old code running.
type DevInstance interface {
	Instance
	Update(ctx context.Context, files []File) (ok bool, d []Diagnostic, err error)
}

// Remote is what Call and CallStream use.
type Remote interface {
	peer() *sbxkit.Peer
}

// Call invokes a Unary API the sandbox exported.
func Call[O, I any](ctx context.Context, r Remote, path string, in I) (O, error) {
	var out O
	b, err := r.peer().Call(ctx, path, in)
	if err != nil {
		return out, err
	}
	return out, json.Unmarshal(b, &out)
}

// CallStream invokes a Stream API the sandbox exported.
func CallStream[O, I any](ctx context.Context, r Remote, path string, in I) iter.Seq2[O, error] {
	return func(yield func(O, error) bool) {
		for b, err := range r.peer().Stream(ctx, path, in) {
			var v O
			if err == nil {
				err = json.Unmarshal(b, &v)
			}
			if !yield(v, err) || err != nil {
				return
			}
		}
	}
}

// Sandbox is a connection to sandboxd.
type Sandbox interface {
	Compile(ctx context.Context, in CompileInput) (CompileResult, error)
	RunDev(ctx context.Context, o DevOptions) (DevInstance, error)
	Run(ctx context.Context, o RunOptions) (Instance, error)
	Close() error
}

// Options connects to sandboxd. Endpoint: unix:///run/sandboxd.sock or tls://host:port.
type Options struct {
	Endpoint, Token string
	Limits          Limits
	TLS             *tls.Config
}

type link struct {
	c      net.Conn
	wmu    sync.Mutex
	mu     sync.Mutex
	rid    int64
	seq    int64
	waits  map[int64]chan wire.Msg
	routes map[string]*instance
	closed error
}

// New connects. When this process dies, its sandboxes die too.
func New(o Options) (Sandbox, error) {
	u, err := url.Parse(o.Endpoint)
	if err != nil {
		return nil, err
	}
	var c net.Conn
	switch u.Scheme {
	case "unix":
		c, err = net.Dial("unix", u.Path)
	case "tls":
		c, err = tls.Dial("tcp", u.Host, o.TLS)
	default:
		err = fmt.Errorf("endpoint must be unix:// or tls://")
	}
	if err != nil {
		return nil, err
	}
	l := &link{c: c, waits: map[int64]chan wire.Msg{}, routes: map[string]*instance{}}
	go l.read()
	if _, err := l.request(context.Background(), wire.Msg{Op: "hello", Token: o.Token, Limits: o.Limits.wire()}); err != nil {
		c.Close()
		return nil, err
	}
	return l, nil
}

func (l *link) read() {
	s := bufio.NewScanner(l.c)
	s.Buffer(make([]byte, 64*1024), 256<<20)
	for s.Scan() {
		var m wire.Msg
		if json.Unmarshal(s.Bytes(), &m) != nil {
			continue
		}
		if m.Op == "reply" {
			l.mu.Lock()
			ch := l.waits[m.Rid]
			delete(l.waits, m.Rid)
			l.mu.Unlock()
			if ch != nil {
				ch <- m
			}
			continue
		}
		l.mu.Lock()
		in := l.routes[m.ID]
		l.mu.Unlock()
		if in != nil {
			in.route(m)
		}
	}
	err := errors.New("sandboxd connection closed")
	l.mu.Lock()
	l.closed = err
	waits, routes := l.waits, l.routes
	l.waits, l.routes = map[int64]chan wire.Msg{}, map[string]*instance{}
	l.mu.Unlock()
	for _, ch := range waits {
		ch <- wire.Msg{Error: err.Error()}
	}
	for _, in := range routes {
		in.finish(ExitInfo{Reason: ExitCrash})
	}
}

func (l *link) send(m wire.Msg) error {
	b, err := json.Marshal(m)
	if err != nil {
		return err
	}
	l.wmu.Lock()
	defer l.wmu.Unlock()
	_, err = l.c.Write(append(b, '\n'))
	return err
}

func (l *link) request(ctx context.Context, m wire.Msg) (json.RawMessage, error) {
	ch := make(chan wire.Msg, 1)
	l.mu.Lock()
	if l.closed != nil {
		l.mu.Unlock()
		return nil, l.closed
	}
	l.rid++
	m.Rid = l.rid
	l.waits[m.Rid] = ch
	l.mu.Unlock()
	if err := l.send(m); err != nil {
		return nil, err
	}
	select {
	case r := <-ch:
		if r.Error != "" {
			return nil, &Error{Code: "unavailable", Message: r.Error}
		}
		return r.Result, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (l *link) Close() error { return l.c.Close() }

func (l *link) Compile(ctx context.Context, in CompileInput) (CompileResult, error) {
	files := make([]wire.File, len(in.Files))
	for i, f := range in.Files {
		files[i] = wire.File{Path: f.Path, Content: base64.StdEncoding.EncodeToString(f.Content), Encoding: "base64"}
	}
	w := wire.CompileInput{Files: files, ApisSchema: in.ApisSchema.wire(), ExportsSchema: in.ExportsSchema.wire(),
		Environment: wire.Environment{Runtime: in.Environment.Runtime, Version: in.Environment.Version, Dependencies: in.Environment.Dependencies, Entry: in.Environment.Entry},
		Limits:      &wire.Limits{CPUs: in.Limits.CPUs, CPUBudgetMs: in.Limits.CPUBudget.Milliseconds(), WallMs: in.Limits.Wall.Milliseconds(), Memory: in.Limits.Memory, Disk: in.Limits.Disk, Pids: in.Limits.Pids}}
	b, err := l.request(ctx, wire.Msg{Op: "compile", Compile: &w})
	if err != nil {
		return CompileResult{}, err
	}
	var r struct {
		OK           bool            `json:"ok"`
		CompiledCode json.RawMessage `json:"compiledCode"`
		Diagnostics  []Diagnostic    `json:"diagnostics"`
		Usage        Usage           `json:"usage"`
	}
	if err := json.Unmarshal(b, &r); err != nil {
		return CompileResult{}, err
	}
	return CompileResult{r.OK, r.CompiledCode, r.Diagnostics, r.Usage}, nil
}

type instance struct {
	l       *link
	id      string
	ref     string
	opts    RunOptions
	p       *sbxkit.Peer
	apis    wire.Schema
	ready   chan struct{}
	exit    chan ExitInfo
	last    ExitInfo
	once    sync.Once
	rdyOnce sync.Once
	gone    chan struct{}
}

func (in *instance) ID() string              { return in.id }
func (in *instance) Remote() Remote          { return in }
func (in *instance) peer() *sbxkit.Peer      { return in.p }
func (in *instance) Exited() <-chan ExitInfo { return in.exit }

func (in *instance) Ready(ctx context.Context) error {
	select {
	case <-in.ready:
		return nil
	case <-in.gone:
		return &Error{Code: "exited", Message: "sandbox ended before it was ready: " + in.last.Reason}
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (in *instance) route(m wire.Msg) {
	switch m.Op {
	case "frame":
		var f sbxkit.Frame
		if json.Unmarshal(m.M, &f) == nil {
			in.p.Receive(f)
		}
	case "event":
		if in.opts.OnEvent != nil {
			in.opts.OnEvent(*m.Event)
		}
		if m.Event.Type == "ready" {
			in.rdyOnce.Do(func() { close(in.ready) })
		}
		if m.Event.Type == "exit" {
			in.finish(*m.Event.Info)
		}
	}
}

func (in *instance) finish(i ExitInfo) {
	in.once.Do(func() {
		in.last = i
		in.p.CloseAll(&Error{Code: "exited", Message: "sandbox ended: " + i.Reason})
		close(in.gone)
		in.exit <- i
		close(in.exit)
		in.l.mu.Lock()
		delete(in.l.routes, in.ref)
		in.l.mu.Unlock()
	})
}

func (in *instance) Usage(ctx context.Context) (Usage, error) {
	var u Usage
	b, err := in.l.request(ctx, wire.Msg{Op: "usage", ID: in.ref})
	if err != nil {
		return u, err
	}
	return u, json.Unmarshal(b, &u)
}

func (in *instance) await(ctx context.Context) (ExitInfo, error) {
	select {
	case <-in.gone:
		return in.last, nil
	case <-ctx.Done():
		return ExitInfo{}, ctx.Err()
	}
}

func (in *instance) Stop(ctx context.Context, grace time.Duration) (ExitInfo, error) {
	in.l.send(wire.Msg{Op: "stop", ID: in.ref, GraceMs: grace.Milliseconds()})
	return in.await(ctx)
}

func (in *instance) Kill(ctx context.Context) (ExitInfo, error) {
	in.l.send(wire.Msg{Op: "kill", ID: in.ref})
	return in.await(ctx)
}

func (in *instance) lookup(path string) (sbxkit.UnaryFn, sbxkit.StreamFn) {
	h, ok := in.opts.ApiDef[path]
	if !ok {
		return nil, nil
	}
	cx := func(ctx context.Context) Context { return Context{ctx, in.id, path} }
	chain := func(ctx Context, b json.RawMessage, last func() (any, error)) (any, error) {
		next := last
		for i := len(in.opts.Middleware) - 1; i >= 0; i-- {
			m, n := in.opts.Middleware[i], next
			next = func() (any, error) { return m(ctx, b, n) }
		}
		return next()
	}
	if h.unary != nil {
		return func(ctx context.Context, b json.RawMessage) (any, error) {
			c := cx(ctx)
			return chain(c, b, func() (any, error) { return h.unary(c, b) })
		}, nil
	}
	return nil, func(ctx context.Context, b json.RawMessage, emit func(any) error) error {
		c := cx(ctx)
		_, err := chain(c, b, func() (any, error) { return nil, h.stream(c, b, emit) })
		return err
	}
}

func (l *link) Run(ctx context.Context, o RunOptions) (Instance, error) {
	var code wire.CompiledCode
	if err := json.Unmarshal(o.CompiledCode, &code); err != nil {
		return nil, err
	}
	for p := range code.ApisSchema {
		h, ok := o.ApiDef[p]
		if !ok {
			return nil, &Error{Code: "invalid-argument", Message: "ApiDef does not implement " + p}
		}
		spec := code.ApisSchema[p]
		if (spec.Kind == "stream") != (h.stream != nil) {
			return nil, &Error{Code: "invalid-argument", Message: "ApiDef kind mismatch at " + p}
		}
		if err := matches(spec, h); err != nil {
			return nil, &Error{Code: "invalid-argument", Message: p + ": " + err.Error()}
		}
	}
	in := &instance{l: l, opts: o, apis: code.ApisSchema, ready: make(chan struct{}), exit: make(chan ExitInfo, 1), gone: make(chan struct{})}
	in.p = sbxkit.NewPeer(func(f sbxkit.Frame) { l.send(wire.Msg{Op: "frame", ID: in.ref, M: raw(f)}) }, in.lookup)
	var req wire.RunRequest
	req.CompiledCode, req.Limits, req.Env = code, o.Limits.wire(), o.Env
	if len(o.Network.Allow) > 0 {
		req.Network = &wire.Network{Allow: o.Network.Allow, Bytes: o.Network.Bytes}
	}
	// The route exists before the request: frames can arrive before the reply.
	l.mu.Lock()
	l.seq++
	in.ref = fmt.Sprintf("r%d", l.seq)
	l.routes[in.ref] = in
	l.mu.Unlock()
	b, err := l.request(ctx, wire.Msg{Op: "run", ID: in.ref, Run: &req})
	if err != nil {
		l.mu.Lock()
		delete(l.routes, in.ref)
		l.mu.Unlock()
		return nil, err
	}
	var r struct {
		ID string `json:"id"`
	}
	json.Unmarshal(b, &r)
	in.id = r.ID
	return in, nil
}

// matches reports a handler whose Go types do not fit the compiled schema, so a
// mismatch stops Run instead of failing on the first call.
func matches(spec wire.ApiSpec, h Handler) error {
	same := func(a json.RawMessage, t reflect.Type) bool {
		var x, y any
		json.Unmarshal(a, &x)
		json.Unmarshal(raw(schemaOf(t)), &y)
		return reflect.DeepEqual(x, y)
	}
	if !same(spec.Input, h.in) {
		return errors.New("handler input does not match the schema")
	}
	out := spec.Output
	if spec.Kind == "stream" {
		out = spec.Item
	}
	if !same(out, h.out) {
		return errors.New("handler output does not match the schema")
	}
	return nil
}

type dev struct {
	Instance
	l  *link
	o  DevOptions
	mu sync.Mutex
}

func (l *link) RunDev(ctx context.Context, o DevOptions) (DevInstance, error) {
	if o.Limits.CPUBudget == 0 {
		o.Limits.CPUBudget = time.Minute
	}
	d := &dev{l: l, o: o}
	ok, ds, err := d.Update(ctx, o.Files)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, &Error{Code: "invalid-argument", Message: fmt.Sprint(ds)}
	}
	return d, nil
}

func (d *dev) Update(ctx context.Context, files []File) (bool, []Diagnostic, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	in := d.o.CompileInput
	in.Files = files
	r, err := d.l.Compile(ctx, in)
	if err != nil || !r.OK {
		return false, r.Diagnostics, err
	}
	if d.Instance != nil {
		d.Instance.Kill(ctx)
	}
	box, err := d.l.Run(ctx, RunOptions{CompiledCode: r.CompiledCode, ApiDef: d.o.ApiDef, Limits: d.o.Limits, Network: d.o.Network, Env: d.o.Env, Middleware: d.o.Middleware, OnEvent: d.o.OnEvent})
	if err != nil {
		return false, nil, err
	}
	d.Instance = box
	return true, r.Diagnostics, box.Ready(ctx)
}
