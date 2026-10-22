/**
 * Ready-made bridge middlewares for hosts: permission scopes, confirmation of
 * destructive calls, rate limits, argument size limits and an audit trail.
 *
 * ```ts
 * mount(div, {
 *   artifact, apis,
 *   middleware: [
 *     audit((e) => log.push(e)),
 *     rateLimit({ perSecond: 20 }),
 *     scopes({ "devices.list": "devices:read", "devices.*": "devices:write" }, granted),
 *     confirm({ "devices.bulkAllocate": (args) => `Allocate ${args[0].length} devices?` }, askUser),
 *   ],
 * });
 * ```
 *
 * @module
 */
import { SandboxError } from "./bridge.ts";
import type { CallContext, Middleware } from "./bridge.ts";

/** `a.b.c` matches rule `a.b.c`, `a.b.*`, `a.*` and `*`; the most specific rule wins. */
export function matchRule<T>(rules: Record<string, T>, path: string[]): T | undefined {
  for (let i = path.length; i >= 0; i--) {
    const key = i === path.length ? path.join(".") : [...path.slice(0, i), "*"].join(".");
    if (key in rules) return rules[key];
  }
  return undefined;
}

/**
 * Permission scopes. `rules` maps a path pattern to the scope(s) it needs
 * (all of them); `granted` is the set the artifact holds (a function is read on
 * every call, so grants can change live). A path with no rule is refused unless
 * `defaultAllow` is true. Callbacks are never checked (the host created them).
 */
export function scopes(
  rules: Record<string, string | string[] | null>,
  granted: Iterable<string> | (() => Iterable<string>),
  options: { defaultAllow?: boolean } = {},
): Middleware {
  return (ctx, next) => {
    if (ctx.callback) return next();
    const need = matchRule(rules, ctx.path);
    if (need === undefined) {
      if (!options.defaultAllow) throw new SandboxError("permission-denied", `${ctx.path.join(".")} is not available to artifacts`);
      return next();
    }
    if (need === null) return next();
    const have = new Set(typeof granted === "function" ? granted() : granted);
    for (const s of Array.isArray(need) ? need : [need]) {
      if (!have.has(s)) throw new SandboxError("permission-denied", `Needs scope "${s}"`, { scope: s, path: ctx.path });
    }
    ctx.meta.scopes = need;
    return next();
  };
}

/**
 * Host-rendered confirmation for destructive calls. `rules` maps a path
 * pattern to the question (a string or a function of the arguments); `ask`
 * shows it to the person and resolves true to go ahead.
 */
export function confirm(
  rules: Record<string, string | ((args: unknown[]) => string)>,
  ask: (question: string, ctx: CallContext) => Promise<boolean> | boolean,
): Middleware {
  return async (ctx, next) => {
    if (ctx.callback) return next();
    const q = matchRule(rules, ctx.path);
    if (q === undefined) return next();
    const question = typeof q === "function" ? q(ctx.args) : q;
    if (!(await ask(question, ctx))) throw new SandboxError("cancelled", "Declined by the user");
    return next();
  };
}

/** At most `perSecond` calls per second (token bucket, burst = `burst` or perSecond). */
export function rateLimit(o: { perSecond: number; burst?: number; now?: () => number }): Middleware {
  const burst = o.burst ?? o.perSecond;
  const now = o.now ?? (() => Date.now());
  let tokens = burst;
  let last = now();
  return (_ctx, next) => {
    const t = now();
    tokens = Math.min(burst, tokens + ((t - last) / 1000) * o.perSecond);
    last = t;
    if (tokens < 1) throw new SandboxError("quota", "Too many calls; slow down");
    tokens -= 1;
    return next();
  };
}

/** Refuse calls whose arguments serialise to more than `maxBytes` (JSON estimate). */
export function maxArgBytes(maxBytes: number): Middleware {
  return (ctx, next) => {
    let size = 0;
    try {
      size = JSON.stringify(ctx.args, (_k, v) => (typeof v === "function" ? null : v))?.length ?? 0;
    } catch {
      size = 0;
    }
    if (size > maxBytes) throw new SandboxError("invalid-argument", `Arguments too large (${size} > ${maxBytes} bytes)`);
    return next();
  };
}

export interface AuditEntry {
  path: string[];
  ok: boolean;
  ms: number;
  error?: { code: string; message: string };
  meta: Record<string, unknown>;
}

/** Reports every call (path, outcome, duration). Put it first to see refusals too. */
export function audit(report: (e: AuditEntry) => void): Middleware {
  return async (ctx, next) => {
    if (ctx.callback) return next();
    const t0 = Date.now();
    try {
      const r = await next();
      report({ path: ctx.path, ok: true, ms: Date.now() - t0, meta: ctx.meta });
      return r;
    } catch (e) {
      const err = e as { code?: string; message?: string };
      report({ path: ctx.path, ok: false, ms: Date.now() - t0, error: { code: String(err?.code ?? "internal"), message: String(err?.message ?? e) }, meta: ctx.meta });
      throw e;
    }
  };
}

/** Dry-run: calls matching `rules` return `fake(ctx)` instead of running (for dev previews). */
export function dryRun(rules: Record<string, true>, fake: (ctx: CallContext) => unknown, enabled: () => boolean = () => true): Middleware {
  return (ctx, next) => {
    if (!ctx.callback && enabled() && matchRule(rules, ctx.path)) return Promise.resolve(fake(ctx));
    return next();
  };
}
