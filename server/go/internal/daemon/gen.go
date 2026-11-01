package daemon

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/Panth977/sandbox-environment/server/go/internal/wire"
)

// sc is the JSON Schema subset the builders emit.
type sc struct {
	Type       string         `json:"type"`
	Properties map[string]*sc `json:"properties"`
	Required   []string       `json:"required"`
	Items      *sc            `json:"items"`
	Enum       []any          `json:"enum"`
	Const      any            `json:"const"`
	AnyOf      []*sc          `json:"anyOf"`
	Additional *sc            `json:"additionalProperties"`
	Format     string         `json:"format"`
}

func parse(raw json.RawMessage) *sc {
	s := &sc{}
	if len(raw) > 0 {
		json.Unmarshal(raw, s)
	}
	return s
}

func (s *sc) nullable() (*sc, bool) {
	if len(s.AnyOf) == 2 {
		for i, o := range s.AnyOf {
			if o.Type == "null" {
				return s.AnyOf[1-i], true
			}
		}
	}
	return s, false
}

func (s *sc) req(k string) bool {
	for _, r := range s.Required {
		if r == k {
			return true
		}
	}
	return false
}

func keys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func jsLit(v any) string { b, _ := json.Marshal(v); return string(b) }

// ---- TypeScript ----

func tsType(s *sc) string {
	switch {
	case s.Const != nil:
		return jsLit(s.Const)
	case len(s.Enum) > 0:
		p := []string{}
		for _, e := range s.Enum {
			p = append(p, jsLit(e))
		}
		return strings.Join(p, " | ")
	case len(s.AnyOf) > 0:
		p := []string{}
		for _, o := range s.AnyOf {
			p = append(p, tsType(o))
		}
		return strings.Join(p, " | ")
	}
	switch s.Type {
	case "string":
		return "string"
	case "number", "integer":
		return "number"
	case "boolean":
		return "boolean"
	case "null":
		return "void"
	case "array":
		if s.Items == nil {
			return "unknown[]"
		}
		return "(" + tsType(s.Items) + ")[]"
	case "object":
		if s.Additional != nil {
			return "Record<string, " + tsType(s.Additional) + ">"
		}
		p := []string{}
		for _, k := range keys(s.Properties) {
			q := "?"
			if s.req(k) {
				q = ""
			}
			p = append(p, jsLit(k)+q+": "+tsType(s.Properties[k]))
		}
		return "{ " + strings.Join(p, "; ") + " }"
	}
	return "unknown"
}

type node struct {
	spec *wire.ApiSpec
	kids map[string]*node
}

func tree(s wire.Schema) *node {
	root := &node{kids: map[string]*node{}}
	for _, p := range keys(s) {
		n := root
		for _, part := range strings.Split(p, ".") {
			if n.kids[part] == nil {
				n.kids[part] = &node{kids: map[string]*node{}}
			}
			n = n.kids[part]
		}
		v := s[p]
		n.spec = &v
	}
	return root
}

func tsTree(n *node, member func(name string, spec wire.ApiSpec) string, ind string) string {
	var b strings.Builder
	for _, k := range keys(n.kids) {
		c := n.kids[k]
		if c.spec != nil {
			b.WriteString(ind + member(k, *c.spec) + "\n")
		} else {
			b.WriteString(ind + k + ": {\n" + tsTree(c, member, ind+"  ") + ind + "};\n")
		}
	}
	return b.String()
}

// TSModule is the body of the typed child API.
func TSModule(in wire.Schema, ex wire.Schema) string {
	host := tsTree(tree(in), func(k string, s wire.ApiSpec) string {
		i := tsType(parse(s.Input))
		if s.Kind == "stream" {
			return fmt.Sprintf("%s(input: %s, call?: Call): AsyncIterable<%s>;", k, i, tsType(parse(s.Item)))
		}
		return fmt.Sprintf("%s(input: %s, call?: Call): Promise<%s>;", k, i, tsType(parse(s.Output)))
	}, "  ")
	exp := tsTree(tree(ex), func(k string, s wire.ApiSpec) string {
		i := tsType(parse(s.Input))
		if s.Kind == "stream" {
			return fmt.Sprintf("%s(input: %s, ctx: { signal: AbortSignal }): AsyncIterable<%s>;", k, i, tsType(parse(s.Item)))
		}
		o := tsType(parse(s.Output))
		return fmt.Sprintf("%s(input: %s, ctx: { signal: AbortSignal }): Promise<%s> | %s;", k, i, o, o)
	}, "  ")
	return "export interface Call { signal?: AbortSignal; timeoutMs?: number }\n" +
		"export declare const host: {\n" + host + "};\n" +
		"export interface Exports {\n" + exp + "}\n" +
		"export declare function expose(impl: Exports): void;\n" +
		"export declare const env: Readonly<Record<string, string | number | boolean>>;\n" +
		"export declare class SandboxError extends Error { code: string; data?: unknown }\n"
}

