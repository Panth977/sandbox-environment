/**
 * `<sbx-artifact>`: the render engine as a custom element, for any host —
 * plain JS, Angular, React, Vue or Svelte — with no adapter code.
 *
 * ```ts
 * import "@panth977/sandbox/element";   // defines <sbx-artifact>
 *
 * const el = document.createElement("sbx-artifact");
 * el.artifact = compiled;                 // from the compiler
 * el.api = { devices: { list: () => http.get("/devices") } };
 * el.addEventListener("sbx-ready", () => console.log("running"));
 * document.body.append(el);
 * ```
 *
 * Angular (any version with custom elements, e.g. 15): add `CUSTOM_ELEMENTS_SCHEMA`
 * to the component or module, then bind properties and events:
 *
 * ```html
 * <sbx-artifact [artifact]="compiled" [api]="api" [theme]="theme" (sbx-ready)="onReady()"></sbx-artifact>
 * ```
 *
 * Every {@link MountOptions} field is a property of the same name (or set
 * them together with `options`). A new `artifact` reloads the frame, `theme`
 * and `env` are pushed live, anything else remounts. The frame mounts when the
 * element is in the document and has an `artifact`.
 *
 * Events (bubbling `CustomEvent`s): `sbx-ready`, `sbx-error` (detail: the
 * error), `sbx-console` (detail: the console entry), `sbx-mount` (detail: the
 * {@link ArtifactHandle}).
 *
 * @module
 */
import { mount } from "./mount.js";

/** The options the element passes to `mount()` (its own event wiring aside). */

/** Event detail types, by event name. */

const LIVE = new Set(["artifact", "theme", "env"]);

// Importable where there is no DOM (SSR, Deno docs): the element is defined only in a browser.
const Base                     = (globalThis                                        ).HTMLElement ??
  (class {}                                 );

/** The `<sbx-artifact>` element class. */
export class SbxArtifactElement extends Base {
  #opts                                  = {};
  #handle                             = null;
  #queued = false;
  #readyWaiters                 = [];

  static get observedAttributes()           {
    return ["size", "min-height", "title"];
  }

  /** All options at once (replaces what was set before). */
  get options()                                  {
    return { ...this.#opts };
  }
  set options(o                                 ) {
    const prev = this.#opts;
    this.#opts = { ...o };
    const keys = new Set([...Object.keys(prev), ...Object.keys(o)]);
    let remount = false;
    for (const k of keys) {
      if ((prev                           )[k] === (o                           )[k]) continue;
      if (!LIVE.has(k)) remount = true;
    }
    if (!this.#handle || remount) {
      this.#schedule(true);
      return;
    }
    if (prev.artifact !== o.artifact && o.artifact) this.#handle.reload(o.artifact);
    if (prev.theme !== o.theme && o.theme) void this.#handle.setTheme(o.theme);
    if (prev.env !== o.env && o.env) void this.#handle.setEnv(o.env);
  }

  get artifact()                               {
    return this.#opts.artifact;
  }
  set artifact(v                              ) {
    this.#set("artifact", v);
  }
  get api()                     {
    return this.#opts.api;
  }
  set api(v                    ) {
    this.#set("api", v);
  }
  get middleware()                           {
    return this.#opts.middleware;
  }
  set middleware(v                          ) {
    this.#set("middleware", v);
  }
  get meta()                                      {
    return this.#opts.meta;
  }
  set meta(v                                     ) {
    this.#set("meta", v);
  }
  get components()                                 {
    return this.#opts.components;
  }
  set components(v                                ) {
    this.#set("components", v);
  }
  get ui()                      {
    return this.#opts.ui;
  }
  set ui(v                     ) {
    this.#set("ui", v);
  }
  get theme()                    {
    return this.#opts.theme;
  }
  set theme(v                   ) {
    this.#set("theme", v);
  }
  get env()                                      {
    return this.#opts.env;
  }
  set env(v                                     ) {
    this.#set("env", v);
  }
  get network()                       {
    return this.#opts.network;
  }
  set network(v                      ) {
    this.#set("network", v);
  }
  get networkAlways()                       {
    return this.#opts.networkAlways;
  }
  set networkAlways(v                      ) {
    this.#set("networkAlways", v);
  }
  get sandbox()                          {
    return this.#opts.sandbox;
  }
  set sandbox(v                         ) {
    this.#set("sandbox", v);
  }
  get mode()                       {
    return this.#opts.mode;
  }
  set mode(v                      ) {
    this.#set("mode", v);
  }
  get size()                       {
    return this.#opts.size;
  }
  set size(v                      ) {
    this.#set("size", v);
  }
  get minHeight()                     {
    return this.#opts.minHeight;
  }
  set minHeight(v                    ) {
    this.#set("minHeight", v);
  }
  get bootTimeoutMs()                     {
    return this.#opts.bootTimeoutMs;
  }
  set bootTimeoutMs(v                    ) {
    this.#set("bootTimeoutMs", v);
  }

  /** The mounted artifact (null before it mounts). */
  get handle()                             {
    return this.#handle;
  }
  /** What the artifact offered with `expose()` (null before it mounts). */
  get remote()                                       {
    return this.#handle?.remote ?? null;
  }
  /** Resolves once the current artifact's entry module has run. */
  get ready()                {
    if (this.#handle) return this.#handle.ready;
    return new Promise((r) => this.#readyWaiters.push(r));
  }

  connectedCallback()       {
    if (!this.style.display) this.style.display = "block";
    this.#schedule(false);
  }

  disconnectedCallback()       {
    // A move (remove + append in the same task) keeps the frame.
    queueMicrotask(() => {
      if (this.isConnected) return;
      this.#handle?.destroy();
      this.#handle = null;
    });
  }

  attributeChangedCallback(name        , _old               , value               )       {
    if (name === "size") this.#set("size", value === "fill" ? "fill" : value === "auto" ? "auto" : undefined);
    if (name === "min-height") this.#set("minHeight", value === null ? undefined : Number(value));
    if (name === "title" && this.#handle && value) this.#handle.iframe.title = value;
  }

  #set                                        (key   , value                                       ) {
    if (this.#opts[key] === value) return;
    this.options = { ...this.#opts, [key]: value };
  }

  #schedule(remount         ) {
    if (remount && this.#handle) {
      this.#handle.destroy();
      this.#handle = null;
    }
    if (this.#queued) return;
    this.#queued = true;
    queueMicrotask(() => {
      this.#queued = false;
      if (!this.isConnected || this.#handle || !this.#opts.artifact) return;
      const opts               = {
        ...(this.#opts                          ),
        title: this.getAttribute("title") ?? this.#opts.title,
        onReady: () => this.#emit("sbx-ready", undefined),
        onError: (e) => this.#emit("sbx-error", e),
        onConsole: (e) => this.#emit("sbx-console", e),
      };
      this.#handle = mount(this               , opts);
      const waiters = this.#readyWaiters.splice(0);
      void this.#handle.ready.then(() => waiters.forEach((w) => w()), () => {});
      this.#emit("sbx-mount", this.#handle);
    });
  }

  #emit   (type        , detail   ) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}

/** Defines the element under `tag` (default `sbx-artifact`); importing this module already does it. */
export function defineArtifactElement(tag = "sbx-artifact")       {
  const ce = (globalThis                                              ).customElements;
  if (!ce || ce.get(tag)) return;
  ce.define(tag, tag === "sbx-artifact" ? SbxArtifactElement : class extends SbxArtifactElement {});
}

defineArtifactElement();
