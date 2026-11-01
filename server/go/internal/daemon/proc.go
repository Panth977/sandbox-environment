package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Panth977/sandbox-environment/server/go/internal/wire"
)

// Config is how one sandboxd runs.
type Config struct {
	Docker      string // docker CLI
	DockerSock  string // for stats when cgroup files are out of reach
	Runtime     string // "runsc" in production
	DataDir     string // shared with dockerd: bundles are bind-mounted read-only from here
	ProxyBinary string // static linux sandboxd, mounted into the egress proxy
	Socket      string // unix socket
	TLSAddr     string // host:port for TLS parents
	TLSCert     string
	TLSKey      string
	Token       string
	Ceiling     wire.Limits
}

type procSpec struct {
	name    string
	image   string
	cmd     []string
	env     []string
	limits  wire.Limits
	network string // "" = none
	mounts  []string
	tmpfs   []string
	workdir string
	stdin   bool
	user    string
}

// proc is one container under watch: the limits live here, for runs and compiles alike.
type proc struct {
	d       *Daemon
	spec    procSpec
	cmd     *exec.Cmd
	started time.Time
	onLimit func(limit string, used, max int64)
	onTick  func(now time.Time)

	reason  atomic.Pointer[string]
	serving atomic.Bool // start-up is over; only then cpuBurst applies
	mu      sync.Mutex
	usage   wire.Usage
	pidsHit bool
	done    chan struct{}
}

func (d *Daemon) newProc(spec procSpec) *proc {
	return &proc{d: d, spec: spec, done: make(chan struct{})}
}

func (p *proc) args() []string {
	l := p.spec.limits
	user := p.spec.user
	if user == "" {
		user = "1000:1000"
	}
	a := []string{"run", "--name", p.spec.name, "--label", "sbx=1", "--label", "sbx.daemon=" + p.d.id,
		"--label", fmt.Sprintf("sbx.expires=%d", time.Now().UnixMilli()+l.WallMs+60000),
		"--runtime", p.d.cfg.Runtime, "--read-only", "--log-driver", "none",
		"--memory", strconv.FormatInt(l.Memory, 10), "--memory-swap", strconv.FormatInt(l.Memory, 10),
		"--cpus", strconv.FormatFloat(l.CPUs, 'f', 2, 64), "--pids-limit", strconv.FormatInt(l.Pids, 10),
		"--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", user,
		"--ulimit", "nofile=256:256", "--ulimit", "core=0:0"}
	if p.spec.stdin {
		a = append(a, "-i")
	}
	if p.spec.network == "" {
		a = append(a, "--network", "none")
	} else {
		a = append(a, "--network", p.spec.network)
	}
	for _, t := range p.spec.tmpfs {
		a = append(a, "--tmpfs", t)
	}
	for _, m := range p.spec.mounts {
		a = append(a, "-v", m)
	}
	for _, e := range p.spec.env {
		a = append(a, "-e", e)
	}
	if p.spec.workdir != "" {
		a = append(a, "--workdir", p.spec.workdir)
	}
	a = append(a, p.spec.image)
	return append(a, p.spec.cmd...)
}

func (p *proc) start() (stdin io.WriteCloser, stdout, stderr io.ReadCloser, err error) {
	p.cmd = exec.Command(p.d.cfg.Docker, p.args()...)
	if p.spec.stdin {
		if stdin, err = p.cmd.StdinPipe(); err != nil {
			return
		}
	}
	if stdout, err = p.cmd.StdoutPipe(); err != nil {
		return
	}
	if stderr, err = p.cmd.StderrPipe(); err != nil {
		return
	}
	p.started = time.Now()
	if err = p.cmd.Start(); err != nil {
		return
	}
	go p.watch()
	return
}

