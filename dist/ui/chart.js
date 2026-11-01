/**
 * `<sbx-chart>`: line, area, bar, pie and donut charts in SVG. Responsive,
 * themed by the `--sbx-c1…c8` palette, hover tooltips, click-to-toggle legend.
 *
 * ```js
 * chart.type = "line";                  // "line" | "area" | "bar" | "pie" | "donut"
 * chart.data = [{ day: "Mon", pm25: 41, pm10: 80 }, …];
 * chart.x = "day";
 * chart.y = ["pm25", "pm10"];           // or one key
 * chart.labels = { pm25: "PM2.5" };     // optional series names
 * ```
 * Attributes: `height` (px, default 240), `stacked`, `no-legend`, `unit`.
 * Numbers / dates on x give a linear axis; anything else is categorical.
 *
 * @module
 */
import { ElementBase, define, emit, esc, shadow } from "./base.js";

const CSS = `
:host { display: block; position: relative; }
svg { display: block; width: 100%; overflow: visible; }
.axis text, .lbl { fill: var(--sbx-muted); font-size: 11px; font-family: var(--sbx-font); }
.grid { stroke: var(--sbx-line); stroke-width: 1; }
.base { stroke: var(--sbx-line-strong); }
.legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 6px; font-size: 12px; }
.legend button { all: unset; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; color: var(--sbx-text); }
.legend button[aria-pressed="false"] { opacity: .4; }
.sw { width: 10px; height: 10px; border-radius: 2px; }
.tip { position: absolute; pointer-events: none; background: var(--sbx-surface); border: 1px solid var(--sbx-line);
  box-shadow: var(--sbx-shadow); border-radius: var(--sbx-radius); padding: 6px 8px; font-size: 12px; white-space: nowrap; display: none; z-index: 1; }
.tip b { display: block; margin-bottom: 2px; font-weight: 600; }
.tip div { display: flex; align-items: center; gap: 6px; }
.empty { display: grid; place-items: center; color: var(--sbx-subtle); font-size: 12px; border: 1px dashed var(--sbx-line); border-radius: var(--sbx-radius); }
`;

const color = (i        ) => `var(--sbx-c${(i % 8) + 1})`;

function niceTicks(min        , max        , count = 5)           {
  if (min === max) {
    max = min + 1;
    min = min - (min === 0 ? 0 : 1);
  }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const out           = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 1e-9; v += step) out.push(+v.toFixed(10));
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

function fmt(v        , unit = "")         {
  const a = Math.abs(v);
  const s = a >= 1e9 ? (v / 1e9).toFixed(1) + "B" : a >= 1e6 ? (v / 1e6).toFixed(1) + "M" : a >= 1e4 ? (v / 1e3).toFixed(1) + "k"
    : Number.isInteger(v) ? String(v) : v.toFixed(a < 1 ? 3 : 1).replace(/\.?0+$/, "");
  return s + unit;
}

