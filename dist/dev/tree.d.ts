export interface TreeCallbacks {
    open(path: string): void;
    /** Create a file (with starter content chosen by the dev engine). */
    createFile(path: string): void;
    createFolder(path: string): void;
    /** Rename or move a file or folder (a folder moves everything under it). */
    rename(from: string, to: string, folder: boolean): void;
    remove(path: string, folder: boolean): void;
}
export interface TreeState {
    files: string[];
    folders: string[];
    active: string;
    /** path → "error" | "warning" */
    marks: Record<string, "error" | "warning">;
    readOnly: boolean;
}
export declare const TREE_CSS = "\n.sbx-tree { display: flex; flex-direction: column; min-height: 0; background: var(--sbx-surface); border-right: 1px solid var(--sbx-line); font-size: 12.5px; user-select: none; }\n.sbx-tree__head { display: flex; align-items: center; gap: 2px; height: 32px; padding: 0 4px 0 10px; color: var(--sbx-muted);\n  font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; flex: none; }\n.sbx-tree__head span { flex: 1; }\n.sbx-tree__head button, .sbx-tree__row button { all: unset; display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 4px; cursor: pointer; color: var(--sbx-muted); font-size: 13px; }\n.sbx-tree__head button:hover, .sbx-tree__row button:hover { background: var(--sbx-surface-3); color: var(--sbx-text); }\n.sbx-tree__body { overflow: auto; flex: 1; padding: 2px 0 12px; outline: none; }\n.sbx-tree__row { display: flex; align-items: center; gap: 4px; height: 24px; padding-right: 4px; cursor: pointer; white-space: nowrap; color: var(--sbx-text); position: relative; }\n.sbx-tree__row:hover { background: var(--sbx-surface-2); }\n.sbx-tree__row[aria-selected=\"true\"] { background: var(--sbx-accent-soft); color: var(--sbx-accent); }\n.sbx-tree__row.focus { box-shadow: inset 0 0 0 1px var(--sbx-accent); }\n.sbx-tree__row.drop { background: var(--sbx-accent-soft); }\n.sbx-tree__chev { width: 12px; flex: none; color: var(--sbx-subtle); font-size: 9px; text-align: center; transition: transform .1s; }\n.sbx-tree__row[aria-expanded=\"true\"] .sbx-tree__chev { transform: rotate(90deg); }\n.sbx-tree__icon { width: 18px; flex: none; font: 600 9px/14px var(--sbx-font-mono); text-align: center; border-radius: 3px; }\n.sbx-tree__name { flex: 1; overflow: hidden; text-overflow: ellipsis; }\n.sbx-tree__acts { display: none; }\n.sbx-tree__row:hover .sbx-tree__acts, .sbx-tree__row.focus .sbx-tree__acts { display: inline-flex; }\n.sbx-tree__mark { width: 6px; height: 6px; border-radius: 50%; flex: none; }\n.sbx-tree__mark.error { background: var(--sbx-danger); } .sbx-tree__mark.warning { background: var(--sbx-warning); }\n.sbx-tree__name.error { color: var(--sbx-danger); } .sbx-tree__name.warning { color: var(--sbx-warning); }\n.sbx-tree__input { flex: 1; min-width: 0; height: 20px; padding: 0 4px; border: 1px solid var(--sbx-accent); border-radius: 3px;\n  background: var(--sbx-surface); color: var(--sbx-text); font: inherit; outline: none; }\n.sbx-tree__err { padding: 2px 10px 4px 28px; color: var(--sbx-danger); font-size: 11.5px; white-space: normal; }\n";
/** Path → its parent folder ('/' for top level). */
export declare const parentOf: (p: string) => string;
/** Mounts the explorer into `el`. Call `render(state)` whenever the files change. */
export interface TreeHandle {
    render(next?: Partial<TreeState>): void;
    newFile(): void;
    newFolder(): void;
}
export declare function createTree(el: HTMLElement, cb: TreeCallbacks): TreeHandle;
