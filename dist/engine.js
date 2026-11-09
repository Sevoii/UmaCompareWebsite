/** Load the engine and run prepared races (python/globalsim/prepared.py). */
import initWasm, { PreparedRace as NativeRace, registerCourseGeometry as registerNative } from './wasm/globalsim.js';
import { COURSES } from './catalog.js';
import { decode } from './replay.js';
async function fetchText(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Course geometry could not be loaded from ${url} (HTTP ${response.status}); `
            + 'host data/course_geometry and call setGeometrySource() with its URL');
    }
    return response.text();
}
const defaults = {
    wasm: () => new URL('./wasm/globalsim_bg.wasm', import.meta.url),
    geometry: (id) => fetchText(new URL(`./course_geometry/${id}.json`, import.meta.url)),
};
/** @internal Platform entry points (node.ts) replace the browser defaults. */
export function setDefaults(values) {
    Object.assign(defaults, values);
}
let ready;
let compiled;
let trapped = false;
async function compileResponse(response) {
    if (!response.ok)
        throw new Error(`GlobalSim engine could not be loaded from ${response.url} (HTTP ${response.status})`);
    if (response.headers.get('content-type')?.startsWith('application/wasm'))
        return WebAssembly.compileStreaming(response);
    return WebAssembly.compile(await response.arrayBuffer());
}
async function compile(source) {
    if (source instanceof WebAssembly.Module)
        return source;
    if (typeof Response !== 'undefined' && source instanceof Response)
        return compileResponse(source);
    if (typeof source === 'string' || source instanceof URL)
        return compileResponse(await fetch(source));
    return WebAssembly.compile(source);
}
/**
 * Load and instantiate the engine. Called automatically by `PreparedRace.create`
 * and `RacePool.create`; call it yourself before `new PreparedRace(...)`, or to
 * load the engine from somewhere other than the package's own `wasm/` folder.
 * Later calls return the first load.
 */
export function init(source) {
    ready ??= (async () => {
        const module = await compile(source ?? await defaults.wasm());
        await initWasm({ module_or_path: module });
        compiled = module;
        for (const [id, json] of geometry)
            registerNative(id, json);
        return module;
    })().catch((error) => {
        ready = undefined;
        throw error;
    });
    return ready.then(() => undefined);
}
/** @internal The compiled engine, for handing to workers. */
export async function compiledModule() {
    await init();
    return compiled;
}
/** @internal Whether a native panic has made this realm's engine unusable. */
export function isTrapped() { return trapped; }
function guard(call) {
    if (trapped)
        throw new Error('The GlobalSim engine stopped after a native panic; reload the page or worker');
    try {
        return call();
    }
    catch (error) {
        // panic = "abort" surfaces as a trap, and the module's memory may be inconsistent after it.
        if (error instanceof WebAssembly.RuntimeError) {
            trapped = true;
            throw new Error(`The GlobalSim engine panicked (${error.message}); reload the page or worker`, { cause: error });
        }
        throw error;
    }
}
// Course geometry: loaded text by course, and the courses registered with the engine.
const geometry = new Map();
const loading = new Map();
let geometrySource;
/**
 * Where course geometry comes from: a base URL holding `<courseId>.json` files
 * (a copy of data/course_geometry), or a function returning one course's text.
 * Defaults to the copy bundled with the package.
 */
export function setGeometrySource(source) {
    if (typeof source === 'function') {
        geometrySource = source;
    }
    else {
        const base = new URL(String(source).replace(/\/?$/, '/'), globalThis.location?.href);
        geometrySource = (id) => fetchText(new URL(`${id}.json`, base));
    }
}
/** Supply one course's geometry text directly. */
export function registerCourseGeometry(courseId, json) {
    geometry.set(courseId, json);
    if (compiled)
        registerNative(courseId, json);
}
/** Load (once) and register the geometry for a course. */
export function loadCourseGeometry(courseId) {
    if (!Object.prototype.hasOwnProperty.call(COURSES, courseId)) {
        return Promise.reject(new RangeError(`Unknown course ID: ${courseId}`));
    }
    const known = geometry.get(courseId);
    if (known !== undefined)
        return Promise.resolve(known);
    let pending = loading.get(courseId);
    if (!pending) {
        pending = Promise.resolve((geometrySource ?? defaults.geometry)(courseId)).then((json) => {
            registerCourseGeometry(courseId, json);
            return json;
        }).finally(() => loading.delete(courseId));
        loading.set(courseId, pending);
    }
    return pending;
}
/** Whether a request uses world geometry, so its course's geometry must be loaded first. */
export function needsGeometry(request) {
    return request.experimentalRetailGeometry === true;
}
/** Load whatever a request needs before it can be prepared synchronously. */
export async function ensureGeometry(request) {
    const parsed = normalize(request).request;
    if (needsGeometry(parsed))
        await loadCourseGeometry(parsed.courseId);
}
/** @internal Request text plus parsed form, with the course checked (unknown courses can panic the engine). */
export function normalize(input) {
    const request = typeof input === 'string' ? JSON.parse(input) : input;
    if (typeof request !== 'object' || request === null || Array.isArray(request)) {
        throw new TypeError('A race request must be an object or its JSON text');
    }
    const courseId = request.courseId;
    if (!Object.prototype.hasOwnProperty.call(COURSES, courseId))
        throw new RangeError(`Unknown course ID: ${String(courseId)}`);
    return { json: typeof input === 'string' ? input : JSON.stringify(input), request: request };
}
function prepared(input) {
    if (!compiled)
        throw new Error('Call `await init()` before creating a PreparedRace, or use PreparedRace.create()');
    const { json, request } = normalize(input);
    if (needsGeometry(request) && !geometry.has(request.courseId)) {
        throw new Error(`Course geometry ${request.courseId} is not loaded; use PreparedRace.create() `
            + 'or `await ensureGeometry(request)` first');
    }
    return json;
}
function checkSeed(seed) {
    if (!Number.isSafeInteger(seed))
        throw new RangeError('Seed must be a safe integer');
    return seed;
}
/**
 * A request prepared once, then simulated for any number of seeds. Each run
 * starts from fresh simulation state. Results match native builds exactly.
 */
export class PreparedRace {
    #native;
    /** Requires `init()` to have finished and any needed geometry to be loaded; see `create`. */
    constructor(request) {
        const json = prepared(request);
        this.#native = guard(() => new NativeRace(json));
    }
    /** Load the engine and the course's geometry as needed, then prepare. */
    static async create(request) {
        await init();
        await ensureGeometry(request);
        return new PreparedRace(request);
    }
    #race() {
        if (!this.#native)
            throw new Error('Prepared race has been closed');
        return this.#native;
    }
    /** Replace the request. A failed preparation keeps the current one. */
    prepare(request) {
        const race = this.#race();
        const json = prepared(request);
        guard(() => race.prepare(json));
    }
    /** One seed as a decoded replay: metadata plus numeric frames. */
    run(seed) {
        return decode(this.runWire(seed));
    }
    /** One seed as the lossless binary packet (docs/BINARY-REPLAY.md). */
    runWire(seed) {
        const race = this.#race();
        return guard(() => race.runBinary(checkSeed(seed)));
    }
    /** One seed's results without replay frames: the fast path for Monte Carlo. */
    runResults(seed) {
        const race = this.#race();
        return JSON.parse(guard(() => race.runResults(checkSeed(seed))));
    }
    /** One seed as the conventional JSON reply, frames included. */
    runJson(seed) {
        const race = this.#race();
        return JSON.parse(guard(() => race.runJson(checkSeed(seed))));
    }
    get closed() { return this.#native === undefined; }
    /** Free the engine memory; repeated calls are harmless. */
    close() {
        this.#native?.free();
        this.#native = undefined;
    }
}
if (typeof Symbol.dispose === 'symbol') {
    PreparedRace.prototype[Symbol.dispose] = function () { this.close(); };
}
//# sourceMappingURL=engine.js.map