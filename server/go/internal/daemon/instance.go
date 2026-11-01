package daemon

import (
	"archive/tar"
	"bufio"
	"bytes"
	"compress/gzip"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/Panth977/sandbox-environment/server/go/internal/wire"
)

const maxBundle = 512 * mib

type frame struct {
	Sbx  int               `json:"$sbx"`
	T    string            `json:"t"`
	ID   int64             `json:"id"`
	Path []string          `json:"path,omitempty"`
	Args []json.RawMessage `json:"args,omitempty"`
	V    json.RawMessage   `json:"v,omitempty"`
	N    int64             `json:"n,omitempty"`
	E    *wireErr          `json:"e,omitempty"`
}

type wireErr struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type pending struct {
	at   time.Time
	path string
	spec wire.ApiSpec
}

type bucket struct {
	tokens float64
	last   time.Time
}

// Instance is one running sandbox and everything between it and its parent.
type Instance struct {
	id    string
	ref   string // the parent's name for this run
	d     *Daemon
	conn  *client
	p     *proc
	code  wire.CompiledCode
	lim   wire.Limits
	dir   string
	stdin chan []byte

	mu       sync.Mutex
	toChild  map[int64]pending // parent's calls
	toHost   map[int64]pending // child's calls
	buckets  map[string]*bucket
	waitFrom time.Time
	waitedMs int64
	lastCall time.Time
	ready    bool
	logBytes int64
	frames   int64
	frameSec int64
	netName  string
	pxName   string
	pxIP     string
}

func newID(prefix string) string {
	b := make([]byte, 6)
	rand.Read(b)
	return prefix + hex.EncodeToString(b)
}

// unpack writes a compiled bundle read-only, refusing anything that leaves the root.
func unpack(bundle, dir string) error {
	raw, err := base64.StdEncoding.DecodeString(bundle)
	if err != nil {
		return err
	}
	gz, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		return err
	}
	tr := tar.NewReader(gz)
	var total int64
	for {
		h, err := tr.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		name, ok := safePath(h.Name)
		if !ok {
			return fmt.Errorf("unsafe path %q", h.Name)
		}
		target := filepath.Join(dir, name)
		switch h.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			total += h.Size
			if total > maxBundle {
				return fmt.Errorf("bundle too large")
			}
			os.MkdirAll(filepath.Dir(target), 0o755)
			mode := os.FileMode(0o444)
			if h.Mode&0o111 != 0 {
				mode = 0o555
			}
			f, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_EXCL, mode)
			if err != nil {
				return err
			}
			_, err = io.CopyN(f, tr, h.Size)
			f.Close()
			if err != nil {
				return err
			}
		default: // links stay out: they are how an archive points outside itself
			return fmt.Errorf("unsupported entry %q", h.Name)
		}
	}
}

func safePath(p string) (string, bool) {
	c := path.Clean(strings.TrimPrefix(p, "./"))
	if c == "." {
		return ".", true
	}
	if c == "" || strings.HasPrefix(c, "/") || c == ".." || strings.HasPrefix(c, "../") || strings.ContainsAny(c, "\x00\\") {
		return "", false
	}
	return c, true
}

func codeHash(c wire.CompiledCode) string {
	c.Hash = ""
	b, _ := json.Marshal(c)
	s := sha256.Sum256(b)
	return "sha256:" + hex.EncodeToString(s[:])
}

