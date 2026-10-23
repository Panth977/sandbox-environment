import { test } from "node:test";
import assert from "node:assert/strict";
import { svelteToVirtual } from "../src/dev/svelte.ts";

const SRC = `<script lang="ts">
  import { stream } from "x";
  let count = $state(0);
  const clicks = stream(() => 1);
</script>

<!-- a {comment} -->
<main class="a">
  {#if count > 1}<p>{count} and {$clicks.latest}</p>{:else}<p>none</p>{/if}
  {#each items as item, i (item.id)}<b>{item}</b>{/each}
  <button onclick={() => { count++; }}>x</button>
</main>
<style>p { color: red }</style>`;

test("same length, scripts and expressions kept, the rest blank", () => {
  const v = svelteToVirtual(SRC);
  assert.equal(v.ts, true);
  const head = v.code.slice(0, SRC.length);
  assert.equal(head.length, SRC.length);
  // every newline stays where it was
  for (let i = 0; i < SRC.length; i++) if (SRC[i] === "\n") assert.equal(head[i], "\n", `newline at ${i}`);
  assert.ok(head.includes('let count = $state(0);'));
  assert.ok(head.includes(";    count > 1;"));
  assert.ok(head.includes(";count;"));
  assert.ok(head.includes(";$clicks.latest;"));
  assert.ok(head.includes(";() => { count++; };"));
  assert.ok(!head.includes("comment"));
  assert.ok(!head.includes("color"));
  assert.ok(!head.includes("<main"));
  // positions line up: the `count` in the template is at the same offset
  const at = SRC.indexOf("{count}") + 1;
  assert.equal(head.slice(at, at + 5), "count");
  // the store read gets a declaration after the source
  assert.match(v.code.slice(SRC.length), /declare const \$clicks: __SbxStoreValue<typeof clicks>;/);
  assert.equal(v.scripts.length, 1);
});
