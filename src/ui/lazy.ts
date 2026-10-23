/**
 * Lazy custom elements: the DEFINITION is synchronous, the CODE is not.
 *
 * `defineLazy(tag, schema)` registers a tiny stub class right away, so the tag
 * is a real custom element from the first moment: frameworks see its
 * properties (React/Preact set `rows={…}` as a property, not an attribute),
 * `instanceof` and form association work, attributes are observed. The
 * implementation — rendering, behaviour, styles — is a separate module, loaded
 * the first time an element with that tag is connected to a document. Until
 * then property writes and method calls are kept and replayed.
 *
 * An implementation is a class extending ElementBase whose prototype holds the
 * behaviour: `_init()` instead of a constructor and field initializers,
 * `_connected` / `_disconnected` / `_attributeChanged` / `_formReset` /
 * `_formDisabled` instead of the lifecycle callbacks. Its members are copied
 * onto the stub's prototype when it loads.
 *
 * @module
 */
import { define, ElementBase } from "./base.ts";

export interface LazySchema {
  /** Properties that may be set before the code is there (replayed after it loads). */
  props?: string[];
  /** Attributes the element observes. */
  attrs?: string[];
  /** Methods that may be called before the code is there (they wait for it and return a Promise). */
  methods?: string[];
  formAssociated?: boolean;
  /** Loads the implementation: a module whose `impl` export is the class. */
  load(): Promise<{ impl: CustomElementConstructor }>;
}

type Instance = HTMLElement & {
  _internals?: ElementInternals | null;
  _ready?: boolean;
  _pending?: [string, unknown][];
  _calls?: [string, unknown[], (v: unknown) => void, (e: unknown) => void][];
  _init?(): void;
  _connected?(): void;
  _disconnected?(): void;
  _attributeChanged?(name: string, old: string | null, value: string | null): void;
  _formReset?(): void;
  _formDisabled?(disabled: boolean): void;
};

const LIFECYCLE = new Set(["constructor", "connectedCallback", "disconnectedCallback", "attributeChangedCallback", "formResetCallback", "formDisabledCallback", "formAssociatedCallback"]);

/** How many implementation modules have been loaded (for tests and diagnostics). */
export const lazyStats: { loaded: string[] } = { loaded: [] };