func (d *Daemon) startInstance(cl *client, ref string, req *wire.RunRequest) (*Instance, error) {
	code := req.CompiledCode
	if code.Format != 1 || code.Hash != codeHash(code) {
		return nil, fmt.Errorf("compiledCode failed its hash check")
	}
	if !allowedImage(code.Image) {
		return nil, fmt.Errorf("image %q is not a runtime image", code.Image)
	}
	lim := Resolve(req.Limits, RunDefaults(), cl.ceiling())
	id := newID("sbx-")
	in := &Instance{id: id, ref: ref, d: d, conn: cl, code: code, lim: lim, dir: filepath.Join(d.cfg.DataDir, id),
		toChild: map[int64]pending{}, toHost: map[int64]pending{}, buckets: map[string]*bucket{},
		stdin: make(chan []byte, 1024), lastCall: time.Now()}
	app := filepath.Join(in.dir, "app")
	if err := os.MkdirAll(app, 0o755); err != nil {
		return nil, err
	}
	if err := unpack(code.Bundle, app); err != nil {
		os.RemoveAll(in.dir)
		return nil, err
	}
	env, _ := json.Marshal(req.Env)
	vars := append([]string{"SBX_ENV=" + string(env), "HOME=/tmp"}, code.EnvVars...)
	network := ""
	if req.Network != nil && len(req.Network.Allow) > 0 {
		if err := in.startProxy(req.Network); err != nil {
			in.cleanup()
			return nil, err
		}
		network = in.netName
		u := "http://" + in.pxIP + ":3128"
		vars = append(vars, "HTTPS_PROXY="+u, "https_proxy="+u, "HTTP_PROXY="+u, "http_proxy="+u)
	}
	in.p = d.newProc(procSpec{name: id, image: code.Image, cmd: code.Cmd, env: vars, limits: lim, network: network, stdin: true,
		mounts: []string{app + ":/app:ro"}, workdir: "/app",
		tmpfs: []string{fmt.Sprintf("/tmp:size=%d,uid=1000,gid=1000,mode=1700", lim.Disk)}})
	in.p.onLimit = func(limit string, used, max int64) {
		in.send(wire.Event{Type: "limit", Limit: limit, Used: used, Max: max})
	}
	lastUsage := time.Now()
	in.p.onTick = func(now time.Time) {
		in.tick(now)
		if now.Sub(lastUsage) >= time.Second {
			lastUsage = now
			u := in.usage()
			in.send(wire.Event{Type: "usage", Usage: &u})
		}
	}
	stdin, stdout, stderr, err := in.p.start()
	if err != nil {
		in.cleanup()
		return nil, err
	}
	d.add(in)
	cl.track(in)
	go func() {
		for b := range in.stdin {
			if _, err := stdin.Write(b); err != nil {
				return
			}
		}
	}()
	var pumps sync.WaitGroup
	pumps.Add(2)
	go func() { defer pumps.Done(); in.pumpStdout(stdout) }()
	go func() { defer pumps.Done(); in.pumpLog("stderr", stderr) }()
	go func() {
		pumps.Wait()
		info := in.p.wait()
		stdin.Close()
		info.Usage.HostWaitMs = in.hostWait()
		in.send(wire.Event{Type: "exit", Info: &info})
		in.cleanup()
		d.remove(in)
		cl.untrack(in)
	}()
	return in, nil
}

func (in *Instance) cleanup() {
	if in.pxName != "" {
		exec.Command(in.d.cfg.Docker, "rm", "-f", "-v", in.pxName).Run()
		exec.Command(in.d.cfg.Docker, "network", "rm", in.netName).Run()
	}
	exec.Command("chmod", "-R", "u+w", in.dir).Run()
	os.RemoveAll(in.dir)
}

func (in *Instance) send(e wire.Event) {
	e.At = time.Now().UnixMilli()
	in.conn.write(wire.Msg{Op: "event", ID: in.ref, Event: &e})
}

func (in *Instance) hostWait() int64 {
	in.mu.Lock()
	defer in.mu.Unlock()
	w := in.waitedMs
	if len(in.toHost) > 0 {
		w += time.Since(in.waitFrom).Milliseconds()
	}
	return w
}

func (in *Instance) usage() wire.Usage {
	u := in.p.snapshot()
	u.HostWaitMs = in.hostWait()
	return u
}

// tick enforces the deadlines that depend on calls.
func (in *Instance) tick(now time.Time) {
	in.mu.Lock()
	var expired []int64
	kill := ""
	timeout := func(p pending) int64 {
		if p.spec.TimeoutMs > 0 {
			return p.spec.TimeoutMs
		}
		return in.lim.CallMs
	}
	for id, p := range in.toHost {
		if p.spec.Kind == "unary" && now.Sub(p.at).Milliseconds() > timeout(p) {
			expired = append(expired, id)
		}
	}
	for _, p := range in.toChild {
		if p.spec.Kind == "unary" && now.Sub(p.at).Milliseconds() > timeout(p) {
			kill = "call-deadline"
		}
	}
	if !in.ready && now.Sub(in.p.started) > 30*time.Second {
		kill = "start-timeout"
	}
	idle := in.lim.IdleMs > 0 && len(in.toChild)+len(in.toHost) == 0 && now.Sub(in.lastCall).Milliseconds() > in.lim.IdleMs
	in.mu.Unlock()
	if kill != "" {
		in.p.kill(kill)
	}
	if idle {
		in.p.kill("idle")
	}
	for _, id := range expired {
		in.finishHost(id, "deadline")
		in.toStdin(frame{Sbx: 1, T: "err", ID: id, E: &wireErr{"deadline", "the host API took too long"}})
	}
}

