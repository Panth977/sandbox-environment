/**
 * @panth977/sandbox/server: the parent side of the backend sandbox. Same API on Node,
 * Deno and Bun. It talks to sandboxd, which owns Docker, the limits and the compiler.
 *
 * @module
 */
import net from "node:net";
import tls from "node:tls";
import { Peer, SandboxError } from "./peer.mjs";

export { SandboxError };

// ---- 1. Schema: one definition gives types, runtime checks and child adapters ----

                                                                             
                                                                                        
                                                 

                                                    
                                                                                                   
                                               
                          
                                                             
                                                              
  

const of =    (schema            )          => ({ schema });

/** The schema builders. */
                               
                                                                                                                         
                                                               
                                                                
                           
                                                                                                  
                                                    
                                                                        
                                                                         
                                                                             
                                                                           
                                                     
                                                                                   
                                             
                                              
                     
                                                 
                        
 

export const t               = {
  string(rules                                                                                           )               {
    return of({ type: "string", minLength: rules?.min, maxLength: rules?.max, pattern: rules?.pattern, format: rules?.format });
  },
  number(rules                                 )               {
    return of({ type: "number", minimum: rules?.min, maximum: rules?.max });
  },
  integer(rules                                 )               {
    return of({ type: "integer", minimum: rules?.min, maximum: rules?.max });
  },
  boolean()                {
    return of({ type: "boolean" });
  },
  /** Base64 on the wire: Uint8Array here and in Go, a base64 string in Python and JS children. */
  bytes(rules                   )                   {
    return of({ type: "string", format: "byte", maxLength: rules?.max ? Math.ceil(rules.max * 4 / 3) + 4 : undefined });
  },
  literal                                           (value   )          {
    return of({ const: value });
  },
  enum                                   (...values   )                  {
    return of({ enum: values });
  },
  array   (item         , rules                                 )            {
    return of({ type: "array", items: item.schema, minItems: rules?.min, maxItems: rules?.max });
  },
  object                                     (shape   )                    {
    const properties                             = {};
    const required           = [];
    for (const [k, v] of Object.entries(shape)) {
      properties[k] = v.schema;
      if (!(v                         ).optional) required.push(k);
    }
    return of({ type: "object", properties, required });
  },
  record   (value         )                          {
    return of({ type: "object", additionalProperties: value.schema });
  },
  union                                      (...types   )                         {
    return of({ anyOf: types.map((x) => x.schema) });
  },
  nullable   (type         )                 {
    return of({ anyOf: [type.schema, { type: "null" }] });
  },
  optional   (type         )                  {
    return { schema: type.schema, optional: true };
  },
  void()             {
    return of({ type: "null" });
  },
  /** Any JSON. Unchecked: prefer a real type. */
  json()                {
    return of({});
  },
};

/** Per-API rules. The parent enforces them; the sandbox cannot change them. */
                          
                       
                                                                                          
                     
                                                     
 

/** One request, one reply: a promise on both sides. */
                                                                                                           
/** One request, many items: an async iterable on both sides, with backpressure and cancel. */
                                                                                                           

export function api      (input         , output         , meta          )                 {
  return { kind: "unary", input, output, meta };
}
export function stream      (input         , item         , meta          )                  {
  return { kind: "stream", input, item, meta };
}

/** Nested namespaces of APIs. */
                                                                                                     

/** Handed to each implementation. */
                             
                                                             
                      
                     
                                                     
               
 

/** What a developer must implement for a schema. Missing or wrong = compile error. */
                         
                 
                                                                                             
                                                                                                
                 
  

                                                                         

/** How a schema looks to the caller. */
                            
                 
                                                                                               
                                                                                                      
                    
  

// ---- 2. What runs ----

                                                                          

                           
                                                         
                                        
                                                                    
                 
 
                                             
                                             
                                     
                                    
                                                   
                                               
                                                                        
                                        
  

                                                                           
                           
                      
                                                        
                
                                                                                        
                    
                                                                                                  
                         
 

/**
 * Limits of one compile: typecheck, install and build together.
 * Default: 2 cores, 180 s CPU budget, 300 s wall, 1 GiB memory, 512 processes, 512 MiB disk.
 */
                                                                                                         

                             
                                                
                  
                                
                                                       
 