/** Registers `tag` now; its code loads on first connect. */
export function defineLazy(tag: string, schema: LazySchema): void {
  if (typeof customElements === "undefined" || customElements.get(tag)) return;
  let installed = false;
  let loading: Promise<void> | null = null;

  class Stub extends ElementBase {
    static formAssociated = !!schema.formAssociated;
    static get observedAttributes(): string[] {
      return schema.attrs ?? [];
    }
    constructor() {
      super();
      const self = this as unknown as Instance;
      self._ready = false;
      self._pending = [];
      self._calls = [];
      self._internals = null;
      if (schema.formAssociated) {
        try {
          self._internals = this.attachInternals();
        } catch { /* not supported */ }
      }
      // Values set on the element before it was upgraded are own properties
      // shadowing our accessors: take them over.
      for (const p of schema.props ?? []) {
        if (Object.prototype.hasOwnProperty.call(this, p)) {
          const v = (this as unknown as Record<string, unknown>)[p];
          delete (this as unknown as Record<string, unknown>)[p];
          self._pending!.push([p, v]);
        }
      }
    }
    connectedCallback(): void {
      const self = this as unknown as Instance;
      if (self._ready) return self._connected?.();
      void ensure().then(() => {
        boot(self);
        if (this.isConnected) self._connected?.();
      }, (e) => console.error(`[sandbox ui] ${tag} failed to load:`, e));
    }
    disconnectedCallback(): void {
      const self = this as unknown as Instance;
      if (self._ready) self._disconnected?.();
    }
    attributeChangedCallback(name: string, old: string | null, value: string | null): void {
      const self = this as unknown as Instance;
      if (self._ready) self._attributeChanged?.(name, old, value);
    }
    formResetCallback(): void {
      const self = this as unknown as Instance;
      if (self._ready) self._formReset?.();
    }
    formDisabledCallback(disabled: boolean): void {
      const self = this as unknown as Instance;
      if (self._ready) self._formDisabled?.(disabled);
    }
  }

  // Before the code: properties are remembered, methods wait.
  for (const p of schema.props ?? []) {
    Object.defineProperty(Stub.prototype, p, {
      configurable: true,
      get(this: Instance) {
        const hit = [...(this._pending ?? [])].reverse().find(([k]) => k === p);
        return hit?.[1];
      },
      set(this: Instance, v: unknown) {
        this._pending = (this._pending ?? []).filter(([k]) => k !== p);
        this._pending.push([p, v]);
      },
    });
  }
  for (const m of schema.methods ?? []) {
    Object.defineProperty(Stub.prototype, m, {
      configurable: true,
      writable: true,
      value(this: Instance, ...args: unknown[]) {
        return new Promise((resolve, reject) => {
          this._calls!.push([m, args, resolve, reject]);
          void ensure().then(() => this.isConnected && boot(this));
        });
      },
    });
  }

  function ensure(): Promise<void> {
    if (installed) return Promise.resolve();
    loading ??= schema.load().then(({ impl }) => {
      // Copy the implementation's members (all the way up to ElementBase) onto the stub.
      const chain: object[] = [];
      for (let p = impl.prototype; p && p !== ElementBase.prototype && p !== Object.prototype; p = Object.getPrototypeOf(p)) chain.unshift(p);
      const props = new Set(schema.props ?? []);
      const methods = new Set(schema.methods ?? []);
      for (const proto of chain) {
        for (const key of Reflect.ownKeys(proto)) {
          if (typeof key === "string" && LIFECYCLE.has(key)) continue;
          const d = Object.getOwnPropertyDescriptor(proto, key)!;
          if (typeof key === "string" && props.has(key) && (d.get || d.set)) {
            // An element not booted yet (never connected) still only remembers.
            const pending = Object.getOwnPropertyDescriptor(Stub.prototype, key)!;
            Object.defineProperty(Stub.prototype, key, {
              configurable: true,
              get(this: Instance) {
                return this._ready ? d.get?.call(this) : pending.get!.call(this);
              },
              set(this: Instance, v: unknown) {
                if (this._ready) d.set?.call(this, v);
                else pending.set!.call(this, v);
              },
            });
          } else if (typeof key === "string" && methods.has(key) && typeof d.value === "function") {
            const queued = (Stub.prototype as unknown as Record<string, (...a: unknown[]) => unknown>)[key];
            const real = d.value as (...a: unknown[]) => unknown;
            Object.defineProperty(Stub.prototype, key, {
              configurable: true,
              writable: true,
              value(this: Instance, ...args: unknown[]) {
                return this._ready ? real.apply(this, args) : queued.apply(this, args);
              },
            });
          } else Object.defineProperty(Stub.prototype, key, d);
        }
      }
      installed = true;
      lazyStats.loaded.push(tag);
    });
    return loading;
  }

  function boot(el: Instance) {
    if (el._ready) return;
    el._ready = true;
    el._init?.();
    // Attributes already on the element count as changes.
    for (const a of schema.attrs ?? []) if (el.hasAttribute(a)) el._attributeChanged?.(a, null, el.getAttribute(a));
    for (const [k, v] of el._pending ?? []) (el as unknown as Record<string, unknown>)[k] = v;
    el._pending = [];
    for (const [m, args, resolve, reject] of el._calls ?? []) {
      try {
        resolve((el as unknown as Record<string, (...a: unknown[]) => unknown>)[m](...args));
      } catch (e) {
        reject(e);
      }
    }
    el._calls = [];
  }

  define(tag, Stub);
}

/** Loads the implementation of `tag` now (e.g. before measuring a component). */
export async function whenLoaded(tag: string): Promise<void> {
  await customElements.whenDefined(tag);
  const el = document.createElement(tag);
  document.body.append(el);
  el.remove();
  for (let i = 0; i < 100 && !lazyStats.loaded.includes(tag); i++) await new Promise((r) => setTimeout(r, 10));
}