func (in *Instance) finishHost(id int64, errText string) {
	in.mu.Lock()
	p, ok := in.toHost[id]
	if ok {
		delete(in.toHost, id)
		if len(in.toHost) == 0 {
			in.waitedMs += time.Since(in.waitFrom).Milliseconds()
		}
		in.lastCall = time.Now()
	}
	in.mu.Unlock()
	if ok {
		in.send(wire.Event{Type: "call", Direction: "to-host", Path: p.path, Ms: time.Since(p.at).Milliseconds(), Error: errText})
	}
}

func (in *Instance) finishChild(id int64, errText string) {
	in.mu.Lock()
	p, ok := in.toChild[id]
	if ok {
		delete(in.toChild, id)
		in.lastCall = time.Now()
	}
	in.mu.Unlock()
	if ok {
		in.send(wire.Event{Type: "call", Direction: "to-sandbox", Path: p.path, Ms: time.Since(p.at).Milliseconds(), Error: errText})
	}
}

func (in *Instance) toStdin(f frame) {
	b, _ := json.Marshal(f)
	in.writeStdin(append(b, '\n'))
}

func (in *Instance) writeStdin(b []byte) {
	defer func() { recover() }()
	select {
	case in.stdin <- b:
	default: // the code stopped reading while frames keep arriving
		in.p.kill("frame-rate")
	}
}

func (in *Instance) toParent(raw []byte) {
	in.conn.write(wire.Msg{Op: "frame", ID: in.ref, M: json.RawMessage(raw)})
}

func (in *Instance) rejectChild(id int64, code, msg string) {
	in.toStdin(frame{Sbx: 1, T: "err", ID: id, E: &wireErr{code, msg}})
}

