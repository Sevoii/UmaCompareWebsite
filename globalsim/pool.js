/** Run seeds in parallel across Web Workers (or Node worker threads), each with its own engine. */
import { compiledModule, loadCourseGeometry, needsGeometry, normalize } from './engine.js';
import { decode } from './replay.js';
let defaultSpawn = () => {
    // Written out literally so bundlers (Vite, webpack) find and bundle the worker.
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    return {
        post: (message) => worker.postMessage(message),
        onMessage: (listener) => worker.addEventListener('message', (event) => listener(event.data)),
        onError: (listener) => worker.addEventListener('error', (event) => {
            event.preventDefault();
            listener(event.error instanceof Error ? event.error : new Error(event.message || 'GlobalSim worker failed'));
        }),
        terminate: () => worker.terminate(),
    };
};
/** @internal */
export function setDefaultSpawn(spawn) { defaultSpawn = spawn; }
function failure(message, fatal) {
    return Object.assign(new Error(message), { fatal });
}
export class RacePool {
    #module;
    #spawn;
    #chunkSize;
    #slots;
    #queue = Promise.resolve();
    #closed = false;
    constructor(module, size, options) {
        this.#module = module;
        this.#spawn = options.spawn ?? defaultSpawn;
        this.#chunkSize = options.chunkSize;
        this.#slots = Array.from({ length: size }, () => this.#spawnSlot());
    }
    /** Load the engine once, then start the workers. */
    static async create(options = {}) {
        const size = options.size ?? Math.max(1, globalThis.navigator?.hardwareConcurrency ?? 4);
        if (!Number.isInteger(size) || size < 1)
            throw new RangeError('size must be a positive integer');
        if (options.chunkSize !== undefined && !(Number.isInteger(options.chunkSize) && options.chunkSize > 0)) {
            throw new RangeError('chunkSize must be a positive integer');
        }
        const pool = new RacePool(await compiledModule(), size, options);
        try {
            await Promise.all(pool.#slots.map((slot) => slot.ready));
        }
        catch (error) {
            pool.close();
            throw error;
        }
        return pool;
    }
    get size() { return this.#slots.length; }
    #spawnSlot() {
        const worker = this.#spawn();
        let markReady;
        let markFailed;
        const slot = {
            worker, key: undefined, geometry: new Set(), pending: undefined, dead: false,
            ready: new Promise((resolve, reject) => { markReady = resolve; markFailed = reject; }),
        };
        slot.ready.catch(() => { });
        worker.onMessage((reply) => {
            if (reply.type === 'ready')
                return markReady();
            if (reply.type === 'initError')
                return markFailed(new Error(reply.message));
            const pending = slot.pending;
            slot.pending = undefined;
            if (reply.type === 'done')
                pending?.resolve(reply);
            else
                pending?.reject(failure(reply.message, reply.fatal));
        });
        worker.onError((error) => {
            slot.dead = true;
            markFailed(error);
            slot.pending?.reject(failure(error.message, true));
            slot.pending = undefined;
        });
        worker.post({ type: 'init', module: this.#module });
        return slot;
    }
    /** Results without frames for every seed, in seed order. */
    runResults(request, seeds, options = {}) {
        return this.#enqueue(request, seeds, 'results', options);
    }
    /** Decoded replays for every seed, in seed order. */
    async run(request, seeds, options = {}) {
        const packets = await this.#enqueue(request, seeds, 'replay', options);
        return packets.map(decode);
    }
    /** Stop every worker. Pending runs reject. */
    close() {
        this.#closed = true;
        for (const slot of this.#slots) {
            slot.pending?.reject(failure('Race pool was closed', false));
            slot.pending = undefined;
            slot.worker.terminate();
        }
    }
    // One batch at a time, so each worker's prepared request stays coherent.
    #enqueue(request, seeds, mode, options) {
        const task = this.#queue.then(() => this.#execute(request, seeds, mode, options));
        this.#queue = task.catch(() => { });
        return task;
    }
    async #execute(input, seeds, mode, options) {
        if (this.#closed)
            throw new Error('Race pool was closed');
        if (!Array.isArray(seeds) || !seeds.every(Number.isSafeInteger)) {
            throw new RangeError('seeds must be an array of safe integers');
        }
        const { json, request } = normalize(input);
        const courseId = request.courseId;
        const geometry = needsGeometry(request) ? await loadCourseGeometry(courseId) : undefined;
        const total = seeds.length;
        const out = new Array(total);
        const chunk = this.#chunkSize ?? Math.max(1, Math.min(64, Math.ceil(total / (this.#slots.length * 4))));
        let next = 0;
        let done = 0;
        let error;
        const work = async (index) => {
            while (error === undefined && next < total && !this.#closed) {
                try {
                    options.signal?.throwIfAborted();
                    let slot = this.#slots[index];
                    if (slot.dead)
                        slot = this.#slots[index] = this.#spawnSlot();
                    await slot.ready;
                    const start = next;
                    next = Math.min(total, next + chunk);
                    const message = { type: 'run', mode, seeds: seeds.slice(start, next) };
                    if (geometry !== undefined && !slot.geometry.has(courseId))
                        message.geometry = [courseId, geometry];
                    if (slot.key !== json)
                        message.request = json;
                    const reply = await new Promise((resolve, reject) => {
                        slot.pending = { resolve, reject };
                        slot.worker.post(message);
                    }).catch((reason) => {
                        slot.key = undefined;
                        if (reason.fatal) {
                            slot.dead = true;
                            slot.worker.terminate();
                        }
                        throw reason;
                    });
                    slot.key = json;
                    if (geometry !== undefined)
                        slot.geometry.add(courseId);
                    reply.results.forEach((result, i) => { out[start + i] = result; });
                    done += reply.results.length;
                    options.onProgress?.(done, total);
                }
                catch (reason) {
                    error ??= reason;
                }
            }
        };
        await Promise.all(this.#slots.map((_, index) => work(index)));
        if (error !== undefined)
            throw error;
        if (this.#closed)
            throw new Error('Race pool was closed');
        return out;
    }
}
//# sourceMappingURL=pool.js.map