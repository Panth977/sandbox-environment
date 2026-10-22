export type MenuItem = {
    label: string;
    value: unknown;
    danger?: boolean;
    disabled?: boolean;
    shortcut?: string;
    checked?: boolean;
} | {
    separator: true;
} | {
    group: string;
};
export declare class SbxMenu extends HTMLElement {
    #private;
    connectedCallback(): void;
    disconnectedCallback(): void;
    get items(): MenuItem[];
    set items(v: MenuItem[]);
    /** Opens the menu (focus goes to the first item). */
    show(): void;
    hide(): void;
}
