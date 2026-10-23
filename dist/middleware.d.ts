import type { CallContext, Middleware } from "./bridge.js";
/** `a.b.c` matches rule `a.b.c`, `a.b.*`, `a.*` and `*`; the most specific rule wins. */
export declare function matchRule<T>(rules: Record<string, T>, path: string[]): T | undefined;
/**
 * Permission scopes. `rules` maps a path pattern to the scope(s) it needs
 * (all of them); `granted` is the set the artifact holds (a function is read on
 * every call, so grants can change live). A path with no rule is refused unless
 * `defaultAllow` is true. Callbacks are never checked (the host created them).
 */
export declare function scopes(rules: Record<string, string | string[] | null>, granted: Iterable<string> | (() => Iterable<string>), options?: {
    defaultAllow?: boolean;
}): Middleware;
/**
 * Host-rendered confirmation for destructive calls. `rules` maps a path
 * pattern to the question (a string or a function of the arguments); `ask`
 * shows it to the person and resolves true to go ahead.
 */
export declare function confirm(rules: Record<string, string | ((args: unknown[]) => string)>, ask: (question: string, ctx: CallContext) => Promise<boolean> | boolean): Middleware;
/** At most `perSecond` calls per second (token bucket, burst = `burst` or perSecond). */
export declare function rateLimit(o: {
    perSecond: number;
    burst?: number;
    now?: () => number;
}): Middleware;
/** Refuse calls whose arguments serialise to more than `maxBytes` (JSON estimate). */
export declare function maxArgBytes(maxBytes: number): Middleware;
export interface AuditEntry {
    path: string[];
    ok: boolean;
    ms: number;
    error?: {
        code: string;
        message: string;
    };
    meta: Record<string, unknown>;
}
/** Reports every call (path, outcome, duration). Put it first to see refusals too. */
export declare function audit(report: (e: AuditEntry) => void): Middleware;
/** Dry-run: calls matching `rules` return `fake(ctx)` instead of running (for dev previews). */
export declare function dryRun(rules: Record<string, true>, fake: (ctx: CallContext) => unknown, enabled?: () => boolean): Middleware;
