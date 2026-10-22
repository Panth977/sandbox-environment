// Tiny static server for e2e pages (repo root). node e2e/server.mjs [port]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".txt": "text/plain" };

export function serve(port = 0) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/echo") {
      res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
      return res.end(JSON.stringify({ ok: true }));
    }
    const p = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!p.startsWith(ROOT)) return res.writeHead(403).end();
    try {
      const body = await readFile(p.endsWith("/") ? join(p, "index.html") : p);
      res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream", "access-control-allow-origin": "*", "cache-control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((r) => server.listen(port, "127.0.0.1", () => r(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await serve(Number(process.argv[2] ?? 4480));
  console.log(`http://127.0.0.1:${s.address().port}/`);
}
