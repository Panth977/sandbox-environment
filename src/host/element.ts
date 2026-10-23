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
import { mount } from "./mount.ts";
import type { ArtifactHandle, MountOptions } from "./mount.ts";
import type { CompiledArtifact, ComponentPackRef, ConsoleEntry, RuntimeErrorEntry, Theme } from "../protocol.ts";
import type { Middleware } from "../bridge.ts";

/** The options the element passes to `mount()` (its own event wiring aside). */
export type ArtifactElementOptions = Omit<MountOptions, "onConsole" | "onError" | "onReady">;

/** Event detail types, by event name. */
export interface ArtifactElementEvents {
  "sbx-ready": CustomEvent<void>;
  "sbx-error": CustomEvent<RuntimeErrorEntry>;
  "sbx-console": CustomEvent<ConsoleEntry>;
  "sbx-mount": CustomEvent<ArtifactHandle<any>>;
}

const LIVE = new Set(["artifact", "theme", "env"]);

// Importable where there is no DOM (SSR, Deno docs): the element is defined only in a browser.
const Base: typeof HTMLElement = (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement ??
  (class {} as unknown as typeof HTMLElement);

/** The `<sbx-artifact>` element class. */
export class SbxArtifactElement extends Base {
  #opts: Partial<ArtifactElementOptions> = {};
  #handle: ArtifactHandle<any> | null = null;
  #queued = false;
  #readyWaiters: (() => void)[] = [];

  static get observedAttributes(): string[] {
    return ["size", "min-height", "title"];
  }

  /** All options at once (replaces what was set before). */
  get options(): Partial<ArtifactElementOptions> {
    return { ...this.#opts };
  }
  set options(o: Partial<ArtifactElementOptions>) {
    const prev = this.#opts;
    this.#opts = { ...o };
    const keys = new Set([...Object.keys(prev), ...Object.keys(o)]);
    let remount = false;
    for (const k of keys) {
      if ((prev as Record<string, unknown>)[k] === (o as Record<string, unknown>)[k]) continue;
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

  get artifact(): CompiledArtifact | undefined {
    return this.#opts.artifact;
  }
  set artifact(v: CompiledArtifact | undefined) {
    this.#set("artifact", v);
  }
  get api(): object | undefined {
    return this.#opts.api;
  }
  set api(v: object | undefined) {
    this.#set("api", v);
  }
  get middleware(): Middleware[] | undefined {
    return this.#opts.middleware;
  }
  set middleware(v: Middleware[] | undefined) {
    this.#set("middleware", v);
  }
  get meta(): Record<string, unknown> | undefined {
    return this.#opts.meta;
  }
  set meta(v: Record<string, unknown> | undefined) {
    this.#set("meta", v);
  }
  get components(): ComponentPackRef[] | undefined {
    return this.#opts.components;
  }
  set components(v: ComponentPackRef[] | undefined) {
    this.#set("components", v);
  }
  get ui(): boolean | undefined {
    return this.#opts.ui;
  }
  set ui(v: boolean | undefined) {
    this.#set("ui", v);
  }
  get theme(): Theme | undefined {
    return this.#opts.theme;
  }
  set theme(v: Theme | undefined) {
    this.#set("theme", v);
  }
  get env(): Record<string, unknown> | undefined {
    return this.#opts.env;
  }
  set env(v: Record<string, unknown> | undefined) {
    this.#set("env", v);
  }
  get network(): string[] | undefined {
    return this.#opts.network;
  }
  set network(v: string[] | undefined) {
    this.#set("network", v);
  }
  get networkAlways(): string[] | undefined {
    return this.#opts.networkAlways;
  }
  set networkAlways(v: string[] | undefined) {
    this.#set("networkAlways", v);
  }
  get sandbox(): MountOptions["sandbox"] {
    return this.#opts.sandbox;
  }
  set sandbox(v: MountOptions["sandbox"]) {
    this.#set("sandbox", v);
  }
  get mode(): MountOptions["mode"] {
    return this.#opts.mode;
  }
  set mode(v: MountOptions["mode"]) {
    this.#set("mode", v);
  }
  get size(): MountOptions["size"] {
    return this.#opts.size;
  }
  set size(v: MountOptions["size"]) {
    this.#set("size", v);
  }
  get minHeight(): number | undefined {
    return this.#opts.minHeight;
  }
  set minHeight(v: number | undefined) {
    this.#set("minHeight", v);
  }
  get bootTimeoutMs(): number | undefined {
    return this.#opts.bootTimeoutMs;
  }
  set bootTimeoutMs(v: number | undefined) {
    this.#set("bootTimeoutMs", v);
  }

  /** The mounted artifact (null before it mounts). */
  get handle(): ArtifactHandle<any> | null {
    return this.#handle;
  }
  /** What the artifact offered with `expose()` (null before it mounts). */
  get remote(): ArtifactHandle<any>["remote"] | null {
    return this.#handle?.remote ?? null;
  }
  /** Resolves once the current artifact's entry module has run. */
  get ready(): Promise<void> {
    if (this.#handle) return this.#handle.ready;
    return new Promise((r) => this.#readyWaiters.push(r));
  }

  connectedCallback(): void {
    if (!this.style.display) this.style.display = "block";
    this.#schedule(false);
  }

  disconnectedCallback(): void {
    // A move (remove + append in the same task) keeps the frame.
    queueMicrotask(() => {
      if (this.isConnected) return;
      this.#handle?.destroy();
      this.#handle = null;
    });
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (name === "size") this.#set("size", value === "fill" ? "fill" : value === "auto" ? "auto" : undefined);
    if (name === "min-height") this.#set("minHeight", value === null ? undefined : Number(value));
    if (name === "title" && this.#handle && value) this.#handle.iframe.title = value;
  }

  #set<K extends keyof ArtifactElementOptions>(key: K, value: ArtifactElementOptions[K] | undefined) {
    if (this.#opts[key] === value) return;
    this.options = { ...this.#opts, [key]: value };
  }

  #schedule(remount: boolean) {
    if (remount && this.#handle) {
      this.#handle.destroy();
      this.#handle = null;
    }
    if (this.#queued) return;
    this.#queued = true;
    queueMicrotask(() => {
      this.#queued = false;
      if (!this.isConnected || this.#handle || !this.#opts.artifact) return;
      const opts: MountOptions = {
        ...(this.#opts as ArtifactElementOptions),
        title: this.getAttribute("title") ?? this.#opts.title,
        onReady: () => this.#emit("sbx-ready", undefined),
        onError: (e) => this.#emit("sbx-error", e),
        onConsole: (e) => this.#emit("sbx-console", e),
      };
      this.#handle = mount(this as HTMLElement, opts);
      const waiters = this.#readyWaiters.splice(0);
      void this.#handle.ready.then(() => waiters.forEach((w) => w()), () => {});
      this.#emit("sbx-mount", this.#handle);
    });
  }

  #emit<T>(type: string, detail: T) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}

/** Defines the element under `tag` (default `sbx-artifact`); importing this module already does it. */
export function defineArtifactElement(tag = "sbx-artifact"): void {
  const ce = (globalThis as { customElements?: CustomElementRegistry }).customElements;
  if (!ce || ce.get(tag)) return;
  ce.define(tag, tag === "sbx-artifact" ? SbxArtifactElement : class extends SbxArtifactElement {});
}

defineArtifactElement();
