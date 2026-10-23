/**
 * Host side: mount artifacts, guard their calls, build sandbox documents.
 *
 * @module
 */
export { mount } from "./mount.js";

export { buildCsp, cleanOrigins, runtimeHtml, sandboxHtml } from "./html.js";

export { audit, confirm, dryRun, matchRule, maxArgBytes, rateLimit, scopes } from "../middleware.js";

export { SandboxError } from "../bridge.js";
