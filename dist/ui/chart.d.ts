/**
 * `<sbx-chart>`: line, area, bar, pie and donut charts in SVG. Responsive,
 * themed by the `--sbx-c1…c8` palette, hover tooltips, click-to-toggle legend.
 *
 * ```js
 * chart.type = "line";                  // "line" | "area" | "bar" | "pie" | "donut"
 * chart.data = [{ day: "Mon", pm25: 41, pm10: 80 }, …];
 * chart.x = "day";
 * chart.y = ["pm25", "pm10"];           // or one key
 * chart.labels = { pm25: "PM2.5" };     // optional series names
 * ```
 * Attributes: `height` (px, default 240), `stacked`, `no-legend`, `unit`.
 * Numbers / dates on x give a linear axis; anything else is categorical.
 *
 * @module
 */
import { ElementBase } from "./base.js";
export type ChartType = "line" | "area" | "bar" | "pie" | "donut";
type Row = Record<string, unknown>;
export declare class SbxChart extends ElementBase {
    _init(): void;
    _root: ShadowRoot;
    _data: Row[];
    _type: ChartType;
    _x: string;
    _y: string[];
    _labels: Record<string, string>;
    _hidden: Set<any>;
    _width: number;
    _raf: number;
    _connected(): void;
    _attributeChanged(name: string, _o: string | null, v: string | null): void;
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
    _schedule(): void;
    _name: any;
    _render(): void;
    _pie(plot: HTMLElement, tip: HTMLElement, W: number, H: number, unit: string): void;
}
export {};
