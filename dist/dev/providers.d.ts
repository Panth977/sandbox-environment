/**
 * Monaco language features backed by the kit's TypeScript worker. Monaco's
 * providers are per language and page-wide, so they are registered once and
 * find their dev engine by the model's URI (`sbx://<engine>/<path>`).
 *
 * @module
 */
import type { Remote } from "../bridge.js";
import type { CompletionDetails, LanguageService } from "./language.js";
import type { Monaco } from "./monaco.js";
/** What a dev engine lends the shared providers. */
export interface Engine {
    /** The language worker, once it is ready (null while loading or when off). */
    lsp(): Promise<Remote<LanguageService> | null>;
    /** The model of a file of this engine. */
    model(path: string): any | null;
    /** Opens a file in this engine's editor and selects a range in it. */
    reveal(path: string, range?: any): void;
}
export declare const LANGUAGES: string[];
/** Registers an engine under `id` (the URI authority of its models). */
export declare function addEngine(monaco: Monaco, id: string, engine: Engine): () => void;
/** The Markdown of a completion item's detail pane. */
export declare function detailsMarkdown(d: CompletionDetails): {
    value: string;
};
/** A Monaco theme from the kit's CSS variables (light or dark from the surface colour). */
export declare function themeFrom(monaco: Monaco, el: Element): string;
