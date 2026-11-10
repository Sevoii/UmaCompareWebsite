import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Course } from '../globalsim/index.js';
import { eligibleSkills, isValidBuild, mulberry32, priorWeights } from '../optimizer-core.js';
import { drawOptimizerTrials } from '../optimizer-eval.js';
import {
  StoppedError, WorkerPool, chunkRanges, completedTrials, mergeChunks, rankOrder, runOptimization,
} from '../optimizer-run.js';

/** A fake module worker speaking the optimizer protocol; a result's place is trial seed + candidate. */
function fakeWorkerFactory({ failInit = false, failRun = false } = {}) {
  return () => {
    const w = {
      onmessage: null, onerror: null, terminated: false,
      postMessage(m) {
        queueMicrotask(async () => {
          const reply = (data) => { if (!w.terminated) w.onmessage({ data }); };
          if (w.terminated) return;
          if (m.type === 'init') {
            reply(failInit ? { type: 'error', id: m.id, message: 'bad init' } : { type: 'ready', id: m.id });
            return;
          }
          if (failRun) { reply({ type: 'error', id: m.id, message: 'bad run' }); return; }
          const results = [];
          for (const [i, t] of m.trials.entries()) {
            const result = m.candidates.map((c) => ({ place: t.seed + c, teamWin: false, umaWin: false, skills: [] }));
            results.push(result);
            reply({ type: 'progress', id: m.id, trial: i, races: m.candidates.length, result });
            await Promise.resolve();
          }
          reply({ type: 'done', id: m.id, results });
        });
      },
      terminate() { w.terminated = true; },
    };
    return w;
  };
}

test('chunkRanges covers every trial exactly once', () => {
  for (const [total, workers] of [[1, 4], [7, 3], [200, 7], [200, 1]]) {
    const ranges = chunkRanges(total, workers);
    assert.equal(ranges[0].start, 0);
    assert.equal(ranges.at(-1).end, total);
    ranges.slice(1).forEach((r, i) => assert.equal(r.start, ranges[i].end));
  }
  assert.deepEqual(chunkRanges(0, 3), []);
});

test('mergeChunks restores trial order and rejects gaps', () => {
  const merged = mergeChunks([{ start: 2, results: ['c', 'd'] }, { start: 0, results: ['a', 'b'] }], 4);
  assert.deepEqual(merged, ['a', 'b', 'c', 'd']);
  assert.throws(() => mergeChunks([{ start: 0, results: ['a'] }], 2), /Missing result/);
});

test('WorkerPool merges results in trial order and reports progress', async () => {
  const pool = new WorkerPool({ createWorker: fakeWorkerFactory(), size: 3 });
  await pool.init({ race: {}, pool: [], teammates: [], slot: 0 });
  const trials = Array.from({ length: 23 }, (_, i) => ({ seed: i * 100 }));
  let races = 0;
  const results = await pool.run([1, 2], trials, (n) => { races += n; });
  assert.equal(races, 46);
  results.forEach((r, t) => assert.deepEqual(r.map((x) => x.place), [t * 100 + 1, t * 100 + 2]));
  pool.terminate();
});

test('WorkerPool rejects on init and run errors with the worker message', async () => {
  const bad = new WorkerPool({ createWorker: fakeWorkerFactory({ failInit: true }), size: 2 });
  await assert.rejects(bad.init({}), /bad init/);
  bad.terminate();
  const run = new WorkerPool({ createWorker: fakeWorkerFactory({ failRun: true }), size: 2 });
  await run.init({});
  await assert.rejects(run.run([1], [{ seed: 1 }, { seed: 2 }, { seed: 3 }]), /bad run/);
  run.terminate();
});

test('terminate rejects pending jobs with a StoppedError carrying finished trials', async () => {
  const pool = new WorkerPool({ createWorker: fakeWorkerFactory(), size: 1 });
  await pool.init({});
  const trials = Array.from({ length: 30 }, (_, i) => ({ seed: i }));
  let n = 0;
  const promise = pool.run([0], trials, () => { if (++n === 5) pool.terminate(); });
  const error = await promise.catch((e) => e);
  assert.ok(error instanceof StoppedError);
  assert.ok(error.partial.filter(Boolean).length >= 5);
  const { trials: kept, results } = completedTrials(trials, error.partial);
  assert.equal(kept.length, results.length);
  assert.ok(kept.length < 30);
});