// kill records the first reason and stops the container. Later reasons are ignored.
// It never blocks: callers include the stdout pump, and dockerd cannot finish a kill
// while that stream is not being drained.
func (p *proc) kill(reason string) {
	if p.reason.CompareAndSwap(nil, &reason) {
		go func() {
			if p.cmd == nil {
				return
			}
			c := exec.Command(p.d.cfg.Docker, "kill", p.spec.name)
			if err := c.Start(); err != nil {
				p.cmd.Process.Kill()
				return
			}
			done := make(chan error, 1)
			go func() { done <- c.Wait() }()
			select {
			case <-done:
			case <-time.After(10 * time.Second):
				c.Process.Kill()
				p.cmd.Process.Kill() // drop the stream; the sweeper removes the container
			}
		}()
	}
}

// stop asks the code to end, then kills it after the grace time.
func (p *proc) stop(graceMs int64) {
	reason := "stopped"
	p.reason.CompareAndSwap(nil, &reason)
	exec.Command(p.d.cfg.Docker, "kill", "-s", "TERM", p.spec.name).Run()
	if graceMs <= 0 {
		graceMs = 2000
	}
	select {
	case <-p.done:
	case <-time.After(time.Duration(graceMs) * time.Millisecond):
		exec.Command(p.d.cfg.Docker, "kill", p.spec.name).Run()
	}
}

func (p *proc) snapshot() wire.Usage {
	p.mu.Lock()
	defer p.mu.Unlock()
	u := p.usage
	u.WallMs = time.Since(p.started).Milliseconds()
	return u
}

func (p *proc) update(f func(u *wire.Usage)) {
	p.mu.Lock()
	f(&p.usage)
	p.mu.Unlock()
}

// startCPUMs is the CPU a run may use before it reports ready.
const startCPUMs = 15000

type stats struct{ cpuUsec, mem, peak, pids, pidsMax int64 }

var statRe = regexp.MustCompile(`usage_usec (\d+)`)

func readInt(path string) int64 {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0
	}
	v, _ := strconv.ParseInt(strings.TrimSpace(string(b)), 10, 64)
	return v
}

func cgroupDir(id string) string {
	for _, d := range []string{"/sys/fs/cgroup/docker/" + id, "/sys/fs/cgroup/system.slice/docker-" + id + ".scope"} {
		if _, err := os.Stat(d + "/cpu.stat"); err == nil {
			return d
		}
	}
	return ""
}

func readCgroup(dir string) (stats, bool) {
	b, err := os.ReadFile(dir + "/cpu.stat")
	if err != nil {
		return stats{}, false
	}
	m := statRe.FindSubmatch(b)
	if m == nil {
		return stats{}, false
	}
	var s stats
	s.cpuUsec, _ = strconv.ParseInt(string(m[1]), 10, 64)
	s.mem = readInt(dir + "/memory.current")
	s.peak = readInt(dir + "/memory.peak")
	s.pids = readInt(dir + "/pids.current")
	if e, err := os.ReadFile(dir + "/pids.events"); err == nil {
		f := strings.Fields(string(e))
		if len(f) == 2 {
			s.pidsMax, _ = strconv.ParseInt(f[1], 10, 64)
		}
	}
	return s, true
}

// apiStats is the fallback for a daemon that cannot read the cgroup files directly.
func (d *Daemon) apiStats(id string) (stats, bool) {
	c := http.Client{Timeout: 3 * time.Second, Transport: &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", d.cfg.DockerSock)
	}}}
	r, err := c.Get("http://docker/containers/" + id + "/stats?stream=false&one-shot=true")
	if err != nil {
		return stats{}, false
	}
	defer r.Body.Close()
	var v struct {
		CPU struct {
			Usage struct {
				Total int64 `json:"total_usage"`
			} `json:"cpu_usage"`
		} `json:"cpu_stats"`
		Mem struct {
			Usage int64 `json:"usage"`
			Max   int64 `json:"max_usage"`
		} `json:"memory_stats"`
		Pids struct {
			Current int64 `json:"current"`
		} `json:"pids_stats"`
	}
	if json.NewDecoder(r.Body).Decode(&v) != nil {
		return stats{}, false
	}
	return stats{cpuUsec: v.CPU.Usage.Total / 1000, mem: v.Mem.Usage, peak: v.Mem.Max, pids: v.Pids.Current}, v.CPU.Usage.Total > 0
}

