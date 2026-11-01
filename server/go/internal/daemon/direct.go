package daemon

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// The direct driver runs gVisor with no Docker, for hosts like Cloud Run gen2, where
// the container is itself root inside a microVM. The sandbox sees the host's files
// read-only, except what sandboxd keeps, which is hidden; it has no network.

const directImage = "local"

func (d *Daemon) direct() bool { return d.cfg.Driver == "direct" }

func (d *Daemon) runscRoot() string { return filepath.Join(d.cfg.DataDir, ".runsc") }

type ociMount struct {
	Destination string   `json:"destination"`
	Type        string   `json:"type"`
	Source      string   `json:"source"`
	Options     []string `json:"options,omitempty"`
}

func (p *proc) ociSpec() map[string]any {
	l := p.spec.limits
	mounts := []ociMount{
		{Destination: "/proc", Type: "proc", Source: "proc"},
		{Destination: "/dev", Type: "tmpfs", Source: "tmpfs"},
		{Destination: p.d.cfg.DataDir, Type: "tmpfs", Source: "tmpfs", Options: []string{"size=1m", "ro"}},
		{Destination: "/etc/gateway", Type: "tmpfs", Source: "tmpfs", Options: []string{"size=1m", "ro"}},
	}
	for _, m := range p.spec.tmpfs {
		dest, opts, _ := strings.Cut(m, ":")
		o := []string{"nosuid", "nodev", "mode=1777"}
		for _, x := range strings.Split(opts, ",") {
			if strings.HasPrefix(x, "size=") {
				o = append(o, x)
			}
		}
		mounts = append(mounts, ociMount{Destination: dest, Type: "tmpfs", Source: "tmpfs", Options: o})
	}
	for _, m := range p.spec.mounts {
		f := strings.Split(m, ":")
		mounts = append(mounts, ociMount{Destination: f[1], Type: "bind", Source: f[0], Options: []string{"bind", "ro"}})
	}
	cwd := p.spec.workdir
	if cwd == "" {
		cwd = "/tmp"
	}
	return map[string]any{
		"ociVersion": "1.0.2",
		"hostname":   "sandbox",
		"root":       map[string]any{"path": "/", "readonly": true},
		"mounts":     mounts,
		"process": map[string]any{
			"user": map[string]int{"uid": 1000, "gid": 1000}, "args": p.spec.cmd, "cwd": cwd,
			"env":             append([]string{"PATH=/usr/local/bin:/usr/bin:/bin"}, p.spec.env...),
			"capabilities":    map[string]any{},
			"noNewPrivileges": true,
			"rlimits":         []map[string]any{{"type": "RLIMIT_NOFILE", "hard": 256, "soft": 256}, {"type": "RLIMIT_CORE", "hard": 0, "soft": 0}},
		},
		"linux": map[string]any{
			"cgroupsPath": "/" + p.spec.name, // top level: a shared parent ends up capping its children
			"namespaces":  []map[string]string{{"type": "pid"}, {"type": "network"}, {"type": "ipc"}, {"type": "uts"}, {"type": "mount"}},
			// No cpu quota: Cloud Run refuses one (EINVAL) once it throttles the instance.
			// Its own CPU cap bounds speed, and cpuBurst and cpuBudgetMs still kill.
			"resources": map[string]any{
				"memory": map[string]any{"limit": l.Memory},
				"pids":   map[string]any{"limit": l.Pids},
			},
		},
	}
}

func (p *proc) bundleDir() string { return filepath.Join(p.d.cfg.DataDir, ".oci", p.spec.name) }

func (p *proc) directCmd() (*exec.Cmd, error) {
	dir := p.bundleDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	b, err := json.Marshal(p.ociSpec())
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(dir, "config.json"), b, 0o600); err != nil {
		return nil, err
	}
	return exec.Command(p.d.cfg.Runsc, "--root="+p.d.runscRoot(), "--network=none", "run", "--bundle", dir, p.spec.name), nil
}

// signal is `docker kill` or `runsc kill`.
func (p *proc) signal(sig string) *exec.Cmd {
	if p.d.direct() {
		return exec.Command(p.d.cfg.Runsc, "--root="+p.d.runscRoot(), "kill", p.spec.name, sig)
	}
	return exec.Command(p.d.cfg.Docker, "kill", "-s", sig, p.spec.name)
}

func (p *proc) cleanDirect() {
	exec.Command(p.d.cfg.Runsc, "--root="+p.d.runscRoot(), "delete", "-force", p.spec.name).Run()
	os.RemoveAll(p.bundleDir())
}

// readCgroupV1 reads usage on a cgroup v1 host, which is what Cloud Run gen2 has.
func readCgroupV1(name string) (stats, bool) {
	base := "/sys/fs/cgroup/%s/" + name + "/%s"
	at := func(ctrl, file string) string { return fmt.Sprintf(base, ctrl, file) }
	b, err := os.ReadFile(at("cpu,cpuacct", "cpuacct.usage"))
	if err != nil {
		return stats{}, false
	}
	ns, err := strconv.ParseInt(strings.TrimSpace(string(b)), 10, 64)
	if err != nil {
		return stats{}, false
	}
	s := stats{cpuUsec: ns / 1000, mem: readInt(at("memory", "memory.usage_in_bytes")),
		peak: readInt(at("memory", "memory.max_usage_in_bytes")), pids: readInt(at("pids", "pids.current")),
		memFail: readInt(at("memory", "memory.failcnt"))}
	if e, err := os.ReadFile(at("pids", "pids.events")); err == nil {
		if f := strings.Fields(string(e)); len(f) == 2 {
			s.pidsMax, _ = strconv.ParseInt(f[1], 10, 64)
		}
	}
	return s, true
}
