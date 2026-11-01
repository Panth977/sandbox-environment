#!/usr/bin/env node
/**
 * `sbx` command line (Node 22+ or Deno):
 *
 *   sbx build <dir> [-o artifact.json]   compile a folder of sources into a compiled artifact
 *   sbx runtime-html [-o runtime.html]   write the sandbox document for origin mode (+ its CSP)
 *
 * TypeScript/Svelte sources need `typescript` / `svelte` installed next to the
 * project (they are loaded from node_modules; Deno can also load them from the CDN).
 *
 * @module
 */
import { compile } from "./compile.js";
import { runtimeHtml } from "../host/html.js";

const IGNORE = new Set(["node_modules", ".git", "dist", ".DS_Store"]);

async function readTree(dir        )                                  {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const out                         = {};
  const walk = async (d        ) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      if (IGNORE.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(tsx?|jsx?|mjs|svelte|css|json|html|svg|txt|md)$/.test(e.name)) {
        out["/" + path.relative(dir, p).split(path.sep).join("/")] = await fs.readFile(p, "utf8");
      }
    }
  };
  await walk(dir);
  return out;
}

async function main(argv          ) {
  const fs = await import("node:fs/promises");
  const [cmd, ...rest] = argv;
  const oi = rest.indexOf("-o");
  const out = oi >= 0 ? rest[oi + 1] : undefined;
  const args = rest.filter((_, i) => i !== oi && i !== oi + 1);
  if (cmd === "build") {
    const dir = args[0] ?? ".";
    const files = await readTree(dir);
    const r = await compile(files);
    for (const d of r.diagnostics) {
      console.error(`${d.severity === "error" ? "error" : "warn "} ${d.file ?? ""}${d.line ? `:${d.line}:${d.column ?? 1}` : ""} ${d.message}`);
    }
    if (!r.ok) return 1;
    const json = JSON.stringify(r.artifact);
    if (out) await fs.writeFile(out, json);
    else console.log(json);
    console.error(`built ${Object.keys(r.artifact .modules).length} modules, ${json.length} bytes${out ? ` → ${out}` : ""}`);
    return 0;
  }
  if (cmd === "runtime-html") {
    const { html, csp } = runtimeHtml();
    if (out) {
      await fs.writeFile(out, html);
      await fs.writeFile(out.replace(/\.html$/, "") + ".csp.txt", csp + "\n");
      console.error(`wrote ${out}; serve it with header: Content-Security-Policy: <contents of .csp.txt>`);
    } else console.log(html);
    return 0;
  }
  console.error("usage: sbx build <dir> [-o artifact.json] | sbx runtime-html [-o runtime.html]");
  return 2;
}

const proc = (globalThis                                                       ).process;
const deno = (globalThis                                                        ).Deno;
const argv = deno ? deno.args : proc ? proc.argv.slice(2) : [];
main(argv).then((code) => {
  if (deno) deno.exit(code);
  else if (proc) proc.exitCode = code;
});
