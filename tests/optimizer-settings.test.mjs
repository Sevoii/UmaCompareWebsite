import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADVANCED, BASIC, advancedField, parseSettings } from '../optimizer-settings.js';

const defaults = () => ({
  metric: 'place', ...Object.fromEntries([...BASIC, ...ADVANCED].map((d) => [d.id, String(d.def)])),
});
const read = (over = {}) => { const v = { ...defaults(), ...over }; return (id) => v[id]; };

test('defaults match the spec values', () => {
  const s = parseSettings(read());
  assert.deepEqual(
    [s.population, s.trials, s.maxGenerations, s.eliteFraction, s.staleLimit, s.minPartialTrials, s.confidence, s.alpha,
      s.floorNumerator, s.crossShare, s.dropShare, s.tournamentSize, s.maxDrops, s.tierChangeProb, s.rateFloor,
      s.retries, s.initialRetries, s.uniqueFallback, s.maxTeams, s.buildsShown, s.maxChunk, s.perWorker],
    [64, 200, 12, 0.2, 2, 2, 0.95, 0.3, 0.02, 0.4, 0.3, 2, 3, 0.25, 0.05, 20, 20, 4, 300, 5, 10, 4],
  );
  assert.equal(s.workers, null);
  assert.equal(s.seed, null);
  assert.equal(s.diversityShare, 0.1);
  assert.equal(s.diversityBand, 0.2);
});

test('validation messages name the field', () => {
  assert.throws(() => parseSettings(read({ alpha: '2' })), /Distribution update rate \(alpha\) must be a number at least 0 and at most 1/);
  assert.throws(() => parseSettings(read({ staleLimit: '0' })), /Stale generations to stop must be a whole number at least 1/);
  assert.throws(() => parseSettings(read({ confidence: '1' })), /Improvement confidence/);
  assert.throws(() => parseSettings(read({ seed: '1.5' })), /Random seed must be a whole number/);
  assert.throws(() => parseSettings(read({ crossShare: '0.7', dropShare: '0.5' })), /add up to at most 1/);
  assert.throws(() => parseSettings(read({ minPartial: '500' })), /cannot exceed/);
  assert.throws(() => parseSettings(read({ budget: '' })), /SP budget/);
  assert.equal(parseSettings(read({ seed: '42', workers: '3' })).seed, 42);
});

test('every advanced field renders an input with its default', () => {
  for (const def of ADVANCED) assert.match(advancedField(def), new RegExp(`id="${def.id}"`));
});

// ---- docs/reviews/05-stage-c-fixes.md ----
import { zForConfidence, priorWeights, priorTable } from '../optimizer-core.js';
import { makeRngs } from '../optimizer-run.js';

test('seed range is unsigned 32-bit; the two streams differ for every seed, including the ends', () => {
  const draw = (r) => Array.from({ length: 5 }, () => r());
  for (const seed of [0, 1, 4294967295]) {
    const { rng, trialRng } = makeRngs(seed);
    assert.notDeepEqual(draw(rng), draw(trialRng));
  }
  assert.notDeepEqual(draw(makeRngs(4294967295).trialRng), draw(makeRngs(0).rng));
  assert.throws(() => makeRngs(4294967296), /0 to 4294967295/);
  assert.throws(() => makeRngs(-1), /0 to 4294967295/);
  assert.throws(() => makeRngs(2 ** 60), /0 to 4294967295/);
});

test('zForConfidence stays finite and increasing up to the edge of (0, 1)', () => {
  const levels = [0.5, 0.8, 0.9, 0.95, 0.99, 0.999, 1 - 1e-12, 0.9999999999999999];
  const z = levels.map(zForConfidence);
  assert.ok(z.every(Number.isFinite), String(z));
  for (let i = 1; i < z.length; i++) assert.ok(z[i] >= z[i - 1], `${levels[i]}: ${z[i]} < ${z[i - 1]}`);
  assert.ok(Math.abs(zForConfidence(0.99) - 2.5758293) < 1e-6);
  assert.ok(Math.abs(zForConfidence(0.95 + 1e-15) - 1.959963984540054) < 1e-6);
});

test('prior smoothing feeds both the search weights and the displayed table', () => {
  const usage = [{ id: 200011, style: 1, players: 10 }];
  const ids = [200011, 200012];
  const w = priorWeights(ids, usage, 'Nige', 1);
  assert.deepEqual([...w.values()], [11, 1]);
  const rows = priorTable(ids, usage, [{ style: 1, owners: 100 }], 'Nige', 0, 1);
  assert.deepEqual(rows.map((r) => r.weight), [11, 1]);
  assert.ok(Math.abs(rows[0].share - 11 / 12) < 1e-12);
  assert.deepEqual([...priorWeights(ids, usage, 'Nige').values()], [15, 5]); // default unchanged
});

test('builds shown defaults to 5 and must be at least 1', () => {
  assert.equal(parseSettings(read()).buildsShown, 5);
  assert.throws(() => parseSettings(read({ buildsShown: '0' })), /Builds shown.*at least 1/);
});
