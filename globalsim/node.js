/**
 * Node entry (selected by the package's "node" export condition): loads the
 * engine and course geometry from the package's files and runs RacePool on
 * worker threads. The API is identical to the browser entry.
 */
import { readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { setDefaults } from './engine.js';
import { setDefaultSpawn } from './pool.js';
setDefaults({
    wasm: async () => new Uint8Array(await readFile(new URL('./wasm/globalsim_bg.wasm', import.meta.url))),
    geometry: (id) => readFile(new URL(`./course_geometry/${id}.json`, import.meta.url), 'utf8'),
});
setDefaultSpawn(() => {
    const worker = new Worker(new URL('./node-worker.js', import.meta.url));
    return {
        post: (message) => worker.postMessage(message),
        onMessage: (listener) => worker.on('message', (reply) => listener(reply)),
        onError: (listener) => worker.on('error', listener),
        terminate: () => { void worker.terminate(); },
    };
});
export * from './index.js';
//# sourceMappingURL=node.js.map