function asTime(v         )                {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

export class SbxChart extends ElementBase {
  _init()       {
    this._data = [];
    this._type = "line";
    this._x = "x";
    this._y = ["y"];
    this._labels = {};
    this._hidden = new Set        ();
    this._width = 0;
    this._raf = 0;
    this._name = (k        ) => this._labels[k] ?? k;
  }

  _connected()       {
    if (!this._root) {
      this._root = shadow(this, CSS, `<div class="plot" part="plot"></div><div class="legend" part="legend"></div><div class="tip" part="tooltip"></div>`);
      new ResizeObserver((e) => {
        const w = Math.floor(e[0].contentRect.width);
        if (w !== this._width) {
          this._width = w;
          this._schedule();
        }
      }).observe(this);
      this._root.querySelector(".legend") .addEventListener("click", (e) => {
        const b = (e.target           ).closest             ("button");
        if (!b) return;
        const k = b.dataset.key ;
        this._hidden.has(k) ? this._hidden.delete(k) : this._hidden.add(k);
        this._schedule();
      });
    }
    this._schedule();
  }

  _attributeChanged(name        , _o               , v               )       {
    if (name === "type" && v) this._type = v             ;
    if (name === "x" && v) this._x = v;
    if (name === "y" && v) this._y = v.split(",").map((s) => s.trim()).filter(Boolean);
    this._schedule();
  }

  get type()            {
    return this._type;
  }
  set type(v           ) {
    this._type = v;
    this._schedule();
  }
  get data()        {
    return this._data;
  }
  set data(v       ) {
    this._data = Array.isArray(v) ? v : [];
    this._schedule();
  }
  get x()         {
    return this._x;
  }
  set x(v        ) {
    this._x = v;
    this._schedule();
  }
  get y()                    {
    return this._y.length === 1 ? this._y[0] : this._y;
  }
  set y(v                   ) {
    this._y = Array.isArray(v) ? v : [v];
    this._schedule();
  }
  get labels()                         {
    return this._labels;
  }
  set labels(v                        ) {
    this._labels = v ?? {};
    this._schedule();
  }

  _schedule() {
    if (this._raf || !this._root) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this._render();
    });
  }

  _render()       {
    const H = Number(this.getAttribute("height") ?? 240);
    const W = this._width || this.clientWidth || 480;
    const plot = this._root.querySelector             (".plot") ;
    const legend = this._root.querySelector             (".legend") ;
    const tip = this._root.querySelector             (".tip") ;
    tip.style.display = "none";
    const unit = this.getAttribute("unit") ?? "";
    if (!this._data.length) {
      plot.innerHTML = `<div class="empty" style="height:${H}px">No data</div>`;
      legend.innerHTML = "";
      return;
    }
    const keys = this._y;
    const pie = this._type === "pie" || this._type === "donut";
    // legend
    const legendItems = pie ? this._data.map((r) => String(r[this._x])) : keys;
    legend.style.display = this.hasAttribute("no-legend") || (!pie && keys.length < 2) ? "none" : "";
    legend.innerHTML = legendItems.map((k, i) =>
      `<button data-key="${esc(k)}" aria-pressed="${!this._hidden.has(k)}"><span class="sw" style="background:${color(i)}"></span>${esc(pie ? k : this._name(k))}</button>`
    ).join("");
    if (pie) return this._pie(plot, tip, W, H, unit);

    const visible = keys.filter((k) => !this._hidden.has(k));
    const xs = this._data.map((r) => r[this._x]);
    const times = xs.map(asTime);
    const linear = this._type !== "bar" && xs.every((v, i) => typeof v === "number" || times[i] !== null);
    const xNum = xs.map((v, i) => (typeof v === "number" ? v : times[i] ?? i));
    const isTime = linear && times.every((t) => t !== null);
    const stacked = this.hasAttribute("stacked") && (this._type === "bar" || this._type === "area");
    const val = (r     , k        ) => {
      const n = Number(r[k]);
      return Number.isFinite(n) ? n : 0;
    };
    let lo = 0;
    let hi = 0;
    for (const r of this._data) {
      if (stacked) {
        let s = 0;
        for (const k of visible) s += val(r, k);
        hi = Math.max(hi, s);
      } else {
        for (const k of visible) {
          hi = Math.max(hi, val(r, k));
          lo = Math.min(lo, val(r, k));
        }
      }
    }
    const ticks = niceTicks(lo, hi || 1);
    const yMin = ticks[0];
    const yMax = ticks[ticks.length - 1];
    const padL = Math.max(28, ...ticks.map((t) => fmt(t, unit).length * 6.5 + 10));
    const padR = 8;
    const padT = 8;
    const padB = 22;
    const iw = Math.max(10, W - padL - padR);
    const ih = Math.max(10, H - padT - padB);
    const yPos = (v        ) => padT + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;
    const n = this._data.length;
    const xMin = Math.min(...xNum);
    const xMax = Math.max(...xNum);
    const band = iw / n;
    const xPos = (i        ) => (linear ? padL + ((xNum[i] - xMin) / (xMax - xMin || 1)) * iw : padL + band * i + band / 2);
    const xLabel = (i        ) => {
      const v = xs[i];
      if (isTime) {
        const d = new Date(times[i] );
        return xMax - xMin > 2 * 864e5 ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
      }
      return typeof v === "number" ? fmt(v) : String(v ?? "");
    };

    let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(this.getAttribute("aria-label") ?? `${this._type} chart`)}">`;
    svg += `<g class="axis">`;
    for (const t of ticks) {
      const y = yPos(t);
      svg += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}"/><text x="${padL - 6}" y="${y + 3.5}" text-anchor="end">${esc(fmt(t, unit))}</text>`;
    }
    const maxLabels = Math.max(2, Math.floor(iw / 64));
    const every = Math.ceil(n / maxLabels);
    for (let i = 0; i < n; i += every) svg += `<text x="${xPos(i)}" y="${H - 6}" text-anchor="middle">${esc(xLabel(i))}</text>`;
    svg += `<line class="base" x1="${padL}" x2="${W - padR}" y1="${yPos(Math.max(0, yMin))}" y2="${yPos(Math.max(0, yMin))}"/></g>`;

    if (this._type === "bar") {
      const groupW = band * 0.72;
      const bw = stacked ? groupW : groupW / Math.max(1, visible.length);
      this._data.forEach((r, i) => {
        let acc = 0;
        visible.forEach((k, j) => {
          const v = val(r, k);
          const ci = keys.indexOf(k);
          const x0 = padL + band * i + (band - groupW) / 2 + (stacked ? 0 : j * bw);
          const from = stacked ? acc : 0;
          const to = stacked ? acc + v : v;
          acc += v;
          const y1 = yPos(Math.max(from, to));
          const y2 = yPos(Math.min(from, to));
          svg += `<rect x="${x0}" y="${y1}" width="${Math.max(1, bw - 1)}" height="${Math.max(0, y2 - y1)}" rx="2" fill="${color(ci)}"/>`;
        });
      });
    } else {
      const base = new Array(n).fill(0);
      visible.forEach((k) => {
        const ci = keys.indexOf(k);
        const pts = this._data.map((r, i) => {
          const v = val(r, k) + (stacked ? base[i] : 0);
          return [xPos(i), yPos(v)]         ;
        });
        const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
        if (this._type === "area") {
          const floor = stacked
            ? this._data.map((_, i) => [xPos(i), yPos(base[i])]         ).reverse()
            : [[xPos(n - 1), yPos(Math.max(0, yMin))]         , [xPos(0), yPos(Math.max(0, yMin))]         ];
          svg += `<path d="${d}${floor.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join("")}Z" fill="${color(ci)}" fill-opacity=".18"/>`;
        }
        svg += `<path d="${d}" fill="none" stroke="${color(ci)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
        if (n <= 40) for (const [x, y] of pts) svg += `<circle cx="${x}" cy="${y}" r="2.5" fill="${color(ci)}"/>`;
        if (stacked) this._data.forEach((r, i) => (base[i] += val(r, k)));
      });
    }
    svg += `<line class="cross" x1="0" x2="0" y1="${padT}" y2="${padT + ih}" stroke="var(--sbx-line-strong)" stroke-dasharray="3 3" visibility="hidden"/>`;
    svg += `<rect class="hit" x="${padL}" y="${padT}" width="${iw}" height="${ih}" fill="transparent"/></svg>`;
    plot.innerHTML = svg;

    const hit = plot.querySelector                (".hit") ;
    const cross = plot.querySelector                (".cross") ;
    const nearest = (px        ) => {
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < n; i++) {
        const d = Math.abs(xPos(i) - px);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      return best;
    };
    hit.addEventListener("pointermove", (e) => {
      const rect = plot.getBoundingClientRect();
      const i = nearest(e.clientX - rect.left);
      const x = xPos(i);
      cross.setAttribute("x1", String(x));
      cross.setAttribute("x2", String(x));
      cross.setAttribute("visibility", "visible");
      tip.innerHTML = `<b>${esc(xLabel(i))}</b>` + visible.map((k) =>
        `<div><span class="sw" style="background:${color(keys.indexOf(k))}"></span>${esc(this._name(k))}: ${esc(fmt(val(this._data[i], k), unit))}</div>`
      ).join("");
      tip.style.display = "block";
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.min(Math.max(0, x + 12), W - tw)}px`;
      tip.style.top = `${padT}px`;
    });
    hit.addEventListener("pointerleave", () => {
      tip.style.display = "none";
      cross.setAttribute("visibility", "hidden");
    });
    hit.addEventListener("click", (e) => {
      const rect = plot.getBoundingClientRect();
      const i = nearest(e.clientX - rect.left);
      emit(this, "pointclick", { index: i, row: this._data[i] });
    });
  }

  _pie(plot             , tip             , W        , H        , unit        ) {
    const k = this._y[0];
    const items = this._data.map((r, i) => ({ label: String(r[this._x]), v: Math.max(0, Number(r[k]) || 0), i, row: r }))
      .filter((s) => !this._hidden.has(s.label));
    const total = items.reduce((a, s) => a + s.v, 0) || 1;
    const R = Math.min(H, W) / 2 - 6;
    const cx = W / 2;
    const cy = H / 2;
    const inner = this._type === "donut" ? R * 0.6 : 0;
    let a0 = -Math.PI / 2;
    let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(this.getAttribute("aria-label") ?? "pie chart")}">`;
    for (const s of items) {
      const a1 = a0 + (s.v / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a        , r        ) => `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
      const full = s.v / total > 0.9999;
      const d = full
        ? `M${p(0, R)}A${R},${R} 0 1 1 ${p(Math.PI, R)}A${R},${R} 0 1 1 ${p(0, R)}` + (inner ? `M${p(0, inner)}A${inner},${inner} 0 1 0 ${p(Math.PI, inner)}A${inner},${inner} 0 1 0 ${p(0, inner)}` : "")
        : inner
        ? `M${p(a0, R)}A${R},${R} 0 ${large} 1 ${p(a1, R)}L${p(a1, inner)}A${inner},${inner} 0 ${large} 0 ${p(a0, inner)}Z`
        : `M${cx},${cy}L${p(a0, R)}A${R},${R} 0 ${large} 1 ${p(a1, R)}Z`;
      svg += `<path d="${d}" fill="${color(s.i)}" stroke="var(--sbx-surface)" stroke-width="1.5" fill-rule="evenodd" data-i="${s.i}"/>`;
      a0 = a1;
    }
    if (inner) svg += `<text class="lbl" x="${cx}" y="${cy + 5}" text-anchor="middle" style="font-size:16px;fill:var(--sbx-text);font-weight:600">${esc(fmt(total, unit))}</text>`;
    plot.innerHTML = svg + "</svg>";
    plot.querySelector("svg") .addEventListener("pointermove", (e) => {
      const path = (e.target           ).closest("path");
      if (!path) {
        tip.style.display = "none";
        return;
      }
      const s = items.find((x) => x.i === Number(path.getAttribute("data-i"))) ;
      tip.innerHTML = `<b>${esc(s.label)}</b><div>${esc(fmt(s.v, unit))} · ${((s.v / total) * 100).toFixed(1)}%</div>`;
      tip.style.display = "block";
      const r = plot.getBoundingClientRect();
      tip.style.left = `${Math.min(e.clientX - r.left + 12, W - tip.offsetWidth)}px`;
      tip.style.top = `${e.clientY - r.top + 12}px`;
    });
    plot.querySelector("svg") .addEventListener("pointerleave", () => (tip.style.display = "none"));
    plot.querySelector("svg") .addEventListener("click", (e) => {
      const path = (e.target           ).closest("path");
      if (path) {
        const i = Number(path.getAttribute("data-i"));
        emit(this, "pointclick", { index: i, row: this._data[i] });
      }
    });
  }
}
