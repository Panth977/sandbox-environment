export interface LazySchema {
    /** Properties that may be set before the code is there (replayed after it loads). */
    props?: string[];
    /** Attributes the element observes. */
    attrs?: string[];
    /** Methods that may be called before the code is there (they wait for it and return a Promise). */
    methods?: string[];
    formAssociated?: boolean;
    /** Loads the implementation: a module whose `impl` export is the class. */
    load(): Promise<{
        impl: CustomElementConstructor;
    }>;
}
/** How many implementation modules have been loaded (for tests and diagnostics). */
export declare const lazyStats: {
    loaded: string[];
};
/** Registers `tag` now; its code loads on first connect. */
export declare function defineLazy(tag: string, schema: LazySchema): void;
/** Loads the implementation of `tag` now (e.g. before measuring a component). */
export declare function whenLoaded(tag: string): Promise<void>;
