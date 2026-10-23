/**
 * Helpers that open the kit's overlays: confirmDialog, promptDialog, toast.
 * Small and synchronous to import; the dialog and toaster code loads the
 * first time one is shown.
 *
 * @module
 */
import { esc } from "./base.ts";
import type { SbxDialog, SbxToaster, ToastKind, ToastOptions } from "./overlays.ts";

export interface ConfirmOptions {
  heading?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

function tempDialog(heading: string, bodyHtml: string, buttons: string): SbxDialog {
  const d = document.createElement("sbx-dialog") as SbxDialog;
  d.setAttribute("heading", heading);
  d.setAttribute("size", "sm");
  d.innerHTML = bodyHtml + buttons;
  document.body.append(d);
  return d;
}

/** A modal yes/no question inside the artifact. Resolves true on confirm. */
export function confirmDialog(message: string, o: ConfirmOptions = {}): Promise<boolean> {
  const d = tempDialog(
    o.heading ?? "Are you sure?",
    `<p style="margin:0">${esc(message)}</p>`,
    `<button slot="footer" class="sbx-btn" data-close="cancel">${esc(o.cancelLabel ?? "Cancel")}</button>` +
      `<button slot="footer" class="sbx-btn ${o.danger ? "sbx-btn--danger" : "sbx-btn--primary"}" data-close="ok" autofocus>${esc(o.confirmLabel ?? "OK")}</button>`,
  );
  return new Promise((resolve) => {
    d.addEventListener("close", () => {
      resolve(d.returnValue === "ok");
      d.remove();
    }, { once: true });
    requestAnimationFrame(() => d.show());
  });
}

/** A modal text prompt. Resolves the text, or null when cancelled. */
export function promptDialog(message: string, o: ConfirmOptions & { value?: string; placeholder?: string } = {}): Promise<string | null> {
  const d = tempDialog(
    o.heading ?? message,
    `${o.heading ? `<p style="margin:0 0 8px">${esc(message)}</p>` : ""}<input class="sbx-input" autofocus value="${esc(o.value ?? "")}" placeholder="${esc(o.placeholder ?? "")}">`,
    `<button slot="footer" class="sbx-btn" data-close="cancel">${esc(o.cancelLabel ?? "Cancel")}</button>` +
      `<button slot="footer" class="sbx-btn sbx-btn--primary" data-close="ok">${esc(o.confirmLabel ?? "OK")}</button>`,
  );
  const input = d.querySelector("input")!;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") d.close("ok");
  });
  return new Promise((resolve) => {
    d.addEventListener("close", () => {
      resolve(d.returnValue === "ok" ? input.value : null);
      d.remove();
    }, { once: true });
    requestAnimationFrame(() => {
      d.show();
      input.focus();
      input.select();
    });
  });
}


/** Shows a toast inside the artifact. Returns a function that dismisses it. */
export function toast(message: string, o: ToastOptions | ToastKind = {}): () => void {
  const opts = typeof o === "string" ? { kind: o } : o;
  let t = document.querySelector("sbx-toaster") as SbxToaster | null;
  if (!t) {
    t = document.createElement("sbx-toaster") as SbxToaster;
    document.body.append(t);
  }
  // Before the toaster's code has loaded, add() answers with a Promise of the dismiss function.
  const r = t.add(message, opts) as unknown as (() => void) | Promise<() => void>;
  return () => void Promise.resolve(r).then((dismiss) => typeof dismiss === "function" && dismiss());
}