/** Plain JSON. Store it anywhere; run it later on any sandboxd of the same CPU architecture. */
                                                                                                     
            
                                                                           
               
                           
                                                 
                
                
                     
                                        
                 
                                         
                                            
                      
                         
 

                                                                       
                                                                                           
                                                                                     

// ---- 3. Fail-safes. Every field has a safe default; none can be turned off ----

                         
                                                                               
                
     
                                                                           
                                                                                 
                                                       
     
                                              
                                                                                                              
                       
                                                                                              
                  
                                                               
                  
                                                        
                  
                                                                                
                
                                              
                
                                                                                     
                  
                                             
                      
                                           
                        
                                           
                    
                                                      
                       
 

                                
                                                                    
                  
                                             
                 
 

                                                                                                                                     

                        
                                           
                                                                                      
                                                                        
                    

                                                                                                       
                        
                           
                
                  
                 
                                                     
                     
                                            
                          
                                                             
                                                         
 

                          
                                                  
                                                                          
                                               
                                                                                                               
                                                                                                      
                                                                                 
                                                 

                                                                         
                                   
                                           
                    
                  
                          
                                                                                           
                                                  
                            
                                          
 

                                                              
                      
                                                                     
                                
                                        
                                
                                                                 
                                     
                          
                                        
                                                           
                                                          
                            
 

                                                                                                                                                            
                                
                                
 

                                                                        
                                                                                       
                                                                                   
                                             
 

                          
                                                                                                                    
                                                               
                                                                                                     
                                                                                          
                                                                                        
                                                                                             
                                                                                   
                         
 

// ---- 4. Runtime ----

                                 
                                                                        
                   
                 
                                                                  
                  
                                              
              
 

                                                                                                                                                       

function flatten(schema                        , prefix = "", out                       = {})                       {
  for (const [k, v] of Object.entries(schema ?? {})) {
    const path = prefix + k;
    const a = v                                            ;
    if (a.kind === "unary" || a.kind === "stream") {
      out[path] = {
        kind: a.kind,
        input: a.input.schema,
        ...(a.kind === "unary" ? { output: a.output.schema } : { item: a.item.schema }),
        description: a.meta?.description,
        timeoutMs: a.meta?.timeoutMs,
        rateLimit: a.meta?.rateLimit,
      };
    } else flatten(v              , path + ".", out);
  }
  return out;
}

const b64 = (b            ) => btoa(String.fromCharCode(...b));
const unb64 = (s        ) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Turns Uint8Array into base64 strings on the way out, by value. */
function toWire(v         )          {
  if (v instanceof Uint8Array) return b64(v);
  if (Array.isArray(v)) return v.map(toWire);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toWire(x)]));
  return v;
}

/** Restores t.bytes() fields on the way in, by schema. */
function fromWire(s                        , v     )      {
  if (!s || v == null) return v;
  if (s.format === "byte" && typeof v === "string") return unb64(v);
  if (Array.isArray(v) && s.items) return v.map((x) => fromWire(s.items              , x));
  if (typeof v === "object" && s.properties) {
    const p = s.properties                              ;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fromWire(p[k], x)]));
  }
  if (typeof v === "object" && s.additionalProperties) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fromWire(s.additionalProperties              , x)]));
  }
  if (Array.isArray(s.anyOf)) return fromWire((s.anyOf                ).find((o) => o.type !== "null"), v);
  return v;
}

class Link {
          sock            ;
          rid = 1;
          waits = new Map                                                          ();
          buf = "";
          ready                  ;
  closed               = null;
  routes = new Map                          ();

  constructor(o                ) {
    const u = new URL(o.endpoint);
    if (u.protocol === "unix:") this.sock = net.connect(u.pathname);
    else if (u.protocol === "tls:") {
      this.sock = tls.connect({ host: u.hostname, port: Number(u.port), ca: o.ca, servername: u.hostname });
    } else throw new SandboxError("invalid-argument", "endpoint must be unix:// or tls://");
    this.sock.setEncoding("utf8");
    this.sock.on("data", (d        ) => this.data(d));
    const down = (e        ) => this.down(e ?? new SandboxError("unavailable", "sandboxd connection closed"));
    this.sock.on("error", down);
    this.sock.on("close", () => down());
    this.ready = this.request({ op: "hello", token: o.token, limits: o.limits });
  }

