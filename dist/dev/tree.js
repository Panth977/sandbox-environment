/**
 * The dev engine's file explorer: the artifact's files as a folder tree.
 * Folders come from the paths (`/components/Chart.tsx` → `components/`) plus
 * any empty folders created here. Collapsible folders, file icons, error
 * markers, and create / rename / delete / move by drag, inline.
 *
 * Plain DOM, no framework; the dev engine owns the files and passes callbacks.
 *
 * @module
 */
import { esc } from "../ui/base.js";

export const TREE_CSS = `
.sbx-tree { display: flex; flex-direction: column; min-height: 0; background: var(--sbx-surface); border-right: 1px solid var(--sbx-line); font-size: 12.5px; user-select: none; }
.sbx-tree__head { display: flex; align-items: center; gap: 2px; height: 32px; padding: 0 4px 0 10px; color: var(--sbx-muted);
  font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; flex: none; }
.sbx-tree__head span { flex: 1; }
.sbx-tree__head button, .sbx-tree__row button { all: unset; display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 4px; cursor: pointer; color: var(--sbx-muted); font-size: 13px; }
.sbx-tree__head button:hover, .sbx-tree__row button:hover { background: var(--sbx-surface-3); color: var(--sbx-text); }
.sbx-tree__body { overflow: auto; flex: 1; padding: 2px 0 12px; outline: none; }
.sbx-tree__row { display: flex; align-items: center; gap: 4px; height: 24px; padding-right: 4px; cursor: pointer; white-space: nowrap; color: var(--sbx-text); position: relative; }
.sbx-tree__row:hover { background: var(--sbx-surface-2); }
.sbx-tree__row[aria-selected="true"] { background: var(--sbx-accent-soft); color: var(--sbx-accent); }
.sbx-tree__row.focus { box-shadow: inset 0 0 0 1px var(--sbx-accent); }
.sbx-tree__row.drop { background: var(--sbx-accent-soft); }
.sbx-tree__chev { width: 12px; flex: none; color: var(--sbx-subtle); font-size: 9px; text-align: center; transition: transform .1s; }
.sbx-tree__row[aria-expanded="true"] .sbx-tree__chev { transform: rotate(90deg); }
.sbx-tree__icon { width: 18px; flex: none; font: 600 9px/14px var(--sbx-font-mono); text-align: center; border-radius: 3px; }
.sbx-tree__name { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.sbx-tree__acts { display: none; }
.sbx-tree__row:hover .sbx-tree__acts, .sbx-tree__row.focus .sbx-tree__acts { display: inline-flex; }
.sbx-tree__mark { width: 6px; height: 6px; border-radius: 50%; flex: none; }
.sbx-tree__mark.error { background: var(--sbx-danger); } .sbx-tree__mark.warning { background: var(--sbx-warning); }
.sbx-tree__name.error { color: var(--sbx-danger); } .sbx-tree__name.warning { color: var(--sbx-warning); }
.sbx-tree__input { flex: 1; min-width: 0; height: 20px; padding: 0 4px; border: 1px solid var(--sbx-accent); border-radius: 3px;
  background: var(--sbx-surface); color: var(--sbx-text); font: inherit; outline: none; }
.sbx-tree__err { padding: 2px 10px 4px 28px; color: var(--sbx-danger); font-size: 11.5px; white-space: normal; }
`;

const ICONS                                   = {
  ts: ["TS", "#3178c6"], tsx: ["TSX", "#3178c6"], mts: ["TS", "#3178c6"],
  js: ["JS", "#c9a400"], jsx: ["JSX", "#c9a400"], mjs: ["JS", "#c9a400"],
  svelte: ["S", "#ff3e00"], css: ["#", "#7c4dff"], json: ["{}", "#8a8a8a"],
  html: ["<>", "#e34c26"], md: ["M↓", "#6b6560"], svg: ["◇", "#e8a33d"], txt: ["≡", "#8a8a8a"],
};

function iconFor(name        )         {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const [label, color] = ICONS[ext] ?? ["·", "#8a8a8a"];
  return `<span class="sbx-tree__icon" style="color:${color}">${esc(label)}</span>`;
}

const folderIcon = (open         ) =>
  `<span class="sbx-tree__icon" style="color:var(--sbx-accent)"><svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true" style="vertical-align:-1px">` +
  (open
    ? `<path d="M1 2.5V10a1 1 0 0 0 1 1h9.2a1 1 0 0 0 .95-.7L13.6 5.6A.8.8 0 0 0 12.85 4.5H4.2a1 1 0 0 0-.95.7L2 9M1 2.5A1 1 0 0 1 2 1.5h3l1.2 1.5H11a1 1 0 0 1 1 1v.5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>`
    : `<path d="M1 2.5A1 1 0 0 1 2 1.5h3l1.2 1.5H12a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1z" fill="currentColor" fill-opacity=".18" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>`) +
  `</svg></span>`;

