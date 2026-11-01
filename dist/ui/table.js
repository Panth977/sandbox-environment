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
  _init()       {
    this._columns = [];
    this._rows = [];
    this._sort = null;
    this._selected = new Set     ();
    this._raf = 0;
  }

  _connected()       {
    this.style.display = this.style.display || "block";
    this._schedule();
  }

  _attributeChanged()       {
    this._schedule();
  }

  get columns()           {
    return this._columns;
  }
  set columns(v          ) {
    this._columns = Array.isArray(v) ? v : [];
    this._schedule();
  }

  get rows()        {
    return this._rows;
  }
  set rows(v       ) {
    this._rows = Array.isArray(v) ? v : [];
    for (const r of [...this._selected]) if (!this._rows.includes(r)) this._selected.delete(r);
    this._schedule();
  }

  /** Selected rows (with the `selectable` attribute). */
  get selection()        {
    return this._rows.filter((r) => this._selected.has(r));
  }
  set selection(v       ) {
    this._selected = new Set(v);
    this._schedule();
  }

  /** Rows in display order. */
  get sortedRows()        {
    if (!this._sort) return this._rows;
    const col = this._columns.find((c) => c.key === this._sort .key);
    const get = col?.sortValue ?? ((r     ) => r[this._sort .key]);
    const out = [...this._rows].sort((a, b) => cmp(get(a), get(b)));
    return this._sort.dir === "desc" ? out.reverse() : out;
  }

  sortBy(key        , dir                 = "asc")       {
    this._sort = { key, dir };
    this._schedule();
  }

  _schedule() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this._render();
    });
  }

  _render() {
    const selectable = this.hasAttribute("selectable");
    const cols = this._columns.length
      ? this._columns
      : Object.keys(this._rows[0] ?? {}).map((key) => ({ key, label: key }          ));
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
      all.checked = rows.length > 0 && rows.every((r) => this._selected.has(r));
      all.indeterminate = !all.checked && rows.some((r) => this._selected.has(r));
      all.addEventListener("change", () => {
        if (all.checked) rows.forEach((r) => this._selected.add(r));
        else this._selected.clear();
        emit(this, "selectionchange", { rows: this.selection });
        this._schedule();
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
        const on = this._sort?.key === c.key;
        th.setAttribute("aria-sort", on ? (this._sort .dir === "asc" ? "ascending" : "descending") : "none");
        if (on) th.textContent += this._sort .dir === "asc" ? " ↑" : " ↓";
        const toggle = () => {
          const dir = this._sort?.key === c.key && this._sort.dir === "asc" ? "desc" : "asc";
          this._sort = { key: c.key, dir };
          emit(this, "sort", { key: c.key, dir });
          this._schedule();
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
          cb.checked = this._selected.has(row);
          cb.setAttribute("aria-label", "Select row");
          cb.addEventListener("click", (e) => e.stopPropagation());
          cb.addEventListener("change", () => {
            cb.checked ? this._selected.add(row) : this._selected.delete(row);
            emit(this, "selectionchange", { rows: this.selection });
            this._schedule();
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
