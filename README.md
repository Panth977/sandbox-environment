# Sandbox Environment

Run untrusted mini-apps ("artifacts") inside any web app — sandboxed, two-way
connected to the host through a typed API — and give people the tools to write
and compile them in the browser. **Zero runtime dependencies.** Web standards only;
the dev tools load TypeScript, the Svelte compiler and the Monaco editor from a CDN when used.

```
@panth977/sandbox
├─ /host       mount(div, { artifact, api, middleware, theme })   — the render engine
├─ /svelte     use:artifact / {@attach sandbox(…)}                 — Svelte adapter
├─ /artifact   host · env · expose · onTheme                       — what artifacts import
├─ /ui         CSS kit + <sbx-select> <sbx-table> <sbx-chart> …    — the component library
├─ /compiler   compile(files) → artifact (browser, worker, Node)  — no bundler, no WASM
├─ /dev        mountDev(div, { files, api, hostTypes })           — IDE (Monaco) + live preview
├─ /editor     <sbx-editor>                                        — a tiny zero-dep code field
├─ /bridge     createEndpoint(port)                                — the typed RPC on its own
└─ /middleware scopes · confirm · rateLimit · audit · dryRun
```

## Why

Teams keep asking an admin/ops team for small tools: a bulk edit, a one-off
report, a dashboard. This lets anyone (or their AI agent) build them as
**artifacts** that run inside your existing app, reuse your APIs with the
viewer's permissions, look native, and never touch your tokens.

- **Isolation by the browser.** Each artifact runs in an `<iframe sandbox="allow-scripts">`
  with an opaque origin: no access to your DOM, cookies, `localStorage` or tokens.
  A strict CSP closes the network unless the artifact's manifest asks and the host allows.
- **Your frontend is its backend.** The artifact calls `await host.devices.list()`;
  your host implements it (with your auth). Streams (`for await`), callbacks,
  cancellation and errors all cross the bridge.
- **Permissions as middleware.** Scopes, confirm-before-destructive, rate limits and an
  audit trail are a line each.
- **Any framework, both sides.** Hosts: vanilla, Svelte (Angular/React are ~50 lines on
  `mount`). Artifacts: plain JS, React/Preact (TSX) or Svelte 5 — compiled to plain ES modules.
- **Browser-first compiler.** No server compute per edit: TypeScript/JSX and Svelte are
  compiled in the browser (or a worker), modules are linked by the browser through an
  import map. The same compiler runs in Node for CI.

## Quick start

### 1. Host: mount an artifact

```ts
import { mount, scopes, confirm, audit } from "jsr:@panth977/sandbox/host";

const handle = mount(document.getElementById("slot")!, {
  artifact,                                  // from the compiler (JSON)
  env: { orgId: "o7" },
  theme: { mode: "dark" },
  api: {
    devices: {
      list: (q) => http.get("/devices", { params: q }),                // uses YOUR token
      bulkAllocate: (ids, org) => http.post("/devices/allocate", { ids, org }),
    },
    live: { async *readings(id) { for await (const r of socket.stream(id)) yield r; } },
  },
  middleware: [
    audit((e) => log.push(e)),
    scopes({ "devices.list": "devices:read", "devices.*": "devices:write", "live.*": "devices:read" }, granted),
    confirm({ "devices.bulkAllocate": ([ids]) => `Move ${ids.length} devices?` }, (q) => myConfirmDialog(q)),
  ],
  network: ["https://api.open-meteo.com"],   // what artifacts may fetch (∩ their manifest)
  onConsole: (e) => console.log("[artifact]", ...e.args),
  onError: (e) => console.warn("[artifact]", e.message),
});
await handle.ready;
await handle.remote.getSelection();          // call what the artifact exposed
handle.setTheme({ mode: "light" });
handle.destroy();
```

Svelte:

```svelte
<script>
  import { artifact } from "@panth977/sandbox/svelte";
</script>
<div use:artifact={{ artifact: compiled, api, theme }}></div>
```

### 2. Artifact: use the host

```tsx
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { host, env } from "@panth977/sandbox/artifact";
import { toast } from "@panth977/sandbox/ui";

function App() {
  const [rows, setRows] = useState([]);
  useEffect(() => { host.devices.list({ orgId: env.orgId }).then(setRows); }, []);
  return (
    <main className="sbx-page sbx-stack">
      <sbx-table rows={rows} selectable />
      <sbx-chart type="bar" data={rows} x="name" y="pm25" />
      <button className="sbx-btn sbx-btn--primary" onClick={async () => {
        await host.devices.bulkAllocate(rows.map((r) => r.id), "spare");
        toast("Moved", "success");
      }}>Move to spare pool</button>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
```

Types for `host` come from the host: ship a `.d.ts` that augments `HostApi`:

```ts
declare module "@panth977/sandbox/artifact" {
  interface HostApi {
    devices: { list(q?: { orgId?: string }): Promise<Device[]>; bulkAllocate(ids: string[], org: string): Promise<{ ok: number }> };
    live: { readings(id: string): AsyncIterable<Reading> };
  }
}
```

### 3. Compile (browser, worker or Node)

```ts
import { compile } from "@panth977/sandbox/compiler";
const { ok, artifact, diagnostics } = await compile({
  "/manifest.json": `{ "name": "Allocator", "dependencies": { "react": "19", "react-dom": "19" }, "scopes": ["devices:read"] }`,
  "/index.tsx": "…",
  "/App.tsx": "…",
});
```