func (in *Instance) allow(path string, r *wire.RateLimit) bool {
	if r == nil || r.PerSecond <= 0 {
		return true
	}
	in.mu.Lock()
	defer in.mu.Unlock()
	burst := r.Burst
	if burst <= 0 {
		burst = r.PerSecond
	}
	b := in.buckets[path]
	now := time.Now()
	if b == nil {
		b = &bucket{tokens: burst, last: now}
		in.buckets[path] = b
	}
	b.tokens = min(burst, b.tokens+now.Sub(b.last).Seconds()*r.PerSecond)
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func inputOf(args []json.RawMessage) any {
	var v any
	if len(args) > 0 {
		json.Unmarshal(args[0], &v)
	}
	return v
}

// fromChild checks one frame from the sandbox before the parent sees it.
func (in *Instance) fromChild(raw []byte) {
	var f frame
	if json.Unmarshal(raw, &f) != nil || f.Sbx != 1 {
		in.p.kill("bad-frame")
		return
	}
	switch f.T {
	case "ready":
		in.mu.Lock()
		first := !in.ready
		in.ready = true
		in.lastCall = time.Now()
		in.mu.Unlock()
		if first {
			in.p.serving.Store(true)
			in.send(wire.Event{Type: "ready", StartMs: time.Since(in.p.started).Milliseconds()})
		}
	case "call":
		p := strings.Join(f.Path, ".")
		spec, ok := in.code.ApisSchema[p]
		if !ok {
			in.rejectChild(f.ID, "permission-denied", "no such host API: "+p)
			return
		}
		if !in.allow(p, spec.RateLimit) {
			in.rejectChild(f.ID, "quota", "rate limit: "+p)
			return
		}
		if err := Validate(spec.Input, inputOf(f.Args)); err != nil {
			in.rejectChild(f.ID, "invalid-argument", err.Error())
			return
		}
		in.mu.Lock()
		if int64(len(in.toHost)+len(in.toChild)) >= in.lim.Concurrency {
			in.mu.Unlock()
			in.rejectChild(f.ID, "quota", "too many calls in flight")
			return
		}
		if _, dup := in.toHost[f.ID]; dup {
			in.mu.Unlock()
			in.p.kill("bad-frame")
			return
		}
		if len(in.toHost) == 0 {
			in.waitFrom = time.Now()
		}
		in.toHost[f.ID] = pending{at: time.Now(), path: p, spec: spec}
		in.mu.Unlock()
		in.p.update(func(u *wire.Usage) { u.Calls++ })
		in.toParent(raw)
	case "ok", "next":
		in.mu.Lock()
		p, ok := in.toChild[f.ID]
		in.mu.Unlock()
		if !ok {
			return
		}
		var v any
		json.Unmarshal(f.V, &v)
		schema := p.spec.Output
		if f.T == "next" {
			schema = p.spec.Item
		}
		if err := Validate(schema, v); err != nil {
			in.finishChild(f.ID, "invalid output")
			b, _ := json.Marshal(frame{Sbx: 1, T: "err", ID: f.ID, E: &wireErr{"internal", "sandbox broke its schema: " + err.Error()}})
			in.toParent(b)
			return
		}
		if f.T == "ok" {
			in.finishChild(f.ID, "")
		}
		in.toParent(raw)
	case "err", "end":
		e := ""
		if f.E != nil {
			e = f.E.Code
		}
		in.mu.Lock()
		_, ok := in.toChild[f.ID]
		in.mu.Unlock()
		if ok {
			in.finishChild(f.ID, e)
			in.toParent(raw)
		}
	case "pull", "cancel":
		in.toParent(raw)
		if f.T == "cancel" {
			in.finishHost(f.ID, "cancelled")
		}
	default:
		in.p.kill("bad-frame")
	}
}

// fromParent routes one frame from the SDK into the sandbox.
func (in *Instance) fromParent(raw []byte) {
	var f frame
	if json.Unmarshal(raw, &f) != nil {
		return
	}
	switch f.T {
	case "call":
		p := strings.Join(f.Path, ".")
		spec, ok := in.code.ExportsSchema[p]
		if !ok {
			b, _ := json.Marshal(frame{Sbx: 1, T: "err", ID: f.ID, E: &wireErr{"not-found", "no such export: " + p}})
			in.toParent(b)
			return
		}
		if err := Validate(spec.Input, inputOf(f.Args)); err != nil {
			b, _ := json.Marshal(frame{Sbx: 1, T: "err", ID: f.ID, E: &wireErr{"invalid-argument", err.Error()}})
			in.toParent(b)
			return
		}
		in.mu.Lock()
		over := int64(len(in.toHost)+len(in.toChild)) >= in.lim.Concurrency
		if !over {
			in.toChild[f.ID] = pending{at: time.Now(), path: p, spec: spec}
		}
		in.mu.Unlock()
		if over {
			b, _ := json.Marshal(frame{Sbx: 1, T: "err", ID: f.ID, E: &wireErr{"quota", "too many calls in flight"}})
			in.toParent(b)
			return
		}
		in.p.update(func(u *wire.Usage) { u.Calls++ })
	case "ok", "err", "end":
		in.mu.Lock()
		_, ok := in.toHost[f.ID]
		in.mu.Unlock()
		if !ok { // already answered with a deadline
			return
		}
		e := ""
		if f.E != nil {
			e = f.E.Code
		}
		in.finishHost(f.ID, e)
	case "cancel":
		in.finishChild(f.ID, "cancelled")
	}
	in.writeStdin(append(append([]byte{}, raw...), '\n'))
}

func (in *Instance) countLog(n int) bool {
	in.mu.Lock()
	in.logBytes += int64(n)
	over := in.logBytes > in.lim.LogBytes
	in.mu.Unlock()
	if over {
		in.p.kill("log-cap")
	}
	return !over
}

func (in *Instance) pace() bool {
	now := time.Now().Unix()
	in.mu.Lock()
	if now != in.frameSec {
		in.frameSec, in.frames = now, 0
	}
	in.frames++
	over := in.frames > in.lim.FramesPerSec
	in.mu.Unlock()
	if over {
		in.p.kill("frame-rate")
	}
	return !over
}

// pumpStdout splits stdout: `{"$sbx"` lines are frames, every other line is a log,
// so a stray print never breaks the protocol.
func (in *Instance) pumpStdout(r io.Reader) {
	br := bufio.NewReaderSize(r, 64*1024)
	var line []byte
	for {
		chunk, err := br.ReadSlice('\n')
		line = append(line, chunk...)
		if errors.Is(err, bufio.ErrBufferFull) {
			if int64(len(line)) > in.lim.FrameBytes {
				in.p.kill("frame-cap")
				io.Copy(io.Discard, br)
				return
			}
			continue
		}
		if t := bytes.TrimSpace(line); len(t) > 0 && in.p.reason.Load() == nil {
			if int64(len(t)) > in.lim.FrameBytes {
				in.p.kill("frame-cap")
			} else if in.pace() {
				if bytes.HasPrefix(t, []byte(`{"$sbx"`)) {
					in.fromChild(t)
				} else if in.countLog(len(t)) {
					in.send(wire.Event{Type: "log", Stream: "stdout", Text: clip(t)})
				}
			}
		}
		line = line[:0]
		if err != nil {
			return
		}
	}
}

func clip(b []byte) string {
	if len(b) > 8192 {
		b = b[:8192]
	}
	return strings.ToValidUTF8(string(b), "�")
}

func (in *Instance) pumpLog(stream string, r io.Reader) {
	buf := make([]byte, 8192)
	for {
		n, err := r.Read(buf)
		if n > 0 && in.countLog(n) && in.pace() {
			in.send(wire.Event{Type: "log", Stream: stream, Text: clip(buf[:n])})
		}
		if err != nil {
			return
		}
	}
}

// startProxy gives this one run a private network with the egress proxy as its only door.
func (in *Instance) startProxy(n *wire.Network) error {
	in.netName, in.pxName = in.id+"-net", in.id+"-px"
	max := n.Bytes
	if max <= 0 {
		max = 64 * mib
	}
	ip, err := in.d.startProxy(in.pxName, in.netName, n.Allow, max, func(e proxyEvent) {
		allowed := e.Allowed
		in.p.update(func(u *wire.Usage) { u.NetInBytes += e.BytesIn; u.NetOutBytes += e.BytesOut })
		in.send(wire.Event{Type: "network", Host: e.Host, Allowed: &allowed, BytesIn: e.BytesIn, BytesOut: e.BytesOut})
		if e.Cap {
			in.p.kill("network-cap")
		}
	})
	in.pxIP = ip
	return err
}

// startProxy runs one proxy on an internal network, joins it to bridge, and returns its
// address: an IP, because Docker's embedded DNS does not work inside gVisor. The proxy is
// our own code holding no secrets, and it needs that DNS, so it runs on runc, not gVisor.
func (d *Daemon) startProxy(name, netName string, allow []string, max int64, on func(proxyEvent)) (string, error) {
	if d.direct() {
		return "", fmt.Errorf("this host has no network for sandboxes")
	}
	if d.cfg.ProxyBinary == "" {
		return "", fmt.Errorf("network.allow needs --proxy-binary")
	}
	run := func(a ...string) error {
		if out, err := exec.Command(d.cfg.Docker, a...).CombinedOutput(); err != nil {
			return fmt.Errorf("docker %s: %s", a[0], strings.TrimSpace(string(out)))
		}
		return nil
	}
	if err := run("network", "create", "--internal", "--label", "sbx=1", "--label", "sbx.daemon="+d.id, netName); err != nil {
		return "", err
	}
	if err := run("create", "--name", name, "--label", "sbx=1", "--label", "sbx.daemon="+d.id, "--label", fmt.Sprintf("sbx.expires=%d", time.Now().Add(7*24*time.Hour).UnixMilli()),
		"--runtime", "runc", "--network", netName, "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
		"--user", "65534:65534", "--memory", "64m", "--pids-limit", "128",
		"-v", d.cfg.ProxyBinary+":/sandboxd:ro", "alpine:3.20", "/sandboxd", "proxy",
		"--allow", strings.Join(allow, ","), "--bytes", fmt.Sprint(max)); err != nil {
		return "", err
	}
	if err := run("network", "connect", "bridge", name); err != nil {
		return "", err
	}
	cmd := exec.Command(d.cfg.Docker, "start", "-a", name)
	out, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	if err := cmd.Start(); err != nil {
		return "", err
	}
	ready := make(chan struct{})
	var once sync.Once
	go func() {
		s := bufio.NewScanner(out)
		for s.Scan() {
			var e proxyEvent
			if json.Unmarshal(s.Bytes(), &e) != nil {
				continue
			}
			if e.Ready {
				once.Do(func() { close(ready) })
			} else {
				on(e)
			}
		}
		cmd.Wait()
		once.Do(func() { close(ready) })
	}()
	select {
	case <-ready:
	case <-time.After(10 * time.Second):
		return "", fmt.Errorf("egress proxy did not start")
	}
	ipOut, err := exec.Command(d.cfg.Docker, "inspect", "-f", fmt.Sprintf(`{{(index .NetworkSettings.Networks %q).IPAddress}}`, netName), name).Output()
	ip := strings.TrimSpace(string(ipOut))
	if err != nil || ip == "" {
		return "", fmt.Errorf("egress proxy has no address")
	}
	return ip, nil
}
