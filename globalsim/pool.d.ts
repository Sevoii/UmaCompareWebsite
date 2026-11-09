/** Run seeds in parallel across Web Workers (or Node worker threads), each with its own engine. */
import { type RequestInput } from './engine.js';
import type { RaceResult } from './models.js';
import { type Replay } from './replay.js';
import type { WorkerReply, WorkerRequest } from './worker-core.js';
/** The pool's view of one worker; supply `spawn` to use a custom worker setup. */
export interface PoolWorker {
    post(message: WorkerRequest): void;
    onMessage(listener: (message: WorkerReply) => void): void;
    onError(listener: (error: Error) => void): void;
    terminate(): void;
}
export interface PoolOptions {
    /** Worker count; defaults to the number of logical cores. */
    size?: number;
    /** Seeds per worker message; defaults to an even split, at most 64. */
    chunkSize?: number;
    spawn?: () => PoolWorker;
}
export interface RunOptions {
    /** Called after each chunk with the number of seeds finished. */
    onProgress?: (done: number, total: number) => void;
    /** Stops handing out chunks; the returned promise rejects with the signal's reason. */
    signal?: AbortSignal;
}
/** @internal */
export declare function setDefaultSpawn(spawn: () => PoolWorker): void;
export declare class RacePool {
    #private;
    private constructor();
    /** Load the engine once, then start the workers. */
    static create(options?: PoolOptions): Promise<RacePool>;
    get size(): number;
    /** Results without frames for every seed, in seed order. */
    runResults(request: RequestInput, seeds: readonly number[], options?: RunOptions): Promise<RaceResult[]>;
    /** Decoded replays for every seed, in seed order. */
    run(request: RequestInput, seeds: readonly number[], options?: RunOptions): Promise<Replay[]>;
    /** Stop every worker. Pending runs reject. */
    close(): void;
}