test('rankOrder: lower is better for place, higher for win rates', () => {
  const scored = [{ mean: 3 }, { mean: 1 }, { mean: 2 }];
  assert.deepEqual(rankOrder(scored, 'place'), [1, 2, 0]);
  assert.deepEqual(rankOrder(scored, 'teamWin'), [0, 2, 1]);
});

// ---- generation loop with a fake evaluator ----
const course = Course.all().find((c) => c.surface === 1 && c.distance === 1600);
const race = { courseId: course.id, ground: 'Firm', weather: 'Sunny', season: 'Spring', time: 'Midday' };
const uma = { speed: 1200, stamina: 800, power: 900, guts: 500, wisdom: 700, strategy: 'Senkou' };
const eligible = eligibleSkills({ uma, race });
const prior = priorWeights(eligible, [], 'Senkou');
const settings = { population: 12, trials: 20, maxGenerations: 4, eliteFraction: 0.25, metric: 'place', budget: 600, pct: 0 };

/** Place improves with the number of skills held; builds are passed through as "runners". */
const fakeEvaluate = (flat = false) => async (candidates, trials) => trials.map((t) => candidates.map((build) => ({
  place: 5 - (flat ? 0 : build.length * 0.5) + (t.seed % 3) * 0.1, teamWin: false, umaWin: false, skills: [],
})));

test('runOptimization respects the budget, keeps the previous best and ends at max generations', async () => {
  const rng = mulberry32(7);
  const seen = [];
  const run = await runOptimization({
    prior, settings, rng, makeRunner: (b) => b, evaluate: fakeEvaluate(),
    drawTrials: (n) => drawOptimizerTrials(n, 10, 5, rng),
    onGeneration: (g) => seen.push(g),
  });
  assert.equal(seen.length, run.history.length);
  assert.ok(run.history.length >= 1 && run.history.length <= settings.maxGenerations);
  for (const e of run.top) assert.ok(isValidBuild(e.build, { budget: 600, pct: 0 }));
  run.history.slice(1).forEach((g, i) => {
    const prevBest = JSON.stringify(run.history[i].best.build);
    assert.ok(g.entries.some((e) => JSON.stringify(e.build) === prevBest));
  });
  assert.equal(run.stopped, false);
});

test('runOptimization stops after two generations without a significant improvement', async () => {
  const rng = mulberry32(3);
  const run = await runOptimization({
    prior, settings: { ...settings, maxGenerations: 12 }, rng, makeRunner: (b) => b, evaluate: fakeEvaluate(true),
    drawTrials: (n) => drawOptimizerTrials(n, 10, 5, rng),
  });
  assert.equal(run.reason, 'no-improvement');
  assert.equal(run.history.length, 3);
});

test('resume continues the completed population and generation numbering', async () => {
  const rng = mulberry32(17);
  const options = { prior, settings: { ...settings, maxGenerations: 2, staleLimit: 99 }, rng,
    makeRunner: (b) => b, evaluate: fakeEvaluate(), drawTrials: (n) => Array.from({ length: n }, (_, i) => ({ seed: i })) };
  const first = await runOptimization(options);
  const resumed = await runOptimization({ ...options, resumeState: first.resumeState });
  assert.deepEqual(resumed.history.map((g) => g.generation), [1, 2, 3, 4]);
  assert.ok(resumed.history[2].entries.some((e) => JSON.stringify(e.build) === JSON.stringify(first.best.build)));
});

test('runOptimization on Stop keeps completed work', async () => {
  const rng = mulberry32(5);
  const signal = { aborted: false };
  let calls = 0;
  const run = await runOptimization({
    prior, settings, rng, signal, makeRunner: (b) => b,
    drawTrials: (n) => drawOptimizerTrials(n, 10, 5, rng),
    evaluate: async (candidates, trials) => {
      if (++calls === 2) {
        signal.aborted = true;
        const partial = new Array(trials.length);
        const full = await fakeEvaluate()(candidates, trials);
        for (let i = 0; i < 6; i++) partial[i] = full[i];
        throw new StoppedError(partial);
      }
      return fakeEvaluate()(candidates, trials);
    },
  });
  assert.equal(run.stopped, true);
  assert.equal(run.history.length, 2);
  assert.equal(run.history[1].partial, true);
  assert.equal(run.history[1].trials, 6);
  assert.ok(run.best);
});