// ---- Python ----

type pyGen struct {
	decls []string
	seen  map[string]bool
}

func pascal(s string) string {
	parts := regexp.MustCompile(`[^A-Za-z0-9]+`).Split(s, -1)
	var b strings.Builder
	for _, p := range parts {
		if p != "" {
			b.WriteString(strings.ToUpper(p[:1]) + p[1:])
		}
	}
	return b.String()
}

func snake(s string) string {
	s = regexp.MustCompile(`([a-z0-9])([A-Z])`).ReplaceAllString(s, "${1}_$2")
	return strings.ToLower(strings.ReplaceAll(s, ".", "_"))
}

func (g *pyGen) ty(name string, s *sc) string {
	if s.Const != nil || len(s.Enum) > 0 {
		v := s.Enum
		if s.Const != nil {
			v = []any{s.Const}
		}
		p := []string{}
		for _, e := range v {
			p = append(p, jsLit(e))
		}
		return "Literal[" + strings.Join(p, ", ") + "]"
	}
	if inner, ok := s.nullable(); ok {
		return g.ty(name, inner) + " | None"
	}
	if len(s.AnyOf) > 0 {
		p := []string{}
		for i, o := range s.AnyOf {
			p = append(p, g.ty(fmt.Sprintf("%s%d", name, i), o))
		}
		return strings.Join(p, " | ")
	}
	switch s.Type {
	case "string":
		return "str"
	case "number":
		return "float"
	case "integer":
		return "int"
	case "boolean":
		return "bool"
	case "null":
		return "None"
	case "array":
		if s.Items == nil {
			return "list[Any]"
		}
		return "list[" + g.ty(name+"Item", s.Items) + "]"
	case "object":
		if s.Additional != nil {
			return "dict[str, " + g.ty(name+"Value", s.Additional) + "]"
		}
		if !g.seen[name] {
			g.seen[name] = true
			var b strings.Builder
			b.WriteString("class " + name + "(TypedDict):\n")
			if len(s.Properties) == 0 {
				b.WriteString("    pass\n")
			}
			for _, k := range keys(s.Properties) {
				t := g.ty(name+pascal(k), s.Properties[k])
				if !s.req(k) {
					t = "NotRequired[" + t + "]"
				}
				b.WriteString("    " + k + ": " + t + "\n")
			}
			g.decls = append(g.decls, b.String())
		}
		return name
	}
	return "Any"
}

func (g *pyGen) kwargs(name string, raw json.RawMessage) string {
	s := parse(raw)
	if s.Type != "object" || s.Additional != nil {
		return ""
	}
	p := []string{"*"}
	for _, k := range keys(s.Properties) {
		t := g.ty(name+pascal(k), s.Properties[k])
		if s.req(k) {
			p = append(p, k+": "+t)
		} else {
			p = append(p, k+": "+t+" | None = ...")
		}
	}
	if len(p) == 1 {
		return ""
	}
	return ", " + strings.Join(p, ", ")
}

func (g *pyGen) host(n *node, name string, b *strings.Builder) {
	var body strings.Builder
	for _, k := range keys(n.kids) {
		c := n.kids[k]
		if c.spec == nil {
			g.host(c, name+pascal(k), b)
			body.WriteString("    " + k + ": _" + name + pascal(k) + "\n")
			continue
		}
		base := name + pascal(k)
		args := g.kwargs(base+"Input", c.spec.Input)
		if c.spec.Kind == "stream" {
			body.WriteString(fmt.Sprintf("    def %s(self%s) -> AsyncIterator[%s]: ...\n", k, args, g.ty(base+"Item", parse(c.spec.Item))))
		} else {
			body.WriteString(fmt.Sprintf("    async def %s(self%s) -> %s: ...\n", k, args, g.ty(base+"Output", parse(c.spec.Output))))
		}
	}
	if body.Len() == 0 {
		body.WriteString("    pass\n")
	}
	b.WriteString("class _" + name + ":\n" + body.String() + "\n")
}

