package daemon

import "github.com/Panth977/sandbox-environment/server/go/internal/wire"

const mib = 1 << 20

// RunDefaults are the fail-safes of run().
func RunDefaults() wire.Limits {
	return wire.Limits{
		CPUs: 0.5, CPUBurst: &wire.CPUBurst{Ms: 2000, WindowMs: 10000}, WallMs: 300000,
		Memory: 128 * mib, Pids: 128, Disk: 8 * mib, CallMs: 30000,
		FrameBytes: 1 * mib, FramesPerSec: 2000, LogBytes: 16 * mib, Concurrency: 64,
	}
}

// CompileDefaults are the fail-safes of compile(). The compiler is user-controlled
// work (install steps, build tools), so its CPU counts like any other.
func CompileDefaults() wire.Limits {
	return wire.Limits{
		CPUs: 2, CPUBudgetMs: 180000, WallMs: 300000,
		Memory: 1024 * mib, Pids: 512, Disk: 512 * mib,
		FrameBytes: 64 * mib, FramesPerSec: 1 << 40, LogBytes: 16 * mib,
	}
}

// DefaultCeiling caps anything a parent asks for, unless the operator changes it.
func DefaultCeiling() wire.Limits {
	return wire.Limits{
		CPUs: 4, CPUBurst: &wire.CPUBurst{Ms: 600000, WindowMs: 1000}, CPUBudgetMs: 86400000, WallMs: 604800000,
		IdleMs: 604800000, Memory: 4096 * mib, Pids: 1024, Disk: 1024 * mib, CallMs: 3600000,
		FrameBytes: 16 * mib, FramesPerSec: 20000, LogBytes: 256 * mib, Concurrency: 1024,
	}
}

func pick(want, def, max int64) int64 {
	v := want
	if v <= 0 {
		v = def
	}
	if max > 0 && v > max {
		v = max
	}
	return v
}

// Resolve merges a request onto defaults and clamps it to the ceiling. No field can
// be turned off: zero or negative means the default.
func Resolve(want *wire.Limits, def, ceil wire.Limits) wire.Limits {
	if want == nil {
		want = &wire.Limits{}
	}
	out := def
	out.CPUs = def.CPUs
	if want.CPUs > 0 {
		out.CPUs = want.CPUs
	}
	if ceil.CPUs > 0 && out.CPUs > ceil.CPUs {
		out.CPUs = ceil.CPUs
	}
	if want.CPUBurst != nil && want.CPUBurst.Ms > 0 && want.CPUBurst.WindowMs > 0 {
		b := *want.CPUBurst
		out.CPUBurst = &b
	}
	out.CPUBudgetMs = pick(want.CPUBudgetMs, def.CPUBudgetMs, ceil.CPUBudgetMs)
	out.WallMs = pick(want.WallMs, def.WallMs, ceil.WallMs)
	out.IdleMs = pick(want.IdleMs, def.IdleMs, ceil.IdleMs)
	out.Memory = pick(want.Memory, def.Memory, ceil.Memory)
	out.Pids = pick(want.Pids, def.Pids, ceil.Pids)
	out.Disk = pick(want.Disk, def.Disk, ceil.Disk)
	out.CallMs = pick(want.CallMs, def.CallMs, ceil.CallMs)
	out.FrameBytes = pick(want.FrameBytes, def.FrameBytes, ceil.FrameBytes)
	out.FramesPerSec = pick(want.FramesPerSec, def.FramesPerSec, ceil.FramesPerSec)
	out.LogBytes = pick(want.LogBytes, def.LogBytes, ceil.LogBytes)
	out.Concurrency = pick(want.Concurrency, def.Concurrency, ceil.Concurrency)
	return out
}

// sample is a CPU reading at a moment.
type sample struct{ atMs, cpuUsec int64 }

// window answers "how much CPU in the last N ms?" over readings kept in a ring.
type window struct {
	spanMs int64
	s      []sample
}

func (w *window) add(atMs, cpuUsec int64) int64 {
	w.s = append(w.s, sample{atMs, cpuUsec})
	cut := 0
	for cut+1 < len(w.s) && w.s[cut+1].atMs <= atMs-w.spanMs {
		cut++
	}
	w.s = w.s[cut:]
	return (cpuUsec - w.s[0].cpuUsec) / 1000
}

// Lower caps a ceiling with what a parent set for itself. Zero fields change nothing.
func Lower(c wire.Limits, p *wire.Limits) wire.Limits {
	if p == nil {
		return c
	}
	down := func(a, b int64) int64 {
		if b > 0 && (a == 0 || b < a) {
			return b
		}
		return a
	}
	if p.CPUs > 0 && p.CPUs < c.CPUs {
		c.CPUs = p.CPUs
	}
	c.CPUBudgetMs = down(c.CPUBudgetMs, p.CPUBudgetMs)
	c.WallMs = down(c.WallMs, p.WallMs)
	c.IdleMs = down(c.IdleMs, p.IdleMs)
	c.Memory = down(c.Memory, p.Memory)
	c.Pids = down(c.Pids, p.Pids)
	c.Disk = down(c.Disk, p.Disk)
	c.CallMs = down(c.CallMs, p.CallMs)
	c.FrameBytes = down(c.FrameBytes, p.FrameBytes)
	c.FramesPerSec = down(c.FramesPerSec, p.FramesPerSec)
	c.LogBytes = down(c.LogBytes, p.LogBytes)
	c.Concurrency = down(c.Concurrency, p.Concurrency)
	return c
}
