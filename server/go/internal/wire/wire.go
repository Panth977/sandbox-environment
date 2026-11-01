// Package wire holds the JSON shapes sandboxd shares with every parent SDK.
package wire

import "encoding/json"

// Limits are the fail-safes of one run or one compile. Zero means "use the default".
type Limits struct {
	CPUs         float64   `json:"cpus,omitempty"`
	CPUBurst     *CPUBurst `json:"cpuBurst,omitempty"`
	CPUBudgetMs  int64     `json:"cpuBudgetMs,omitempty"`
	WallMs       int64     `json:"wallMs,omitempty"`
	IdleMs       int64     `json:"idleMs,omitempty"`
	Memory       int64     `json:"memory,omitempty"`
	Pids         int64     `json:"pids,omitempty"`
	Disk         int64     `json:"disk,omitempty"`
	CallMs       int64     `json:"callMs,omitempty"`
	FrameBytes   int64     `json:"frameBytes,omitempty"`
	FramesPerSec int64     `json:"framesPerSec,omitempty"`
	LogBytes     int64     `json:"logBytes,omitempty"`
	Concurrency  int64     `json:"concurrency,omitempty"`
}

// CPUBurst allows Ms of CPU time in any rolling WindowMs.
type CPUBurst struct {
	Ms       int64 `json:"ms"`
	WindowMs int64 `json:"windowMs"`
}

// Network is the egress policy of a run. Empty Allow means no network at all.
type Network struct {
	Allow []string `json:"allow"`
	Bytes int64    `json:"bytes,omitempty"`
}

// Usage is what a sandbox has consumed so far.
type Usage struct {
	CPUMs           int64   `json:"cpuMs"`
	WallMs          int64   `json:"wallMs"`
	HostWaitMs      int64   `json:"hostWaitMs"`
	MemoryMbSeconds float64 `json:"memoryMbSeconds"`
	MemoryBytes     int64   `json:"memoryBytes"`
	MemoryPeakBytes int64   `json:"memoryPeakBytes"`
	Pids            int64   `json:"pids"`
	NetInBytes      int64   `json:"netInBytes"`
	NetOutBytes     int64   `json:"netOutBytes"`
	Calls           int64   `json:"calls"`
}

// ExitInfo says how a sandbox ended.
type ExitInfo struct {
	Reason     string `json:"reason"`
	Code       *int   `json:"code"`
	DurationMs int64  `json:"durationMs"`
	Usage      Usage  `json:"usage"`
}

// Event is one entry of the live monitor stream.
type Event struct {
	Type      string    `json:"type"`
	At        int64     `json:"at"`
	StartMs   int64     `json:"startMs,omitempty"`
	Stream    string    `json:"stream,omitempty"`
	Text      string    `json:"text,omitempty"`
	Usage     *Usage    `json:"usage,omitempty"`
	Direction string    `json:"direction,omitempty"`
	Path      string    `json:"path,omitempty"`
	Ms        int64     `json:"ms,omitempty"`
	Error     string    `json:"error,omitempty"`
	Host      string    `json:"host,omitempty"`
	Allowed   *bool     `json:"allowed,omitempty"`
	BytesIn   int64     `json:"bytesIn,omitempty"`
	BytesOut  int64     `json:"bytesOut,omitempty"`
	Limit     string    `json:"limit,omitempty"`
	Used      int64     `json:"used,omitempty"`
	Max       int64     `json:"max,omitempty"`
	Info      *ExitInfo `json:"info,omitempty"`
}

// Environment says what the code runs on.
type Environment struct {
	Runtime      string            `json:"runtime"`
	Version      string            `json:"version"`
	Dependencies map[string]string `json:"dependencies,omitempty"`
	Entry        string            `json:"entry,omitempty"`
}

// File is one source file. Encoding is "utf8" (default) or "base64".
type File struct {
	Path     string `json:"path"`
	Content  string `json:"content"`
	Encoding string `json:"encoding,omitempty"`
}

// RateLimit is a per-API token bucket.
type RateLimit struct {
	PerSecond float64 `json:"perSecond,omitempty"`
	Burst     float64 `json:"burst,omitempty"`
}

// ApiSpec is one API, flattened to a dotted path in Schemas.
type ApiSpec struct {
	Kind        string          `json:"kind"` // "unary" | "stream"
	Input       json.RawMessage `json:"input"`
	Output      json.RawMessage `json:"output,omitempty"`
	Item        json.RawMessage `json:"item,omitempty"`
	Description string          `json:"description,omitempty"`
	TimeoutMs   int64           `json:"timeoutMs,omitempty"`
	RateLimit   *RateLimit      `json:"rateLimit,omitempty"`
}

// Schema maps a dotted path to its spec.
type Schema map[string]ApiSpec

// Diagnostic is one compile problem.
type Diagnostic struct {
	File     string `json:"file,omitempty"`
	Line     int    `json:"line,omitempty"`
	Column   int    `json:"column,omitempty"`
	Message  string `json:"message"`
	Severity string `json:"severity"`
	Source   string `json:"source"`
}

// CompileInput is what compile takes.
type CompileInput struct {
	Environment   Environment `json:"environment"`
	Files         []File      `json:"files"`
	ApisSchema    Schema      `json:"apisSchema"`
	ExportsSchema Schema      `json:"exportsSchema,omitempty"`
	Limits        *Limits     `json:"limits,omitempty"`
}

// CompiledCode is plain JSON: store it anywhere, run it on any sandboxd.
type CompiledCode struct {
	Format        int         `json:"format"`
	Hash          string      `json:"hash"`
	Environment   Environment `json:"environment"`
	Image         string      `json:"image"`
	Cmd           []string    `json:"cmd"`
	EnvVars       []string    `json:"envVars,omitempty"`
	Bundle        string      `json:"bundle"` // tar.gz, base64
	ApisSchema    Schema      `json:"apisSchema"`
	ExportsSchema Schema      `json:"exportsSchema"`
}

// CompileResult is what compile returns. Bad user code is a result, not an error.
type CompileResult struct {
	OK           bool          `json:"ok"`
	CompiledCode *CompiledCode `json:"compiledCode,omitempty"`
	Diagnostics  []Diagnostic  `json:"diagnostics"`
	Usage        Usage         `json:"usage"`
}

// RunRequest starts stored code.
type RunRequest struct {
	CompiledCode CompiledCode   `json:"compiledCode"`
	Limits       *Limits        `json:"limits,omitempty"`
	Network      *Network       `json:"network,omitempty"`
	Env          map[string]any `json:"env,omitempty"`
}

// Msg is one line between a parent SDK and sandboxd.
type Msg struct {
	Op      string          `json:"op"`
	Rid     int64           `json:"rid,omitempty"`
	ID      string          `json:"id,omitempty"`
	Token   string          `json:"token,omitempty"`
	Limits  *Limits         `json:"limits,omitempty"`
	Compile *CompileInput   `json:"compile,omitempty"`
	Run     *RunRequest     `json:"run,omitempty"`
	GraceMs int64           `json:"graceMs,omitempty"`
	M       json.RawMessage `json:"m,omitempty"`
	Event   *Event          `json:"event,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   string          `json:"error,omitempty"`
}
