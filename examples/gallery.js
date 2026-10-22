// A gallery of the UI kit, as a plain-JS artifact (no framework).
// Used by the docs playground and the e2e "ui" page.
import { host } from "@panth977/sandbox/artifact";
import { confirmDialog, toast } from "@panth977/sandbox/ui";

const root = document.getElementById("root");
root.innerHTML = `
<main class="sbx-page sbx-stack" style="--sbx-gap:20px">
  <header class="sbx-row sbx-row--between">
    <div><h1 style="margin:0">UI kit</h1><p class="sbx-muted" style="margin:0">Everything below is inside the sandbox.</p></div>
    <div class="sbx-row">
      <sbx-tooltip text="Toggle dark mode"><sbx-switch id="dark">Dark</sbx-switch></sbx-tooltip>
      <sbx-menu placement="bottom-end">
        <button slot="trigger" class="sbx-btn">Actions ▾</button>
        <sbx-menu-item value="export" shortcut="E">Export CSV</sbx-menu-item>
        <sbx-menu-item value="share">Share…</sbx-menu-item>
        <sbx-menu-separator></sbx-menu-separator>
        <sbx-menu-item value="delete" danger>Delete</sbx-menu-item>
      </sbx-menu>
    </div>
  </header>

  <section class="sbx-grid" style="--sbx-min:180px">
    <div class="sbx-stat"><span class="sbx-stat__label">Devices online</span><span class="sbx-stat__value" id="online">—</span><span class="sbx-stat__delta sbx-stat__delta--up">+4 this week</span></div>
    <div class="sbx-stat"><span class="sbx-stat__label">Avg PM2.5</span><span class="sbx-stat__value" id="avg">—</span><span class="sbx-stat__delta sbx-stat__delta--down">−8%</span></div>
    <div class="sbx-stat"><span class="sbx-stat__label">Alerts</span><span class="sbx-stat__value">3</span><span class="sbx-stat__delta">2 critical</span></div>
  </section>

  <sbx-tabs value="data">
    <sbx-tab value="data" count="12">Data</sbx-tab>
    <sbx-tab value="charts">Charts</sbx-tab>
    <sbx-tab value="forms">Forms</sbx-tab>
    <sbx-tab value="feedback">Feedback</sbx-tab>
    <section data-tab="data" class="sbx-stack">
      <div class="sbx-row">
        <sbx-select id="org" placeholder="Organisation" clearable searchable>
          <optgroup label="West"><option value="amd">Ahmedabad</option><option value="pune">Pune</option><option value="mum">Mumbai</option></optgroup>
          <optgroup label="North"><option value="del">Delhi</option><option value="jai">Jaipur</option></optgroup>
        </sbx-select>
        <sbx-select id="types" placeholder="Device types" multiple>
          <option value="polludrone">Polludrone</option><option value="dustroid">Dustroid</option><option value="odosense">Odosense</option>
        </sbx-select>
        <span class="sbx-spacer"></span>
        <button class="sbx-btn sbx-btn--primary" id="alloc">Move to spare pool</button>
      </div>
      <sbx-table id="table" selectable max-height="320"></sbx-table>
    </section>
    <section data-tab="charts" class="sbx-grid" style="--sbx-min:320px">
      <div class="sbx-card sbx-card--pad"><h3>PM2.5 by device</h3><sbx-chart id="bar" type="bar" x="name" y="pm25" height="220"></sbx-chart></div>
      <div class="sbx-card sbx-card--pad"><h3>Last 24 h</h3><sbx-chart id="line" type="area" x="t" height="220"></sbx-chart></div>
      <div class="sbx-card sbx-card--pad"><h3>Fleet</h3><sbx-chart id="pie" type="donut" x="type" y="n" height="220"></sbx-chart></div>
    </section>
    <section data-tab="forms" class="sbx-stack" style="max-width:520px">
      <label class="sbx-field"><span class="sbx-label" data-required>Name</span><input class="sbx-input" placeholder="Bulk allocation run"><span class="sbx-hint">Shown in the audit log</span></label>
      <label class="sbx-field"><span class="sbx-label">Notes</span><textarea class="sbx-textarea"></textarea></label>
      <div class="sbx-input-group"><span class="sbx-input-addon">https://</span><input class="sbx-input" placeholder="example.com"></div>
      <label class="sbx-check"><input type="checkbox" checked> Notify owners</label>
      <label class="sbx-check"><input type="radio" name="r" checked> Now</label>
      <label class="sbx-check"><input type="radio" name="r"> Tonight</label>
      <input type="range" class="sbx-range" value="40">
      <div class="sbx-btn-group"><button class="sbx-btn" aria-pressed="true">Day</button><button class="sbx-btn">Week</button><button class="sbx-btn">Month</button></div>
      <div class="sbx-row"><button class="sbx-btn sbx-btn--primary">Primary</button><button class="sbx-btn">Secondary</button><button class="sbx-btn sbx-btn--ghost">Ghost</button>
        <button class="sbx-btn sbx-btn--danger">Danger</button><button class="sbx-btn sbx-btn--link">Link</button><button class="sbx-btn" aria-busy="true">Saving</button></div>
    </section>
    <section data-tab="feedback" class="sbx-stack">
      <div class="sbx-row"><span class="sbx-badge">Default</span><span class="sbx-badge sbx-badge--accent">Accent</span><span class="sbx-badge sbx-badge--success sbx-badge--dot">Online</span>
        <span class="sbx-badge sbx-badge--warning">Warning</span><span class="sbx-badge sbx-badge--danger">Offline</span><span class="sbx-tag">pm25 <button aria-label="Remove">✕</button></span>
        <span class="sbx-avatar">PP</span><span class="sbx-kbd">⌘K</span></div>
      <div class="sbx-alert sbx-alert--info"><div><strong>Heads up</strong>Calls run with your permissions.</div></div>
      <div class="sbx-alert sbx-alert--danger"><div><strong>3 devices offline</strong>Since 09:40.</div></div>
      <progress class="sbx-progress" value="62" max="100"></progress>
      <span class="sbx-skeleton" style="height:14px;width:60%"></span>
      <div class="sbx-empty"><strong>No runs yet</strong>Move devices to see history here.</div>
      <div class="sbx-row"><button class="sbx-btn" id="t1">Toast</button><button class="sbx-btn" id="d1">Dialog</button><span class="sbx-spinner"></span></div>
    </section>
  </sbx-tabs>
</main>
<sbx-dialog id="dlg" heading="Move devices">
  <p>Move the selected devices to the spare pool?</p>
  <button slot="footer" class="sbx-btn" data-close="cancel">Cancel</button>
  <button slot="footer" class="sbx-btn sbx-btn--primary" data-close="ok">Move</button>
</sbx-dialog>`;

