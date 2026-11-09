import type { RaceResult } from './models.js';
export type WorkerRequest = {
    type: 'init';
    module: WebAssembly.Module;
} | {
    type: 'run';
    mode: 'results' | 'replay';
    seeds: number[];
    request?: string;
    geometry?: [number, string];
};
export type WorkerReply = {
    type: 'ready';
} | {
    type: 'initError';
    message: string;
} | {
    type: 'done';
    results: RaceResult[] | Uint8Array[];
} | {
    type: 'error';
    message: string;
    fatal: boolean;
};
export interface WorkerPort {
    post(message: WorkerReply, transfer?: ArrayBuffer[]): void;
    onMessage(listener: (message: WorkerRequest) => void): void;
}
export declare function serve(port: WorkerPort): void;