// PyStub is the typed view of sandbox_api for editors and mypy.
func PyStub(in, ex wire.Schema) string {
	g := &pyGen{seen: map[string]bool{}}
	var h strings.Builder
	g.host(tree(in), "Host", &h)
	var e strings.Builder
	for _, p := range keys(ex) {
		s := ex[p]
		base := pascal(p)
		m := snake(p)
		args := g.kwargs(base+"Input", s.Input)
		if s.Kind == "stream" {
			e.WriteString(fmt.Sprintf("    def %s(self%s) -> AsyncIterator[%s]: ...\n", m, args, g.ty(base+"Item", parse(s.Item))))
		} else {
			e.WriteString(fmt.Sprintf("    async def %s(self%s) -> %s: ...\n", m, args, g.ty(base+"Output", parse(s.Output))))
		}
	}
	if e.Len() == 0 {
		e.WriteString("    pass\n")
	}
	return "# Generated from the schema. Do not edit.\nfrom typing import Any, AsyncIterator, Literal, Mapping, NotRequired, Protocol, TypedDict\n\n" +
		strings.Join(g.decls, "\n") + "\n" + h.String() + "class Exports(Protocol):\n" + e.String() +
		"\nhost: _Host\nenv: Mapping[str, str | int | float | bool]\ndef expose(impl: Exports) -> None: ...\nclass SandboxError(Exception):\n    code: str\n"
}

// ---- Go ----

type goGen struct {
	decls []string
	seen  map[string]bool
}

func (g *goGen) ty(name string, s *sc) string {
	if s.Const != nil {
		s = &sc{Type: fmt.Sprintf("%T", s.Const)}
		if s.Type == "float64" {
			s.Type = "number"
		}
	}
	if len(s.Enum) > 0 {
		return "string"
	}
	if inner, ok := s.nullable(); ok {
		t := g.ty(name, inner)
		if strings.HasPrefix(t, "[]") || strings.HasPrefix(t, "map[") || t == "any" {
			return t
		}
		return "*" + t
	}
	if len(s.AnyOf) > 0 {
		return "any"
	}
	switch s.Type {
	case "string":
		if s.Format == "byte" {
			return "[]byte"
		}
		if s.Format == "date-time" {
			return "time.Time"
		}
		return "string"
	case "number":
		return "float64"
	case "integer":
		return "int64"
	case "boolean":
		return "bool"
	case "null":
		return "struct{}"
	case "array":
		if s.Items == nil {
			return "[]any"
		}
		return "[]" + g.ty(name+"Item", s.Items)
	case "object":
		if s.Additional != nil {
			return "map[string]" + g.ty(name+"Value", s.Additional)
		}
		if !g.seen[name] {
			g.seen[name] = true
			var b strings.Builder
			b.WriteString("type " + name + " struct {\n")
			for _, k := range keys(s.Properties) {
				t := g.ty(name+pascal(k), s.Properties[k])
				tag := k
				if !s.req(k) {
					tag += ",omitempty"
					if !strings.HasPrefix(t, "[]") && !strings.HasPrefix(t, "map[") && !strings.HasPrefix(t, "*") && t != "any" {
						t = "*" + t
					}
				}
				b.WriteString(fmt.Sprintf("\t%s %s `json:%q`\n", pascal(k), t, tag))
			}
			b.WriteString("}\n")
			g.decls = append(g.decls, b.String())
		}
		return name
	}
	return "any"
}

func isVoid(raw json.RawMessage) bool { return len(raw) == 0 || parse(raw).Type == "null" }

func (g *goGen) ns(n *node, path, name string, b *strings.Builder) {
	var fields strings.Builder
	for _, k := range keys(n.kids) {
		c := n.kids[k]
		sub := strings.TrimPrefix(path+"."+k, ".")
		base := name + pascal(k)
		if c.spec == nil {
			g.ns(c, sub, base, b)
			fields.WriteString("\t" + pascal(k) + " ns" + base + "\n")
			continue
		}
		param, arg := "", "nil"
		if !isVoid(c.spec.Input) {
			param, arg = ", in "+g.ty(base+"Input", parse(c.spec.Input)), "in"
		}
		recv := "ns" + name
		m := pascal(k)
		switch {
		case c.spec.Kind == "stream":
			t := g.ty(base+"Item", parse(c.spec.Item))
			fmt.Fprintf(b, "func (%s) %s(ctx context.Context%s) iter.Seq2[%s, error] {\n\treturn sbxkit.Stream[%s](ctx, %q, %s)\n}\n", recv, m, param, t, t, sub, arg)
		case isVoid(c.spec.Output):
			fmt.Fprintf(b, "func (%s) %s(ctx context.Context%s) error {\n\t_, err := sbxkit.Call[any](ctx, %q, %s)\n\treturn err\n}\n", recv, m, param, sub, arg)
		default:
			t := g.ty(base+"Output", parse(c.spec.Output))
			fmt.Fprintf(b, "func (%s) %s(ctx context.Context%s) (%s, error) {\n\treturn sbxkit.Call[%s](ctx, %q, %s)\n}\n", recv, m, param, t, t, sub, arg)
		}
	}
	fmt.Fprintf(b, "type ns%s struct {\n%s}\n", name, fields.String())
}

