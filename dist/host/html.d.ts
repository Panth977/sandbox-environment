/**
 * The loader: a tiny self-contained script inside the sandbox. It waits for the
 * host's boot message (only from `parent`, only once), turns every module
 * source into a `blob:` URL, installs one import map, and starts the runtime.
 */
export declare const LOADER_JS = "(()=>{\nconst nonce=document.currentScript&&document.currentScript.nonce||\"\";\nlet booted=false;\naddEventListener(\"message\",(e)=>{\n  const d=e.data;\n  if(booted||e.source!==parent||!d||d.$sbx!==1||d.t!==\"boot\"||!e.ports||!e.ports[0])return;\n  booted=true;\n  const b=d.boot,urls={},imports={};\n  const mods=Object.assign({},b.runtime,b.artifact.modules);\n  for(const k of Object.keys(mods))urls[k]=URL.createObjectURL(new Blob([mods[k]],{type:\"text/javascript\"}));\n  Object.assign(imports,b.artifact.imports||{});\n  for(const k of Object.keys(b.specifiers||{}))if(urls[b.specifiers[k]])imports[k]=urls[b.specifiers[k]];\n  Object.assign(imports,urls);\n  const m=document.createElement(\"script\");\n  m.type=\"importmap\";m.nonce=nonce;m.textContent=JSON.stringify({imports});\n  document.head.append(m);\n  globalThis.__sbxBoot={port:e.ports[0],boot:b,urls};\n  import(urls[b.runtimeEntry]).catch((err)=>parent.postMessage({$sbx:1,t:\"fatal\",message:String(err&&err.message||err)},\"*\"));\n});\nparent.postMessage({$sbx:1,t:\"ready\",protocols:[1]},\"*\");\n})();";
/** Keeps only well-formed origins (`https://api.example.com`, `https://*.example.com:8443`). */
export declare function cleanOrigins(list: readonly string[] | undefined): string[];
/** The origin part of a URL, or null for blob:/data:/relative URLs. */
export declare function originOf(url: string): string | null;
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
export declare function buildCsp(o?: CspOptions): string;
/** The full sandbox HTML document. */
export declare function sandboxHtml(o: {
    csp: string;
    nonce?: string;
    title?: string;
}): string;
/**
 * A static `runtime.html` for origin mode: serve it from a dedicated origin
 * (e.g. `https://sandbox.example.com/runtime.html`) and send the same policy
 * as an HTTP header there. The nonce is fixed per file; rotate it per deploy.
 */
export declare function runtimeHtml(o?: CspOptions & {
    title?: string;
}): {
    html: string;
    csp: string;
};
export declare function randomNonce(): string;
