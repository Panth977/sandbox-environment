import { mount, scopes, confirm, audit } from "@panth977/sandbox/host";
import type { ArtifactHandle, CompiledArtifact, MountOptions } from "@panth977/sandbox/host";
import "@panth977/sandbox/element";
import { SbxArtifactElement, defineArtifactElement } from "@panth977/sandbox/element";
import { compile } from "@panth977/sandbox/compiler";
import { createEndpoint } from "@panth977/sandbox/bridge";
import { mountDev } from "@panth977/sandbox/dev";
import { artifact } from "@panth977/sandbox/svelte";
export async function demo(el: HTMLElement) {
  const r = await compile({ "/index.js": "export {}" });
  const a: CompiledArtifact = r.artifact!;
  const h: ArtifactHandle = mount(el, { artifact: a, api: { x: async () => 1 }, middleware: [scopes({}, []), audit(() => {})] } as MountOptions);
  const e = document.createElement("sbx-artifact") as SbxArtifactElement;
  e.artifact = a; e.api = {}; e.addEventListener("sbx-ready", () => {});
  defineArtifactElement("my-artifact");
  void createEndpoint; void mountDev; void artifact; void confirm; void h;
}
