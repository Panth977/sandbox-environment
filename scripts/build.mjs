#!/usr/bin/env node
// Builds dist/: every src/**/*.ts as a browser-ready ES module (types stripped
// with Node's built-in stripTypeScriptTypes, `.ts` imports rewritten to `.js`),
// plus dist/kit.css and dist/runtime.html. No bundler, no dependencies.
//
//   node scripts/build.mjs
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

process.removeAllListeners("warning");
process.on("warning", (w) => w.name !== "ExperimentalWarning" && console.warn(w));

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const DIST = join(ROOT, "dist");

function* walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.endsWith(".d.ts")) yield p;
  }
}

const SPEC = /^(\s*(?:(?:import|export)\b[^"'\n]*?\bfrom\s*|\}\s*from\s*|import\s*))(["'])(\.[^"']+)\.ts\2/gm;
const DYN = /(\bimport\s*\(\s*)(["'])(\.[^"']+)\.ts\2/g;

rmSync(DIST, { recursive: true, force: true });
let count = 0;
for (const file of walk(SRC)) {
  const rel = relative(SRC, file);
  let js = stripTypeScriptTypes(readFileSync(file, "utf8"), { mode: "strip" });
  js = js.replace(SPEC, "$1$2$3.js$2").replace(DYN, "$1$2$3.js$2");
  js = js.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
  const out = join(DIST, rel.replace(/\.ts$/, ".js"));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, js);
  count++;
}

const css = await import(pathToFileURL(join(DIST, "ui", "css.js")).href);
writeFileSync(join(DIST, "kit.css"), css.KIT_CSS);
const html = await import(pathToFileURL(join(DIST, "host", "html.js")).href);
const rt = html.runtimeHtml({ title: "artifact" });
writeFileSync(join(DIST, "runtime.html"), rt.html);
writeFileSync(join(DIST, "runtime.csp.txt"), rt.csp + "\n");
console.log(`dist/: ${count} modules, kit.css, runtime.html`);
