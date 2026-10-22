/**
 * The sandbox document: Content-Security-Policy, the inline loader and the
 * HTML around it. Used by {@link mount} for `srcdoc` mode, and by
 * {@link runtimeHtml} to produce a static `runtime.html` for origin mode.
 *
 * @module
 */
import { PROTOCOL } from "../protocol.ts";

/**
 * The loader: a tiny self-contained script inside the sandbox. It waits for the
 * host's boot message (only from `parent`, only once), turns every module
 * source into a `blob:` URL, installs one import map, and starts the runtime.
 */
export const LOADER_JS = `(()=>{
const nonce=document.currentScript&&document.currentScript.nonce||"";
let booted=false;
addEventListener("message",(e)=>{
  const d=e.data;
  if(booted||e.source!==parent||!d||d.$sbx!==${PROTOCOL}||d.t!=="boot"||!e.ports||!e.ports[0])return;
  booted=true;
  const b=d.boot,urls={},imports={};
  const mods=Object.assign({},b.runtime,b.artifact.modules);
  for(const k of Object.keys(mods))urls[k]=URL.createObjectURL(new Blob([mods[k]],{type:"text/javascript"}));
  Object.assign(imports,b.artifact.imports||{});
  for(const k of Object.keys(b.specifiers||{}))if(urls[b.specifiers[k]])imports[k]=urls[b.specifiers[k]];
  Object.assign(imports,urls);
  const m=document.createElement("script");
  m.type="importmap";m.nonce=nonce;m.textContent=JSON.stringify({imports});
  document.head.append(m);
  globalThis.__sbxBoot={port:e.ports[0],boot:b,urls};
  import(urls[b.runtimeEntry]).catch((err)=>parent.postMessage({$sbx:${PROTOCOL},t:"fatal",message:String(err&&err.message||err)},"*"));
});
parent.postMessage({$sbx:${PROTOCOL},t:"ready",protocols:[${PROTOCOL}]},"*");
})();`;

const ORIGIN = /^(https?|wss?):\/\/(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*(:\d{1,5})?$/i;

/** Keeps only well-formed origins (`https://api.example.com`, `https://*.example.com:8443`). */
export function cleanOrigins(list: readonly string[] | undefined): string[] {
  const out = new Set<string>();
  for (const raw of list ?? []) {
    const s = String(raw).trim().replace(/\/+$/, "");
    if (ORIGIN.test(s)) out.add(s.toLowerCase());
  }
  return [...out];
}

/** The origin part of a URL, or null for blob:/data:/relative URLs. */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

export interface CspOptions {
  nonce?: string;
  /** Origins scripts and module imports may come from (vendor CDNs, component packs). */
  scripts?: string[];
  /** Origins the artifact may reach: fetch/XHR/WebSocket, images, fonts, media. */
  network?: string[];
  /** Extra origins for stylesheets (e.g. a font CSS host). */
  styles?: string[];
}

/** The sandbox's Content-Security-Policy. Network access is closed unless listed. */
export function buildCsp(o: CspOptions = {}): string {
  const scripts = cleanOrigins(o.scripts);
  const net = cleanOrigins(o.network);
  const styles = cleanOrigins(o.styles);
  const join = (...parts: (string | string[])[]) => parts.flat().filter(Boolean).join(" ");
  return [
    "default-src 'none'",
    `script-src ${join(o.nonce ? `'nonce-${o.nonce}'` : "", "blob:", scripts)}`,
    `style-src ${join("'unsafe-inline'", "blob:", styles, scripts)}`,
    `connect-src ${join(net) || "'none'"}`,
    `img-src ${join("data:", "blob:", net)}`,
    `font-src ${join("data:", net, styles)}`,
    `media-src ${join("data:", "blob:", net)}`,
    "worker-src blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The full sandbox HTML document. */
export function sandboxHtml(o: { csp: string; nonce?: string; title?: string }): string {
  return `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${esc(o.csp)}">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${esc(o.title ?? "artifact")}</title>` +
    `<style>html,body{margin:0;padding:0}</style>` +
    `<script${o.nonce ? ` nonce="${esc(o.nonce)}"` : ""}>${LOADER_JS}</script>` +
    `</head><body></body></html>`;
}

/**
 * A static `runtime.html` for origin mode: serve it from a dedicated origin
 * (e.g. `https://sandbox.example.com/runtime.html`) and send the same policy
 * as an HTTP header there. The nonce is fixed per file; rotate it per deploy.
 */
export function runtimeHtml(o: CspOptions & { title?: string } = {}): { html: string; csp: string } {
  const nonce = o.nonce ?? randomNonce();
  const csp = buildCsp({ ...o, nonce });
  return { html: sandboxHtml({ csp, nonce, title: o.title }), csp };
}

export function randomNonce(): string {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/[+/=]/g, "");
}
