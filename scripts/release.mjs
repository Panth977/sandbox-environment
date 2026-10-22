#!/usr/bin/env node
// Tags a release that carries dist/ (so jsDelivr can serve it from GitHub) without
// committing dist/ to main:  node scripts/release.mjs   (version from deno.json)
//
//   https://cdn.jsdelivr.net/gh/Panth977/sandbox-environment@v<version>/dist/host/mod.js
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
const sh = (c) => execSync(c, { stdio: ["ignore", "pipe", "inherit"] }).toString().trim();
const version = JSON.parse(readFileSync("deno.json", "utf8")).version;
const tag = `v${version}`;
if (sh("git status --porcelain")) throw new Error("working tree not clean");
if (sh(`git tag -l ${tag}`)) throw new Error(`${tag} exists`);
const branch = sh("git rev-parse --abbrev-ref HEAD");
execSync("node scripts/gen.mjs --check && node scripts/check-deps.mjs && node scripts/build.mjs", { stdio: "inherit" });
sh("git checkout --detach");
try {
  sh("git add -f dist");
  sh(`git commit -m "release ${tag} (with dist/)"`);
  sh(`git tag -a ${tag} -m "${tag}"`);
} finally {
  sh(`git checkout ${branch}`);
}
console.log(`tagged ${tag}; push with: git push origin ${branch} ${tag}`);
