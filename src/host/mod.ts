/**
 * Host side: mount artifacts, guard their calls, build sandbox documents.
 *
 * @module
 */
export { mount } from "./mount.ts";
export type { ArtifactHandle, MountOptions, SandboxFlag } from "./mount.ts";
export { buildCsp, cleanOrigins, runtimeHtml, sandboxHtml } from "./html.ts";
export type { CspOptions } from "./html.ts";
export { audit, confirm, dryRun, matchRule, maxArgBytes, rateLimit, scopes } from "../middleware.ts";
export type { AuditEntry } from "../middleware.ts";
export { SandboxError } from "../bridge.ts";
export type { CallContext, Middleware, Remote, RemoteStream } from "../bridge.ts";
export type { ArtifactManifest, CompiledArtifact, ComponentPackRef, ConsoleEntry, RuntimeErrorEntry, Theme } from "../protocol.ts";
