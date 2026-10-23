/**
 * Host side: mount artifacts, guard their calls, build sandbox documents.
 *
 * @module
 */
export { mount } from "./mount.js";
export type { ArtifactHandle, MountOptions, SandboxFlag } from "./mount.js";
export { buildCsp, cleanOrigins, runtimeHtml, sandboxHtml } from "./html.js";
export type { CspOptions } from "./html.js";
export { audit, confirm, dryRun, matchRule, maxArgBytes, rateLimit, scopes } from "../middleware.js";
export type { AuditEntry } from "../middleware.js";
export { SandboxError } from "../bridge.js";
export type { CallContext, Middleware, Remote, RemoteStream } from "../bridge.js";
export type { ArtifactManifest, CompiledArtifact, ComponentPackRef, ConsoleEntry, RuntimeErrorEntry, Theme } from "../protocol.js";
