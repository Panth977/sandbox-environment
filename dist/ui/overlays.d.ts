export declare class SbxDialog extends HTMLElement {
    #private;
    static get observedAttributes(): string[];
    returnValue: string;
    connectedCallback(): void;
    attributeChangedCallback(name: string): void;
    /** Esc / backdrop / ✕ close it (default). Set the `persistent` attribute to require an explicit choice. */
    get dismissable(): boolean;
    get open(): boolean;
    /** Opens as a modal. */
    show(): void;
    /** Closes with an optional return value (also from `data-close="value"` buttons). */
    close(returnValue?: string): void;
}
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
export declare class SbxToaster extends HTMLElement {
    #private;
    connectedCallback(): void;
    add(message: string, o?: ToastOptions): () => void;
}
/** Shows a toast inside the artifact. Returns a function that dismisses it. */
export declare function toast(message: string, o?: ToastOptions | ToastKind): () => void;
