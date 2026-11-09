/* tslint:disable */
/* eslint-disable */

export class PreparedRace {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Prepare one JSON race request (the same shape as a worker input line).
     */
    constructor(input: string);
    /**
     * Replace the preparation. An invalid replacement keeps the existing one.
     */
    prepare(input: string): void;
    /**
     * One seed as a lossless GSIMRP01 packet (see docs/BINARY-REPLAY.md).
     */
    runBinary(seed: number): Uint8Array;
    /**
     * One seed as the complete JSON reply, replay frames included.
     */
    runJson(seed: number): string;
    /**
     * One seed as a JSON reply without replay frames or frame metadata;
     * the fast path for Monte Carlo batches.
     */
    runResults(seed: number): string;
}

/**
 * Register `data/course_geometry/<courseId>.json` (its exact text) before
 * preparing a race that uses world geometry on that course.
 */
export function registerCourseGeometry(course_id: number, json: string): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_preparedrace_free: (a: number, b: number) => void;
    readonly globalsim_data: (a: number) => number;
    readonly globalsim_error: (a: number) => number;
    readonly globalsim_free: (a: number) => number;
    readonly globalsim_new: () => number;
    readonly globalsim_prepare: (a: number, b: number, c: number) => number;
    readonly globalsim_run: (a: number, b: bigint) => number;
    readonly globalsim_size: (a: number) => number;
    readonly preparedrace_new: (a: number, b: number) => [number, number, number];
    readonly preparedrace_prepare: (a: number, b: number, c: number) => [number, number];
    readonly preparedrace_runBinary: (a: number, b: number) => [number, number, number, number];
    readonly preparedrace_runJson: (a: number, b: number) => [number, number, number, number];
    readonly preparedrace_runResults: (a: number, b: number) => [number, number, number, number];
    readonly registerCourseGeometry: (a: number, b: number, c: number) => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
