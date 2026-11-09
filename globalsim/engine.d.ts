import type { RaceRequest, RaceResult } from './models.js';
import { type Replay } from './replay.js';
/** Where to load the engine from: a URL, a fetch Response, the module bytes, or a compiled module. */
export type WasmSource = string | URL | Response | BufferSource | WebAssembly.Module;
/** Returns the exact text of `data/course_geometry/<courseId>.json`. */
export type GeometryLoader = (courseId: number) => string | Promise<string>;
/** A request object, or its JSON text. */
export type RequestInput = RaceRequest | string;
declare const defaults: {
    wasm: () => WasmSource | Promise<WasmSource>;
    geometry: GeometryLoader;
};
/** @internal Platform entry points (node.ts) replace the browser defaults. */
export declare function setDefaults(values: Partial<typeof defaults>): void;
/**
 * Load and instantiate the engine. Called automatically by `PreparedRace.create`
 * and `RacePool.create`; call it yourself before `new PreparedRace(...)`, or to
 * load the engine from somewhere other than the package's own `wasm/` folder.
 * Later calls return the first load.
 */
export declare function init(source?: WasmSource): Promise<void>;
/** @internal The compiled engine, for handing to workers. */
export declare function compiledModule(): Promise<WebAssembly.Module>;
/** @internal Whether a native panic has made this realm's engine unusable. */
export declare function isTrapped(): boolean;
/**
 * Where course geometry comes from: a base URL holding `<courseId>.json` files
 * (a copy of data/course_geometry), or a function returning one course's text.
 * Defaults to the copy bundled with the package.
 */
export declare function setGeometrySource(source: string | URL | GeometryLoader): void;
/** Supply one course's geometry text directly. */
export declare function registerCourseGeometry(courseId: number, json: string): void;
/** Load (once) and register the geometry for a course. */
export declare function loadCourseGeometry(courseId: number): Promise<string>;
/** Whether a request uses world geometry, so its course's geometry must be loaded first. */
export declare function needsGeometry(request: RaceRequest): boolean;
/** Load whatever a request needs before it can be prepared synchronously. */
export declare function ensureGeometry(request: RequestInput): Promise<void>;
/** @internal Request text plus parsed form, with the course checked (unknown courses can panic the engine). */
export declare function normalize(input: RequestInput): {
    json: string;
    request: RaceRequest;
};
/**
 * A request prepared once, then simulated for any number of seeds. Each run
 * starts from fresh simulation state. Results match native builds exactly.
 */
export declare class PreparedRace {
    #private;
    /** Requires `init()` to have finished and any needed geometry to be loaded; see `create`. */
    constructor(request: RequestInput);
    /** Load the engine and the course's geometry as needed, then prepare. */
    static create(request: RequestInput): Promise<PreparedRace>;
    /** Replace the request. A failed preparation keeps the current one. */
    prepare(request: RequestInput): void;
    /** One seed as a decoded replay: metadata plus numeric frames. */
    run(seed: number): Replay;
    /** One seed as the lossless binary packet (docs/BINARY-REPLAY.md). */
    runWire(seed: number): Uint8Array;
    /** One seed's results without replay frames: the fast path for Monte Carlo. */
    runResults(seed: number): RaceResult;
    /** One seed as the conventional JSON reply, frames included. */
    runJson(seed: number): RaceResult & {
        frames: unknown[];
    };
    get closed(): boolean;
    /** Free the engine memory; repeated calls are harmless. */
    close(): void;
}
export interface PreparedRace {
    [Symbol.dispose]?(): void;
}
export {};
