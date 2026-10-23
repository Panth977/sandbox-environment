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
import { define, ElementBase } from "./base.js";

const LIFECYCLE = new Set(["constructor", "connectedCallback", "disconnectedCallback", "attributeChangedCallback", "formResetCallback", "formDisabledCallback", "formAssociatedCallback"]);

/** How many implementation modules have been loaded (for tests and diagnostics). */
export const lazyStats                       = { loaded: [] };

/** Registers `tag` now; its code loads on first connect. */
export function defineLazy(tag        , schema            )       {
  if (typeof customElements === "undefined" || customElements.get(tag)) return;
  let installed = false;
  let loading                       = null;

  class Stub extends ElementBase {
    static formAssociated = !!schema.formAssociated;
    static get observedAttributes()           {
      return schema.attrs ?? [];
    }
    constructor() {
      super();
      const self = this                       ;
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
          const v = (this                                      )[p];
          delete (this                                      )[p];
          self._pending .push([p, v]);
        }
      }
    }
    connectedCallback()       {
      const self = this                       ;
      if (self._ready) return self._connected?.();
      void ensure().then(() => {
        boot(self);
        if (this.isConnected) self._connected?.();
      }, (e) => console.error(`[sandbox ui] ${tag} failed to load:`, e));
    }
    disconnectedCallback()       {
      const self = this                       ;
      if (self._ready) self._disconnected?.();
    }
    attributeChangedCallback(name        , old               , value               )       {
      const self = this                       ;
      if (self._ready) self._attributeChanged?.(name, old, value);
    }
    formResetCallback()       {
      const self = this                       ;
      if (self._ready) self._formReset?.();
    }
    formDisabledCallback(disabled         )       {
      const self = this                       ;
      if (self._ready) self._formDisabled?.(disabled);
    }
  }

  // Before the code: properties are remembered, methods wait.
  for (const p of schema.props ?? []) {
    Object.defineProperty(Stub.prototype, p, {
      configurable: true,
      get(              ) {
        const hit = [...(this._pending ?? [])].reverse().find(([k]) => k === p);
        return hit?.[1];
      },
      set(                v         ) {
        this._pending = (this._pending ?? []).filter(([k]) => k !== p);
        this._pending.push([p, v]);
      },
    });
  }
  for (const m of schema.methods ?? []) {
    Object.defineProperty(Stub.prototype, m, {
      configurable: true,
      writable: true,
      value(                ...args           ) {
        return new Promise((resolve, reject) => {
          this._calls .push([m, args, resolve, reject]);
          void ensure().then(() => this.isConnected && boot(this));
        });
      },
    });
  }

  function ensure()                {
    if (installed) return Promise.resolve();
    loading ??= schema.load().then(({ impl }) => {
      // Copy the implementation's members (all the way up to ElementBase) onto the stub.
      const chain           = [];
      for (let p = impl.prototype; p && p !== ElementBase.prototype && p !== Object.prototype; p = Object.getPrototypeOf(p)) chain.unshift(p);
      const props = new Set(schema.props ?? []);
      const methods = new Set(schema.methods ?? []);
      for (const proto of chain) {
        for (const key of Reflect.ownKeys(proto)) {
          if (typeof key === "string" && LIFECYCLE.has(key)) continue;
          const d = Object.getOwnPropertyDescriptor(proto, key) ;
          if (typeof key === "string" && props.has(key) && (d.get || d.set)) {
            // An element not booted yet (never connected) still only remembers.
            const pending = Object.getOwnPropertyDescriptor(Stub.prototype, key) ;
            Object.defineProperty(Stub.prototype, key, {
              configurable: true,
              get(              ) {
                return this._ready ? d.get?.call(this) : pending.get .call(this);
              },
              set(                v         ) {
                if (this._ready) d.set?.call(this, v);
                else pending.set .call(this, v);
              },
            });
          } else if (typeof key === "string" && methods.has(key) && typeof d.value === "function") {
            const queued = (Stub.prototype                                                           )[key];
            const real = d.value                                ;
            Object.defineProperty(Stub.prototype, key, {
              configurable: true,
              writable: true,
              value(                ...args           ) {
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

  function boot(el          ) {
    if (el._ready) return;
    el._ready = true;
    el._init?.();
    // Attributes already on the element count as changes.
    for (const a of schema.attrs ?? []) if (el.hasAttribute(a)) el._attributeChanged?.(a, null, el.getAttribute(a));
    for (const [k, v] of el._pending ?? []) (el                                      )[k] = v;
    el._pending = [];
    for (const [m, args, resolve, reject] of el._calls ?? []) {
      try {
        resolve((el                                                           )[m](...args));
      } catch (e) {
        reject(e);
      }
    }
    el._calls = [];
  }

  define(tag, Stub);
}

/** Loads the implementation of `tag` now (e.g. before measuring a component). */
export async function whenLoaded(tag        )                {
  await customElements.whenDefined(tag);
  const el = document.createElement(tag);
  document.body.append(el);
  el.remove();
  for (let i = 0; i < 100 && !lazyStats.loaded.includes(tag); i++) await new Promise((r) => setTimeout(r, 10));
}
