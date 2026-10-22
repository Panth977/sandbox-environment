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

CHECKS.dev = async function (r, expect, page) {
  expect(r.mounted, "dev engine mounted");
  // first build + preview
  await page.waitForFunction(() => window.__results.builds.length > 0, null, { timeout: 60000 }).catch(() => {});
  const r2 = await page.evaluate(() => window.__results);
  expect(r2.builds[0] === true, `first build ok (${r2.builds})`);
  const frame = page.frameLocator(".sbx-dev__preview iframe");
  const h = await frame.locator("#h").textContent({ timeout: 30000 }).catch(() => null);
  expect(h === "2 devices", `preview renders host data (${h})`);
  // TypeScript diagnostics (TS + libs + @types/react fetched from CDNs)
  const problem = await page.waitForFunction(() => {
    const t = document.querySelector(".sbx-dev__list")?.textContent ?? "";
    return t.includes("not assignable to type 'number'") ? t : null;
  }, null, { timeout: 90000 }).then((x) => x.jsonValue()).catch(() => null);
  expect(!!problem, "TS type error listed in Problems");
  const leftover = await page.evaluate(() => document.querySelector(".sbx-dev__list")?.textContent ?? "");
  expect(!/Cannot find module|JSX element implicitly|IntrinsicElements/.test(leftover), `no bogus module/JSX errors: ${leftover.slice(0, 400)}`);
  // completions for the host API (types from hostTypes)
  const items = await page.evaluate(async () => {
    window.__dev.openFile("/App.tsx");
    const ed = document.querySelector("sbx-editor");
    const src = ed.value;
    const pos = src.indexOf("host.devices.") + "host.devices.".length;
    const res = await ed.completions(pos, src);
    return res?.items.map((i) => i.label) ?? [];
  });
  expect(items.includes("list"), `completions for host.devices. (${items.slice(0, 10)})`);
  // edit → rebuild → preview updates
  await page.evaluate(() => window.__dev.setFile("/App.tsx", window.__dev.files()["/App.tsx"].replace("devices</h1>", "sensors</h1>")));
  const h2 = await page.waitForFunction(async () => true, null, { timeout: 1000 }).then(() =>
    page.frameLocator(".sbx-dev__preview iframe").locator("#h").filter({ hasText: "sensors" }).textContent({ timeout: 20000 })).catch(() => null);
  expect(h2 === "2 sensors", `rebuild after edit (${h2})`);
};

CHECKS.ui = async function (r, expect, page) {
  expect(r.galleryReady, "gallery rendered");
  expect(!r.errors.length, `errors: ${r.errors}`);
  const f = page.frameLocator("#slot iframe");
  // select: open, search, pick
  await f.locator("#org").click();
  await f.locator("#org .search").fill("pu");
  await f.locator("#org .item").first().click();
  expect(await f.locator("#org").evaluate((el) => el.value) === "pune", "select search + pick");
  // multi-select
  await f.locator("#types").click();
  await f.locator("#types .item").nth(0).click();
  await f.locator("#types .item").nth(2).click();
  await f.locator("#types").press("Escape");
  const multi = await f.locator("#types").evaluate((el) => el.value.join(","));
  expect(multi === "polludrone,odosense", `multi select (${multi})`);
  // table sort + select
  for (let i = 0; i < 3; i++) {
    const sort = await f.locator("sbx-table th", { hasText: "PM2.5" }).getAttribute("aria-sort");
    if (sort === "descending") break;
    await f.locator("sbx-table th", { hasText: "PM2.5" }).click();
    await page.waitForTimeout(100);
  }
  const first = await f.locator("sbx-table tbody tr td:nth-child(2)").first().textContent();
  expect(first === "DEL-11", `table sorts desc (${first})`);
  // tabs + chart
  await f.locator("sbx-tabs button", { hasText: "Charts" }).click();
  const bars = await f.locator("#bar").evaluate((el) => el.shadowRoot.querySelectorAll("rect[rx]").length);
  expect(bars === 4, `bar chart bars (${bars})`);
  const paths = await f.locator("#pie").evaluate((el) => el.shadowRoot.querySelectorAll("path").length);
  expect(paths === 3, `donut slices (${paths})`);
  // menu + toast
  await f.locator("sbx-menu [slot=trigger]").click();
  await f.locator("sbx-menu .item", { hasText: "Share" }).click();
  const toastText = await f.locator("sbx-toaster").evaluate((el) => el.shadowRoot.textContent);
  expect(toastText.includes("Menu: share"), `menu select → toast (${toastText})`);
  // dialog via keyboard
  await f.locator("sbx-tabs button", { hasText: "Feedback" }).click();
  await f.locator("#d1").click();
  expect(await f.locator("#dlg").evaluate((el) => el.open), "dialog opens");
  await f.locator("#dlg").press("Escape");
  expect(!(await f.locator("#dlg").evaluate((el) => el.open)), "Esc closes dialog");
};