CLI: `deno run -A jsr:@panth977/sandbox/cli build ./my-artifact -o artifact.json`.

### 4. Develop: editor + live preview

```ts
import { mountDev } from "@panth977/sandbox/dev";
mountDev(document.getElementById("ide")!, { files, api, hostTypes, onSave: (files) => save(files) });
```

Left: a file explorer (folders; create, rename, drag to move, delete) and tabs. The editor is
[Monaco](https://microsoft.github.io/monaco-editor/) — the editor of VS Code — loaded on first use
from jsDelivr (`monacoBase` to serve it yourself; the kit pins the version it is tested with), so
find/replace, multi-cursor, the command palette (F1), folding and VS Code's keyboard shortcuts all work.

The language features come from the kit's TypeScript worker: errors, completions, hover, signature
help, go to definition (F12, across files), find references, rename (F2, across files) and format —
from your `hostTypes`, the UI kit and npm types fetched on demand, in `.ts/.tsx/.js` files and in
`.svelte` files (script blocks and template expressions, runes and `$store` reads typed).
Completions say what each item is — object (of methods), method, property — with its short type,
and the pane beside the list shows the full signature, an object's members and the docs. Right: the same
sandbox viewers get. Bottom: problems and console.

## The UI kit

Importing `@panth977/sandbox/ui` (the runtime does it for artifacts) installs:

- **Tokens** — `--sbx-bg, --sbx-surface, --sbx-text, --sbx-accent, --sbx-danger, …`, light/dark/system,
  chart palette `--sbx-c1…c8`. Set them from the host with `theme.vars`.
- **Typography & base** — headings, links, code, lists, focus rings (zero-specificity, your CSS wins).
- **Classes for native elements** — `sbx-btn` (+ `--primary|--ghost|--danger|--link|--sm|--lg|--icon`),
  `sbx-input`, `sbx-textarea`, `sbx-native-select`, `sbx-check`, `sbx-field/label/hint/error`,
  `sbx-input-group`, `sbx-card`, `sbx-badge`, `sbx-tag`, `sbx-alert`, `sbx-progress`, `sbx-skeleton`,
  `sbx-empty`, `sbx-table`, `sbx-kv`, `sbx-stat`, `sbx-avatar`, `sbx-kbd`, `sbx-list`, layout
  (`sbx-page`, `sbx-stack`, `sbx-row`, `sbx-grid`, `sbx-toolbar`).
- **Custom elements** — `<sbx-select>` (single/multi, searchable, groups, form-associated),
  `<sbx-menu>`, `<sbx-dialog>` + `confirmDialog()` / `promptDialog()`, `<sbx-tabs>`, `<sbx-switch>`,
  `<sbx-tooltip>`, `<sbx-table>` (sort, select, loading/empty), `<sbx-chart>` (line, area, bar,
  stacked, pie, donut), `toast()`.

**Lazy by default.** The definitions (tag, properties, attributes, methods, form association)
are registered synchronously and are tiny; each component's code is its own module, loaded the
first time that tag is rendered. Properties set and methods called before that are kept and
replayed, so `table.rows = data` or React's `rows={data}` work from the first render
(`lazyStats.loaded` lists what has loaded).

Hosts can provide their *own* components too, also lazily:

```ts
mount(el, {
  artifact, api,
  components: [
    // a plain pack: imported the first time <oz-map> appears
    { url: "https://cdn.example.com/oz-map.js", tags: ["oz-map"] },
    // a kit-style pack: definitions now, code on first render
    // (the module exports `elements: { "oz-line-chart": Impl }`, written like ui/lazy.ts describes)
    { url: "https://cdn.example.com/oz-charts.js", elements: { "oz-line-chart": { props: ["series"], attrs: ["height"] } } },
  ],
});
```

## Security model

- `sandbox="allow-scripts"` — never `allow-same-origin` (the library refuses it).
- Opaque origin; the host accepts messages only from the iframe's own window, then
  only on a private `MessagePort`.
- CSP per artifact: `default-src 'none'`, scripts only from a per-mount nonce, `blob:`
  and the import map's CDN origins; `connect/img/font/media-src` only for the manifest's
  `network` ∩ the host's allowlist.
- The API is an allowlist of plain-object functions; `_private`, `__proto__`, `constructor`
  are unreachable. Errors cross without stacks.
- Calls run as the **viewer** (the host's session): sharing an artifact never escalates.

Two iframe modes: `srcdoc` (default, no extra infrastructure; note it also inherits the
host page's CSP) and `{ url }` for a dedicated sandbox origin (`sbx runtime-html` writes
the file and its CSP header) — recommended in production.

## Zero dependencies

The published package has no dependencies. Two optional *peer tools* are loaded only
when needed: the official `typescript` package (TS/JSX transpile and type checking) and
`svelte/compiler` (for `.svelte` files) — from `node_modules` in Node, from a CDN in the
browser. Artifact frameworks (React, Preact, Svelte runtime) are the artifact's own choice,
served via the import map. Repo tooling: `tsc`-free (Deno checks, Node's built-in type
stripping builds), `node:test`; Playwright is used for browser e2e only.

## Development

```sh
node scripts/gen.mjs            # regenerate sandbox runtime modules after editing src/
deno check src/                 # types
deno task test                  # unit tests (node:test)
node scripts/build.mjs          # dist/ (browser ES modules, kit.css, runtime.html)
node e2e/run.mjs                # Chromium, Firefox, WebKit (needs Playwright, dev only)
node scripts/check-deps.mjs     # the zero-dependency rule
```

## License

Apache-2.0
