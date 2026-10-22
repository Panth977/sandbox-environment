import { test } from "node:test";
import assert from "node:assert/strict";

// Importing any entry point outside a browser (Node, SSR, unit tests) must not throw.
test("every entry point imports without a DOM", async () => {
  for (const m of ["../src/mod.ts", "../src/host/mod.ts", "../src/host/svelte.ts", "../src/ui/index.ts", "../src/editor/editor.ts",
    "../src/dev/mod.ts", "../src/compiler/mod.ts", "../src/artifact/artifact.ts", "../src/artifact/stores.ts", "../src/artifact/react.ts"]) {
    await assert.doesNotReject(import(m), m);
  }
});