test('runOptimization propagates real errors', async () => {
  const rng = mulberry32(1);
  await assert.rejects(runOptimization({
    prior, settings, rng, makeRunner: (b) => b, drawTrials: (n) => drawOptimizerTrials(n, 10, 5, rng),
    evaluate: async () => { throw new Error('engine exploded'); },
  }), /engine exploded/);
});

// ---- abort, failure, options ----
import { dropAndRefill, nextGeneration, significantImprovement, updateDistribution, zForConfidence } from '../optimizer-core.js';
import { makeRngs } from '../optimizer-run.js';

test('runOptimization aborted before the first evaluate never evaluates', async () => {
  const rng = mulberry32(1);
  let calls = 0;
  const run = await runOptimization({
    prior, settings, rng, signal: { aborted: true }, makeRunner: (b) => b,
    drawTrials: (n) => drawOptimizerTrials(n, 10, 5, rng),
    evaluate: async () => { calls++; return []; },
  });
  assert.equal(calls, 0);
  assert.equal(run.stopped, true);
  assert.equal(run.best, null);
});

test('runOptimization stops between generations when aborted from onGeneration', async () => {
  const rng = mulberry32(2);
  const signal = { aborted: false };
  const run = await runOptimization({
    prior, settings, rng, signal, makeRunner: (b) => b, evaluate: fakeEvaluate(),
    drawTrials: (n) => drawOptimizerTrials(n, 10, 5, rng),
    onGeneration: () => { signal.aborted = true; },
  });
  assert.equal(run.history.length, 1);
  assert.equal(run.stopped, true);
  assert.ok(run.best);
});

test('staleLimit and minPartialTrials are honoured', async () => {
  const rng = mulberry32(3);
  const common = { prior, rng, makeRunner: (b) => b, evaluate: fakeEvaluate(true), drawTrials: (n) => drawOptimizerTrials(n, 10, 5, rng) };
  const one = await runOptimization({ ...common, settings: { ...settings, maxGenerations: 12, staleLimit: 1 } });
  assert.equal(one.history.length, 2);
  const four = await runOptimization({ ...common, settings: { ...settings, maxGenerations: 12, staleLimit: 4 } });
  assert.equal(four.history.length, 5);

  const signal = { aborted: false };
  const cut = await runOptimization({
    ...common, signal, settings: { ...settings, minPartialTrials: 8 },
    evaluate: async (c, t) => {
      signal.aborted = true;
      const partial = new Array(t.length);
      const full = await fakeEvaluate()(c, t);
      for (let i = 0; i < 6; i++) partial[i] = full[i];
      throw new StoppedError(partial);
    },
  });
  assert.equal(cut.best, null); // 6 finished trials < 8
});

test('WorkerPool chunking option and a failing lane retires the pool', async () => {
  const sent = [];
  const factory = (index) => () => {
    const w = {
      onmessage: null, terminated: false,
      postMessage(m) {
        sent.push([index, m.type]);
        setTimeout(() => {
          if (w.terminated) return;
          const reply = (data) => w.onmessage({ data });
          if (m.type === 'init') return reply({ type: 'ready', id: m.id });
          if (index === 0) return reply({ type: 'error', id: m.id, message: 'lane 0 broke' });
          const results = m.trials.map(() => [{ place: 1, skills: [] }]);
          m.trials.forEach((_, i) => reply({ type: 'progress', id: m.id, trial: i, races: 1, result: results[i] }));
          reply({ type: 'done', id: m.id, results });
        }, index === 0 ? 1 : 30);
      },
      terminate() { w.terminated = true; },
    };
    return w;
  };
  let n = 0;
  const pool = new WorkerPool({ createWorker: () => factory(n++)(), size: 2, chunking: { maxChunk: 2, perWorker: 1 } });
  await pool.init({});
  const trials = Array.from({ length: 12 }, (_, i) => ({ seed: i }));
  const error = await pool.run([0], trials).catch((e) => e);
  assert.match(error.message, /lane 0 broke/);
  assert.ok(!error.stopped);
  const runMessages = sent.filter(([, t]) => t === 'run').length;
  assert.ok(runMessages <= 2, `only the first chunk per lane was sent, got ${runMessages}`);
  await assert.rejects(pool.run([0], trials), /lane 0 broke/); // a failed pool stays failed
});

