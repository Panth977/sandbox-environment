/**
 * Monaco language features backed by the kit's TypeScript worker. Monaco's
 * providers are per language and page-wide, so they are registered once and
 * find their dev engine by the model's URI (`sbx://<engine>/<path>`).
 *
 * @module
 */
/* deno-lint-ignore-file no-explicit-any */
import type { Remote } from "../bridge.ts";
import type { CompletionDetails, LanguageService, LspLocation } from "./language.ts";
import type { Monaco } from "./monaco.ts";

/** What a dev engine lends the shared providers. */
export interface Engine {
  /** The language worker, once it is ready (null while loading or when off). */
  lsp(): Promise<Remote<LanguageService> | null>;
  /** The model of a file of this engine. */
  model(path: string): any | null;
  /** Opens a file in this engine's editor and selects a range in it. */
  reveal(path: string, range?: any): void;
}

const engines = new Map<string, Engine>();
let registered = false;

export const LANGUAGES = ["typescript", "javascript", "svelte"];

/** Registers an engine under `id` (the URI authority of its models). */
export function addEngine(monaco: Monaco, id: string, engine: Engine): () => void {
  engines.set(id, engine);
  if (!registered) register(monaco);
  return () => engines.delete(id);
}

const owner = (model: any) => {
  const e = model?.uri?.scheme === "sbx" ? engines.get(model.uri.authority) : undefined;
  return e ? { engine: e, path: model.uri.path as string } : null;
};

const code = (text: string) => ({ value: "```typescript\n" + text + "\n```" });

/** The Markdown of a completion item's detail pane. */
export function detailsMarkdown(d: CompletionDetails): { value: string } {
  const parts: string[] = [];
  if (d.members?.length) {
    parts.push("```typescript\n{\n" + d.members.map((m) => (m.doc ? `  /** ${m.doc} */\n` : "") + "  " + m.text + ";").join("\n") + "\n}\n```");
  }
  if (d.doc) parts.push(d.doc);
  return { value: parts.join("\n\n") };
}

function kindOf(monaco: Monaco, kind: string): number {
  const K = monaco.languages.CompletionItemKind;
  const map: Record<string, number> = {
    method: K.Method, function: K.Function, "local function": K.Function, object: K.Module, property: K.Property,
    getter: K.Property, setter: K.Property, "JSX attribute": K.Property, var: K.Variable, let: K.Variable,
    "local var": K.Variable, parameter: K.Variable, const: K.Constant, class: K.Class, "local class": K.Class,
    interface: K.Interface, type: K.TypeParameter, "type parameter": K.TypeParameter, enum: K.Enum,
    "enum member": K.EnumMember, module: K.Module, "external module name": K.Module, keyword: K.Keyword,
    "primitive type": K.Keyword, alias: K.Reference, string: K.Value, constructor: K.Constructor,
    script: K.File, directory: K.Folder,
  };
  return map[kind] ?? K.Text;
}

