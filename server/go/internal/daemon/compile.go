package daemon

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"

	sandboxkits "github.com/Panth977/sandbox-environment/server/go"
	"github.com/Panth977/sandbox-environment/server/go/internal/wire"
)

type runtimeDef struct {
	versions map[string]string // version -> build image
	runImage func(build string) string
	entry    string
	js       bool
	registry []string
}

const denoImage = "denoland/deno:alpine"

var runtimes = map[string]runtimeDef{
	"node": {versions: map[string]string{"22": "node:22-alpine", "24": "node:24-alpine"}, entry: "main.ts", js: true, registry: []string{"registry.npmjs.org"}},
	"bun":  {versions: map[string]string{"1": "oven/bun:1-alpine"}, entry: "main.ts", js: true, registry: []string{"registry.npmjs.org"}},
	"deno": {versions: map[string]string{"2": denoImage}, entry: "main.ts", js: true, registry: []string{"registry.npmjs.org", "jsr.io", "npm.jsr.io"}},
	"python": {versions: map[string]string{"3.12": "python:3.12-alpine", "3.13": "python:3.13-alpine"}, entry: "main.py",
		registry: []string{"pypi.org", "files.pythonhosted.org"}},
	"go": {versions: map[string]string{"1.23": "golang:1.23-alpine", "1.24": "golang:1.24-alpine"}, entry: "main.go",
		registry: []string{"proxy.golang.org", "sum.golang.org"}, runImage: func(string) string { return "alpine:3.20" }},
	"sh": {versions: map[string]string{"alpine": "alpine:3.20"}, entry: "main.sh"},
}

func allowedImage(image string) bool {
	repo := regexp.MustCompile(`[:@].*$`).ReplaceAllString(image, "")
	for _, r := range []string{directImage, "node", "oven/bun", "denoland/deno", "python", "alpine"} {
		if repo == r {
			return true
		}
	}
	return false
}

var (
	depName = regexp.MustCompile(`^[@A-Za-z0-9._/~-]+$`)
	depVer  = regexp.MustCompile(`^[A-Za-z0-9._+~^=<>*-]+$`)
)

func (d *Daemon) pinned(image string) (string, error) {
	if d.direct() {
		return directImage, nil
	}
	inspect := func() string {
		out, _ := exec.Command(d.cfg.Docker, "image", "inspect", "-f", `{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}`, image).Output()
		return strings.TrimSpace(string(out))
	}
	if err := exec.Command(d.cfg.Docker, "image", "inspect", image).Run(); err != nil {
		if out, err := exec.Command(d.cfg.Docker, "pull", "-q", image).CombinedOutput(); err != nil {
			return "", fmt.Errorf("pull %s: %s", image, strings.TrimSpace(string(out)))
		}
	}
	if p := inspect(); p != "" {
		return p, nil
	}
	return image, nil
}

func diag(source, msg string) wire.Diagnostic {
	return wire.Diagnostic{Message: msg, Severity: "error", Source: source}
}