          down(e       ) {
    if (this.closed) return;
    this.closed = e;
    for (const w of this.waits.values()) w.no(e);
    this.waits.clear();
    for (const r of this.routes.values()) r({ op: "down" });
  }

          data(d        ) {
    this.buf += d;
    let i;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      const m = JSON.parse(line);
      if (m.op === "reply") {
        const w = this.waits.get(m.rid);
        this.waits.delete(m.rid);
        if (m.error) w?.no(new SandboxError("unavailable", m.error));
        else w?.ok(m.result);
      } else this.routes.get(m.id)?.(m);
    }
  }

  send(m         ) {
    if (!this.closed) this.sock.write(JSON.stringify(m) + "\n");
  }

  request(m                         )               {
    if (this.closed) return Promise.reject(this.closed);
    return new Promise((ok, no) => {
      const rid = this.rid++;
      this.waits.set(rid, { ok, no });
      this.send({ ...m, rid });
    });
  }

  async call(m                         )               {
    await this.ready;
    return this.request(m);
  }

  close() {
    this.sock.end();
  }
}

function apply(chain              , call                                                   , last                        ) {
  const go = (i        )                   => (i < chain.length ? chain[i](call, () => go(i + 1)) : last());
  return go(0);
}

function missing(spec                      , def         )                     {
  for (const p of Object.keys(spec)) {
    if (typeof p.split(".").reduce((o     , k) => o?.[k], def) !== "function") return p;
  }
  return undefined;
}

