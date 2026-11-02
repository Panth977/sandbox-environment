/**
 * Overlays: `<sbx-dialog>`, the `confirmDialog` / `promptDialog` helpers, and
 * toasts (`toast()` + `<sbx-toaster>`).
 *
 * ```html
 * <sbx-dialog id="d" heading="Move devices">
 *   <p>Move 12 devices to the spare pool?</p>
 *   <button slot="footer" class="sbx-btn" data-close="cancel">Cancel</button>
 *   <button slot="footer" class="sbx-btn sbx-btn--primary" data-close="ok">Move</button>
 * </sbx-dialog>
 * <script> d.show(); d.addEventListener("close", (e) => e.detail.returnValue) </script>
 * ```
 *
 * @module
 */
import { ElementBase } from "./base.js";
export declare class SbxDialog extends ElementBase {
    _init(): void;
    _root: ShadowRoot;
    returnValue: string;
    _connected(): void;
    _attributeChanged(name: string): void;
    get _dialog(): HTMLDialogElement;
    _syncHeading(): void;
    /** Esc / backdrop / ✕ close it (default). Set the `persistent` attribute to require an explicit choice. */
    get dismissable(): boolean;
    get open(): boolean;
    /** Opens as a modal. */
    show(): void;
    /** Closes with an optional return value (also from `data-close="value"` buttons). */
    close(returnValue?: string): void;
}
export type ToastKind = "info" | "success" | "warning" | "error";
export interface ToastOptions {
    kind?: ToastKind;
    /** ms before it disappears; 0 = stays until closed. Default 4000 (errors 7000). */
    timeout?: number;
    /** A button in the toast. */
    action?: {
        label: string;
        onClick(): void;
    };
}
export declare class SbxToaster extends ElementBase {
    _init(): void;
    _root: ShadowRoot;
    _connected(): void;
    add(message: string, o?: ToastOptions): () => void;
}
