// DOM-free orchestration of the skill optimizer: a pool of evaluation workers (protocol in
// optimizer-protocol.js), trial chunking/merging, and the generation loop with its stopping rule.
// The worker factory and the evaluate function are injected so Node tests can use fakes.
import { scoreCandidates } from './optimizer-eval.js';
import {
  canonicalKey, buildCost, initialPopulation, lowerIsBetter, mulberry32, nextGeneration, normalizeWeights,
  significantImprovement, updateDistribution,
} from './optimizer-core.js';

/** Thrown into pending jobs when the pool is terminated (Stop). `partial` holds finished trials. */
export class StoppedError extends Error {
  constructor(partial = []) {
    super('Stopped');
    this.name = 'StoppedError';
    this.stopped = true;
    this.partial = partial;
  }
}

/**
 * Split `total` trials into contiguous ranges [{ start, end }] for `workers` workers: small
 * enough to balance load and lose little on Stop, large enough to keep message overhead low.
 */
export function chunkRanges(total, workers, { maxChunk = 10, perWorker = 4 } = {}) {
  if (total <= 0) return [];
  const size = Math.max(1, Math.min(maxChunk, Math.ceil(total / (Math.max(1, workers) * perWorker))));
  const ranges = [];
  for (let start = 0; start < total; start += size) ranges.push({ start, end: Math.min(total, start + size) });
  return ranges;
}

/** Merge `[{ start, results }]` chunks into one array in trial order; a gap is an error. */
export function mergeChunks(chunks, total) {
  const merged = new Array(total);
  for (const { start, results } of chunks) results.forEach((r, i) => { merged[start + i] = r; });
  for (let i = 0; i < total; i++) if (merged[i] === undefined) throw new Error(`Missing result for trial ${i}`);
  return merged;
}

/**
 * A pool of workers speaking the optimizer protocol. Replies are matched to jobs by request id.
 * @param {{createWorker: () => Worker, size: number}} options
 */
export class WorkerPool {
  #workers = [];
  #pending = new Map(); // id -> { worker, resolve, reject, onProgress }
  #nextId = 1;
  #terminated = false;
  #failure = null; // the first error that retired the pool
  #size;
  #createWorker;
  #chunking;

  /** `chunking` = { maxChunk, perWorker } for chunkRanges (defaults 10 and 4). */
  constructor({ createWorker, size, chunking = {} }) {
    this.#createWorker = createWorker;
    this.#size = Math.max(1, size);
    this.#chunking = chunking;
  }

