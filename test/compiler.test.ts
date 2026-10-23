import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { compile, moduleKey } from "../src/compiler/compile.ts";

// Dev-only: borrow TypeScript / Svelte from a local checkout when present.
const req = createRequire(import.meta.url);
function tryReq(p: string) {
  try {
    return req(p);
  } catch {
    return null;
  }
}
const TS = tryReq(process.env.SBX_TS ?? "/Users/panth977/Dev/PROJECTS/TaskManager/tracker/node_modules/typescript");
const SVELTE_PATH = process.env.SBX_SVELTE ?? "/Users/panth977/Dev/PROJECTS/TaskManager/tracker/frontend/node_modules/svelte/src/compiler/index.js";

test("plain JS + CSS + JSON compile with zero dependencies", async () => {
  const r = await compile({
    "/index.js": `import { host } from "@panth977/sandbox/artifact";\nimport data from "./data.json";\nimport "./style.css";\nimport { greet } from "./lib/greet";\nconst lazy = () => import("./lazy.js");\ndocument.body.textContent = greet(data.name);`,
    "/lib/greet.js": `export const greet = (n) => "hi " + n;`,
    "/lazy.js": `export default 1;`,
    "/data.json": `{"name":"ops"}`,
    "/style.css": `body { color: red }`,
    "/manifest.json": `{"name":"t","network":["https://api.example.com"]}`,
  });
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
  const a = r.artifact!;
  assert.equal(a.entry, "sbx:/index.js");
  assert.deepEqual(Object.keys(a.modules).sort(), ["sbx:/data.json.js", "sbx:/index.js", "sbx:/lazy.js", "sbx:/lib/greet.js", "sbx:/style.css.js"]);
  assert.match(a.modules["sbx:/index.js"], /from "sbx:\/data\.json\.js"/);
  assert.match(a.modules["sbx:/index.js"], /import\("sbx:\/lazy\.js"\)/);
  assert.match(a.modules["sbx:/index.js"], /from "@panth977\/sandbox\/artifact"/);
  assert.deepEqual(a.imports, {});
  assert.deepEqual(a.manifest.network, ["https://api.example.com"]);
});

test("bare imports go to the CDN import map with manifest versions", async () => {
  const r = await compile({
    "/index.js": `import { render } from "preact";\nimport { useState } from "preact/hooks";\nimport x from "left-pad";`,
    "/manifest.json": `{"dependencies":{"preact":"10.26.0"}}`,
  });
  assert.equal(r.ok, true);
  assert.equal(r.artifact!.imports["preact"], "https://esm.sh/preact@10.26.0");
  assert.equal(r.artifact!.imports["preact/hooks"], "https://esm.sh/preact@10.26.0/hooks");
  assert.equal(r.artifact!.imports["left-pad"], "https://esm.sh/left-pad@latest");
  assert.ok(r.diagnostics.some((d) => d.severity === "warning" && d.message.includes("left-pad")));
});

test("errors: missing module, node builtin, no entry", async () => {
  const r = await compile({ "/index.js": `import "./nope";\nimport fs from "node:fs";\nimport p from "path";` });
  assert.equal(r.ok, false);
  const msgs = r.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
  assert.ok(msgs.some((m) => m.includes('Cannot find module "./nope"')));
  assert.ok(msgs.some((m) => m.includes('"node:fs" is a Node.js module')));
  assert.ok(msgs.some((m) => m.includes('"path" is a Node.js module')));
  const r2 = await compile({ "/readme.md": "x" });
  assert.equal(r2.ok, false);
});

test("index.html body becomes the artifact html", async () => {
  const r = await compile({ "/index.js": "", "/index.html": `<html><body><main id="app"></main><script src="x.js"></script></body></html>` });
  assert.equal(r.artifact!.html, `<main id="app"></main>`);
});

test("moduleKey", () => {
  assert.equal(moduleKey("/a/b.tsx"), "sbx:/a/b.js");
  assert.equal(moduleKey("/a.mjs"), "sbx:/a.mjs");
  assert.equal(moduleKey("/App.svelte"), "sbx:/App.svelte.js");
});

test("TypeScript + JSX via the typescript package", { skip: !TS && "typescript not found" }, async () => {
  const r = await compile({
    "/index.tsx": `import { App } from "./App";\nimport { createRoot } from "react-dom/client";\ncreateRoot(document.getElementById("root")!).render(<App n={1} />);`,
    "/App.tsx": `type P = { n: number };\nexport function App({ n }: P) { return <b>{n}</b>; }`,
  }, { typescript: async () => TS, sourcemap: false });
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
  const idx = r.artifact!.modules["sbx:/index.js"];
  assert.match(idx, /from "sbx:\/App\.js"/);
  assert.match(idx, /react\/jsx-runtime/);
  assert.doesNotMatch(r.artifact!.modules["sbx:/App.js"], /type P/);
  assert.equal(r.artifact!.imports["react/jsx-runtime"], "https://esm.sh/react@19/jsx-runtime");
  assert.equal(r.artifact!.imports["react-dom/client"], "https://esm.sh/react-dom@19/client");
});

test("Svelte via svelte/compiler", { skip: !TS && "svelte not found" }, async () => {
  let svelte: any;
  try {
    svelte = await import(SVELTE_PATH);
  } catch {
    return;
  }
  const r = await compile({
    "/App.svelte": `<script>let n = $state(1);</script><button onclick={() => n++}>{n}</button><style>button{color:red}</style>`,
    "/index.js": `import { mount } from "svelte";\nimport App from "./App.svelte";\nmount(App, { target: document.getElementById("root") });`,
  }, { svelte: async () => svelte });
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
  assert.ok(r.artifact!.modules["sbx:/App.svelte.js"].includes("svelte/internal/client"));
  assert.match(r.artifact!.imports["svelte/internal/client"], /^https:\/\/esm\.sh\/svelte@5\/internal\/client$/);
});

test("plain .ts files compile without JSX warnings", { skip: !TS && "typescript not found" }, async () => {
  const r = await compile({ "/index.ts": `const a: number = 1;\nexport default a;` }, { typescript: async () => TS, sourcemap: false });
  assert.equal(r.ok, true);
  assert.deepEqual(r.diagnostics, []);
});
