// Assertions per e2e page: (results, expect) => void
export const CHECKS = {
  render(r, expect) {
    expect(r.readyResolved, "ready promise resolved");
    expect(r.reported, "artifact reported results");
    expect(!r.fatal, `artifact fatal: ${r.fatal}`);
    expect(r.sum === 5, "call returns value");
    expect(JSON.stringify(r.devices) === JSON.stringify([{ id: "d1", org: "o7" }]), "env + nested call");
    expect(JSON.stringify(r.stream) === "[0,1,2,3,4]", "stream iterates");
    expect(r.ticks >= 2, `callback fired (${r.ticks})`);
    expect(r.denied === "permission-denied", `scope denies write (${r.denied})`);
    expect(r.secret === "permission-denied", `path without rule refused (${r.secret})`);
    expect(r.fetchAllowed === true, "fetch to allowed origin works");
    expect(r.fetchOther === false, "fetch to other origin blocked by CSP");
    expect(r.storage === "blocked", `localStorage blocked (${r.storage})`);
    expect(r.parentDom === "blocked", "parent DOM unreachable");
    expect(r.origin === "null", `opaque origin (${r.origin})`);
    expect(r.defined?.length === 8, `UI kit defined (${r.defined})`);
    expect(r.themeMode === "dark", "theme passed at boot");
    expect(r.accentVar === "#7089f5", `dark tokens applied (${r.accentVar})`);
    expect(r.themeChanged === "light", "theme pushed live");
    expect(r.exposed?.ready === true && r.exposed?.n === 5, "host calls artifact's exposed API");
    expect(r.console.some((c) => c.startsWith('log:artifact says {"a":1}')), "console relayed");
    expect(r.errors.some((e) => e.includes("boom from artifact")), "runtime errors relayed");
    expect(parseInt(r.iframeHeight) >= 300, `auto height (${r.iframeHeight})`);
    expect(r.sandboxAttr === "allow-scripts", `sandbox flags (${r.sandboxAttr})`);
    expect(r.afterDestroy === 0, "destroy removes iframe");
    expect(r.audit.includes("devices.remove:false") && r.audit.includes("math.add:true"), "audit saw calls");
  },
};

CHECKS.compile = async function (r, expect, page) {
  expect(!r.fatal, `fatal: ${r.fatal}`);
  expect(!r.diagnostics?.react?.length, `react diagnostics: ${r.diagnostics?.react}`);
  expect(!r.diagnostics?.svelte?.length, `svelte diagnostics: ${r.diagnostics?.svelte}`);
  expect(r.reactMounted && r.svelteMounted, "both mounted");
  expect(r.reactRows === 2, `react rendered host data (${r.reactRows})`);
  expect(r.svelteRows === 2, `svelte rendered host data (${r.svelteRows})`);
  expect(!r.errors?.length, `runtime errors: ${r.errors}`);
  // interact inside the sandboxed frames (Playwright can, the host page cannot)
  const svelte = page.frameLocator("#svelte iframe");
  await svelte.locator("#b").click();
  await svelte.locator("#b").click();
  const clicks = await page.waitForFunction(() => window.__results.svelteClicks === 2 && 2, null, { timeout: 5000 }).then((h) => h.jsonValue()).catch(() => null);
  expect(clicks === 2, `svelte click reached host (${clicks})`);
  const h1Color = await svelte.locator("h1").evaluate((el) => getComputedStyle(el).color);
  expect(h1Color === "rgb(1, 2, 3)", `svelte scoped css applied (${h1Color})`);
  const react = page.frameLocator("#react iframe");
  await react.locator("#sel").click();
  await react.locator("sbx-select .item").nth(1).click();
  const val = await react.locator("#sel").evaluate((el) => el.value);
  expect(val === "D2", `sbx-select inside React picks value (${val})`);
};
