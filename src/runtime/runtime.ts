/**
 * Runs inside the sandbox iframe, after the loader linked the modules.
 * Connects the bridge, applies theme/CSS/HTML, relays console, errors and
 * size to the host, loads component packs, then imports the artifact entry.
 *
 * Not imported by host code; shipped to the iframe as a module source.
 *
 * @module
 */
import { createEndpoint } from "../bridge.ts";
import type { Endpoint } from "../bridge.ts";
import type { BootPayload, ConsoleEntry, RuntimeErrorEntry, Theme } from "../protocol.ts";

interface HostInternal {
  $sbx: {
    console(e: ConsoleEntry): void;
    error(e: RuntimeErrorEntry): void;
    size(height: number): void;
    ready(): void;
    open(url: string): void;
  };
}

export interface RuntimeState {
  endpoint: Endpoint<HostInternal & Record<string, unknown>>;
  boot: BootPayload;
  exposed: Record<string, unknown>;
  theme: Theme;
  env: Record<string, unknown>;
  themeListeners: Set<(t: Theme) => void>;
  envListeners: Set<(e: Record<string, unknown>) => void>;
}

declare global {
  // deno-lint-ignore no-var
  var __sbxBoot: { port: MessagePort; boot: BootPayload; urls: Record<string, string> } | undefined;
  // deno-lint-ignore no-var
  var __sbx: RuntimeState | undefined;
}

function show(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  try {
    const s = JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x));
    return s === undefined ? String(v) : s.length > 4000 ? s.slice(0, 4000) + "…" : s;
  } catch {
    return String(v);
  }
}

function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t.mode) {
    root.dataset.theme = t.mode;
    root.style.colorScheme = t.mode;
  }
  for (const [k, v] of Object.entries(t.vars ?? {})) {
    if (k.startsWith("--")) root.style.setProperty(k, v);
  }
}

function addCss(css: string) {
  const s = document.createElement("style");
  s.textContent = css;
  document.head.append(s);
}

async function start() {
  const b = globalThis.__sbxBoot;
  if (!b) throw new Error("sandbox runtime started without boot data");
  delete globalThis.__sbxBoot;
  const { port, boot, urls } = b;

  const exposed: Record<string, unknown> = {};
  const state: RuntimeState = {
    boot,
    exposed,
    theme: boot.theme,
    env: boot.env,
    themeListeners: new Set(),
    envListeners: new Set(),
    endpoint: null as never,
  };
  // What the host may call: the artifact's own API (filled by expose()) plus runtime controls.
  const controls = {
    theme(t: Theme) {
      state.theme = t;
      applyTheme(t);
      for (const l of state.themeListeners) l(t);
    },
    env(e: Record<string, unknown>) {
      state.env = e;
      for (const l of state.envListeners) l(e);
    },
    ping: () => "pong",
  };
  const api: Record<string, unknown> = new Proxy(exposed, {
    get: (target, key) => (key === "$sbx" ? controls : target[key as string]),
    has: (target, key) => key === "$sbx" || key in target,
    getOwnPropertyDescriptor: (target, key): PropertyDescriptor | undefined =>
      key === "$sbx" ? { configurable: true, enumerable: true, value: controls } : Object.getOwnPropertyDescriptor(target, key),
  });
  state.endpoint = createEndpoint<HostInternal & Record<string, unknown>>(port, { expose: api });
  globalThis.__sbx = state;
  const host = state.endpoint.remote.$sbx;

  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      orig(...args);
      host.console({ level, args: args.map(show) }).catch(() => {});
    };
  }
  addEventListener("error", (ev) => {
    host.error({
      message: ev.message || String(ev.error),
      source: ev.filename,
      line: ev.lineno,
      column: ev.colno,
      stack: ev.error?.stack,
    }).catch(() => {});
  });
  addEventListener("unhandledrejection", (ev) => {
    const r = ev.reason as { message?: string; stack?: string } | undefined;
    host.error({ message: `Unhandled rejection: ${r?.message ?? show(ev.reason)}`, stack: r?.stack }).catch(() => {});
  });
  // Popups are not allowed in the sandbox; the host decides what to do with links.
  document.addEventListener("click", (ev) => {
    const a = (ev.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a || ev.defaultPrevented) return;
    const href = a.getAttribute("href") ?? "";
    if (href.startsWith("#") || href.startsWith("javascript:")) return;
    ev.preventDefault();
    host.open(a.href).catch(() => {});
  });

  applyTheme(boot.theme);
  document.body.innerHTML = boot.artifact.html ?? '<div id="root"></div>';

  if (boot.autoSize) {
    let last = -1;
    let queued = false;
    const report = () => {
      queued = false;
      const h = Math.ceil(document.documentElement.getBoundingClientRect().height);
      if (h !== last) {
        last = h;
        host.size(h).catch(() => {});
      }
    };
    new ResizeObserver(() => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(report);
      }
    }).observe(document.documentElement);
  }

  // The UI kit (when the host included it) is ready before any artifact code runs.
  const uiKey = boot.specifiers["@panth977/sandbox/ui"];
  if (uiKey && urls[uiKey]) await import(urls[uiKey]);
  for (const pack of boot.components) {
    if (pack.css) addCss(pack.css);
    const url = pack.url ?? (pack.source ? URL.createObjectURL(new Blob([pack.source], { type: "text/javascript" })) : null);
    if (url) await import(url);
  }
  for (const css of boot.artifact.css) addCss(css);
  try {
    await import(urls[boot.artifact.entry] ?? boot.artifact.entry);
  } catch (e) {
    const err = e as Error;
    host.error({ message: `Artifact failed to start: ${err?.message ?? e}`, stack: err?.stack }).catch(() => {});
    throw e;
  }
  await host.ready();
}

start();