function register(monaco: Monaco) {
  registered = true;
  const L = monaco.languages;
  const range = (model: any, from: number, to: number) => {
    const a = model.getPositionAt(from);
    const b = model.getPositionAt(to);
    return new monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column);
  };
  const toLocations = (engine: Engine, list: LspLocation[]) =>
    list.flatMap((l) => {
      const m = engine.model(l.path);
      return m ? [{ uri: m.uri, range: range(m, l.from, l.to) }] : [];
    });

  for (const lang of LANGUAGES) {
    L.registerCompletionItemProvider(lang, {
      triggerCharacters: [".", '"', "'", "/", "<", "@", "$"],
      async provideCompletionItems(model: any, position: any) {
        const o = owner(model);
        const lsp = await o?.engine.lsp();
        if (!o || !lsp) return { suggestions: [] };
        const pos = model.getOffsetAt(position);
        const r = await lsp.completions(o.path, pos).catch(() => null);
        if (!r) return { suggestions: [] };
        const rng = range(model, r.from, pos);
        return {
          suggestions: r.items.map((it, i) => ({
            label: { label: it.label, description: it.detail && it.detail !== it.kind ? it.detail : undefined },
            kind: kindOf(monaco, it.kind),
            detail: it.detail && it.detail !== it.kind ? `(${it.kind}) ${it.detail}` : it.kind,
            insertText: it.label,
            range: rng,
            sortText: String(i).padStart(5, "0"),
            sbx: { id: model.uri.authority, path: o.path, pos },
          })),
        };
      },
      async resolveCompletionItem(item: any) {
        const at = item.sbx;
        const o = at ? engines.get(at.id) : undefined;
        const lsp = await o?.lsp();
        if (!lsp) return item;
        const name = typeof item.label === "string" ? item.label : item.label.label;
        const d = await lsp.completionDetails(at.path, at.pos, name).catch(() => null);
        if (!d) return item;
        return { ...item, detail: d.title, documentation: detailsMarkdown(d) };
      },
    });

    L.registerHoverProvider(lang, {
      async provideHover(model: any, position: any) {
        const o = owner(model);
        const lsp = await o?.engine.lsp();
        if (!o || !lsp) return null;
        const text = await lsp.quickInfo(o.path, model.getOffsetAt(position)).catch(() => null);
        if (!text) return null;
        const [sig, ...doc] = text.split("\n\n");
        const w = model.getWordAtPosition(position);
        return {
          range: w ? new monaco.Range(position.lineNumber, w.startColumn, position.lineNumber, w.endColumn) : undefined,
          contents: [code(sig), ...(doc.length ? [{ value: doc.join("\n\n") }] : [])],
        };
      },
    });

    L.registerSignatureHelpProvider(lang, {
      signatureHelpTriggerCharacters: ["(", ",", "<"],
      signatureHelpRetriggerCharacters: [")"],
      async provideSignatureHelp(model: any, position: any) {
        const o = owner(model);
        const lsp = await o?.engine.lsp();
        if (!o || !lsp) return null;
        const h = await lsp.signatureHelp(o.path, model.getOffsetAt(position)).catch(() => null);
        if (!h || !h.signatures.length) return null;
        return {
          value: {
            signatures: h.signatures.map((s) => ({
              label: s.label,
              documentation: s.doc ? { value: s.doc } : undefined,
              parameters: s.params.map((p) => ({ label: p.label, documentation: p.doc ? { value: p.doc } : undefined })),
            })),
            activeSignature: h.active,
            activeParameter: h.param,
          },
          dispose() {},
        };
      },
    });

    L.registerDefinitionProvider(lang, {
      async provideDefinition(model: any, position: any) {
        const o = owner(model);
        const lsp = await o?.engine.lsp();
        if (!o || !lsp) return [];
        return toLocations(o.engine, await lsp.definition(o.path, model.getOffsetAt(position)).catch(() => []));
      },
    });

    L.registerReferenceProvider(lang, {
      async provideReferences(model: any, position: any) {
        const o = owner(model);
        const lsp = await o?.engine.lsp();
        if (!o || !lsp) return [];
        return toLocations(o.engine, await lsp.references(o.path, model.getOffsetAt(position)).catch(() => []));
      },
    });

    L.registerRenameProvider(lang, {
      async provideRenameEdits(model: any, position: any, newName: string) {
        const o = owner(model);
        const lsp = await o?.engine.lsp();
        if (!o || !lsp) return { edits: [], rejectReason: "Types are still loading" };
        const r = await lsp.rename(o.path, model.getOffsetAt(position), newName).catch((e) => ({ error: String(e) }));
        if ("error" in r) return { edits: [], rejectReason: r.error };
        return {
          edits: r.edits.flatMap((e) => {
            const m = o.engine.model(e.path);
            return m ? [{ resource: m.uri, textEdit: { range: range(m, e.from, e.to), text: e.text }, versionId: undefined }] : [];
          }),
        };
      },
    });

    L.registerDocumentFormattingEditProvider(lang, {
      async provideDocumentFormattingEdits(model: any, options: any) {
        const o = owner(model);
        const lsp = await o?.engine.lsp();
        if (!o || !lsp) return [];
        const edits = await lsp.format(o.path, { tabSize: options.tabSize, insertSpaces: options.insertSpaces }).catch(() => []);
        return edits.map((e) => ({ range: range(model, e.from, e.to), text: e.text }));
      },
    });
  }

  // Go to definition in another file of the artifact opens it in the same editor.
  monaco.editor.registerEditorOpener({
    openCodeEditor(_source: any, resource: any, selection: any) {
      const e = resource?.scheme === "sbx" ? engines.get(resource.authority) : undefined;
      if (!e) return false;
      e.reveal(resource.path, selection);
      return true;
    },
  });
}

/** A Monaco theme from the kit's CSS variables (light or dark from the surface colour). */
export function themeFrom(monaco: Monaco, el: Element): string {
  const cs = getComputedStyle(el);
  const rgb = (v: string, fallback: string): [number, number, number] => {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const ctx = c.getContext("2d");
    if (!ctx) return [255, 255, 255];
    ctx.fillStyle = fallback;
    ctx.fillStyle = v.trim() || fallback;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const hex = (c: [number, number, number]) => "#" + c.map((x) => x.toString(16).padStart(2, "0")).join("");
  const bg = rgb(cs.getPropertyValue("--sbx-surface"), "#ffffff");
  const fg = rgb(cs.getPropertyValue("--sbx-text"), "#1f2328");
  const accent = rgb(cs.getPropertyValue("--sbx-accent"), "#3b82f6");
  const line = rgb(cs.getPropertyValue("--sbx-line"), "#e5e7eb");
  const raised = rgb(cs.getPropertyValue("--sbx-surface-2"), "#f6f8fa");
  const dark = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2] < 128;
  const name = `sbx-${dark ? "dark" : "light"}-${hex(bg).slice(1)}${hex(accent).slice(1)}`;
  monaco.editor.defineTheme(name, {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": hex(bg),
      "editor.foreground": hex(fg),
      "editorGutter.background": hex(bg),
      "editorLineNumber.activeForeground": hex(fg),
      "editorCursor.foreground": hex(accent),
      "editorWidget.background": hex(raised),
      "editorWidget.border": hex(line),
      "editorSuggestWidget.background": hex(raised),
      "editorSuggestWidget.border": hex(line),
      "editorHoverWidget.background": hex(raised),
      "editorHoverWidget.border": hex(line),
      "focusBorder": hex(accent),
    },
  });
  return name;
}
