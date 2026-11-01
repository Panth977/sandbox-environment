package daemon

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"net"
	"os"
	"strings"
	"testing"

	"github.com/Panth977/sandbox-environment/server/go/internal/wire"
)

func TestResolveCannotDisableOrExceed(t *testing.T) {
	r := Resolve(&wire.Limits{Memory: -1, CPUs: 99, WallMs: 0, Pids: 1 << 40}, RunDefaults(), DefaultCeiling())
	if r.Memory != RunDefaults().Memory {
		t.Fatal("negative memory turned the limit off")
	}
	if r.CPUs != DefaultCeiling().CPUs || r.Pids != DefaultCeiling().Pids {
		t.Fatal("ceiling ignored")
	}
	if r.WallMs != RunDefaults().WallMs {
		t.Fatal("zero wall turned the limit off")
	}
	low := Lower(DefaultCeiling(), &wire.Limits{Memory: 1 << 20})
	if Resolve(nil, RunDefaults(), low).Memory != 1<<20 {
		t.Fatal("parent ceiling ignored")
	}
}

func TestRollingWindow(t *testing.T) {
	w := window{spanMs: 1000}
	w.add(0, 0)
	if got := w.add(500, 400_000); got != 400 {
		t.Fatal(got)
	}
	if got := w.add(1000, 500_000); got != 500 {
		t.Fatal(got)
	}
	if got := w.add(1600, 500_000); got != 100 { // the old CPU has left the window
		t.Fatal(got)
	}
}

func TestPublicIP(t *testing.T) {
	for _, s := range []string{"169.254.169.254", "10.0.0.1", "172.17.0.1", "192.168.1.1", "127.0.0.1", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fc00::1", "224.0.0.1"} {
		if publicIP(net.ParseIP(s)) {
			t.Fatal("allowed " + s)
		}
	}
	if !publicIP(net.ParseIP("1.1.1.1")) {
		t.Fatal("public refused")
	}
}

func TestHostAllowed(t *testing.T) {
	a := []string{"github.com", "*.example.com"}
	for h, want := range map[string]bool{"github.com": true, "GitHub.com.": true, "evilgithub.com": false, "a.example.com": true, "example.com": false, "github.com.evil.com": false} {
		if hostAllowed(h, a) != want {
			t.Fatal(h)
		}
	}
}

func bundle(t *testing.T, h tar.Header, body string) string {
	var b bytes.Buffer
	gz := gzip.NewWriter(&b)
	tw := tar.NewWriter(gz)
	h.Size = int64(len(body))
	if err := tw.WriteHeader(&h); err != nil {
		t.Fatal(err)
	}
	tw.Write([]byte(body))
	tw.Close()
	gz.Close()
	return base64.StdEncoding.EncodeToString(b.Bytes())
}

func TestUnpackRefusesEscapes(t *testing.T) {
	for _, h := range []tar.Header{
		{Name: "../evil", Typeflag: tar.TypeReg, Mode: 0o644},
		{Name: "/etc/evil", Typeflag: tar.TypeReg, Mode: 0o644},
		{Name: "a/../../evil", Typeflag: tar.TypeReg, Mode: 0o644},
		{Name: "link", Typeflag: tar.TypeSymlink, Linkname: "/etc"},
	} {
		if err := unpack(bundle(t, h, ""), t.TempDir()); err == nil {
			t.Fatal("accepted " + h.Name)
		}
	}
	dir := t.TempDir()
	if err := unpack(bundle(t, tar.Header{Name: "a/ok.txt", Typeflag: tar.TypeReg, Mode: 0o644}, "x"), dir); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(dir + "/a/ok.txt"); string(b) != "x" {
		t.Fatal("not written")
	}
}

func TestValidate(t *testing.T) {
	s := json.RawMessage(`{"type":"object","properties":{"id":{"type":"string","maxLength":3},"n":{"anyOf":[{"type":"integer"},{"type":"null"}]},"e":{"enum":["a","b"]}},"required":["id"]}`)
	good := []any{map[string]any{"id": "abc"}, map[string]any{"id": "a", "n": nil, "e": "b"}, map[string]any{"id": "a", "n": 3.0}}
	bad := []any{nil, map[string]any{}, map[string]any{"id": 1.0}, map[string]any{"id": "abcd"}, map[string]any{"id": "a", "n": 1.5}, map[string]any{"id": "a", "e": "c"}, map[string]any{"id": "a", "x": 1.0}}
	for _, v := range good {
		if err := Validate(s, v); err != nil {
			t.Fatal(err)
		}
	}
	for _, v := range bad {
		if Validate(s, v) == nil {
			t.Fatalf("accepted %v", v)
		}
	}
}

func TestInputChecks(t *testing.T) {
	ok := wire.CompileInput{Environment: wire.Environment{Runtime: "sh", Version: "alpine"}, Files: []wire.File{{Path: "main.sh"}}}
	if d, _ := checkInput(&ok); len(d) != 0 {
		t.Fatal(d)
	}
	bad := []wire.CompileInput{
		{Environment: wire.Environment{Runtime: "ruby", Version: "3"}, Files: ok.Files},
		{Environment: wire.Environment{Runtime: "sh", Version: "alpine"}, Files: []wire.File{{Path: "../x"}}},
		{Environment: wire.Environment{Runtime: "sh", Version: "alpine"}, Files: []wire.File{{Path: ".sbx/api.json"}}},
		{Environment: wire.Environment{Runtime: "node", Version: "22", Dependencies: map[string]string{"--evil": "1"}}, Files: ok.Files},
		{Environment: wire.Environment{Runtime: "node", Version: "22", Dependencies: map[string]string{"a; rm -rf /": "1"}}, Files: ok.Files},
	}
	for _, in := range bad {
		if d, _ := checkInput(&in); len(d) == 0 {
			t.Fatalf("accepted %+v", in)
		}
	}
}

func TestGeneratedGoHasEveryAPI(t *testing.T) {
	s := wire.Schema{"a.b": {Kind: "unary", Input: json.RawMessage(`{"type":"object","properties":{"x":{"type":"string"}},"required":["x"]}`), Output: json.RawMessage(`{"type":"null"}`)}}
	g := GoPackage(s, wire.Schema{}, "app/sbx/sbxkit")
	if !strings.Contains(g, `sbxkit.Call[any](ctx, "a.b", in)`) || !strings.Contains(g, "HostABInput") {
		t.Fatal(g)
	}
}
