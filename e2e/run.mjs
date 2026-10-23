#!/usr/bin/env node
// Browser e2e: serves the repo, opens each e2e/pages/*.html in Chromium,
// Firefox and WebKit, waits for window.__results.done, then runs the checks
// in e2e/checks.mjs. Playwright is a dev-only tool (never a dependency of the
// published package); it is loaded from PLAYWRIGHT_PATH or the local cache.
//
//   node e2e/run.mjs [page] [--browser chromium|firefox|webkit]
import { createRequire } from "node:module";
import { appendFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { serve } from "./server.mjs";
import { CHECKS } from "./checks.mjs";

function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_PATH, join(process.cwd(), "node_modules"), join(homedir(), ".cache", "explainer-video", "node_modules")].filter(Boolean);
  for (const dir of tries) {
    if (existsSync(join(dir, "playwright"))) return createRequire(join(dir, "x.js"))("playwright");
  }
  throw new Error("Playwright not found: npm i -D playwright (dev only) or set PLAYWRIGHT_PATH");
}

const args = process.argv.slice(2);
const bi = args.indexOf("--browser");
const only = args.find((a, i) => !a.startsWith("--") && i !== bi + 1);
const browsers = bi >= 0 ? [args[bi + 1]] : ["chromium", "firefox", "webkit"];
// Host apps built from examples/ (npm run build:e2e there); skipped unless built, required with REQUIRE_HOSTS=1.
const URLS = {
  "host-angular15": "/examples/angular15/dist/index.html",
  "host-svelte5": "/examples/svelte5/dist/index.html",
};
const pages = Object.keys(CHECKS).filter((p) => !only || p === only).filter((p) => {
  if (!URLS[p] || existsSync(join(process.cwd(), URLS[p]))) return true;
  if (process.env.REQUIRE_HOSTS) throw new Error(`${p}: build ${URLS[p]} first`);
  console.log(`skip ${p} (not built: ${URLS[p]})`);
  return false;
});

const pw = loadPlaywright();
const server = await serve(0);
const base = `http://127.0.0.1:${server.address().port}`;
let failed = 0;
for (const name of browsers) {
  const browser = await pw[name].launch();
  for (const page of pages) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    const pageErrors = [];
    p.on("pageerror", (e) => pageErrors.push(String(e)));
    p.on("console", (m) => m.type() === "error" && pageErrors.push("console: " + m.text()));
    if (process.env.CONSOLE_LOG) p.on("console", (m) => appendFileSync(process.env.CONSOLE_LOG, `[${m.type()}] ${m.text()}\n`));
    let results;
    try {
      await p.goto(base + (URLS[page] ?? `/e2e/pages/${page}.html`));
      if (URLS[page]) results = {};
      else {
        await p.waitForFunction(() => window.__results?.done, null, { timeout: 90000 });
        results = await p.evaluate(() => window.__results);
      }
    } catch (e) {
      results = { timeout: String(e), partial: await p.evaluate(() => window.__results).catch(() => null) };
    }
    const problems = [];
    try {
      await CHECKS[page](results, (cond, msg) => cond || problems.push(msg), p);
    } catch (e) {
      problems.push(`check threw: ${e}`);
    }
    if (results?.timeout) problems.push(results.timeout);
    const ok = problems.length === 0;
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(8)} ${page}`);
    for (const pr of problems) console.log(`       - ${pr}`);
    if (!ok) {
      console.log(`       results: ${JSON.stringify(results).slice(0, 1500)}`);
      if (pageErrors.length) console.log(`       page errors: ${pageErrors.join(" | ").slice(0, 800)}`);
    }
    await ctx.close();
  }
  await browser.close();
}
server.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
