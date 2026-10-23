#!/usr/bin/env node
// The published types, as an Angular 15 app sees them: TypeScript 4.8, `moduleResolution: "node"`
// (no package "exports": typesVersions maps the subpaths), lib ES2022 + dom, strict, no skipLibCheck.
// Needs dist/ with .d.ts (node scripts/build.mjs && node scripts/build-types.mjs).
//
//   node scripts/check-compat.mjs
import { cpSync, mkdtempSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = new URL("..", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "sbx-ts48-"));
execSync("npm init -y >/dev/null && npm i -s typescript@4.8.4 >/dev/null", { cwd: dir, stdio: "inherit", shell: true });
const pkg = join(dir, "node_modules", "@panth977", "sandbox");
mkdirSync(pkg, { recursive: true });
cpSync(join(root, "package.json"), join(pkg, "package.json"));
cpSync(join(root, "dist"), join(pkg, "dist"), { recursive: true });
for (const f of ["tsconfig.json", "app.ts"]) cpSync(join(root, "test/compat/ts48", f), join(dir, f));
execSync("npx tsc -p .", { cwd: dir, stdio: "inherit" });
console.log("types ok with TypeScript 4.8 (Angular 15 settings)");