const $ = (id) => document.getElementById(id);
const devices = (await host.devices?.list?.().catch(() => null)) ?? [
  { id: "D1", name: "AMD-01", type: "Polludrone", pm25: 41, online: true },
  { id: "D2", name: "PUN-04", type: "Dustroid", pm25: 88, online: true },
  { id: "D3", name: "DEL-11", type: "Polludrone", pm25: 152, online: false },
  { id: "D4", name: "JAI-02", type: "Odosense", pm25: 63, online: true },
];
$("online").textContent = devices.filter((d) => d.online).length;
$("avg").textContent = Math.round(devices.reduce((a, d) => a + d.pm25, 0) / devices.length);

const status = (d) => {
  const b = document.createElement("span");
  b.className = `sbx-badge sbx-badge--dot ${d.online ? "sbx-badge--success" : "sbx-badge--danger"}`;
  b.textContent = d.online ? "Online" : "Offline";
  return b;
};
$("table").columns = [
  { key: "name", label: "Device", sortable: true },
  { key: "type", label: "Type", sortable: true },
  { key: "pm25", label: "PM2.5", align: "right", sortable: true, format: (v) => `${v} µg/m³` },
  { key: "online", label: "Status", format: (_v, r) => status(r) },
];
$("table").rows = devices;
$("bar").data = devices;
const now = Date.now();
$("line").data = Array.from({ length: 24 }, (_, i) => ({ t: new Date(now - (23 - i) * 3600e3).toISOString(), pm25: 40 + 25 * Math.sin(i / 3) + i, pm10: 70 + 20 * Math.cos(i / 4) }));
$("line").y = ["pm25", "pm10"];
$("line").labels = { pm25: "PM2.5", pm10: "PM10" };
$("pie").data = [{ type: "Polludrone", n: 42 }, { type: "Dustroid", n: 18 }, { type: "Odosense", n: 9 }];

$("dark").addEventListener("change", (e) => (document.documentElement.dataset.theme = e.detail.checked ? "dark" : "light"));
$("t1").addEventListener("click", () => toast("Saved 12 devices", { kind: "success" }));
$("d1").addEventListener("click", () => $("dlg").show());
$("alloc").addEventListener("click", async () => {
  const rows = $("table").selection;
  if (!rows.length) return toast("Select devices first", "warning");
  if (await confirmDialog(`Move ${rows.length} device(s) to the spare pool?`, { confirmLabel: "Move" })) toast(`${rows.length} moved`, "success");
});
document.querySelector("sbx-menu").addEventListener("select", (e) => toast(`Menu: ${e.detail.value}`));
host.report?.({ galleryReady: true }).catch(() => {});
