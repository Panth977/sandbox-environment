#!/usr/bin/env node
// Emits dist/**/*.d.ts with the official TypeScript compiler (a dev-only tool,
// found via TS_PATH or the nearest node_modules). Import paths are rewritten .ts → .js.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const tsc = [process.env.TS_PATH && join(process.env.TS_PATH, "bin/tsc"), "node_modules/typescript/bin/tsc",
  "/Users/panth977/Dev/PROJECTS/TaskManager/tracker/node_modules/typescript/bin/tsc"].filter(Boolean).find(existsSync);
if (!tsc) throw new Error("TypeScript not found: set TS_PATH to a typescript package");
execFileSync(process.execPath, [tsc, "-p", "tsconfig.types.json"], { stdio: "inherit" });
let n = 0;
function* walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) yield* walk(p); else if (p.endsWith(".d.ts")) yield p; } }
for (const f of walk("dist")) {
  const s = readFileSync(f, "utf8").replace(/(from\s+["']|import\(["'])(\.{1,2}\/[^"']+)\.ts(["'])/g, "$1$2.js$3");
  writeFileSync(f, s);
  n++;
}
console.log(`dist/: ${n} .d.ts files`);
