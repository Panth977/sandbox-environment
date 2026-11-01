// Package daemon is sandboxd: it owns Docker, so no parent app ever holds that power.
// Every limit, cap, deadline and schema check lives here, once, for every language.
package daemon

import (
	"bufio"
	"crypto/subtle"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Panth977/sandbox-environment/server/go/internal/wire"
)

// Daemon is one sandboxd process.
type Daemon struct {
	cfg     Config
	id      string
	ceiling wire.Limits
	mu      sync.Mutex
	inst    map[string]*Instance
}

// New prepares a daemon.
func New(cfg Config) *Daemon {
	c := DefaultCeiling()
	if cfg.Ceiling != (wire.Limits{}) {
		c = Resolve(&cfg.Ceiling, c, c)
	}
	return &Daemon{cfg: cfg, id: newID(""), ceiling: c, inst: map[string]*Instance{}}
}

func (d *Daemon) add(in *Instance) {
	d.mu.Lock()
	d.inst[in.id] = in
	d.mu.Unlock()
}

func (d *Daemon) remove(in *Instance) {
	d.mu.Lock()
	delete(d.inst, in.id)
	d.mu.Unlock()
}

// Sweep removes containers and networks of daemons that died, and anything past its
// expiry. Runs at start and every 30 s, so a crash leaves nothing burning CPU.
func (d *Daemon) Sweep() {
	out, err := exec.Command(d.cfg.Docker, "ps", "-a", "--filter", "label=sbx=1", "--format", `{{.Names}}|{{.Label "sbx.daemon"}}|{{.Label "sbx.expires"}}`).Output()
	if err != nil {
		return
	}
	for _, l := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		f := strings.Split(l, "|")
		if len(f) != 3 {
			continue
		}
		exp, _ := strconv.ParseInt(f[2], 10, 64)
		if f[1] != d.id || (exp > 0 && time.Now().UnixMilli() > exp) {
			exec.Command(d.cfg.Docker, "rm", "-f", "-v", f[0]).Run()
		}
	}
	out, err = exec.Command(d.cfg.Docker, "network", "ls", "--filter", "label=sbx=1", "--format", `{{.Name}}|{{.Label "sbx.daemon"}}`).Output()
	if err == nil {
		for _, l := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			if f := strings.Split(l, "|"); len(f) == 2 && f[1] != d.id {
				exec.Command(d.cfg.Docker, "network", "rm", f[0]).Run()
			}
		}
	}
	dirs, _ := os.ReadDir(d.cfg.DataDir)
	for _, e := range dirs {
		name := e.Name()
		d.mu.Lock()
		_, live := d.inst[name]
		d.mu.Unlock()
		info, err := e.Info()
		if !live && err == nil && strings.HasPrefix(name, "sbx-") && time.Since(info.ModTime()) > time.Hour {
			exec.Command("chmod", "-R", "u+w", d.cfg.DataDir+"/"+name).Run()
			os.RemoveAll(d.cfg.DataDir + "/" + name)
		}
	}
}

// Serve listens until the process ends.
func (d *Daemon) Serve() error {
	if err := os.MkdirAll(d.cfg.DataDir, 0o711); err != nil {
		return err
	}
	d.Sweep()
	go func() {
		for range time.Tick(30 * time.Second) {
			d.Sweep()
		}
	}()
	errs := make(chan error, 2)
	if d.cfg.Socket != "" {
		os.Remove(d.cfg.Socket)
		ln, err := net.Listen("unix", d.cfg.Socket)
		if err != nil {
			return err
		}
		if err := os.Chmod(d.cfg.Socket, 0o600); err != nil {
			return err
		}
		go func() { errs <- d.accept(ln) }()
	}
	if d.cfg.TLSAddr != "" {
		if d.cfg.Token == "" {
			return fmt.Errorf("TLS needs a token")
		}
		cert, err := tls.LoadX509KeyPair(d.cfg.TLSCert, d.cfg.TLSKey)
		if err != nil {
			return err
		}
		ln, err := tls.Listen("tcp", d.cfg.TLSAddr, &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12})
		if err != nil {
			return err
		}
		go func() { errs <- d.accept(ln) }()
	}
	return <-errs
}