/** Path → its parent folder ('/' for top level). */
export const parentOf = (p        )         => p.slice(0, p.lastIndexOf("/")) || "/";

function build(files          , folders          )       {
  const root       = { name: "", path: "/", folder: true, children: [] };
  const dirs = new Map              ([["/", root]]);
  const ensure = (dir        )       => {
    if (dirs.has(dir)) return dirs.get(dir) ;
    const parent = ensure(parentOf(dir));
    const n       = { name: dir.slice(dir.lastIndexOf("/") + 1), path: dir, folder: true, children: [] };
    parent.children.push(n);
    dirs.set(dir, n);
    return n;
  };
  for (const f of folders) ensure(f);
  for (const f of files) ensure(parentOf(f)).children.push({ name: f.slice(f.lastIndexOf("/") + 1), path: f, folder: false, children: [] });
  const sort = (n      ) => {
    n.children.sort((a, b) => (a.folder !== b.folder ? (a.folder ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true })));
    n.children.forEach(sort);
  };
  sort(root);
  return root;
}

const VALID = /^[^\\:*?"<>|]+$/;

/** Mounts the explorer into `el`. Call `render(state)` whenever the files change. */
export function createTree(el             , cb               ) {
  el.classList.add("sbx-tree");
  el.innerHTML = `
    <div class="sbx-tree__head"><span>Files</span>
      <button data-act="new-file" title="New file">＋</button>
      <button data-act="new-folder" title="New folder">⊞</button>
      <button data-act="collapse" title="Collapse folders">⊟</button>
    </div>
    <div class="sbx-tree__body" role="tree" tabindex="0" aria-label="Files"></div>`;
  const body = el.querySelector             (".sbx-tree__body") ;
  let state            = { files: [], folders: [], active: "", marks: {}, readOnly: false };
  const collapsed = new Set        ();
  /** Where a new item goes / which row is being renamed. */
  let editing                                                                                                              = null;
  let editError = "";
  let focus = "";
  let dragging                = null;
  let rerendering = false;
  let lastHtml = "";
  /** Do the new rows have the same paths, in the same order, as the ones on screen? */
  const sameShape = (html        )          => {
    const keys = [...html.matchAll(/data-path="([^"]*)"/g)].map((m) => m[1]);
    const cur = [...body.querySelectorAll             (".sbx-tree__row[data-path]")].map((r) => esc(r.dataset.path ));
    return !body.querySelector(".sbx-tree__input") && keys.length === cur.length && keys.every((k, i) => k === cur[i]);
  };
  let editStarted = 0;

  const all = () => [...state.files, ...state.folders];
  const exists = (p        ) => state.files.includes(p) || state.folders.includes(p) ||
    state.files.some((f) => f.startsWith(p + "/"));
  const selectedDir = () => {
    const f = focus || state.active;
    if (!f) return "/";
    return state.folders.includes(f) || state.files.some((x) => x.startsWith(f + "/")) ? f : parentOf(f);
  };

  function rows(node      , depth        , out          ) {
    if (editing && editing.kind !== "rename" && editing.dir === node.path) out.push(inputRow(depth, editing.kind === "new-folder"));
    for (const c of node.children) {
      const pad = 8 + depth * 14;
      if (editing?.kind === "rename" && editing.path === c.path) {
        out.push(inputRow(depth, c.folder, c.name));
        continue;
      }
      const markOf = (p        ) => (c.folder ? Object.entries(state.marks).find(([k]) => k.startsWith(p + "/"))?.[1] : state.marks[p]);
      const mark = markOf(c.path);
      const open = c.folder && !collapsed.has(c.path);
      out.push(
        `<div class="sbx-tree__row${focus === c.path ? " focus" : ""}" role="treeitem" draggable="${!state.readOnly}" data-path="${esc(c.path)}"` +
          ` data-folder="${c.folder}" style="padding-left:${pad}px"${c.folder ? ` aria-expanded="${open}"` : ` aria-selected="${c.path === state.active}"`}>` +
          `<span class="sbx-tree__chev">${c.folder ? "▶" : ""}</span>` +
          (c.folder ? folderIcon(open) : iconFor(c.name)) +
          `<span class="sbx-tree__name${mark ? " " + mark : ""}">${esc(c.name)}</span>` +
          (mark && !c.folder ? `<span class="sbx-tree__mark ${mark}"></span>` : "") +
          (state.readOnly ? "" : `<span class="sbx-tree__acts">${c.folder ? `<button data-act="new-in" title="New file here">＋</button>` : ""}` +
            `<button data-act="rename" title="Rename">✎</button><button data-act="delete" title="Delete">✕</button></span>`) +
          `</div>`,
      );
      if (c.folder && open) rows(c, depth + 1, out);
    }
  }

  function inputRow(depth        , folder         , value = "")         {
    return `<div class="sbx-tree__row" style="padding-left:${8 + depth * 14}px"><span class="sbx-tree__chev"></span>` +
      (folder ? folderIcon(false) : `<span class="sbx-tree__icon">·</span>`) +
      `<input class="sbx-tree__input" value="${esc(value)}" aria-label="${folder ? "Folder" : "File"} name" spellcheck="false"></div>` +
      (editError ? `<div class="sbx-tree__err">${esc(editError)}</div>` : "");
  }

  function render(next                     ) {
    if (next) state = { ...state, ...next };
    // a folder of the active file is opened for it
    if (state.active) for (let d = parentOf(state.active); d !== "/"; d = parentOf(d)) collapsed.delete(d);
    const out           = [];
    rows(build(state.files, state.folders), 0, out);
    // Same rows as on screen and nobody typing: patch them in place, so a row
    // under the pointer is never replaced (a double click must land on it).
    const html = out.join("");
    if (!editing && html !== lastHtml && sameShape(html)) {
      const tpl = document.createElement("div");
      tpl.innerHTML = html;
      const fresh = tpl.querySelectorAll             (".sbx-tree__row[data-path]");
      body.querySelectorAll             (".sbx-tree__row[data-path]").forEach((row, i) => {
        const f = fresh[i] ;
        if (row.innerHTML !== f.innerHTML) row.innerHTML = f.innerHTML;
        for (const a of ["aria-selected", "aria-expanded", "class", "style"]) {
          const v = f.getAttribute(a);
          if (v === null) row.removeAttribute(a);
          else if (row.getAttribute(a) !== v) row.setAttribute(a, v);
        }
      });
      lastHtml = html;
      return;
    }
    if (!editing && html === lastHtml) return;
    lastHtml = editing ? "" : html;
    // A re-render while someone is typing a name keeps what they typed (and must not read as a blur).
    const typing = body.querySelector                  (".sbx-tree__input");
    const typed = typing ? { value: typing.value, start: typing.selectionStart, end: typing.selectionEnd } : null;
    rerendering = true;
    body.innerHTML = out.join("") || `<div class="sbx-tree__err" style="color:var(--sbx-subtle)">No files</div>`;
    rerendering = false;
    const input = body.querySelector                  (".sbx-tree__input");
    if (input) {
      input.focus();
      if (typed) {
        input.value = typed.value;
        input.setSelectionRange(typed.start, typed.end);
      } else {
        const dot = input.value.lastIndexOf(".");
        input.setSelectionRange(0, dot > 0 && editing?.kind === "rename" && !editing.folder ? dot : input.value.length);
      }
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") commit(input.value);
        if (e.key === "Escape") {
          editing = null;
          editError = "";
          render();
          body.focus();
        }
        e.stopPropagation();
      });
      input.addEventListener("blur", () => {
        if (rerendering) return;
        // A blur right after the row appeared is the click that made it settling, not a decision.
        if (Date.now() - editStarted < 400) return void setTimeout(() => input.isConnected && input.focus(), 0);
        setTimeout(() => editing && input.isConnected && commit(input.value, true), 100);
      });
    }
  }

  function commit(raw        , fromBlur = false) {
    if (!editing) return;
    const name = raw.trim().replace(/^\/+|\/+$/g, "");
    if (!name) {
      editing = null;
      editError = "";
      return render();
    }
    if (!VALID.test(name) || name.split("/").some((s) => !s || s === "." || s === "..")) {
      if (fromBlur) {
        editing = null;
        editError = "";
        return render();
      }
      editError = "Not a valid name";
      return render();
    }
    if (editing.kind === "rename") {
      const to = (parentOf(editing.path) === "/" ? "" : parentOf(editing.path)) + "/" + name;
      if (to !== editing.path) {
        if (exists(to)) {
          if (fromBlur) return ((editing = null), (editError = ""), render());
          editError = `${name} already exists`;
          return render();
        }
        cb.rename(editing.path, to, editing.folder);
      }
    } else {
      const to = (editing.dir === "/" ? "" : editing.dir) + "/" + name;
      if (exists(to)) {
        if (fromBlur) return ((editing = null), (editError = ""), render());
        editError = `${name} already exists`;
        return render();
      }
      if (editing.kind === "new-folder") cb.createFolder(to);
      else cb.createFile(to);
    }
    editing = null;
    editError = "";
    render();
  }

  const startNew = (kind                           , dir = selectedDir()) => {
    if (state.readOnly) return;
    collapsed.delete(dir);
    editStarted = Date.now();
    editing = { kind, dir };
    editError = "";
    render();
  };

  el.querySelector(".sbx-tree__head") .addEventListener("click", (e) => {
    const act = (e.target           ).closest             ("button")?.dataset.act;
    if (act === "new-file" || act === "new-folder") startNew(act);
    if (act === "collapse") {
      for (const p of all()) if (state.folders.includes(p) || state.files.some((f) => f.startsWith(p + "/"))) collapsed.add(p);
      for (const f of state.files) for (let d = parentOf(f); d !== "/"; d = parentOf(d)) collapsed.add(d);
      render();
    }
  });

  body.addEventListener("click", (e) => {
    const row = (e.target           ).closest             (".sbx-tree__row[data-path]");
    if (!row) return;
    const path = row.dataset.path ;
    const folder = row.dataset.folder === "true";
    const act = (e.target           ).closest             ("button")?.dataset.act;
    focus = path;
    if (act === "rename") {
      editStarted = Date.now();
      editing = { kind: "rename", path, folder };
      editError = "";
      return render();
    }
    if (act === "delete") return cb.remove(path, folder);
    if (act === "new-in") return startNew("new-file", path);
    if (folder) {
      collapsed.has(path) ? collapsed.delete(path) : collapsed.add(path);
      render();
    } else cb.open(path);
  });
  body.addEventListener("dblclick", (e) => {
    const row = (e.target           ).closest             (".sbx-tree__row[data-path]");
    if (!row || state.readOnly || (e.target           ).closest("button")) return;
    editStarted = Date.now();
    editing = { kind: "rename", path: row.dataset.path , folder: row.dataset.folder === "true" };
    render();
  });
  body.addEventListener("keydown", (e) => {
    const visible = [...body.querySelectorAll             (".sbx-tree__row[data-path]")].map((r) => r.dataset.path );
    let i = visible.indexOf(focus || state.active);
    const isFolder = (p        ) => body.querySelector             (`[data-path="${CSS.escape(p)}"]`)?.dataset.folder === "true";
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      i = Math.max(0, Math.min(visible.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
      focus = visible[i] ?? "";
      render();
    } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && focus && isFolder(focus)) {
      e.preventDefault();
      e.key === "ArrowRight" ? collapsed.delete(focus) : collapsed.add(focus);
      render();
    } else if (e.key === "Enter" && focus) {
      e.preventDefault();
      if (isFolder(focus)) {
        collapsed.has(focus) ? collapsed.delete(focus) : collapsed.add(focus);
        render();
      } else cb.open(focus);
    } else if (e.key === "F2" && focus && !state.readOnly) {
      editStarted = Date.now();
      editing = { kind: "rename", path: focus, folder: isFolder(focus) };
      render();
    } else if ((e.key === "Delete" || (e.key === "Backspace" && e.metaKey)) && focus && !state.readOnly) {
      cb.remove(focus, isFolder(focus));
    }
  });
  // drag a row onto a folder (or the empty area = top level) to move it
  body.addEventListener("dragstart", (e) => {
    const row = (e.target           ).closest             (".sbx-tree__row[data-path]");
    if (!row || state.readOnly) return;
    dragging = row.dataset.path ;
    e.dataTransfer?.setData("text/plain", dragging);
  });
  const dropTarget = (e           )                => {
    const row = (e.target           ).closest             (".sbx-tree__row[data-path]");
    if (!row) return "/";
    return row.dataset.folder === "true" ? row.dataset.path  : parentOf(row.dataset.path );
  };
  body.addEventListener("dragover", (e) => {
    if (!dragging) return;
    const t = dropTarget(e);
    if (t === null || t === dragging || t.startsWith(dragging + "/")) return;
    e.preventDefault();
    for (const r of body.querySelectorAll(".drop")) r.classList.remove("drop");
    body.querySelector(`[data-path="${CSS.escape(t)}"]`)?.classList.add("drop");
  });
  body.addEventListener("dragleave", () => {
    for (const r of body.querySelectorAll(".drop")) r.classList.remove("drop");
  });
  body.addEventListener("drop", (e) => {
    const from = dragging;
    dragging = null;
    const t = dropTarget(e);
    for (const r of body.querySelectorAll(".drop")) r.classList.remove("drop");
    if (!from || t === null || t === from || t.startsWith(from + "/")) return;
    e.preventDefault();
    const to = (t === "/" ? "" : t) + "/" + from.slice(from.lastIndexOf("/") + 1);
    if (to === from || exists(to)) return;
    cb.rename(from, to, state.folders.includes(from) || state.files.some((f) => f.startsWith(from + "/")));
  });
  body.addEventListener("dragend", () => (dragging = null));

  return {
    render,
    /** Starts an inline "new file" row in the selected folder. */
    newFile: () => startNew("new-file"),
    newFolder: () => startNew("new-folder"),
  };
}