function startInstance(link      , o                      )                {
  const apis = o.compiledCode.apisSchema                        ;
  const exportsSpec = o.compiledCode.exportsSchema                        ;
  let id = "";
  const ref = "r" + Math.random().toString(36).slice(2);
  let live = false;
  const backlog                 = [];
  const listeners = new Set                                  ();
  let endExit                        ;
  const exited = new Promise          ((r) => (endExit = r));
  let okReady             , noReady                     ;
  const ready = new Promise      ((a, b) => ((okReady = a), (noReady = b)));
  ready.catch(() => {});

  const peer = new Peer(
    (m) => link.send({ op: "frame", id: ref, m }),
    (path) => {
      const s = apis[path];
      const fn = path.split(".").reduce((x     , k) => x?.[k], o.apiDef);
      if (!s || typeof fn !== "function") return undefined;
      const ctxOf = (signal             )             => ({ signal, instanceId: id, path });
      const chain = o.middleware ?? [];
      if (s.kind === "stream") {
        return {
          kind: "stream",
          fn: (input         , c                         ) => {
            const ctx = ctxOf(c.signal);
            return (async function* () {
              const value = fromWire(s.input, input);
              let source                                    ;
              await apply(chain, { path, input: value, ctx }, () => {
                source = fn(value, ctx);
                return Promise.resolve();
              });
              for await (const v of source ?? []) yield toWire(v);
            })();
          },
        };
      }
      return {
        kind: "unary",
        fn: async (input         , c                         ) => {
          const ctx = ctxOf(c.signal);
          const value = fromWire(s.input, input);
          return toWire(await apply(chain, { path, input: value, ctx }, () => Promise.resolve(fn(value, ctx))));
        },
      };
    },
  );

  const emit = (e              ) => {
    try {
      o.onEvent?.(e);
    } catch { /* a monitor must not break the sandbox */ }
    backlog.push(e);
    if (backlog.length > 1000) backlog.shift();
    for (const l of listeners) l(e);
  };

  const exit = (info          ) => {
    peer.closeAll(new SandboxError("exited", "sandbox ended: " + info.reason));
    noReady(new SandboxError("exited", "sandbox ended before it was ready: " + info.reason));
    endExit(info);
    for (const l of listeners) l(null);
    link.routes.delete(ref);
  };

  const route = (m     ) => {
    if (m.op === "frame") peer.receive(m.m);
    else if (m.op === "event") {
      emit(m.event);
      if (m.event.type === "ready") okReady();
      if (m.event.type === "exit") exit(m.event.info);
    } else if (m.op === "down") {
      exit({ reason: "crash", code: null, durationMs: 0, usage: {}          });
    }
  };

  const remote = (prefix = "")      =>
    new Proxy({}, {
      get(_, key) {
        if (typeof key !== "string" || key === "then") return undefined;
        const path = prefix + key;
        const s = exportsSpec[path];
        if (!s) return remote(path + ".");
        const wait = async () => {
          await ready;
        };
        if (s.kind === "stream") {
          return (input         , opts              ) => ({
            async *[Symbol.asyncIterator]() {
              await wait();
              for await (const v of peer.stream(path, toWire(input), opts)) yield fromWire(s.item, v);
            },
          });
        }
        return async (input         , opts              ) => {
          await wait();
          return fromWire(s.output, await peer.call(path, toWire(input), opts));
        };
      },
    });

  const gone = missing(apis, o.apiDef);
  if (gone) {
    const e = new SandboxError("invalid-argument", "apiDef does not implement " + gone);
    noReady(e);
    endExit({ reason: "crash", code: null, durationMs: 0, usage: {}          });
  } else {
    link.routes.set(ref, route);
    link.call({ op: "run", id: ref, run: { compiledCode: o.compiledCode, limits: o.limits, network: o.network, env: o.env } }).then((r) => {
      id = r.id;
      live = true;
    }).catch((e) => {
      noReady(e);
      endExit({ reason: "crash", code: null, durationMs: 0, usage: {}          });
    });
  }

  const started = async () => {
    await ready.catch(() => {});
    return live;
  };

  return {
    get id() {
      return id;
    },
    ready,
    remote: remote(),
    exited,
    async usage() {
      await started();
      return link.call({ op: "usage", id: ref });
    },
    async *events() {
      const queue                          = [...backlog];
      let wake                          ;
      const l = (e                     ) => {
        queue.push(e);
        wake?.();
      };
      listeners.add(l);
      try {
        for (;;) {
          if (queue.length) {
            const e = queue.shift() ;
            if (e === null) return;
            yield e;
            if (e.type === "exit") return;
          } else await new Promise      ((r) => (wake = r));
        }
      } finally {
        listeners.delete(l);
      }
    },
    async stop(options) {
      if (await started()) link.send({ op: "stop", id: ref, graceMs: options?.graceMs });
      return exited;
    },
    async kill() {
      if (await started()) link.send({ op: "kill", id: ref });
      return exited;
    },
  };
}

function compileWire(input                        ) {
  return {
    environment: input.environment,
    files: input.files.map((f) =>
      typeof f.content === "string"
        ? { path: f.path, content: f.content }
        : { path: f.path, content: b64(f.content), encoding: "base64" }
    ),
    apisSchema: flatten(input.apisSchema),
    exportsSchema: flatten(input.exportsSchema),
    limits: input.limits,
  };
}