func (p *proc) inspectID() string {
	out, err := exec.Command(p.d.cfg.Docker, "inspect", "-f", "{{.Id}}", p.spec.name).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// watch reads usage and enforces every time-based limit.
func (p *proc) watch() {
	l := p.spec.limits
	var id, dir string
	var burst *window
	if l.CPUBurst != nil {
		burst = &window{spanMs: l.CPUBurst.WindowMs}
	}
	period := 100 * time.Millisecond
	t := time.NewTicker(period)
	defer t.Stop()
	last := time.Now()
	for {
		select {
		case <-p.done:
			return
		case now := <-t.C:
			if p.onTick != nil {
				p.onTick(now)
			}
			if l.WallMs > 0 && now.Sub(p.started).Milliseconds() > l.WallMs {
				p.breach("wallMs", "wall", now.Sub(p.started).Milliseconds(), l.WallMs)
			}
			if id == "" {
				id = p.inspectID()
				if id != "" {
					dir = cgroupDir(id)
				}
				continue
			}
			var s stats
			var ok bool
			if dir != "" {
				s, ok = readCgroup(dir)
			} else if now.Sub(last) >= 500*time.Millisecond {
				s, ok = p.d.apiStats(id)
			}
			if !ok {
				continue
			}
			dt := now.Sub(last).Seconds()
			last = now
			p.update(func(u *wire.Usage) {
				u.CPUMs = s.cpuUsec / 1000
				u.MemoryBytes = s.mem
				if s.peak > u.MemoryPeakBytes {
					u.MemoryPeakBytes = s.peak
				}
				if s.mem > u.MemoryPeakBytes {
					u.MemoryPeakBytes = s.mem
				}
				u.Pids = s.pids
				u.MemoryMbSeconds += float64(s.mem) / mib * dt
				if s.pidsMax > 0 {
					p.pidsHit = true
				}
			})
			cpuMs := s.cpuUsec / 1000
			if l.CPUBudgetMs > 0 && cpuMs > l.CPUBudgetMs {
				p.breach("cpuBudgetMs", "cpu-budget", cpuMs, l.CPUBudgetMs)
			}
			// Start-up is heavy work the code cannot avoid (a Python interpreter under
			// gVisor passes 2 s), so it has its own cap and the rolling window starts at ready.
			if burst != nil && p.serving.Load() {
				if used := burst.add(now.UnixMilli(), s.cpuUsec); used > l.CPUBurst.Ms {
					p.breach("cpuBurst", "cpu-burst", used, l.CPUBurst.Ms)
				}
			} else if burst != nil && cpuMs > startCPUMs {
				p.breach("cpuBurst", "cpu-burst", cpuMs, startCPUMs)
			}
		}
	}
}

func (p *proc) breach(limit, reason string, used, max int64) {
	if p.reason.Load() == nil && p.onLimit != nil {
		p.onLimit(limit, used, max)
	}
	p.kill(reason)
}

// wait ends the run, says why it ended and removes the container.
func (p *proc) wait() wire.ExitInfo {
	p.cmd.Wait()
	close(p.done)
	var state struct {
		ExitCode  int
		OOMKilled bool
	}
	out, _ := exec.Command(p.d.cfg.Docker, "inspect", "-f", "{{json .State}}", p.spec.name).Output()
	json.Unmarshal(bytes.TrimSpace(out), &state)
	exec.Command(p.d.cfg.Docker, "rm", "-f", "-v", p.spec.name).Run()
	u := p.snapshot()
	p.mu.Lock()
	pids := p.pidsHit
	p.mu.Unlock()
	code := state.ExitCode
	reason := "crash"
	switch r := p.reason.Load(); {
	case r != nil:
		reason = *r
	case state.OOMKilled || code == 137:
		reason = "memory"
	case pids && code != 0:
		reason = "pids"
	case code == 0:
		reason = "exit"
	}
	return wire.ExitInfo{Reason: reason, Code: &code, DurationMs: u.WallMs, Usage: u}
}
