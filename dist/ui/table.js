/**
 * `<sbx-table>`: a data table with sorting, selection, sticky header,
 * loading and empty states. Renders into its own light DOM with the kit's
 * `.sbx-table` classes, so your CSS can style it.
 *
 * ```js
 * table.columns = [
 *   { key: "name", label: "Device", sortable: true },
 *   { key: "pm25", label: "PM2.5", align: "right", sortable: true, format: (v) => v.toFixed(1) },
 * ];
 * table.rows = devices;
 * table.addEventListener("rowclick", (e) => open(e.detail.row));
 * ```
 * Attributes: `selectable`, `compact`, `striped`, `loading`, `empty` (text), `max-height`.
 * Events: `rowclick` `{ row, index }`, `selectionchange` `{ rows }`, `sort` `{ key, dir }`.
 *
 * @module
 */
import { ElementBase, define, emit } from "./base.js";

function cmp(a         , b         )         {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export class SbxTable extends ElementBase {
  static get observedAttributes()           {
    return ["selectable", "compact", "striped", "loading", "empty", "max-height"];
  }
  #columns           = [];
  #rows        = [];
  #sort                                              = null;
  #selected = new Set     ();
  #raf = 0;

  connectedCallback()       {
    this.style.display = this.style.display || "block";
    this.#schedule();
  }

  attributeChangedCallback()       {
    this.#schedule();
  }

  get columns()           {
    return this.#columns;
  }
  set columns(v          ) {
    this.#columns = Array.isArray(v) ? v : [];
    this.#schedule();
  }

  get rows()        {
    return this.#rows;
  }
  set rows(v       ) {
    this.#rows = Array.isArray(v) ? v : [];
    for (const r of [...this.#selected]) if (!this.#rows.includes(r)) this.#selected.delete(r);
    this.#schedule();
  }

  /** Selected rows (with the `selectable` attribute). */
  get selection()        {
    return this.#rows.filter((r) => this.#selected.has(r));
  }
  set selection(v       ) {
    this.#selected = new Set(v);
    this.#schedule();
  }

  /** Rows in display order. */
  get sortedRows()        {
    if (!this.#sort) return this.#rows;
    const col = this.#columns.find((c) => c.key === this.#sort .key);
    const get = col?.sortValue ?? ((r     ) => r[this.#sort .key]);
    const out = [...this.#rows].sort((a, b) => cmp(get(a), get(b)));
    return this.#sort.dir === "desc" ? out.reverse() : out;
  }

  sortBy(key        , dir                 = "asc")       {
    this.#sort = { key, dir };
    this.#schedule();
  }

  #schedule() {
    if (this.#raf) return;
    this.#raf = requestAnimationFrame(() => {
      this.#raf = 0;
      this.#render();
    });
  }

  #render() {
    const selectable = this.hasAttribute("selectable");
    const cols = this.#columns.length
      ? this.#columns
      : Object.keys(this.#rows[0] ?? {}).map((key) => ({ key, label: key }          ));
    const rows = this.sortedRows;
    const wrap = document.createElement("div");
    wrap.className = "sbx-table-wrap";
    const mh = this.getAttribute("max-height");
    if (mh) wrap.style.maxHeight = /^\d+$/.test(mh) ? `${mh}px` : mh;
    const table = document.createElement("table");
    table.className = "sbx-table" + (this.hasAttribute("compact") ? " sbx-table--compact" : "") +
      (this.hasAttribute("striped") ? " sbx-table--striped" : "");
    const thead = table.createTHead();
    const hr = thead.insertRow();
    if (selectable) {
      const th = document.createElement("th");
      th.style.width = "32px";
      const all = document.createElement("input");
      all.type = "checkbox";
      all.setAttribute("aria-label", "Select all");
      all.style.accentColor = "var(--sbx-accent)";
      all.checked = rows.length > 0 && rows.every((r) => this.#selected.has(r));
      all.indeterminate = !all.checked && rows.some((r) => this.#selected.has(r));
      all.addEventListener("change", () => {
        if (all.checked) rows.forEach((r) => this.#selected.add(r));
        else this.#selected.clear();
        emit(this, "selectionchange", { rows: this.selection });
        this.#schedule();
      });
      th.append(all);
      hr.append(th);
    }
    for (const c of cols) {
      const th = document.createElement("th");
      th.textContent = c.label ?? c.key;
      if (c.width) th.style.width = c.width;
      if (c.align) th.style.textAlign = c.align;
      if (c.sortable) {
        th.style.cursor = "pointer";
        th.style.userSelect = "none";
        th.tabIndex = 0;
        const on = this.#sort?.key === c.key;
        th.setAttribute("aria-sort", on ? (this.#sort .dir === "asc" ? "ascending" : "descending") : "none");
        if (on) th.textContent += this.#sort .dir === "asc" ? " ↑" : " ↓";
        const toggle = () => {
          const dir = this.#sort?.key === c.key && this.#sort.dir === "asc" ? "desc" : "asc";
          this.#sort = { key: c.key, dir };
          emit(this, "sort", { key: c.key, dir });
          this.#schedule();
        };
        th.addEventListener("click", toggle);
        th.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle()));
      }
      hr.append(th);
    }
    const tbody = table.createTBody();
    const span = cols.length + (selectable ? 1 : 0);
    if (this.hasAttribute("loading")) {
      for (let i = 0; i < 3; i++) {
        const td = tbody.insertRow().insertCell();
        td.colSpan = span;
        td.innerHTML = `<span class="sbx-skeleton" style="height:14px;width:${60 + i * 12}%"></span>`;
      }
    } else if (!rows.length) {
      const td = tbody.insertRow().insertCell();
      td.colSpan = span;
      td.style.textAlign = "center";
      td.style.padding = "24px";
      td.className = "sbx-muted";
      td.textContent = this.getAttribute("empty") ?? "No rows";
    } else {
      rows.forEach((row, index) => {
        const tr = tbody.insertRow();
        if (selectable) {
          const td = tr.insertCell();
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.style.accentColor = "var(--sbx-accent)";
          cb.checked = this.#selected.has(row);
          cb.setAttribute("aria-label", "Select row");
          cb.addEventListener("click", (e) => e.stopPropagation());
          cb.addEventListener("change", () => {
            cb.checked ? this.#selected.add(row) : this.#selected.delete(row);
            emit(this, "selectionchange", { rows: this.selection });
            this.#schedule();
          });
          td.append(cb);
        }
        for (const c of cols) {
          const td = tr.insertCell();
          if (c.align) td.style.textAlign = c.align;
          const raw = row[c.key];
          const out = c.format ? c.format(raw, row) : raw == null ? "" : raw instanceof Date ? raw.toLocaleString() : String(raw);
          if (out instanceof Node) td.append(out);
          else td.textContent = out ?? "";
          if (c.align === "right") td.style.fontVariantNumeric = "tabular-nums";
        }
        tr.addEventListener("click", () => emit(this, "rowclick", { row, index }));
      });
    }
    wrap.append(table);
    this.replaceChildren(wrap);
  }
}

define("sbx-table", SbxTable);
