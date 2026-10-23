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
    expect(Array.isArray(r.lazyBefore) && r.lazyBefore.length === 0, `no component code loaded before use (${r.lazyBefore})`);
    expect(JSON.stringify(r.lazyAfter) === '["sbx-table"]', `only the rendered component loads (${r.lazyAfter})`);
    expect(r.packBefore === false, "plain pack not loaded before its tag appears");
    expect(r.packText === "hello from pack | kit Asha", `lazy host packs render (${r.packText})`);
    expect(r.rowsBeforeLoad === 2, `properties set before the code loaded are kept (${r.rowsBeforeLoad})`);
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
  const h = await frame.locator("#h").filter({ hasText: "2 devices" }).textContent({ timeout: 30000 }).catch(() => null);
  expect(h === "2 devices", `preview renders host data (${h})`);
  // TypeScript diagnostics (TS + libs + @types/react fetched from CDNs)
  const problem = await page.waitForFunction(() => {
    const t = document.querySelector(".sbx-dev__list")?.textContent ?? "";
    return t.includes("not assignable to type 'number'") ? t : null;
  }, null, { timeout: 90000 }).then((x) => x.jsonValue()).catch(() => null);
  expect(!!problem, "TS type error listed in Problems");
  const leftover = await page.evaluate(() => document.querySelector(".sbx-dev__list")?.textContent ?? "");
  expect(!/Cannot find module|JSX element implicitly|IntrinsicElements/.test(leftover), `no bogus module/JSX errors: ${leftover.slice(0, 400)}`);
  // the editor is Monaco
  await page.evaluate(() => window.__dev.ready);
  expect(await page.locator(".sbx-dev__code .monaco-editor").count() === 1, "Monaco editor mounted");
  // edit → rebuild → preview updates
  await page.evaluate(() => window.__dev.setFile("/App.tsx", window.__dev.files()["/App.tsx"].replace("devices</h1>", "sensors</h1>")));
  const h2 = await page.waitForFunction(async () => true, null, { timeout: 1000 }).then(() =>
    page.frameLocator(".sbx-dev__preview iframe").locator("#h").filter({ hasText: "sensors" }).textContent({ timeout: 20000 })).catch(() => null);
  expect(h2 === "2 sensors", `rebuild after edit (${h2})`);

  // ---- the explorer ----
  const tree = page.locator(".sbx-tree__body");
  const names = await tree.locator(".sbx-tree__row .sbx-tree__name").allTextContents();
  expect(["App.tsx", "index.tsx", "manifest.json"].every((n) => names.includes(n)), `tree lists files (${names})`);
  // new file inside a new folder, typed inline
  await page.locator(".sbx-tree__head [data-act=new-file]").click();
  await tree.locator(".sbx-tree__input").fill("components/Chart.tsx");
  await tree.locator(".sbx-tree__input").press("Enter");
  let files = await page.evaluate(() => Object.keys(window.__dev.files()).sort());
  expect(files.includes("/components/Chart.tsx"), `new file created (${files})`);
  expect(await tree.locator(".sbx-tree__row[data-folder=true]", { hasText: "components" }).count() === 1, "folder shown in tree");
  expect(await page.locator(".sbx-dev__tab[aria-selected=true]").textContent().then((t) => t.includes("Chart.tsx")), "new file opened in a tab");
  const content = await page.evaluate(() => window.__dev.files()["/components/Chart.tsx"]);
  expect(content.includes("export function Chart()"), `new .tsx starts as a component (${content})`);
  // rename by double click
  await tree.locator('.sbx-tree__row[data-path="/components/Chart.tsx"]').dblclick();
  await tree.locator(".sbx-tree__input").fill("Bars.tsx");
  await tree.locator(".sbx-tree__input").press("Enter");
  files = await page.evaluate(() => Object.keys(window.__dev.files()).sort());
  expect(files.includes("/components/Bars.tsx") && !files.includes("/components/Chart.tsx"), `rename (${files})`);
  // rename the folder moves its files
  await tree.locator('.sbx-tree__row[data-path="/components"]').dblclick();
  await tree.locator(".sbx-tree__input").fill("ui");
  await tree.locator(".sbx-tree__input").press("Enter");
  files = await page.evaluate(() => Object.keys(window.__dev.files()).sort());
  expect(files.includes("/ui/Bars.tsx"), `folder rename moves files (${files})`);
  // delete (with the confirm dialog)
  await tree.locator('.sbx-tree__row[data-path="/ui/Bars.tsx"]').hover();
  await tree.locator('.sbx-tree__row[data-path="/ui/Bars.tsx"] [data-act=delete]').click();
  await page.locator("sbx-dialog button[data-close=ok]").click();
  await page.waitForTimeout(200);
  files = await page.evaluate(() => Object.keys(window.__dev.files()).sort());
  expect(!files.includes("/ui/Bars.tsx"), `delete (${files})`);
  // tabs: close one
  const before = await page.locator(".sbx-dev__tab").count();
  await page.locator(".sbx-dev__tab", { hasText: "index.tsx" }).hover();
  await page.locator(".sbx-dev__tab", { hasText: "index.tsx" }).locator(".x").click();
  expect(await page.locator(".sbx-dev__tab").count() === before - 1, "tab closes");
  // find in the editor (Monaco's find widget)
  await tree.locator('.sbx-tree__row[data-path="/App.tsx"]').click();
  await page.evaluate(() => {
    window.__dev.goTo(1, 1);
    return window.__dev.editor.getAction("actions.find").run();
  });
  await page.locator(".find-widget textarea, .find-widget input").first().fill("rows");
  const count = await page.locator(".find-widget .matchesCount").textContent({ timeout: 5000 }).catch(() => "");
  expect(/^1 of [2-9]/.test(count), `find counts matches (${count})`);
  await page.keyboard.press("Escape");
  // status bar
  const pos = await page.locator(".sbx-dev__status [data-s=pos]").textContent();
  expect(/^Ln \d+, Col \d+/.test(pos), `status shows cursor (${pos})`);
  const lang = await page.locator(".sbx-dev__status [data-s=lang]").textContent();
  expect(lang === "TypeScript JSX", `status shows language (${lang})`);

  // ---- completions while typing (what a person sees) ----
  const suggest = page.locator(".suggest-widget.visible");
  const typeAt = async (path, line, text) => {
    await tree.locator(`.sbx-tree__row[data-path="${path}"]`).click();
    await page.evaluate((l) => window.__dev.goTo(l, 1000), line);
    await page.keyboard.press("Enter");
    await page.keyboard.type(text, { delay: 40 });
  };
  const labels = async () => {
    await suggest.waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
    return (await suggest.locator(".monaco-list-row .label-name").allTextContents().catch(() => [])).join(" ");
  };
  await typeAt("/App.tsx", 8, "host.devices.");
  const tsx = await labels();
  expect(tsx.includes("list"), `typing host.devices. in .tsx pops completions (${tsx.slice(0, 120)})`);
  await page.keyboard.press("Escape");
  // an object of methods says so (icon + type), and the pane beside the list shows its members
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("Enter");
  await page.keyboard.type("host.dev", { delay: 40 });
  const settled = await page.waitForFunction(() => {
    const row = [...document.querySelectorAll(".suggest-widget.visible .monaco-list-row")].find((r) => r.textContent.includes("devices"));
    const icon = row?.querySelector(".suggest-icon")?.className ?? "";
    const pane = document.querySelector(".suggest-details-container .suggest-details, .suggest-details");
    const text = pane && pane.offsetParent !== null ? pane.textContent : "";
    return /symbol-module/.test(icon) && /list\(q\?/.test(text) ? { icon, text, row: row.textContent } : null;
  }, null, { timeout: 30000 }).then((h) => h.jsonValue()).catch(() => null);
  expect(!!settled, "host.devices is shown as an object, and the details pane lists its members");
  expect(/Devices the viewer can see/.test(settled?.text ?? ""), `pane shows member docs (${(settled?.text ?? "").slice(0, 160)})`);
  expect(/\{ list \}/.test(settled?.row ?? ""), `row shows the object's short type (${settled?.row})`);
  await page.keyboard.press("Escape");
  // go to definition opens the other file
  await tree.locator('.sbx-tree__row[data-path="/index.tsx"]').click();
  await page.evaluate(() => {
    const ed = window.__dev.editor;
    const m = ed.getModel();
    const p = m.getPositionAt(m.getValue().indexOf("App }") + 1);
    ed.setPosition(p);
    ed.focus();
    ed.trigger("t", "editor.action.revealDefinition", {});
  });
  const defTab = await page.waitForFunction(() => {
    const t = document.querySelector(".sbx-dev__tab[aria-selected=true]")?.textContent ?? "";
    return t.includes("App.tsx") ? t : null;
  }, null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => null);
  expect(!!defTab, "go to definition opens App.tsx");
  // rename a symbol across files
  const renamed = await page.evaluate(async () => {
    const ed = window.__dev.editor;
    const m = ed.getModel();
    ed.setPosition(m.getPositionAt(m.getValue().indexOf("function App") + 10));
    ed.focus();
    ed.trigger("t", "editor.action.rename", {});
    return true;
  });
  const box = await page.locator(".rename-box input, .rename-input").first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  expect(box, "rename box opens");
  const input = page.locator(".rename-box input, .rename-input").first();
  await input.fill("Home");
  await input.press("Enter");
  const both = await page.waitForFunction(() => {
    const f = window.__dev.files();
    return f["/App.tsx"].includes("function Home") && f["/index.tsx"].includes("Home") ? true : null;
  }, null, { timeout: 15000 }).catch(() => null);
  expect(renamed && !!both, `rename updates both files (${JSON.stringify(await page.evaluate(() => [window.__dev.files()["/index.tsx"], window.__dev.files()["/App.tsx"].slice(0, 300)]))})`);
  // a Svelte file gets the same: script blocks and template expressions
  await page.evaluate(() => window.__dev.setFile("/Card.svelte", '<script lang="ts">\n  import { host } from "@panth977/sandbox/artifact";\n  let total = $state(0);\n</script>\n<p>{total}</p>\n'));
  await page.waitForTimeout(500);
  await typeAt("/Card.svelte", 3, "host.devices.");
  const sv = await labels();
  expect(sv.includes("list"), `typing host.devices. in .svelte pops completions (${sv.slice(0, 120)})`);
  await page.keyboard.press("Escape");
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
  await f.locator("sbx-toaster").evaluate((el) => new Promise((r) => { const t = () => (el.shadowRoot?.textContent ? r() : setTimeout(t, 20)); t(); }));
  const toastText = await f.locator("sbx-toaster").evaluate((el) => el.shadowRoot.textContent);
  expect(toastText.includes("Menu: share"), `menu select → toast (${toastText})`);
  // dialog via keyboard
  await f.locator("sbx-tabs button", { hasText: "Feedback" }).click();
  await f.locator("#d1").click();
  expect(await f.locator("#dlg").evaluate((el) => el.open), "dialog opens");
  await f.locator("#dlg").press("Escape");
  expect(!(await f.locator("#dlg").evaluate((el) => el.open)), "Esc closes dialog");
};

// ---- hosts: the same three artifacts (plain JS, React, Svelte) in each kind of host app ----
async function hostCheck(r, expect, page) {
  let total = 0;
  for (const kind of ["js", "react", "svelte"]) {
    const section = page.locator(`section[data-kind="${kind}"]`);
    const ok = await section.locator(".ready").waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
    expect(ok, `${kind}: artifact ready`);
    if (!ok) continue;
    const frame = section.frameLocator("iframe");
    const who = await frame.locator("#who").textContent({ timeout: 20000 }).catch(() => "");
    expect(/sees \S/.test(who) && !who.includes("…"), `${kind}: host.user() answered (${who})`);
    await frame.locator("#add").click();
    total += 1;
    const count = await frame.locator("#count").filter({ hasText: String(total) }).textContent({ timeout: 10000 }).catch(() => null);
    expect(count === String(total), `${kind}: host.counter.add() round trip (${count})`);
    const shown = await page.locator("#total").filter({ hasText: String(total) }).count();
    expect(shown === 1, `${kind}: the host's own view updated to ${total}`);
  }
}
CHECKS["host-vanilla"] = hostCheck;
CHECKS["host-angular15"] = hostCheck;
CHECKS["host-svelte5"] = hostCheck;
