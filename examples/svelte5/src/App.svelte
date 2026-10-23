<script>
  // A Svelte 5 host, three ways to place an artifact: the action, the attachment, the element.
  import { artifact, sandbox } from "@panth977/sandbox/svelte";
  import "@panth977/sandbox/element";
  import { compile } from "@panth977/sandbox/compiler";
  import { SOURCES } from "./sources.js";

  let total = $state(0);
  let compiled = $state({});
  let ready = $state({});
  const api = {
    user: async () => ({ name: "Svelte" }),
    counter: { add: async (n) => (total += n) },
  };
  const kinds = ["js", "react", "svelte"];
  for (const k of kinds) {
    compile(SOURCES[k]).then((r) => {
      if (r.ok) compiled[k] = r.artifact;
    });
  }
  const onReady = (k) => () => (ready[k] = true);
</script>

<h1>Svelte 5 host</h1>
<p>Total from all artifacts: <b id="total">{total}</b></p>

<section data-kind="js">
  <h2>js · use:artifact</h2>
  {#if compiled.js}<div use:artifact={{ artifact: compiled.js, api, onReady: onReady("js") }}></div>{/if}
  {#if ready.js}<span class="ready">ready</span>{/if}
</section>
<section data-kind="react">
  <h2>react · {"{@attach sandbox()}"}</h2>
  {#if compiled.react}<div {@attach sandbox({ artifact: compiled.react, api, onReady: onReady("react") })}></div>{/if}
  {#if ready.react}<span class="ready">ready</span>{/if}
</section>
<section data-kind="svelte">
  <h2>svelte · &lt;sbx-artifact&gt;</h2>
  {#if compiled.svelte}<sbx-artifact artifact={compiled.svelte} {api} onsbx-ready={onReady("svelte")}></sbx-artifact>{/if}
  {#if ready.svelte}<span class="ready">ready</span>{/if}
</section>

<style>
  h2 { font-size: 15px; }
</style>
