/**
 * Svelte adapter, as plain functions (no Svelte import, works with Svelte 4 and 5):
 *
 * ```svelte
 * <script>
 *   import { artifact } from "@panth977/sandbox/svelte";
 *   let { compiled, api } = $props();
 * </script>
 * <div use:artifact={{ artifact: compiled, api, theme: { mode: "dark" } }}></div>
 * <!-- Svelte 5 attachment: <div {@attach sandbox({ artifact: compiled, api })}></div> -->
 * ```
 *
 * Updating the parameters: a new `artifact` reloads the frame; `theme` and `env`
 * are pushed live; anything else remounts.
 *
 * @module
 */
import { mount } from "./mount.js";

/** Svelte action: `use:artifact={options}`. */
export function artifact(node             , options                       )                                                              {
  let current = options;
  let handle = mount(node, options);
  options.onHandle?.(handle);
  return {
    update(next) {
      const prev = current;
      current = next;
      const sameExceptLive = Object.keys({ ...prev, ...next }).every((k) =>
        k === "artifact" || k === "theme" || k === "env" || k === "onHandle" ||
        (prev                                      )[k] === (next                                      )[k]
      );
      if (!sameExceptLive) {
        handle.destroy();
        handle = mount(node, next);
        next.onHandle?.(handle);
        return;
      }
      if (prev.artifact !== next.artifact) handle.reload(next.artifact);
      if (prev.theme !== next.theme && next.theme) void handle.setTheme(next.theme);
      if (prev.env !== next.env && next.env) void handle.setEnv(next.env);
    },
    destroy() {
      handle.destroy();
    },
  };
}

/** Svelte 5 attachment: `{@attach sandbox(options)}`. */
export function sandbox(options                       )                                    {
  return (node) => {
    const a = artifact(node, options);
    return () => a.destroy();
  };
}
