import type { ToastKind, ToastOptions } from "./overlays.js";
export interface ConfirmOptions {
    heading?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
}
/** A modal yes/no question inside the artifact. Resolves true on confirm. */
export declare function confirmDialog(message: string, o?: ConfirmOptions): Promise<boolean>;
/** A modal text prompt. Resolves the text, or null when cancelled. */
export declare function promptDialog(message: string, o?: ConfirmOptions & {
    value?: string;
    placeholder?: string;
}): Promise<string | null>;
/** Shows a toast inside the artifact. Returns a function that dismisses it. */
export declare function toast(message: string, o?: ToastOptions | ToastKind): () => void;
