// @panth977/sandbox/backend: what user code imports on Node, Deno and Bun.
import fs from "node:fs";
import process from "node:process";
import { Peer, SandboxError } from "./peer.mjs";

export { SandboxError };

const spec = JSON.parse(fs.readFileSync(process.env.SBX_API ?? "/app/.sbx/api.json", "utf8"));
let impl = {};

const peer = new Peer(
  // The leading newline keeps a frame clean after a stray print without one.
  (m) => process.stdout.write("\n" + JSON.stringify(m) + "\n"),
  (path) => {
    const s = spec.exports?.[path];
    const fn = s && path.split(".").reduce((o, k) => o?.[k], impl);
    return s && typeof fn === "function" ? { kind: s.kind, fn: fn.bind(impl) } : undefined;
  },
);

function build(prefix = "") {
  return new Proxy({}, {
    get(_, key) {
      if (typeof key !== "string") return undefined;
      const path = prefix + key;
      const s = spec.apis?.[path];
      if (s?.kind === "stream") return (input, call) => peer.stream(path, input, call);
      if (s) return (input, call) => peer.call(path, input, call);
      return build(path + ".");
    },
  });
}

/** The parent's API. */
export const host = build();

/** What the parent passed as env. */
export const env = Object.freeze(JSON.parse(process.env.SBX_ENV || "null") ?? {});

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    if (line.trim()) peer.receive(JSON.parse(line));
  }
});
process.stdin.on("end", () => process.exit(0));

/** Serve your exports. Call once, after setup: the parent's `ready` follows. */
export function expose(handlers) {
  impl = handlers ?? {};
  process.stdout.write("\n" + JSON.stringify({ $sbx: 1, t: "ready", protocols: [1] }) + "\n");
}
