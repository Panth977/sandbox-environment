/**
 * Runs inside the sandbox iframe, after the loader linked the modules.
 * Connects the bridge, applies theme/CSS/HTML, relays console, errors and
 * size to the host, loads component packs, then imports the artifact entry.
 *
 * Not imported by host code; shipped to the iframe as a module source.
 *
 * @module
 */
import { createEndpoint } from "../bridge.js";

function show(v         )         {
  if (typeof v === "string") return v;
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  try {
    const s = JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x));
    return s === undefined ? String(v) : s.length > 4000 ? s.slice(0, 4000) + "…" : s;
  } catch {
    return String(v);
  }
}

function applyTheme(t       ) {
  const root = document.documentElement;
  if (t.mode) {
    root.dataset.theme = t.mode;
    root.style.colorScheme = t.mode;
  }
  for (const [k, v] of Object.entries(t.vars ?? {})) {
    if (k.startsWith("--")) root.style.setProperty(k, v);
  }
}

function addCss(css        ) {
  const s = document.createElement("style");
  s.textContent = css;
  document.head.append(s);
}

async function start() {
  const b = globalThis.__sbxBoot;
  if (!b) throw new Error("sandbox runtime started without boot data");
  delete globalThis.__sbxBoot;
  const { port, boot, urls } = b;

  const exposed                          = {};
  const state               = {
    boot,
    exposed,
    theme: boot.theme,
    env: boot.env,
    themeListeners: new Set(),
    envListeners: new Set(),
    endpoint: null         ,
  };
  // What the host may call: the artifact's own API (filled by expose()) plus runtime controls.
  const controls = {
    theme(t       ) {
      state.theme = t;
      applyTheme(t);
      for (const l of state.themeListeners) l(t);
    },
    env(e                         ) {
      state.env = e;
      for (const l of state.envListeners) l(e);
    },
    ping: () => "pong",
  };
  const api                          = new Proxy(exposed, {
    get: (target, key) => (key === "$sbx" ? controls : target[key          ]),
    has: (target, key) => key === "$sbx" || key in target,
    getOwnPropertyDescriptor: (target, key)                                 =>
      key === "$sbx" ? { configurable: true, enumerable: true, value: controls } : Object.getOwnPropertyDescriptor(target, key),
  });
  state.endpoint = createEndpoint                                        (port, { expose: api });
  globalThis.__sbx = state;
  const host = state.endpoint.remote.$sbx;

  for (const level of ["log", "info", "warn", "error", "debug"]         ) {
    const orig = console[level].bind(console);
    console[level] = (...args           ) => {
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
    const r = ev.reason                                                    ;
    host.error({ message: `Unhandled rejection: ${r?.message ?? show(ev.reason)}`, stack: r?.stack }).catch(() => {});
  });
  // Popups are not allowed in the sandbox; the host decides what to do with links.
  document.addEventListener("click", (ev) => {
    const a = (ev.target                  )?.closest?.("a[href]")                            ;
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
    const err = e         ;
    host.error({ message: `Artifact failed to start: ${err?.message ?? e}`, stack: err?.stack }).catch(() => {});
    throw e;
  }
  await host.ready();
}

start();
