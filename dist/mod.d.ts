/**
 * Sandbox Environment: run untrusted mini-apps ("artifacts") inside any web
 * app, two-way connected to the host through a typed API, with the tools to
 * write and compile them. Zero dependencies.
 *
 * Entry points:
 *  - `@panth977/sandbox/host`: `mount()` an artifact, middleware (scopes, confirm, audit…)
 *  - `@panth977/sandbox/svelte`: Svelte action / attachment
 *  - `@panth977/sandbox/artifact`: what artifacts import (`host`, `env`, `expose`)
 *  - `@panth977/sandbox/ui`: the UI kit (CSS + custom elements)
 *  - `@panth977/sandbox/compiler`: source files → compiled artifact (browser or Node)
 *  - `@panth977/sandbox/dev`: the development engine (editor + preview)
 *  - `@panth977/sandbox/bridge`: the RPC bridge on its own
 *
 * @module
 */
export { mount } from "./host/mount.js";
export type { ArtifactHandle, MountOptions } from "./host/mount.js";
export { createEndpoint, SandboxError } from "./bridge.js";
export type { Remote, RemoteStream } from "./bridge.js";
export { PROTOCOL } from "./protocol.js";
export type { CompiledArtifact, Theme } from "./protocol.js";
