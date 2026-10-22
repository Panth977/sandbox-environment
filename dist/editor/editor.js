/**
 * `<sbx-editor>`: a dependency-free code editor. A native `<textarea>` does
 * the typing (IME, selection, undo, accessibility, mobile keyboards) on top of
 * a highlighted copy of the text; a third layer draws diagnostics.
 *
 * ```js
 * const ed = document.createElement("sbx-editor");
 * ed.language = "tsx";
 * ed.value = source;
 * ed.diagnostics = [{ from: 10, to: 14, severity: "error", message: "…" }];
 * ed.completions = async (pos) => ({ from, items: [{ label: "list", detail: "(q) => Promise<Device[]>" }] });
 * ed.hover = async (pos) => "type info";
 * ed.addEventListener("input", () => save(ed.value));
 * ```
 * Keys: Tab / Shift+Tab indent, Enter keeps indentation, brackets and quotes
 * auto-close, Ctrl/Cmd+/ toggles comments, Ctrl+Space opens completions,
 * Ctrl/Cmd+S fires a `save` event.
 *
 * @module
 */
import { define, emit, esc, shadow } from "../ui/base.js";
import { HIGHLIGHT_CSS, highlight, languageOf } from "./highlight.js";

const CSS = `
:host { display: block; position: relative; height: 100%; min-height: 120px; font-family: var(--sbx-font-mono); font-size: 13px;
  line-height: 20px; background: var(--sbx-surface); color: var(--sbx-text); --gutter: 44px; tab-size: 2; }
.scroll { position: absolute; inset: 0; overflow: auto; }
.content { position: relative; min-width: 100%; min-height: 100%; display: inline-block; }
.gutter { position: sticky; left: 0; float: left; width: var(--gutter); padding: 8px 8px 8px 0; text-align: right; color: var(--sbx-subtle);
  background: var(--sbx-surface); user-select: none; z-index: 2; border-right: 1px solid var(--sbx-line); min-height: 100%; box-sizing: border-box; }
.gutter div.err { color: var(--sbx-danger); }
.gutter div.cur { color: var(--sbx-text); }
.layers { position: relative; margin-left: var(--gutter); }
pre, textarea { margin: 0; padding: 8px 12px; font: inherit; line-height: inherit; tab-size: inherit; white-space: pre; border: 0;
  box-sizing: border-box; overflow: hidden; letter-spacing: 0; word-spacing: 0; }
pre { position: absolute; inset: 0; pointer-events: none; }
.diag { color: transparent; }
.diag mark { background: none; color: transparent; text-decoration: underline wavy var(--sbx-danger); text-decoration-skip-ink: none; text-underline-offset: 3px; }
.diag mark.warning { text-decoration-color: var(--sbx-warning); }
.diag mark.info { text-decoration-color: var(--sbx-accent); }
textarea { position: relative; display: block; width: 100%; resize: none; background: transparent; color: transparent;
  caret-color: var(--sbx-text); outline: none; z-index: 1; }
textarea::selection { background: color-mix(in srgb, var(--sbx-accent) 30%, transparent); color: transparent; }
.pop { position: fixed; z-index: 10; min-width: 220px; max-width: 420px; max-height: 240px; overflow: auto; background: var(--sbx-surface);
  border: 1px solid var(--sbx-line); border-radius: var(--sbx-radius); box-shadow: var(--sbx-shadow); padding: 2px 0; font-size: 12.5px; display: none; }
.pop .item { display: flex; gap: 10px; padding: 3px 10px; min-height: 22px; cursor: pointer; white-space: nowrap; }
.pop .item.active { background: var(--sbx-accent-soft); }
.pop .detail { margin-left: auto; color: var(--sbx-muted); overflow: hidden; text-overflow: ellipsis; }
.pop .kind { color: var(--sbx-subtle); width: 14px; }
.hover { position: fixed; z-index: 11; max-width: 520px; padding: 6px 8px; background: var(--sbx-surface); border: 1px solid var(--sbx-line);
  border-radius: var(--sbx-radius); box-shadow: var(--sbx-shadow); font-size: 12px; white-space: pre-wrap; display: none; }
.hover .msg { color: var(--sbx-danger); }
` + HIGHLIGHT_CSS;