/** Connects to sandboxd. One connection: when this process dies, its sandboxes die too. */
export function createSandbox(options                )          {
  const link = new Link(options);
  const sandbox          = {
    compile: (input) => link.call({ op: "compile", compile: compileWire(input) }),
    run: (o) => startInstance(link, o),
    runDev                                                 (o                  )                 {
      const devLimits = { cpuBudgetMs: 60000, ...o.limits };
      let files = o.files;
      let current                         ;
      let readyOk             , readyNo                     ;
      const ready = new Promise      ((a, b) => ((readyOk = a), (readyNo = b)));
      ready.catch(() => {});
      let exitOk                        ;
      const exited = new Promise          ((r) => (exitOk = r));
      const latest                 = [];
      const wakes = new Set            ();
      const publish = (d              ) => {
        latest.push(d);
        for (const w of wakes) w();
      };
      const build = async () => {
        const r = await sandbox.compile({ environment: o.environment, files, apisSchema: o.apisSchema, exportsSchema: o.exportsSchema, limits: o.compileLimits });
        publish(r.diagnostics);
        if (!r.ok) return r;
        await current?.kill();
        current = sandbox.run({ ...o, compiledCode: r.compiledCode, limits: devLimits }                    );
        current.exited.then((i) => {
          if (stopped) exitOk(i);
        });
        await current.ready;
        return r;
      };
      let stopped = false;
      build().then((r) => {
        if (r.ok) readyOk();
        else readyNo(new SandboxError("invalid-argument", r.diagnostics[0]?.message ?? "compile failed"));
      }, readyNo);
      const need = () => {
        if (!current) throw new SandboxError("unavailable", "not running");
        return current;
      };
      const remote = new Proxy({}, { get: (_, k        ) => (need().remote       )[k] })                ;
      return {
        get id() {
          return current?.id ?? "";
        },
        ready,
        remote,
        exited,
        usage: () => need().usage(),
        events: () => need().events(),
        stop(a) {
          stopped = true;
          return need().stop(a);
        },
        kill() {
          stopped = true;
          return need().kill();
        },
        async update(next) {
          files = next;
          const r = await build();
          return { ok: r.ok, diagnostics: r.diagnostics };
        },
        async *diagnostics() {
          let i = 0;
          for (;;) {
            while (i < latest.length) yield latest[i++];
            await new Promise      ((r) => wakes.add(r));
          }
        },
      };
    },
    typings: (input) => link.call({ op: "typings", compile: { ...compileWire({ ...input, files: [] }) } }),
    list: () => link.call({ op: "list" }),
    close: () => Promise.resolve(link.close()),
  };
  return sandbox;
}

/** A stored compiledCode loaded back, typed again. It must match the schema it was built with. */
export function asCompiled                                                 (
  json         ,
  schemas                                      ,
)                     {
  const c = (typeof json === "string" ? JSON.parse(json) : json)                      ;
  if (c?.format !== 1) throw new SandboxError("invalid-argument", "not compiled code");
  for (const [name, want, have] of [["apis", flatten(schemas.apisSchema), c.apisSchema], ["exports", flatten(schemas.exportsSchema), c.exportsSchema]]         ) {
    const a = Object.keys(want).sort().join(), b = Object.keys(have ?? {}).sort().join();
    if (a !== b) throw new SandboxError("invalid-argument", `compiled ${name} do not match the schema: rebuild`);
  }
  return c;
}

/** Each path needs its scope(s); a path with no rule is refused. `null` means open. */
export function scopes(rules                                          , granted                                             )             {
  const find = (path        ) => {
    const parts = path.split(".");
    for (let i = parts.length; i >= 0; i--) {
      const k = i === parts.length ? path : [...parts.slice(0, i), "*"].join(".");
      if (k in rules) return { rule: rules[k] };
    }
    return undefined;
  };
  return (call, next) => {
    const hit = find(call.path);
    if (!hit) throw new SandboxError("permission-denied", "no rule for " + call.path);
    const have = new Set(typeof granted === "function" ? granted() : granted);
    for (const s of [hit.rule ?? []].flat()) {
      if (!have.has(s)) throw new SandboxError("permission-denied", "missing scope " + s);
    }
    return next();
  };
}

/** Limits host API calls of one instance, per path. */
export function rateLimit(options                                       )             {
  const burst = options.burst ?? options.perSecond;
  const buckets = new Map                                   ();
  return (call, next) => {
    const k = call.ctx.instanceId + ":" + call.path;
    const now = Date.now();
    const b = buckets.get(k) ?? { n: burst, at: now };
    b.n = Math.min(burst, b.n + (now - b.at) / 1000 * options.perSecond);
    b.at = now;
    buckets.set(k, b);
    if (b.n < 1) throw new SandboxError("quota", "rate limit: " + call.path);
    b.n--;
    return next();
  };
}

export function audit(sink                                                               )             {
  return async (call, next) => {
    const at = Date.now();
    try {
      const v = await next();
      sink({ path: call.path, ms: Date.now() - at });
      return v;
    } catch (e) {
      sink({ path: call.path, ms: Date.now() - at, error: String((e         )?.message ?? e) });
      throw e;
    }
  };
}

/** Listed paths return nothing and do not reach apiDef. */
export function dryRun(paths          )             {
  return (call, next) => (paths.includes(call.path) ? Promise.resolve(null) : next());
}