test('updateDistribution honours alpha and the floor numerator', () => {
  const p = new Map([[1, 0.5], [2, 0.5]]);
  const elites = [[1]];
  const none = updateDistribution(p, elites, 0, 0);
  assert.equal(none.get(1), 0.5);
  const full = updateDistribution(p, elites, 1, 0);
  assert.equal(full.get(1), 1);
  assert.equal(full.get(2), 0);
  const floored = updateDistribution(p, elites, 1, undefined, 0.5); // floor 0.25 each
  assert.ok(Math.abs(floored.get(2) - 0.25 / 1.5) < 1e-12);
});

test('nextGeneration honours the offspring mix and retries', () => {
  const rng = mulberry32(11);
  const p = normalizeP();
  function normalizeP() { return new Map([...prior].map(([id, w]) => [id, w / 1000])); }
  const elite = { build: [...prior.keys()].slice(0, 2), rates: new Map() };
  const all = nextGeneration({ elites: [elite], size: 9, p, budget: 600, rng, crossShare: 0, dropShare: 0 });
  assert.equal(all.builds.length, 9);
  assert.throws(() => nextGeneration({ elites: [elite], size: 9, p, budget: 600, rng, crossShare: 0.8, dropShare: 0.8 }), RangeError);
  const none = nextGeneration({ elites: [elite], size: 9, p, budget: 600, rng, retries: 0 });
  assert.ok(none.builds.length <= 9);
});

test('diversity mutates a non-elite parent and fresh samples use the original prior', () => {
  const rng = () => 0;
  const diversity = nextGeneration({
    elites: [], diversityParents: [{ build: [200502, 200462] }], size: 1, p: new Map(),
    budget: 1000, rng, crossShare: 0, dropShare: 0, diversityShare: 1, tierChangeProb: 0,
  });
  assert.deepEqual(diversity.builds, [[200462]]);
  const fresh = nextGeneration({
    elites: [], size: 1, p: new Map([[200462, 1]]), freshWeights: new Map([[200502, 1]]),
    budget: 200, rng, crossShare: 0, dropShare: 0, diversityShare: 0,
  });
  assert.deepEqual(fresh.builds, [[200502]]);
});

test('dropAndRefill honours maxDrops and tierChangeProb', () => {
  const ids = [...prior.keys()];
  const build = ids.slice(0, 40);
  const weights = new Map([[ids[0], 1]]); // nothing to refill with
  for (let seed = 0; seed < 20; seed++) {
    const one = dropAndRefill(build, { weights, budget: 1e9, rng: mulberry32(seed), maxDrops: 1, tierChangeProb: 0 });
    assert.ok(one.length >= build.length - 1);
  }
});

test('significantImprovement confidence level', () => {
  assert.equal(zForConfidence(0.95), 1.959963984540054);
  assert.ok(Math.abs(zForConfidence(0.99) - 2.5758293) < 1e-5);
  assert.ok(Math.abs(zForConfidence(0.9) - 1.6448536) < 1e-5);
  const cur = Array.from({ length: 50 }, () => 2.9);
  const prev = Array.from({ length: 50 }, () => 3);
  assert.equal(significantImprovement(cur, prev, 'place', 0.5), true);
  assert.equal(significantImprovement(cur, prev, 'place', 0.999999), false);
});

test('makeRngs: a seed makes both streams deterministic and independent', () => {
  const a = makeRngs(42);
  const b = makeRngs('42');
  const take = (f) => Array.from({ length: 5 }, f);
  assert.deepEqual(take(a.rng), take(b.rng));
  assert.deepEqual(take(a.trialRng), take(b.trialRng));
  assert.notDeepEqual(take(makeRngs(42).rng), take(makeRngs(42).trialRng));
  assert.throws(() => makeRngs(1.5), RangeError);
  assert.notDeepEqual(take(makeRngs('').rng), take(makeRngs(null).rng));
});

test('the same seed gives the same optimization', async () => {
  const go = async () => {
    const { rng, trialRng } = makeRngs(99);
    const run = await runOptimization({
      prior, settings, rng, makeRunner: (b) => b, evaluate: fakeEvaluate(),
      drawTrials: (n) => drawOptimizerTrials(n, 10, 5, trialRng),
    });
    return JSON.stringify(run.top.map((e) => [e.build, e.score.mean]));
  };
  assert.equal(await go(), await go());
});