  get size() { return this.#size; }

  #spawn() {
    const worker = this.#createWorker();
    worker.onmessage = ({ data }) => {
      const job = this.#pending.get(data?.id);
      if (!job) return;
      if (data.type === 'progress') { job.onProgress?.(data); return; }
      this.#pending.delete(data.id);
      if (data.type === 'error') job.reject(new Error(data.message));
      else job.resolve(data);
    };
    worker.onerror = (event) => {
      event?.preventDefault?.();
      const error = new Error(event?.message || 'Worker failed');
      for (const [id, job] of this.#pending) {
        if (job.worker === worker) { this.#pending.delete(id); job.reject(error); }
      }
    };
    this.#workers.push(worker);
    return worker;
  }

  #call(worker, message, onProgress) {
    if (this.#terminated) return Promise.reject(this.#failure ?? new StoppedError());
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { worker, resolve, reject, onProgress });
      worker.postMessage({ ...message, id });
    });
  }

  /** Start the workers and send them the context `{ race, pool, teammates, slot }`; resolves when all are ready. */
  async init(context) {
    for (let i = 0; i < this.#size; i++) this.#spawn();
    await Promise.all(this.#workers.map((w) => this.#call(w, { type: 'init', ...context })));
  }

  /**
   * Run every candidate on every trial, the trials split into chunks across the workers.
   * `onProgress(races)` is called with the number of races each finished trial adds. Results are
   * returned in trial order (`results[t][c]`). On failure or termination the error carries
   * `partial`, a sparse array of the trials that finished (from progress messages).
   */
  async run(candidates, trials, onProgress = () => {}) {
    const results = new Array(trials.length);
    if (this.#terminated) throw Object.assign(this.#failure ?? new StoppedError(), { partial: results });
    const ranges = chunkRanges(trials.length, this.#workers.length, this.#chunking);
    let next = 0;
    // A failing lane retires the whole pool (terminating the other workers), so no lane keeps
    // posting results or takes another chunk; every lane has settled before run() returns.
    const lane = async (worker) => {
      try {
        while (!this.#terminated && next < ranges.length) {
          const { start, end } = ranges[next++];
          await this.#call(worker, { type: 'run', candidates, trials: trials.slice(start, end) }, (m) => {
            if (this.#terminated) return;
            results[start + m.trial] = m.result;
            onProgress(m.races);
          });
        }
      } catch (error) {
        this.#failure ??= error;
        this.terminate();
      }
    };
    await Promise.all(this.#workers.map(lane));
    if (this.#terminated) throw Object.assign(this.#failure ?? new StoppedError(), { partial: results });
    return mergeChunks([{ start: 0, results }], trials.length);
  }

  /** Terminate every worker; pending jobs reject with a StoppedError. The pool cannot be reused. */
  terminate() {
    this.#terminated = true;
    for (const w of this.#workers) w.terminate();
    const error = new StoppedError();
    for (const job of this.#pending.values()) job.reject(error);
    this.#pending.clear();
    this.#workers = [];
  }
}

/** Indices of `scored` ordered best first for a metric (ties keep population order). */
export function rankOrder(scored, metric) {
  const sign = lowerIsBetter(metric) ? 1 : -1;
  return scored.map((_, i) => i).sort((a, b) => sign * (scored[a].mean - scored[b].mean) || a - b);
}

/** The trials all of whose candidate results exist (a cut generation), as { trials, results }. */
export function completedTrials(trials, partial) {
  const keep = [];
  trials.forEach((_, t) => { if (partial[t] !== undefined) keep.push(t); });
  return { trials: keep.map((t) => trials[t]), results: keep.map((t) => partial[t]) };
}

/**
 * The generation loop (spec "Search"). Returns
 * `{ best, top, history, warnings, stopped, reason }` where `top` is the final generation's ranked
 * entries `{ build, score, cost }` (`best` = top[0]).
 *
 * @param {object} options
 * @param {Map<number, number>} options.prior sampling weights of the eligible skills
 * @param {(build: number[]) => object} options.makeRunner build -> runner JSON
 * @param {(candidates: object[], trials: object[]) => Promise<object[][]>} options.evaluate results[t][c]
 * @param {(n: number) => object[]} options.drawTrials
 * @param {{population: number, trials: number, maxGenerations: number, eliteFraction: number,
 *   metric: string, budget: number, pct: number,
 *   staleLimit?: number, minPartialTrials?: number, confidence?: number, alpha?: number, floorNumerator?: number,
 *   retries?: number, initialRetries?: number, crossShare?: number, dropShare?: number, tournamentSize?: number,
 *   maxDrops?: number, tierChangeProb?: number, rateFloor?: number}} options.settings
 *   The optional tuning knobs default to the values in the spec's parameter table.
 * @param {() => number} options.rng
 * @param {(info: object) => void} [options.onGeneration] called after each scored generation
 * @param {{aborted: boolean}} [options.signal] set aborted before terminating the pool
 */
export async function runOptimization({ prior, makeRunner, evaluate, drawTrials, settings, rng, sourceBuilds = [], resumeState = null, onGeneration = () => {}, signal = { aborted: false } }) {
  const { population, trials: trialsPerBuild, maxGenerations, eliteFraction, metric, budget, pct } = settings;
  const {
    staleLimit = 2, minPartialTrials = 2, confidence = 0.95, alpha = 0.3, floorNumerator = 0.02,
    retries = 20, initialRetries = retries, crossShare = 0.4, dropShare = 0.3, diversityShare = 0.1,
    diversityBand = 0.2, tournamentSize = 2,
    maxDrops = 3, tierChangeProb = 0.25, rateFloor = 0.05,
  } = settings;
  const warnings = [...(resumeState?.warnings ?? [])];
  const initial = resumeState ? { population: resumeState.builds } : initialPopulation(prior, { size: population, budget, pct, rng, retries: initialRetries, sourceBuilds });
  if (initial.warning) warnings.push(initial.warning);
  let builds = initial.population;
  const size = resumeState?.size ?? builds.length;
  let p = resumeState ? new Map(resumeState.p) : normalizeWeights(prior);
  let previous = resumeState?.previous ?? null;
  let stale = 0; // consecutive generations without a significant improvement
  let top = resumeState?.top ?? null;
  const history = [...(resumeState?.history ?? [])];
  let checkpoint = resumeState;
  let reason = 'max-generations';
  let stopped = false;

  const breed = (entries) => {
    const eliteCount = Math.max(1, Math.ceil(eliteFraction * entries.length));
    const elites = entries.slice(0, eliteCount);
    p = updateDistribution(p, elites.map((e) => e.build), alpha, undefined, floorNumerator);
    const next = nextGeneration({
      elites: elites.map((e) => ({ build: e.build, rates: e.score.rates })), size, p, budget, pct, rng,
      diversityParents: entries.slice(eliteCount, eliteCount + Math.ceil((entries.length - eliteCount) * diversityBand))
        .map((e) => ({ build: e.build, rates: e.score.rates })),
      freshWeights: prior, retries, crossShare, dropShare, diversityShare, tournamentSize, maxDrops, tierChangeProb, rateFloor,
    });
    if (next.warning && !warnings.includes(next.warning)) warnings.push(next.warning);
    builds = next.builds;
  };
  if (resumeState && !signal.aborted) breed(resumeState.top);
  const startGeneration = resumeState ? resumeState.generation + 1 : 1;
  for (let generation = startGeneration; generation < startGeneration + maxGenerations; generation++) {
    if (signal.aborted) { stopped = true; reason = 'stopped'; break; }
    if (previous && !builds.some((b) => canonicalKey(b) === canonicalKey(previous.build))) builds.push(previous.build);
    let trials = drawTrials(trialsPerBuild);
    let results;
    let partial = false;
    try {
      results = await evaluate(builds.map(makeRunner), trials);
    } catch (error) {
      if (!(error?.stopped || signal.aborted)) throw error;
      stopped = true;
      reason = 'stopped';
      const done = completedTrials(trials, error.partial ?? []);
      if (done.trials.length < minPartialTrials) break; // too little to score; keep the last full generation
      trials = done.trials;
      results = done.results;
      partial = true;
    }
    const scored = scoreCandidates(results, metric);
    const order = rankOrder(scored, metric);
    const entries = order.map((i) => ({ build: builds[i], score: scored[i], cost: buildCost(builds[i], pct) }));
    const best = entries[0];
    let significant = null;
    if (previous) {
      const old = entries.find((e) => canonicalKey(e.build) === canonicalKey(previous.build));
      significant = old && old !== best ? significantImprovement(best.score.scores, old.score.scores, metric, confidence) : false;
      stale = significant ? 0 : stale + 1;
    }
    const eliteCount = Math.max(1, Math.ceil(eliteFraction * entries.length));
    const elites = entries.slice(0, eliteCount);
    top = entries;
    const info = {
      generation, partial, trials: trials.length, best, size: entries.length, significant,
      eliteMean: elites.reduce((s, e) => s + e.score.mean, 0) / elites.length, entries,
    };
    history.push(info);
    onGeneration(info);
    previous = best;
    if (partial) break;
    checkpoint = { generation, builds, size, p: new Map(p), previous, top: entries, history: [...history], warnings: [...warnings] };
    if (signal.aborted) { stopped = true; reason = 'stopped'; break; }
    if (stale >= staleLimit) { reason = 'no-improvement'; break; }
    if (generation === startGeneration + maxGenerations - 1) break;
    breed(entries);
  }
  return { best: top?.[0] ?? null, top: top ?? [], history, warnings, stopped, reason, resumeState: checkpoint };
}

/**
 * The two random streams of a run: \`rng\` for the search (population, operators) and \`trialRng\`
 * for drawing trials. With a seed (an unsigned 32-bit integer, 0..4294967295) both are deterministic:
 * mulberry32(seed) and mulberry32(seed XOR 0x9E3779B9), two different states for every seed (no
 * wraparound at the top of the range); with no seed (null, undefined or '') they are random.
 * @returns {{rng: () => number, trialRng: () => number}}
 */
export function makeRngs(seed = null) {
  if (seed === null || seed === undefined || seed === '') {
    const fresh = mulberry32((Date.now() ^ (Math.random() * 2 ** 32)) >>> 0);
    return { rng: fresh, trialRng: Math.random };
  }
  const n = Number(seed);
  if (!Number.isInteger(n) || n < 0 || n > 0xFFFFFFFF) throw new RangeError('The seed must be a whole number from 0 to 4294967295');
  return { rng: mulberry32(n), trialRng: mulberry32((n ^ 0x9E3779B9) >>> 0) };
}
