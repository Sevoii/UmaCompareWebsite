/** Decode GSIMRP01 binary replies (docs/BINARY-REPLAY.md; python/globalsim/replay_protocol.py). */
import type { RaceFrame, RaceResult } from './models.js';
export declare const FIELDS: readonly ["pos", "speed", "hp", "lane", "temptationMode", "blockFrontHorseIndex"];
export declare class Replay {
    /** Reply metadata: everything except the frames. */
    readonly metadata: RaceResult;
    /** Number of retained frames; zero for results-only output. */
    readonly count: number;
    readonly horseCount: number;
    /**
     * Row-major frame values: per frame, the time followed by six values per
     * runner in `FIELDS` order. Row `i` starts at `i * width`.
     */
    readonly frames: Float64Array;
    constructor(
    /** Reply metadata: everything except the frames. */
    metadata: RaceResult, 
    /** Number of retained frames; zero for results-only output. */
    count: number, horseCount: number, 
    /**
     * Row-major frame values: per frame, the time followed by six values per
     * runner in `FIELDS` order. Row `i` starts at `i * width`.
     */
    frames: Float64Array);
    /** Values per frame: `1 + 6 * horseCount`. */
    get width(): number;
    /** Bytes per frame on the wire: `8 + 48 * horseCount`. */
    get stride(): number;
    /** `[time, runnerValues]`, where runner `i` occupies `runnerValues[i * 6 .. i * 6 + 6]`. Views, not copies. */
    frame(index: number): [number, Float64Array];
    /** One frame with named values; nonfinite values are kept. */
    typedFrame(index: number): RaceFrame;
    /** The conventional JSON reply shape, frames included; nonfinite numbers become null. */
    toJson(): RaceResult & {
        frames?: unknown[];
    };
}
/** Validate and decode one complete binary packet. */
export declare function decode(packet: Uint8Array): Replay;
