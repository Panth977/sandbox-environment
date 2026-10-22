export type ChartType = "line" | "area" | "bar" | "pie" | "donut";
type Row = Record<string, unknown>;
export declare class SbxChart extends HTMLElement {
    #private;
    static get observedAttributes(): string[];
    connectedCallback(): void;
    attributeChangedCallback(name: string, _o: string | null, v: string | null): void;
    get type(): ChartType;
    set type(v: ChartType);
    get data(): Row[];
    set data(v: Row[]);
    get x(): string;
    set x(v: string);
    get y(): string | string[];
    set y(v: string | string[]);
    get labels(): Record<string, string>;
    set labels(v: Record<string, string>);
}
export {};