func checkInput(in *wire.CompileInput) ([]wire.Diagnostic, runtimeDef) {
	var out []wire.Diagnostic
	rt, ok := runtimes[in.Environment.Runtime]
	if !ok {
		return []wire.Diagnostic{diag("schema", "unknown runtime "+in.Environment.Runtime)}, rt
	}
	if _, ok := rt.versions[in.Environment.Version]; !ok {
		out = append(out, diag("schema", "unsupported version "+in.Environment.Version))
	}
	if len(in.Files) == 0 || len(in.Files) > 2000 {
		out = append(out, diag("schema", "files must hold 1 to 2000 entries"))
	}
	for _, f := range in.Files {
		p, ok := safePath(f.Path)
		if !ok || p == "." || strings.HasPrefix(p, ".sbx") {
			out = append(out, diag("schema", "bad file path "+f.Path))
		}
	}
	for k, v := range in.Environment.Dependencies {
		if !depName.MatchString(k) || !depVer.MatchString(v) || strings.HasPrefix(k, "-") || strings.HasPrefix(v, "-") {
			out = append(out, diag("schema", "bad dependency "+k))
		}
	}
	both := []wire.Schema{in.ApisSchema, in.ExportsSchema}
	for _, s := range both {
		for p, a := range s {
			if !regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$`).MatchString(p) {
				out = append(out, diag("schema", "bad API path "+p))
			}
			if a.Kind != "unary" && a.Kind != "stream" {
				out = append(out, diag("schema", p+": kind must be unary or stream"))
			}
			if t := parse(a.Input).Type; t != "object" && t != "null" {
				out = append(out, diag("schema", p+": input must be an object or void"))
			}
		}
	}
	return out, rt
}

func put(dir, name string, b []byte, mode os.FileMode) error {
	p := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	return os.WriteFile(p, b, mode)
}

func kit(name string) []byte {
	b, err := sandboxkits.FS.ReadFile(name)
	if err != nil {
		panic(err)
	}
	return b
}

func sortedDeps(m map[string]string) []string { return keys(m) }

// prepare writes sources, the generated API and the kit for this runtime.
func prepare(dir string, in *wire.CompileInput, entry string) (cmd, vars []string, err error) {
	for _, f := range in.Files {
		c := []byte(f.Content)
		if f.Encoding == "base64" {
			if c, err = base64.StdEncoding.DecodeString(f.Content); err != nil {
				return
			}
		}
		p, _ := safePath(f.Path)
		if err = put(dir, p, c, 0o644); err != nil {
			return
		}
	}
	api, _ := json.Marshal(map[string]wire.Schema{"apis": in.ApisSchema, "exports": in.ExportsSchema})
	put(dir, ".sbx/api.json", api, 0o644)
	vars = []string{"SBX_API=/app/.sbx/api.json"}
	deps := in.Environment.Dependencies
	switch in.Environment.Runtime {
	case "node", "bun", "deno":
		for _, n := range []string{"peer.mjs", "backend.mjs"} {
			put(dir, ".sbx/pkg/"+n, kit("kits/js/"+n), 0o644)
		}
		pkg, _ := json.Marshal(map[string]any{"name": "@panth977/sandbox", "version": "0.0.0", "type": "module", "exports": map[string]string{"./backend": "./backend.mjs"}})
		put(dir, ".sbx/pkg/package.json", pkg, 0o644)
		put(dir, ".sbx/backend.d.ts", []byte(TSModule(in.ApisSchema, in.ExportsSchema)), 0o644)
		put(dir, ".sbx/globals.d.ts", []byte("declare const Bun: any;\n"), 0o644)
		imports := map[string]string{"@panth977/sandbox/backend": "./backend.d.ts"}
		runMap := map[string]string{"@panth977/sandbox/backend": "./pkg/backend.mjs"}
		for _, k := range sortedDeps(deps) {
			imports[k] = "npm:" + k + "@" + deps[k]
			runMap[k] = imports[k]
		}
		check, _ := json.Marshal(map[string]any{"imports": imports, "nodeModulesDir": "none", "compilerOptions": map[string]any{"strict": true, "noImplicitAny": true}})
		put(dir, ".sbx/deno.check.json", check, 0o644)
		if in.Environment.Runtime == "deno" {
			conf, _ := json.Marshal(map[string]any{"imports": runMap})
			put(dir, ".sbx/deno.run.json", conf, 0o644)
			vars = append(vars, "DENO_DIR=/app/.deno", "DENO_NO_UPDATE_CHECK=1")
			cmd = []string{"deno", "run", "-A", "--no-check", "--no-lock", "--cached-only", "--config", "/app/.sbx/deno.run.json", "/app/" + entry}
		} else {
			pj, _ := json.Marshal(map[string]any{"name": "app", "private": true, "type": "module", "dependencies": deps})
			if _, statErr := os.Stat(filepath.Join(dir, "package.json")); statErr != nil {
				put(dir, "package.json", pj, 0o644)
			}
			if in.Environment.Runtime == "bun" {
				cmd = []string{"bun", "run", "--no-install", "/app/" + entry}
				vars = append(vars, "BUN_RUNTIME_TRANSPILER_CACHE_PATH=0")
			} else {
				cmd = []string{"node", "--experimental-strip-types", "--no-warnings", "/app/" + entry}
			}
		}
	case "python":
		put(dir, ".sbx/_sbx_kit.py", kit("kits/python/_sbx_kit.py"), 0o644)
		put(dir, ".sbx/sandbox_api.py", []byte("from _sbx_kit import host, env, expose, SandboxError\n"), 0o644)
		put(dir, ".sbx/sandbox_api.pyi", []byte(PyStub(in.ApisSchema, in.ExportsSchema)), 0o644)
		var req strings.Builder
		for _, k := range sortedDeps(deps) {
			req.WriteString(k + "==" + deps[k] + "\n")
		}
		put(dir, ".sbx/requirements.txt", []byte(req.String()), 0o644)
		vars = append(vars, "PYTHONPATH=/app/.sbx/site:/app/.sbx:/app", "PYTHONDONTWRITEBYTECODE=1", "PYTHONUNBUFFERED=1")
		cmd = []string{"python", "/app/" + entry}
	case "go":
		put(dir, "sbx/api.go", []byte(GoPackage(in.ApisSchema, in.ExportsSchema, "app/sbx/sbxkit")), 0o644)
		ents, _ := sandboxkits.FS.ReadDir("sbxkit")
		for _, e := range ents {
			if !strings.HasSuffix(e.Name(), "_test.go") {
				put(dir, "sbx/sbxkit/"+e.Name(), kit("sbxkit/"+e.Name()), 0o644)
			}
		}
		if _, statErr := os.Stat(filepath.Join(dir, "go.mod")); statErr != nil {
			var m strings.Builder
			m.WriteString("module app\n\ngo 1.23\n")
			for _, k := range sortedDeps(deps) {
				fmt.Fprintf(&m, "\nrequire %s %s\n", k, deps[k])
			}
			put(dir, "go.mod", []byte(m.String()), 0o644)
		}
		cmd = []string{"/app/main"}
	case "sh":
		cmd = []string{"sh", "/app/" + entry}
	}
	return
}

// buildScript runs in a sandbox: it copies /src, builds in a size-capped tmpfs, and
// writes one tar to the saved stdout. Everything else goes to stderr.
func buildScript(in *wire.CompileInput, entry string) string {
	s := "set -e\nexec 3>&1 1>&2\nmkdir -p /build/out && cp -r /src/. /build/out/ && cd /build/out\n"
	deps := len(in.Environment.Dependencies) > 0
	kitNM := "mkdir -p node_modules/@panth977 && cp -r .sbx/pkg node_modules/@panth977/sandbox\n"
	out := "/build/out"
	switch in.Environment.Runtime {
	case "node":
		if deps {
			s += "npm install --ignore-scripts --omit=dev --no-audit --no-fund --cache /build/.npm\n"
		}
		s += kitNM
	case "bun":
		if deps {
			s += "bun install --production --ignore-scripts --no-save --cache-dir /build/.bun\n"
		}
		s += kitNM
	case "deno":
		s += "export DENO_DIR=/build/out/.deno\n"
		s += "deno cache --no-check --no-lock --config .sbx/deno.run.json " + entry + "\n"
		s += "chmod -R a+rX .deno\n"
	case "python":
		if deps {
			s += "pip install --no-cache-dir --only-binary=:all: --disable-pip-version-check --target .sbx/site -r .sbx/requirements.txt\n"
		}
		s += "find . -name '*.py' -not -path './.sbx/*' | while read f; do python -c \"import sys;compile(open(sys.argv[1]).read(),sys.argv[1],'exec')\" \"$f\"; done\n"
	case "go":
		s += "export GOCACHE=/build/.cache GOPATH=/build/.gopath CGO_ENABLED=0 GOFLAGS=-mod=mod GOTOOLCHAIN=local\n"
		s += "go build -trimpath -ldflags='-s -w' -o /build/app/main .\n"
		out = "/build/app"
	case "sh":
		s += "sh -n " + entry + "\n"
	}
	return s + "tar -C " + out + " -cf - . >&3\n"
}

var (
	tsRe = regexp.MustCompile(`(?m)^TS\d+ \[ERROR\]: (.*)$(?s:.*?)at file:///src/([^:\n]+):(\d+):(\d+)`)
	tsE  = regexp.MustCompile(`(?m)^TS\d+ \[ERROR\]: (.*)$`)
	goRe = regexp.MustCompile(`(?m)^\.?/?([^\s:]+\.go):(\d+):(\d+): (.*)$`)
	pyRe = regexp.MustCompile(`File "\./([^"]+)", line (\d+)(?s:.*?)(\w*Error: [^\n]*)`)
	shRe = regexp.MustCompile(`(?m)^([^\s:]+\.sh): line (\d+): (.*)$`)
)

func parseDiags(runtime, source, text string) []wire.Diagnostic {
	var out []wire.Diagnostic
	add := func(file, line, col, msg string) {
		l, _ := strconv.Atoi(line)
		c, _ := strconv.Atoi(col)
		out = append(out, wire.Diagnostic{File: file, Line: l, Column: c, Message: strings.TrimSpace(msg), Severity: "error", Source: source})
	}
	switch {
	case source == "typecheck":
		for _, m := range tsRe.FindAllStringSubmatch(text, 50) {
			msg := m[1]
			add(m[2], m[3], m[4], msg)
		}
		if len(out) == 0 {
			for _, m := range tsE.FindAllStringSubmatch(text, 50) {
				add("", "", "", m[1])
			}
		}
	case runtime == "go":
		for _, m := range goRe.FindAllStringSubmatch(text, 50) {
			add(m[1], m[2], m[3], m[4])
		}
	case runtime == "python":
		for _, m := range pyRe.FindAllStringSubmatch(text, 50) {
			add(m[1], m[2], "", m[3])
		}
	case runtime == "sh":
		for _, m := range shRe.FindAllStringSubmatch(text, 50) {
			add(m[1], m[2], "", m[3])
		}
	}
	if len(out) == 0 {
		t := strings.TrimSpace(text)
		if len(t) > 4000 {
			t = t[len(t)-4000:]
		}
		out = append(out, diag(source, t))
	}
	return out
}

type stepResult struct {
	stdout []byte
	stderr string
	info   wire.ExitInfo
}

// step runs one compile stage under the compile limits.
func (d *Daemon) step(id, image string, script string, env []string, lim wire.Limits, src string, allow []string) (stepResult, error) {
	var r stepResult
	spec := procSpec{name: id, image: image, cmd: []string{"sh", "-c", script}, env: append(env, "HOME=/build/home", "NO_COLOR=1"), limits: lim,
		mounts: []string{src + ":/src:ro"}, workdir: "/build",
		tmpfs: []string{fmt.Sprintf("/build:size=%d,uid=1000,gid=1000,mode=1700,exec", lim.Disk), "/tmp:size=67108864,uid=1000,gid=1000,mode=1700"}}
	px := ""
	if len(allow) > 0 {
		net, name := id+"-net", id+"-px"
		ip, err := d.startProxy(name, net, allow, 512*mib, func(proxyEvent) {})
		if err != nil {
			exec.Command(d.cfg.Docker, "rm", "-f", "-v", name).Run()
			exec.Command(d.cfg.Docker, "network", "rm", net).Run()
			return r, err
		}
		px = name
		u := "http://" + ip + ":3128"
		spec.network = net
		spec.env = append(spec.env, "HTTPS_PROXY="+u, "https_proxy="+u, "HTTP_PROXY="+u, "http_proxy="+u)
		defer func() {
			exec.Command(d.cfg.Docker, "rm", "-f", "-v", px).Run()
			exec.Command(d.cfg.Docker, "network", "rm", net).Run()
		}()
	}
	p := d.newProc(spec)
	_, stdout, stderr, err := p.start()
	if err != nil {
		return r, err
	}
	var wg sync.WaitGroup
	var out, errb bytes.Buffer
	wg.Add(2)
	go func() {
		defer wg.Done()
		if n, _ := io.Copy(&out, io.LimitReader(stdout, maxBundle+1)); n > maxBundle {
			p.kill("frame-cap")
		}
		io.Copy(io.Discard, stdout)
	}()
	go func() {
		defer wg.Done()
		if n, _ := io.Copy(&errb, io.LimitReader(stderr, lim.LogBytes)); n >= lim.LogBytes {
			p.kill("log-cap")
		}
		io.Copy(io.Discard, stderr)
	}()
	wg.Wait()
	r.info = p.wait()
	r.stdout, r.stderr = out.Bytes(), errb.String()
	return r, nil
}

// retar turns the build's tar into a tar.gz of plain files and folders. Links are
// dropped here, so what comes out of a build can never point outside the bundle.
func retar(raw []byte) (string, error) {
	var buf bytes.Buffer
	gz, _ := gzip.NewWriterLevel(&buf, gzip.BestSpeed)
	tw := tar.NewWriter(gz)
	tr := tar.NewReader(bytes.NewReader(raw))
	type ent struct {
		h    tar.Header
		body []byte
	}
	var ents []ent
	for {
		h, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", err
		}
		name, ok := safePath(h.Name)
		if !ok {
			return "", fmt.Errorf("unsafe path in build output")
		}
		if name == "." || (h.Typeflag != tar.TypeReg && h.Typeflag != tar.TypeDir) {
			continue
		}
		b, _ := io.ReadAll(tr)
		ents = append(ents, ent{tar.Header{Name: name, Typeflag: h.Typeflag, Mode: h.Mode & 0o755, Size: int64(len(b))}, b})
	}
	sort.Slice(ents, func(i, j int) bool { return ents[i].h.Name < ents[j].h.Name })
	for i := range ents {
		if err := tw.WriteHeader(&ents[i].h); err != nil {
			return "", err
		}
		tw.Write(ents[i].body)
	}
	tw.Close()
	gz.Close()
	return base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}

func addUsage(t *wire.Usage, u wire.Usage) {
	t.CPUMs += u.CPUMs
	t.WallMs += u.WallMs
	t.MemoryMbSeconds += u.MemoryMbSeconds
	if u.MemoryPeakBytes > t.MemoryPeakBytes {
		t.MemoryPeakBytes = u.MemoryPeakBytes
	}
}

func breachMsg(reason string, lim wire.Limits) string {
	switch reason {
	case "cpu-budget":
		return fmt.Sprintf("compile stopped: used its %d ms CPU budget", lim.CPUBudgetMs)
	case "wall":
		return fmt.Sprintf("compile stopped: took longer than %d ms", lim.WallMs)
	case "memory":
		return fmt.Sprintf("compile stopped: used its %d MiB memory", lim.Memory/mib)
	case "pids":
		return "compile stopped: too many processes"
	case "log-cap":
		return "compile stopped: too much output"
	case "frame-cap":
		return "compile stopped: build output is too large"
	}
	return ""
}

// compile builds user code. All of it runs sandboxed under compile limits, because
// install scripts and compilers are code the user controls, and its CPU is counted.
func (d *Daemon) compile(cl *client, in *wire.CompileInput) (*wire.CompileResult, error) {
	if in == nil {
		return nil, fmt.Errorf("missing input")
	}
	res := &wire.CompileResult{Diagnostics: []wire.Diagnostic{}}
	ds, rt := checkInput(in)
	if len(ds) > 0 {
		res.Diagnostics = ds
		return res, nil
	}
	if d.direct() {
		if r := in.Environment.Runtime; r != "node" && r != "deno" && r != "sh" {
			res.Diagnostics = []wire.Diagnostic{diag("schema", "this host runs node, deno and sh only")}
			return res, nil
		}
		if len(in.Environment.Dependencies) > 0 {
			res.Diagnostics = []wire.Diagnostic{diag("schema", "this host has no network for dependencies")}
			return res, nil
		}
	}
	lim := Resolve(in.Limits, CompileDefaults(), cl.ceiling())
	entry := in.Environment.Entry
	if entry == "" {
		entry = rt.entry
	}
	if p, ok := safePath(entry); !ok || p == "." {
		res.Diagnostics = []wire.Diagnostic{diag("schema", "bad entry")}
		return res, nil
	}
	id := newID("sbx-c")
	dir := filepath.Join(d.cfg.DataDir, id)
	src := filepath.Join(dir, "src")
	defer os.RemoveAll(dir)
	if err := os.MkdirAll(src, 0o755); err != nil {
		return nil, err
	}
	cmd, vars, err := prepare(src, in, entry)
	if err != nil {
		return nil, err
	}
	image := rt.versions[in.Environment.Version]
	runImage := image
	if rt.runImage != nil {
		runImage = rt.runImage(image)
	}
	pinnedBuild, err := d.pinned(image)
	if err != nil {
		return nil, err
	}
	pinnedRun, err := d.pinned(runImage)
	if err != nil {
		return nil, err
	}
	deps := len(in.Environment.Dependencies) > 0
	if rt.js && strings.HasSuffix(entry, ".ts") {
		deno, err := d.pinned(denoImage)
		if err != nil {
			return nil, err
		}
		var allow []string
		usesNode := false
		for _, f := range in.Files {
			usesNode = usesNode || strings.Contains(f.Content, "node:")
		}
		if (deps || usesNode) && !d.direct() {
			allow = runtimes["node"].registry
		}
		script := "exec 1>&2\nexport DENO_DIR=/build/deno\nset -e\n[ -d /opt/deno-cache ] && cp -r /opt/deno-cache /build/deno\ncd /src\ndeno check --no-lock --config .sbx/deno.check.json .sbx/globals.d.ts " + entry + "\n"
		r, err := d.step(id+"-t", deno, script, nil, lim, src, allow)
		if err != nil {
			return nil, err
		}
		addUsage(&res.Usage, r.info.Usage)
		if msg := breachMsg(r.info.Reason, lim); msg != "" {
			res.Diagnostics = []wire.Diagnostic{diag("build", msg)}
			return res, nil
		}
		if r.info.Reason != "exit" {
			res.Diagnostics = parseDiags("", "typecheck", r.stderr)
			return res, nil
		}
		lim.CPUBudgetMs -= res.Usage.CPUMs
		if lim.CPUBudgetMs < 1 {
			lim.CPUBudgetMs = 1
		}
	}
	var allow []string
	if deps {
		allow = rt.registry
	}
	r, err := d.step(id+"-b", pinnedBuild, buildScript(in, entry), nil, lim, src, allow)
	if err != nil {
		return nil, err
	}
	addUsage(&res.Usage, r.info.Usage)
	if msg := breachMsg(r.info.Reason, lim); msg != "" {
		res.Diagnostics = []wire.Diagnostic{diag("build", msg)}
		return res, nil
	}
	if r.info.Reason != "exit" {
		res.Diagnostics = parseDiags(in.Environment.Runtime, "build", r.stderr)
		return res, nil
	}
	bundle, err := retar(r.stdout)
	if err != nil {
		res.Diagnostics = []wire.Diagnostic{diag("build", err.Error())}
		return res, nil
	}
	e := in.Environment
	e.Entry = entry
	code := wire.CompiledCode{Format: 1, Environment: e, Image: pinnedRun, Cmd: cmd, EnvVars: vars, Bundle: bundle,
		ApisSchema: nonNil(in.ApisSchema), ExportsSchema: nonNil(in.ExportsSchema)}
	code.Hash = codeHash(code)
	res.OK, res.CompiledCode = true, &code
	return res, nil
}

func nonNil(s wire.Schema) wire.Schema {
	if s == nil {
		return wire.Schema{}
	}
	return s
}