func (d *Daemon) accept(ln net.Listener) error {
	for {
		c, err := ln.Accept()
		if err != nil {
			return err
		}
		go (&client{d: d, c: c, mine: map[string]*Instance{}}).serve()
	}
}

// client is one parent connection. When it drops, its sandboxes die with it.
type client struct {
	d      *Daemon
	c      net.Conn
	wmu    sync.Mutex
	mu     sync.Mutex
	mine   map[string]*Instance
	limits *wire.Limits
}

func (cl *client) write(m wire.Msg) {
	b, err := json.Marshal(m)
	if err != nil {
		return
	}
	cl.wmu.Lock()
	defer cl.wmu.Unlock()
	cl.c.SetWriteDeadline(time.Now().Add(30 * time.Second))
	if _, err := cl.c.Write(append(b, '\n')); err != nil {
		cl.c.Close()
	}
}

// ceiling is the daemon's ceiling, lowered further by createSandbox({ limits }).
func (cl *client) ceiling() wire.Limits { return Lower(cl.d.ceiling, cl.limits) }

func (cl *client) reply(m wire.Msg, v any, err error) {
	r := wire.Msg{Op: "reply", Rid: m.Rid}
	if err != nil {
		r.Error = err.Error()
	} else {
		r.Result, _ = json.Marshal(v)
	}
	cl.write(r)
}

func (cl *client) track(in *Instance) {
	cl.mu.Lock()
	cl.mine[in.ref] = in
	cl.mu.Unlock()
}

func (cl *client) untrack(in *Instance) {
	cl.mu.Lock()
	delete(cl.mine, in.ref)
	cl.mu.Unlock()
}

func (cl *client) instance(id string) *Instance {
	cl.mu.Lock()
	defer cl.mu.Unlock()
	return cl.mine[id]
}

func (cl *client) serve() {
	defer func() {
		cl.c.Close()
		cl.mu.Lock()
		for _, in := range cl.mine {
			in.p.kill("killed")
		}
		cl.mu.Unlock()
	}()
	s := bufio.NewScanner(cl.c)
	s.Buffer(make([]byte, 64*1024), 256*mib)
	authed := cl.d.cfg.Token == ""
	for s.Scan() {
		var m wire.Msg
		if json.Unmarshal(s.Bytes(), &m) != nil {
			return
		}
		if m.Op == "hello" {
			if tok := cl.d.cfg.Token; tok != "" && subtle.ConstantTimeCompare([]byte(tok), []byte(m.Token)) != 1 {
				cl.reply(m, nil, fmt.Errorf("bad token"))
				return
			}
			authed, cl.limits = true, m.Limits
			cl.reply(m, map[string]any{"protocol": 1, "runtime": cl.d.cfg.Runtime}, nil)
			continue
		}
		if !authed {
			return
		}
		switch m.Op {
		case "frame":
			if in := cl.instance(m.ID); in != nil {
				in.fromParent(m.M)
			}
		case "compile":
			go func() { r, err := cl.d.compile(cl, m.Compile); cl.reply(m, r, err) }()
		case "typings":
			go func() { r, err := Typings(m.Compile); cl.reply(m, r, err) }()
		case "run":
			go func() {
				in, err := cl.d.startInstance(cl, m.ID, m.Run)
				if err != nil {
					cl.reply(m, nil, err)
					return
				}
				cl.reply(m, map[string]string{"id": in.id}, nil)
			}()
		case "usage":
			if in := cl.instance(m.ID); in != nil {
				cl.reply(m, in.usage(), nil)
			} else {
				cl.reply(m, nil, fmt.Errorf("no such sandbox"))
			}
		case "stop":
			if in := cl.instance(m.ID); in != nil {
				go in.p.stop(m.GraceMs)
			}
		case "kill":
			if in := cl.instance(m.ID); in != nil {
				in.p.kill("killed")
			}
		case "list":
			cl.mu.Lock()
			out := []map[string]any{}
			for _, in := range cl.mine {
				out = append(out, map[string]any{"id": in.id, "hash": in.code.Hash, "startedAt": in.p.started.UnixMilli(), "usage": in.usage()})
			}
			cl.mu.Unlock()
			cl.reply(m, out, nil)
		default:
			log.Printf("unknown op %q", m.Op)
		}
	}
}