const PAIRS                         = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`" };

export class SbxEditor extends HTMLElement {
  #root             ;
  #ta                      ;
  #code              ;
  #diag              ;
  #gutter              ;
  #pop              ;
  #hoverEl              ;
  #lang           = "text";
  #value = "";
  #diagnostics                     = [];
  #raf = 0;
  #items                   = [];
  #from = 0;
  #active = 0;
  #charW = 7.8;
  #hoverTimer                                       = null;
  #themeMo                          = null;

  /** Completion provider. */
  completions                                                                                                      = null;
  /** Hover provider (plain text). */
  hover                                                                                  = null;

  connectedCallback()       {
    if (!this.#root) {
      this.#root = shadow(this, CSS, `
        <div class="scroll" part="scroll"><div class="content">
          <div class="gutter" part="gutter" aria-hidden="true"></div>
          <div class="layers">
            <pre class="code" aria-hidden="true"></pre><pre class="diag" aria-hidden="true"></pre>
            <textarea spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" aria-label="Code editor"></textarea>
          </div>
        </div></div>
        <div class="pop" role="listbox"></div><div class="hover" role="tooltip"></div>`);
      this.#ta = this.#root.querySelector("textarea") ;
      this.#code = this.#root.querySelector(".code") ;
      this.#diag = this.#root.querySelector(".diag") ;
      this.#gutter = this.#root.querySelector(".gutter") ;
      this.#pop = this.#root.querySelector(".pop") ;
      this.#hoverEl = this.#root.querySelector(".hover") ;
      this.#ta.value = this.#value;
      this.#ta.addEventListener("input", () => {
        this.#value = this.#ta.value;
        this.#schedule();
        emit(this, "change", { value: this.#value });
        this.#maybeComplete(false);
      });
      this.#ta.addEventListener("keydown", (e) => this.#key(e));
      this.#ta.addEventListener("blur", () => setTimeout(() => this.#closePop(), 150));
      this.#ta.addEventListener("click", () => this.#closePop());
      this.#ta.addEventListener("keyup", () => this.#markCursorLine());
      this.#ta.addEventListener("mousemove", (e) => this.#hoverAt(e));
      this.#ta.addEventListener("mouseleave", () => this.#hideHover());
      this.#pop.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const it = (e.target           ).closest             (".item");
        if (it) this.#accept(Number(it.dataset.i));
      });
      this.#measure();
    }
    if (this.hasAttribute("language")) this.#lang = this.getAttribute("language")            ;
    const syncTheme = () => this.setAttribute("theme", document.documentElement.dataset.theme === "dark" ||
      (!document.documentElement.dataset.theme && matchMedia?.("(prefers-color-scheme: dark)").matches) ? "dark" : "light");
    syncTheme();
    this.#themeMo = new MutationObserver(syncTheme);
    this.#themeMo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    this.#render();
  }

  disconnectedCallback()       {
    this.#themeMo?.disconnect();
  }

  get value()         {
    return this.#value;
  }
  set value(v        ) {
    this.#value = String(v ?? "");
    if (this.#ta && this.#ta.value !== this.#value) this.#ta.value = this.#value;
    this.#schedule();
  }

  get language()           {
    return this.#lang;
  }
  set language(v          ) {
    this.#lang = v;
    this.#schedule();
  }

  /** Sets the language from a file name. */
  set path(p        ) {
    this.language = languageOf(p);
  }

  get diagnostics()                     {
    return this.#diagnostics;
  }
  set diagnostics(v                    ) {
    this.#diagnostics = Array.isArray(v) ? v.filter((d) => d.to >= d.from) : [];
    this.#schedule();
  }

  get readOnly()          {
    return this.hasAttribute("readonly");
  }
  set readOnly(v         ) {
    this.toggleAttribute("readonly", !!v);
    if (this.#ta) this.#ta.readOnly = !!v;
  }

  /** Cursor offset. */
  get cursor()         {
    return this.#ta?.selectionStart ?? 0;
  }

  /** Focuses the text area. */
  focusEditor()       {
    this.#ta?.focus();
  }

  /** Moves the cursor to line/column (1-based) and focuses. */
  goTo(line        , column = 1)       {
    const lines = this.#value.split("\n");
    let off = 0;
    for (let i = 0; i < Math.min(line - 1, lines.length - 1); i++) off += lines[i].length + 1;
    off += Math.max(0, Math.min(column - 1, (lines[line - 1] ?? "").length));
    this.#ta.focus();
    this.#ta.setSelectionRange(off, off);
    const scroll = this.#root.querySelector             (".scroll") ;
    const y = (line - 1) * 20;
    if (y < scroll.scrollTop || y > scroll.scrollTop + scroll.clientHeight - 40) scroll.scrollTop = Math.max(0, y - scroll.clientHeight / 3);
    this.#markCursorLine();
  }

  /** Replaces the selection (or inserts at the cursor) as one undoable edit. */
  insert(text        , from         = this.#ta.selectionStart, to         = this.#ta.selectionEnd)       {
    this.#ta.focus();
    this.#ta.setSelectionRange(from, to);
    // execCommand keeps the native undo stack; fall back to setRangeText
    const ok = typeof document.execCommand === "function" && document.execCommand("insertText", false, text);
    if (!ok) {
      this.#ta.setRangeText(text, from, to, "end");
      this.#ta.dispatchEvent(new Event("input"));
    }
  }

  #measure() {
    const probe = document.createElement("span");
    probe.textContent = "x".repeat(100);
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font:inherit";
    this.#root.querySelector(".layers") .append(probe);
    const w = probe.getBoundingClientRect().width / 100;
    probe.remove();
    if (w > 0) this.#charW = w;
  }

  #schedule() {
    if (this.#raf || !this.#root) return;
    this.#raf = requestAnimationFrame(() => {
      this.#raf = 0;
      this.#render();
    });
  }

  #render() {
    if (!this.#root) return;
    const v = this.#value;
    // trailing newline so the last empty line has height
    this.#code.innerHTML = highlight(v, this.#lang) + "\n";
    let html = "";
    let pos = 0;
    const ds = [...this.#diagnostics].sort((a, b) => a.from - b.from);
    for (const d of ds) {
      const from = Math.max(pos, Math.min(d.from, v.length));
      let to = Math.min(Math.max(d.to, d.from + 1), v.length);
      if (to <= from) {
        if (from >= v.length) continue;
        to = from + 1;
      }
      html += esc(v.slice(pos, from)) + `<mark class="${d.severity}">${esc(v.slice(from, to))}</mark>`;
      pos = to;
    }
    this.#diag.innerHTML = html + esc(v.slice(pos)) + "\n";
    const lines = v.split("\n").length;
    const errLines = new Set(ds.filter((d) => d.severity === "error").map((d) => v.slice(0, d.from).split("\n").length));
    let g = "";
    for (let i = 1; i <= lines; i++) g += `<div${errLines.has(i) ? ' class="err"' : ""}>${i}</div>`;
    this.#gutter.innerHTML = g;
    this.style.setProperty("--gutter", `${Math.max(36, String(lines).length * this.#charW + 20)}px`);
    // size the textarea to the content so the outer box scrolls everything together
    const longest = v.split("\n").reduce((m, l) => Math.max(m, l.replace(/\t/g, "  ").length), 0);
    this.#ta.style.height = `${lines * 20 + 16 + 20}px`;
    this.#ta.style.width = `max(100%, ${Math.ceil(longest * this.#charW) + 48}px)`;
    this.#markCursorLine();
  }

  #markCursorLine() {
    if (!this.#ta) return;
    const line = this.#value.slice(0, this.#ta.selectionStart).split("\n").length;
    const prev = this.#gutter.querySelector(".cur");
    prev?.classList.remove("cur");
    this.#gutter.children[line - 1]?.classList.add("cur");
  }

  #lineStart(pos        ) {
    return this.#value.lastIndexOf("\n", pos - 1) + 1;
  }

  #key(e               ) {
    const ta = this.#ta;
    const mod = e.metaKey || e.ctrlKey;
    if (this.#pop.style.display === "block") {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        this.#active = (this.#active + (e.key === "ArrowDown" ? 1 : -1) + this.#items.length) % this.#items.length;
        this.#renderPop();
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        this.#accept(this.#active);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        this.#closePop();
        return;
      }
    }
    if (mod && e.key === "s") {
      e.preventDefault();
      emit(this, "save", { value: this.#value });
      return;
    }
    if (this.readOnly) return;
    if ((e.ctrlKey && e.key === " ") || (mod && e.key === "i")) {
      e.preventDefault();
      this.#maybeComplete(true);
      return;
    }
    const s = ta.selectionStart;
    const end = ta.selectionEnd;
    const v = this.#value;
    if (e.key === "Tab") {
      e.preventDefault();
      const ls = this.#lineStart(s);
      if (s === end && !e.shiftKey) return this.insert("  ");
      // indent / outdent the selected lines
      const block = v.slice(ls, end);
      const lines = block.split("\n");
      const next = lines.map((l) => (e.shiftKey ? l.replace(/^( {1,2}|\t)/, "") : "  " + l)).join("\n");
      this.insert(next, ls, end);
      ta.setSelectionRange(ls, ls + next.length);
      return;
    }
    if (e.key === "Enter" && !mod) {
      e.preventDefault();
      const ls = this.#lineStart(s);
      const indent = /^[ \t]*/.exec(v.slice(ls, s)) [0];
      const before = v[s - 1];
      const after = v[s];
      if ((before === "{" && after === "}") || (before === "(" && after === ")") || (before === "[" && after === "]") || (before === ">" && after === "<")) {
        this.insert(`\n${indent}  \n${indent}`);
        ta.setSelectionRange(s + indent.length + 3, s + indent.length + 3);
      } else {
        const extra = /[{([]$/.test(v.slice(ls, s).trimEnd()) ? "  " : "";
        this.insert(`\n${indent}${extra}`);
      }
      return;
    }
    if (mod && e.key === "/") {
      e.preventDefault();
      const ls = this.#lineStart(s);
      const le = v.indexOf("\n", end);
      const stop = le < 0 ? v.length : le;
      const lines = v.slice(ls, stop).split("\n");
      const [open, close] = this.#lang === "css" ? ["/* ", " */"] : this.#lang === "html" ? ["<!-- ", " -->"] : ["// ", ""];
      const all = lines.every((l) => !l.trim() || l.trimStart().startsWith(open.trim()));
      const next = lines.map((l) => {
        if (!l.trim()) return l;
        if (all) {
          const i = l.indexOf(open.trim());
          let r = l.slice(0, i) + l.slice(i + open.trim().length).replace(/^ /, "");
          if (close && r.trimEnd().endsWith(close.trim())) r = r.slice(0, r.lastIndexOf(close.trim())).replace(/ $/, "");
          return r;
        }
        const ind = /^\s*/.exec(l) [0];
        return ind + open + l.slice(ind.length) + close;
      }).join("\n");
      this.insert(next, ls, stop);
      return;
    }
    if (PAIRS[e.key] && !mod) {
      const close = PAIRS[e.key];
      if ((e.key === '"' || e.key === "'" || e.key === "`") && v[s] === e.key && s === end) {
        e.preventDefault();
        ta.setSelectionRange(s + 1, s + 1);
        return;
      }
      if (s !== end) {
        e.preventDefault();
        this.insert(e.key + v.slice(s, end) + close, s, end);
        return;
      }
      const nextCh = v[s] ?? "";
      if (/[\s)\]};,]|^$/.test(nextCh) && !((e.key === "'" || e.key === '"') && /\w/.test(v[s - 1] ?? ""))) {
        e.preventDefault();
        this.insert(e.key + close);
        ta.setSelectionRange(s + 1, s + 1);
      }
      return;
    }
    if ((e.key === ")" || e.key === "]" || e.key === "}") && v[s] === e.key && s === end) {
      e.preventDefault();
      ta.setSelectionRange(s + 1, s + 1);
      return;
    }
    if (e.key === "Backspace" && s === end && s > 0 && PAIRS[v[s - 1]] === v[s]) {
      e.preventDefault();
      this.insert("", s - 1, s + 1);
    }
  }

  async #maybeComplete(force         ) {
    if (!this.completions) return;
    const pos = this.#ta.selectionStart;
    const before = this.#value.slice(Math.max(0, pos - 40), pos);
    if (!force && !/(\.|[A-Za-z_$][\w$]*)$/.test(before)) return this.#closePop();
    if (!force && /[A-Za-z_$][\w$]*$/.test(before) && !/\.\w*$/.test(before) && /[A-Za-z_$][\w$]*$/.exec(before) [0].length < 2) return;
    const res = await this.completions(pos, this.#value);
    if (pos !== this.#ta.selectionStart) return; // typed on
    if (!res || !res.items.length) return this.#closePop();
    const word = this.#value.slice(res.from, pos).toLowerCase();
    const items = res.items.filter((i) => i.label.toLowerCase().startsWith(word)).concat(
      res.items.filter((i) => !i.label.toLowerCase().startsWith(word) && i.label.toLowerCase().includes(word)),
    ).slice(0, 80);
    if (!items.length) return this.#closePop();
    this.#items = items;
    this.#from = res.from;
    this.#active = 0;
    this.#renderPop();
  }

  #caretXY(pos        )                           {
    const lines = this.#value.slice(0, pos).split("\n");
    const ta = this.#ta.getBoundingClientRect();
    return { x: ta.left + 12 + lines[lines.length - 1].length * this.#charW, y: ta.top + 8 + lines.length * 20 };
  }

  #renderPop() {
    const p = this.#pop;
    p.innerHTML = this.#items.map((it, i) =>
      `<div class="item${i === this.#active ? " active" : ""}" data-i="${i}" role="option"><span class="kind">${esc((it.kind ?? "")[0] ?? "")}</span>` +
      `<span>${esc(it.label)}</span>${it.detail ? `<span class="detail">${esc(it.detail)}</span>` : ""}</div>`
    ).join("");
    const { x, y } = this.#caretXY(this.#from);
    p.style.display = "block";
    p.style.left = `${Math.min(x, innerWidth - p.offsetWidth - 4)}px`;
    p.style.top = `${y + 2 + p.offsetHeight > innerHeight ? y - 22 - p.offsetHeight : y + 2}px`;
    p.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  }

  #accept(i        ) {
    const it = this.#items[i];
    if (!it) return;
    this.insert(it.insert ?? it.label, this.#from, this.#ta.selectionStart);
    this.#closePop();
  }

  #closePop() {
    if (this.#pop) this.#pop.style.display = "none";
  }

  #posAt(e            )                {
    const r = this.#ta.getBoundingClientRect();
    const line = Math.floor((e.clientY - r.top - 8) / 20);
    const col = Math.round((e.clientX - r.left - 12) / this.#charW);
    const lines = this.#value.split("\n");
    if (line < 0 || line >= lines.length || col < 0 || col > lines[line].length) return null;
    let off = 0;
    for (let i = 0; i < line; i++) off += lines[i].length + 1;
    return off + col;
  }

  #hoverAt(e            ) {
    if (this.#hoverTimer) clearTimeout(this.#hoverTimer);
    this.#hideHover();
    const pos = this.#posAt(e);
    if (pos === null) return;
    this.#hoverTimer = setTimeout(async () => {
      const diag = this.#diagnostics.filter((d) => pos >= d.from && pos <= Math.max(d.to, d.from + 1));
      const info = this.hover ? await this.hover(pos, this.#value) : null;
      if (!diag.length && !info) return;
      this.#hoverEl.innerHTML = diag.map((d) => `<div class="msg">${esc(d.message)}</div>`).join("") + (info ? `<div>${esc(info)}</div>` : "");
      this.#hoverEl.style.display = "block";
      this.#hoverEl.style.left = `${Math.min(e.clientX, innerWidth - this.#hoverEl.offsetWidth - 4)}px`;
      this.#hoverEl.style.top = `${e.clientY + 16}px`;
    }, 450);
  }

  #hideHover() {
    if (this.#hoverEl) this.#hoverEl.style.display = "none";
  }
}

define("sbx-editor", SbxEditor);

export { highlight, languageOf } from "./highlight.js";