// GoPackage is the generated sbx package.
func GoPackage(in, ex wire.Schema, kitImport string) string {
	g := &goGen{seen: map[string]bool{}}
	var h strings.Builder
	g.ns(tree(in), "", "Host", &h)
	var iface, reg strings.Builder
	for _, p := range keys(ex) {
		s := ex[p]
		base := pascal(p)
		it := "struct{}"
		if !isVoid(s.Input) {
			it = g.ty(base+"Input", parse(s.Input))
		}
		if s.Kind == "stream" {
			t := g.ty(base+"Item", parse(s.Item))
			fmt.Fprintf(&iface, "\t%s(ctx context.Context, in %s) iter.Seq2[%s, error]\n", base, it, t)
			fmt.Fprintf(&reg, "\tsbxkit.HandleStream(%q, impl.%s)\n", p, base)
		} else if isVoid(s.Output) {
			fmt.Fprintf(&iface, "\t%s(ctx context.Context, in %s) error\n", base, it)
			fmt.Fprintf(&reg, "\tsbxkit.Handle(%q, func(ctx context.Context, in %s) (any, error) { return nil, impl.%s(ctx, in) })\n", p, it, base)
		} else {
			t := g.ty(base+"Output", parse(s.Output))
			fmt.Fprintf(&iface, "\t%s(ctx context.Context, in %s) (%s, error)\n", base, it, t)
			fmt.Fprintf(&reg, "\tsbxkit.Handle(%q, impl.%s)\n", p, base)
		}
	}
	body := strings.Join(g.decls, "\n") + "\n" + h.String() + "\n// Host is the parent's API.\nvar Host nsHost\n\n" +
		"// Exports must be implemented in full.\ntype Exports interface {\n" + iface.String() + "}\n\n" +
		"// Serve registers impl and answers calls until the sandbox ends.\nfunc Serve(impl Exports) error {\n" + reg.String() + "\treturn sbxkit.Serve()\n}\n\n" +
		"// Env is what the parent passed as env.\nfunc Env() map[string]any { return sbxkit.Env() }\n"
	imports := []string{`"context"`, `"iter"`}
	if strings.Contains(body, "time.Time") {
		imports = append(imports, `"time"`)
	}
	imports = append(imports, fmt.Sprintf("sbxkit %q", kitImport))
	return "// Package sbx is generated from the schema. Do not edit.\npackage sbx\n\nimport (\n\t" + strings.Join(imports, "\n\t") +
		"\n)\n\nvar _ context.Context\nvar _ iter.Seq[int]\n\n" + body
}

// Typings gives editors the same types the build uses.
func Typings(in *wire.CompileInput) ([]wire.File, error) {
	if in == nil {
		return nil, fmt.Errorf("missing input")
	}
	switch in.Environment.Runtime {
	case "node", "deno", "bun":
		m := TSModule(in.ApisSchema, in.ExportsSchema)
		m = strings.ReplaceAll(m, "export declare ", "export ")
		wrapped := "// Generated from the schema. Do not edit.\ndeclare module \"@panth977/sandbox/backend\" {\n" + m + "}\n"
		return []wire.File{{Path: "sandbox.d.ts", Content: wrapped}}, nil
	case "python":
		return []wire.File{{Path: "sandbox_api.pyi", Content: PyStub(in.ApisSchema, in.ExportsSchema)}}, nil
	case "go":
		return []wire.File{{Path: "sbx/api.go", Content: GoPackage(in.ApisSchema, in.ExportsSchema, "app/sbx/sbxkit")}}, nil
	}
	return []wire.File{}, nil
}
