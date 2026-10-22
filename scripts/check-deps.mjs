#!/usr/bin/env node
// Fails if the library grew a dependency: every import in src/ must be relative,
// `node:` (CLI only), or a lazily-loaded peer (typescript / svelte via the CDN or node_modules).
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
const ROOT = new URL("..", import.meta.url).pathname;
const bad = [];
function* walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith(".ts")) yield p;
  }
}
const STATIC = /^\s*(?:import|export)\b[^"'\n]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gm;
for (const f of walk(join(ROOT, "src"))) {
  if (f.includes("/generated/")) continue;
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(STATIC)) {
    const spec = m[1] ?? m[2];
    if (spec.startsWith(".")) continue;
    if (spec.startsWith("node:") && f.endsWith("cli.ts")) continue;
    bad.push(`${relative(ROOT, f)}: imports "${spec}"`);
  }
}
for (const manifest of ["deno.json", "package.json"]) {
  const p = join(ROOT, manifest);
  if (!existsSync(p)) continue;
  const j = JSON.parse(readFileSync(p, "utf8"));
  for (const k of ["imports", "dependencies", "peerDependencies", "optionalDependencies"]) {
    if (j[k] && Object.keys(j[k]).length) bad.push(`${manifest}: has "${k}"`);
  }
}
if (bad.length) {
  console.error("zero-dependency check failed:\n  " + bad.join("\n  "));
  process.exit(1);
}
console.log("zero dependencies: ok");
