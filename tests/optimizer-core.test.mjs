import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Course } from '../globalsim/index.js';
import { SKILL_DATA } from '../skill-data.js';
import {
  buildCost, canonicalKey, crossover, discountedNeed, dropAndRefill, eligibleSkills, freshSample, greedyFill, groupOf,
  initialPopulation, isPossible, isValidBuild, mulberry32, nextGeneration, priorTable, priorWeights, raceContext,
  runnerJson, significantImprovement, skillCost, updateDistribution,
} from '../optimizer-core.js';

const courses = Course.all();
const COURSE_1600 = courses.find((c) => c.surface === 1 && c.distance === 1600);
const COURSE_1800 = courses.find((c) => c.surface === 1 && c.distance === 1800);
const DIRT = courses.find((c) => c.surface === 2);
const SPRINT_TURF = courses.find((c) => c.surface === 1 && c.category === 1);
const race = (course) => ({ courseId: course.id, ground: 'Firm', weather: 'Sunny', season: 'Spring', time: 'Midday' });
const uma = (strategy = 'Senkou') => ({ speed: 1200, stamina: 800, power: 900, guts: 500, wisdom: 700, strategy });
const ctxOf = (course, strategy) => raceContext(race(course), uma(strategy));

// Skills used below (verified against skill-data.js).
const FRONT_GOLD = 200531; // running_style == 1, lower 200532, need 120 each
const FRONT_WHITE = 200532;
const PACE_ONLY = Number(Object.entries(SKILL_DATA)
  .find(([, s]) => JSON.stringify(s.options) === '[[["running_style","==",2]]]' && s.grade >= 0)[0]);

test('discountedNeed / skillCost round per component', () => {
  assert.equal(discountedNeed(FRONT_WHITE, 0), 120);
  assert.equal(skillCost(FRONT_WHITE, 0), 120);
  assert.equal(skillCost(FRONT_GOLD, 0), 240);
  // 15% off 110 = 93.5 -> 94 and 90 -> 76.5 -> 77: 171, whereas rounding the sum (200 * 0.85) gives 170.
  assert.equal(discountedNeed(200011, 15), 94);
  assert.equal(discountedNeed(200012, 15), 77);
  assert.equal(skillCost(200011, 15), 171);
  assert.notEqual(skillCost(200011, 15), Math.round((110 + 90) * 0.85));
  assert.equal(skillCost('200011', 15), 171);
});

test('is_basis_distance: 200131 on 1600 m, 200141 on 1800 m', () => {
  assert.equal(COURSE_1600.distance, 1600);
  assert.equal(COURSE_1800.distance, 1800);
  assert.equal(isPossible(200131, ctxOf(COURSE_1600, 'Senkou')), true);
  assert.equal(isPossible(200131, ctxOf(COURSE_1800, 'Senkou')), false);
  assert.equal(isPossible(200141, ctxOf(COURSE_1600, 'Senkou')), false);
  assert.equal(isPossible(200141, ctxOf(COURSE_1800, 'Senkou')), true);
});

test('raceContext values', () => {
  const ctx = raceContext({ ...race(COURSE_1600), ground: 'Heavy', weather: 'Snowy', season: 'Sakura', time: 'Night' }, uma('Oonige'));
  assert.equal(ctx.running_style, 1);
  assert.equal(ctx.motivation, 5);
  assert.equal(ctx.grade, 100);
  assert.equal(ctx.ground_condition, 4);
  assert.equal(ctx.weather, 4);
  assert.equal(ctx.season, 5);
  assert.equal(ctx.time, 4);
  assert.equal(ctx.is_basis_distance, 1);
  assert.equal(ctx.base_power, 900);
  assert.equal(ctx.track_id, COURSE_1600.track);
  assert.equal(ctx.distance_type, COURSE_1600.category);
});

test('isPossible: absent options, running style', () => {
  const ctx = ctxOf(COURSE_1600, 'Senkou');
  assert.equal(isPossible(200502, ctx), true); // no options
  assert.equal(isPossible(FRONT_WHITE, ctx), false);
  assert.equal(isPossible(FRONT_WHITE, ctxOf(COURSE_1600, 'Nige')), true);
  assert.equal(isPossible(PACE_ONLY, ctx), true);
});

test('isPossible: OR of ANDs and every operator (synthetic options)', () => {
  const id = 999999;
  const withOptions = (options, ctx) => {
    SKILL_DATA[id] = { need: 1, rarity: 1, grade: 1, options };
    try {
      return isPossible(id, ctx);
    } finally {
      delete SKILL_DATA[id];
    }
  };
  const ctx = { a: 5, b: 2 };
  assert.equal(withOptions([[['a', '==', 5], ['b', '==', 2]]], ctx), true);
  assert.equal(withOptions([[['a', '==', 5], ['b', '==', 3]]], ctx), false);
  assert.equal(withOptions([[['a', '==', 4]], [['b', '==', 2]]], ctx), true); // OR
  assert.equal(withOptions([[['a', '!=', 5]]], ctx), false);
  assert.equal(withOptions([[['a', '>=', 5]]], ctx), true);
  assert.equal(withOptions([[['a', '<=', 4]]], ctx), false);
  assert.equal(withOptions([[['a', '>', 5]]], ctx), false);
  assert.equal(withOptions([[['a', '<', 6]]], ctx), true);
  assert.equal(withOptions([[['unknown', '==', 1]]], ctx), true); // unknown keys: possibly true
});

test('eligibility: running style, with Runaway matching style 1', () => {
  const ids = (strategy) => eligibleSkills({ uma: uma(strategy), race: race(COURSE_1600) });
  assert.ok(!ids('Senkou').includes(FRONT_WHITE));
  assert.ok(ids('Nige').includes(FRONT_WHITE));
  assert.ok(ids('Nige').includes(FRONT_GOLD));
  assert.ok(ids('Oonige').includes(FRONT_WHITE));
  assert.ok(ids('Senkou').includes(PACE_ONLY));
  assert.ok(!ids('Nige').includes(PACE_ONLY));
});

test('eligibility: distance and surface', () => {
  const sprintOnly = 200651; // distance_type == 1
  assert.ok(eligibleSkills({ uma: uma(), race: race(SPRINT_TURF) }).includes(sprintOnly));
  assert.ok(!eligibleSkills({ uma: uma(), race: race(COURSE_1800) }).includes(sprintOnly));
  const dirtOnly = 201671; // ground_type == 2
  assert.ok(eligibleSkills({ uma: uma(), race: race(DIRT) }).includes(dirtOnly));
  assert.ok(!eligibleSkills({ uma: uma(), race: race(COURSE_1600) }).includes(dirtOnly));
  const basis = eligibleSkills({ uma: uma(), race: race(COURSE_1600) });
  assert.ok(basis.includes(200131) && !basis.includes(200141));
});

test('eligibility: grade, own unique, evolved, Runaway group, inherited', () => {
  const base = { uma: uma(), race: race(COURSE_1600) };
  const ids = eligibleSkills(base);
  assert.ok(!ids.includes(200013)); // negative grade
  assert.ok(ids.every((id) => SKILL_DATA[id].grade >= 0));
  assert.ok(ids.every((id) => String(id).length !== 9));
  assert.ok(!ids.some((id) => groupOf(id) === 20205));
  assert.ok(eligibleSkills({ ...base, uma: uma('Oonige') }).includes(202051));
  assert.ok(!ids.some((id) => String(id)[0] === '9')); // inherited uniques need listing
  assert.ok(eligibleSkills({ ...base, inheritedUniques: [900011] }).includes(900011));
  assert.ok(eligibleSkills({ ...base, inheritedUniques: ['900011'] }).includes(900011));
  const withOwn = eligibleSkills({ ...base, ownUnique: '200502' });
  assert.ok(ids.includes(200502) && !withOwn.includes(200502));
});

test('tiers: whites are first-class, gold costs both tiers, one per group', () => {
  const ids = eligibleSkills({ uma: uma('Nige'), race: race(COURSE_1600) });
  assert.ok(ids.includes(FRONT_WHITE) && ids.includes(FRONT_GOLD));
  assert.equal(groupOf(FRONT_WHITE), groupOf(FRONT_GOLD));
  assert.equal(isValidBuild([FRONT_WHITE], { budget: 1000 }), true);
  assert.equal(isValidBuild([FRONT_WHITE, FRONT_GOLD], { budget: 10000 }), false);
  assert.equal(buildCost([FRONT_GOLD, 200502], 0), 240 + 120);
  assert.equal(isValidBuild([FRONT_GOLD], { budget: 239 }), false);
  assert.equal(isValidBuild([FRONT_GOLD], { budget: 240 }), true);
  assert.equal(canonicalKey([200502, FRONT_GOLD]), `${FRONT_GOLD},200502`.split(',').sort().join(','));
});

// A shared pool for the operator tests.
const POOL = eligibleSkills({ uma: uma('Nige'), race: race(COURSE_1600) });
const weights = new Map(POOL.map((id) => [id, 5]));
const checkValid = (build, budget, pct = 0) => {
  assert.ok(isValidBuild(build, { budget, pct }), `invalid build ${canonicalKey(build)}`);
  assert.deepEqual(build, [...build].sort((a, b) => a - b));
};

test('greedyFill never exceeds the budget and fills as far as possible', () => {
  const rng = mulberry32(1);
  for (let i = 0; i < 100; i++) {
    const budget = 100 + Math.floor(rng() * 1500);
    const pct = [0, 10, 40][i % 3];
    checkValid(greedyFill([], weights, { budget, pct, rng }), budget, pct);
  }
  // A small pool is drained completely, so nothing else fits afterwards.
  const small = new Map([200531, 200502, 200011, 200021, 200031].map((id) => [id, 1]));
  for (let i = 0; i < 50; i++) {
    const budget = 400;
    const build = greedyFill([], small, { budget, rng });
    const left = budget - buildCost(build);
    for (const id of small.keys()) {
      if (!build.some((b) => groupOf(b) === groupOf(id))) assert.ok(skillCost(id) > left, `${id} still fits`);
    }
  }
  // The starting build is kept and respected.
  const start = greedyFill([FRONT_GOLD], weights, { budget: 500, rng });
  assert.ok(start.includes(FRONT_GOLD));
  checkValid(start, 500);
  assert.deepEqual(greedyFill([FRONT_GOLD], weights, { budget: 100, rng }), [FRONT_GOLD]); // already over: unchanged
});

test('greedyFill is deterministic for a seed', () => {
  const a = greedyFill([], weights, { budget: 900, rng: mulberry32(7) });
  const b = greedyFill([], weights, { budget: 900, rng: mulberry32(7) });
  assert.deepEqual(a, b);
});

test('mutation operators keep builds valid (one per group, within budget)', () => {
  const rng = mulberry32(3);
  const p = new Map(POOL.map((id) => [id, 1 / POOL.length]));
  for (let i = 0; i < 200; i++) {
    const budget = 200 + Math.floor(rng() * 1200);
    const pct = i % 2 ? 20 : 0;
    const a = freshSample(p, { budget, pct, rng });
    const b = freshSample(p, { budget, pct, rng });
    const rates = new Map([...a, ...b].map((id) => [id, rng()]));
    checkValid(crossover(a, b, { weights: p, rates, budget, pct, rng }), budget, pct);
    checkValid(dropAndRefill(a, { weights: p, rates, budget, pct, rng }), budget, pct);
  }
});

test('crossover: upper tier wins and over-budget unions are trimmed', () => {
  const rng = mulberry32(5);
  const only = new Map([[FRONT_GOLD, 1], [FRONT_WHITE, 1]]);
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(crossover([FRONT_WHITE], [FRONT_GOLD], { weights: only, budget: 240, rng }), [FRONT_GOLD]);
    assert.deepEqual(crossover([FRONT_GOLD], [FRONT_WHITE], { weights: only, budget: 240, rng }), [FRONT_GOLD]);
  }
  const wide = crossover([200502, 200011], [FRONT_GOLD], { weights: new Map(), budget: 130, rng });
  assert.ok(buildCost(wide) <= 130);
});

test('dropAndRefill can change tier in both directions', () => {
  const rng = mulberry32(11);
  const only = new Map([[FRONT_GOLD, 1], [FRONT_WHITE, 1]]);
  const fromWhite = new Set();
  const fromGold = new Set();
  for (let i = 0; i < 400; i++) {
    const a = dropAndRefill([FRONT_WHITE], { weights: only, budget: 240, rng });
    const b = dropAndRefill([FRONT_GOLD], { weights: only, budget: 240, rng });
    checkValid(a, 240);
    checkValid(b, 240);
    fromWhite.add(canonicalKey(a));
    fromGold.add(canonicalKey(b));
  }
  assert.ok(fromWhite.has(String(FRONT_GOLD)));
  assert.ok(fromGold.has(String(FRONT_WHITE)));
  // Not affordable: white -> gold must not be chosen on a 120 budget.
  for (let i = 0; i < 100; i++) {
    assert.ok(buildCost(dropAndRefill([FRONT_WHITE], { weights: only, budget: 120, rng })) <= 120);
  }
});

test('initial population: distinct builds, bounded retries with a tiny budget', () => {
  const rng = mulberry32(2);
  const p = priorWeights(POOL, [], 'Nige');
  const { population, warning } = initialPopulation(p, { size: 30, budget: 2000, rng });
  assert.equal(population.length, 30);
  assert.equal(warning, null);
  assert.equal(new Set(population.map(canonicalKey)).size, 30);
  population.forEach((b) => checkValid(b, 2000));
  // Budget fits at most one cheap skill from a three-skill pool: only a handful of distinct builds exist.
  const tiny = new Map([200502, 200011, 200021].map((id) => [id, 5]));
  const small = initialPopulation(tiny, { size: 20, budget: 130, rng });
  assert.ok(small.population.length <= 4 && small.population.length >= 1);
  assert.match(small.warning, /distinct/);
  assert.equal(new Set(small.population.map(canonicalKey)).size, small.population.length);
  // Budget 0: only the empty build.
  const none = initialPopulation(p, { size: 5, budget: 0, rng });
  assert.deepEqual(none.population, [[]]);
});

test('nextGeneration: distinct offspring, elites kept, smaller when it cannot be filled', () => {
  const rng = mulberry32(4);
  const p = new Map(POOL.map((id) => [id, 1 / POOL.length]));
  const pop = initialPopulation(p, { size: 20, budget: 900, rng }).population;
  const elites = pop.slice(0, 4).map((build) => ({ build, rates: new Map(build.map((id) => [id, rng()])) }));
  const { builds, warning } = nextGeneration({ elites, size: 20, p, budget: 900, rng });
  assert.equal(warning, null);
  assert.equal(builds.length, 20);
  assert.deepEqual(builds.slice(0, 4), elites.map((e) => e.build));
  assert.equal(new Set(builds.map(canonicalKey)).size, 20);
  builds.forEach((b) => checkValid(b, 900));

  const tiny = new Map([200502, 200011].map((id) => [id, 1]));
  const out = nextGeneration({ elites: [{ build: [200502] }], size: 10, p: tiny, budget: 130, rng });
  assert.ok(out.builds.length < 10);
  assert.match(out.warning, /distinct/);
  assert.equal(new Set(out.builds.map(canonicalKey)).size, out.builds.length);
  // No elites at all still works.
  assert.ok(nextGeneration({ elites: [], size: 5, p, budget: 900, rng }).builds.length > 0);
});

test('updateDistribution: moves towards elites, keeps a floor', () => {
  const p = new Map([[1, 0.5], [2, 0.3], [3, 0.2]]);
  // Elites [[1, 2], [1]] have 3 skill slots: f = 2/3, 1/3, 0. Then normalized to sum 1.
  const next = updateDistribution(p, [[1, 2], [1]], 0.3, 0.01);
  const raw = [0.7 * 0.5 + 0.3 * (2 / 3) + 0.01, 0.7 * 0.3 + 0.3 * (1 / 3) + 0.01, 0.7 * 0.2 + 0.01];
  const total = raw.reduce((a, b) => a + b, 0);
  raw.forEach((value, i) => assert.ok(Math.abs(next.get(i + 1) - value / total) < 1e-12));
  assert.ok(next.get(1) > next.get(2) && next.get(2) > next.get(3));
  const flat = updateDistribution(new Map([[1, 0], [2, 0]]), [[1]]);
  assert.ok(flat.get(2) > 0); // the floor (default 0.02 / count) keeps unused skills samplable
  assert.ok(Math.abs(flat.get(2) - 0.01 / 0.32) < 1e-12);
});

test('priorWeights / priorTable: +5 smoothing, Runaway sums styles 1 and 5', () => {
  const usage = [
    { id: 200502, style: 1, players: 100 }, { id: 200502, style: 5, players: 30 },
    { id: 200502, style: 2, players: 999 }, { id: 200011, style: 0, players: 7 },
    { id: 200011, style: 1, players: 40 },
  ];
  const nige = priorWeights([200502, 200011, 200021], usage, 'Nige');
  assert.deepEqual([...nige], [[200502, 105], [200011, 45], [200021, 5]]);
  const runaway = priorWeights([200502, 200011, 200021], usage, 'Oonige');
  assert.deepEqual([...runaway], [[200502, 135], [200011, 45], [200021, 5]]);
  assert.equal(priorWeights([200502], usage, 'Senkou').get(200502), 1004);
  const styles = [{ style: 1, owners: 500 }, { style: 5, owners: 100 }, { style: 2, owners: 900 }];
  const table = priorTable([200502, 200021], usage, styles, 'Oonige', 10);
  assert.equal(table[0].count, 130);
  assert.equal(table[0].pct, 130 / 600);
  assert.equal(table[0].cost, skillCost(200502, 10));
  assert.equal(table[1].pct, 0);
  assert.ok(Math.abs(table[0].share + table[1].share - 1) < 1e-12);
  assert.equal(priorTable([200502], usage, styles, 'Nige')[0].pct, 100 / 500);
});

test('significantImprovement direction: place (lower) vs win rates (higher)', () => {
  const n = 200;
  const rng = mulberry32(9);
  const prev = Array.from({ length: n }, () => Math.floor(rng() * 3) + 2);
  const better = prev.map((v) => v - 1);
  assert.equal(significantImprovement(better, prev, 'place'), true);
  assert.equal(significantImprovement(prev, better, 'place'), false);
  assert.equal(significantImprovement(prev, prev, 'place'), false);
  const prevWins = Array.from({ length: n }, (_, i) => (i % 4 === 0 ? 1 : 0));
  const moreWins = prevWins.map((v, i) => (i % 2 === 0 ? 1 : v));
  assert.equal(significantImprovement(moreWins, prevWins, 'teamWin'), true);
  assert.equal(significantImprovement(moreWins, prevWins, 'umaWin'), true);
  assert.equal(significantImprovement(prevWins, moreWins, 'teamWin'), false);
  assert.throws(() => significantImprovement(prev, prev, 'nope'));
});

test('runnerJson never emits an undefined unique', () => {
  const base = { speed: 1, charaId: 1001, outfitId: 100101, strategy: 'Nige' };
  const without = runnerJson({ base, unique: undefined, uniqueLevel: 4, skills: [200502, 200011] });
  assert.deepEqual(without.skills, [
    { skillId: '200502', level: 1, isUnique: false }, { skillId: '200011', level: 1, isUnique: false },
  ]);
  assert.equal(runnerJson({ base, unique: 999999999, skills: [] }).skills.length, 0);
  const withUnique = runnerJson({ base, unique: '100101', uniqueLevel: 5, skills: [200502] });
  assert.deepEqual(withUnique.skills[0], { skillId: '100101', level: 5, isUnique: true });
  assert.equal(withUnique.speed, 1);
  assert.equal(withUnique.skills.length, 2);
});

// ---- stage A review fixes (docs/reviews/02-stage-a.md) ----

test('upgrade chains: cost includes every lower tier, × skills are never in a chain', () => {
  // Right-Handed Demon (gold) <- Right-Handed ◎ <- Right-Handed ○; Right-Handed × is separate.
  assert.equal(SKILL_DATA[200014].lower, 200011);
  assert.equal(SKILL_DATA[200011].lower, 200012);
  assert.equal(skillCost(200014), 130 + 110 + 90);
  assert.equal(skillCost(200014, 10), Math.round(130 * 0.9) + Math.round(110 * 0.9) + Math.round(90 * 0.9));
  for (const [id, s] of Object.entries(SKILL_DATA)) {
    if (s.lower) assert.ok(SKILL_DATA[s.lower].grade >= 0, `${id} chains to a negative skill`);
  }
});

test('greedyFill reaches a cheap low-weight skill after many expensive heavy ones', () => {
  const weights = new Map();
  const expensive = Object.keys(SKILL_DATA).map(Number).filter((id) => skillCost(id) >= 200).slice(0, 40);
  for (const id of expensive) weights.set(id, 1000);
  const cheap = Object.keys(SKILL_DATA).map(Number).find((id) => skillCost(id) <= 100 && !SKILL_DATA[id].lower);
  weights.set(cheap, 0.001);
  const build = greedyFill([], weights, { budget: 150, rng: mulberry32(7) });
  assert.deepEqual(build, [cheap]);
});

test('updateDistribution output sums to 1 over repeated updates', () => {
  let p = new Map([[200462, 0.5], [200331, 0.3], [201601, 0.2]]);
  for (let i = 0; i < 5; i++) {
    p = updateDistribution(p, [[200462, 200331], [200462, 201601]]);
    const sum = [...p.values()].reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `sum ${sum}`);
  }
});

test('crossover keeps the highest tier across a multi-step chain', () => {
  const weights = new Map([[200014, 1], [200011, 1], [200012, 1]]);
  for (const [a, b] of [[[200012], [200014]], [[200014], [200012]], [[200011], [200014]]]) {
    const child = crossover(a, b, { weights, budget: 10000, rng: mulberry32(1) });
    assert.deepEqual(child, [200014]);
  }
});

// ---- available golds ----
import { dropAndRefill as dropRefill, isGold, ownGolds } from '../optimizer-core.js';

test('availableGolds restricts golds only; null leaves everything; whites are untouched', () => {
  const all = eligibleSkills({ uma: uma(), race: race(COURSE_1600) });
  const golds = all.filter(isGold);
  assert.ok(golds.length > 5);
  const none = eligibleSkills({ uma: uma(), race: race(COURSE_1600), availableGolds: [] });
  assert.equal(none.filter(isGold).length, 0);
  assert.deepEqual(none, all.filter((id) => !isGold(id)));
  const one = eligibleSkills({ uma: uma(), race: race(COURSE_1600), availableGolds: [String(golds[0]), 999999999] });
  assert.deepEqual(one.filter(isGold), [golds[0]]);
  assert.deepEqual(eligibleSkills({ uma: uma(), race: race(COURSE_1600), availableGolds: null }), all);
  // a gold's lower-tier white stays buyable on its own
  const upper = golds.find((id) => SKILL_DATA[id].lower);
  assert.ok(none.includes(SKILL_DATA[upper].lower));
});

test('ownGolds lists a costume\'s gold awakening skills', () => {
  const golds = ownGolds(100101);
  assert.ok(golds.length >= 1);
  assert.ok(golds.every((id) => SKILL_DATA[id].rarity === 2));
  assert.deepEqual(ownGolds(null), []);
  assert.deepEqual(ownGolds(1), []);
});

test('tier changes and crossover never produce an unavailable gold', () => {
  const pool = eligibleSkills({ uma: uma(), race: race(COURSE_1600), availableGolds: [] });
  const weights = new Map(pool.map((id) => [id, 1]));
  const whitesWithGold = pool.filter((id) => Object.values(SKILL_DATA).some((s) => s.lower === id));
  assert.ok(whitesWithGold.length > 5);
  for (let seed = 0; seed < 60; seed++) {
    const rng = mulberry32(seed);
    const parent = greedyFill(whitesWithGold.slice(0, 3), weights, { budget: 1500, rng });
    const child = dropRefill(parent, { weights, budget: 1500, rng, tierChangeProb: 1 });
    const mate = greedyFill([], weights, { budget: 1500, rng });
    const cross = crossover(parent, mate, { weights, budget: 1500, rng });
    for (const id of [...child, ...cross]) assert.ok(!isGold(id), `gold ${id} slipped in`);
  }
});

// ---- debuffs ----
test('debuffs are excluded by default; hybrids that also buff the uma stay', () => {
  const debuffs = Object.entries(SKILL_DATA).filter(([, s]) => s.debuff).map(([id]) => Number(id));
  assert.equal(debuffs.length, 42);
  const args = { uma: uma('Nige'), race: race(COURSE_1600) };
  const without = new Set(eligibleSkills(args));
  const withAll = new Set(eligibleSkills({ ...args, includeDebuffs: true }));
  assert.ok(debuffs.every((id) => !without.has(id)));
  assert.ok(debuffs.some((id) => withAll.has(id)), 'some debuff is possible for a front runner in this race');
  for (const [id, s] of Object.entries(SKILL_DATA)) if (!s.debuff && withAll.has(Number(id))) assert.ok(without.has(Number(id)), id);
  // hybrids (an effect on the uma itself plus a debuff) are not debuffs
  assert.equal(SKILL_DATA[201082].debuff, undefined); // Speed Eater: also speeds the uma up
  assert.equal(SKILL_DATA[201221].debuff, undefined); // Stamina Siphon: also restores the uma's stamina
  assert.equal(SKILL_DATA[200791].debuff, 1); // Frenzied Front Runners: positive value, but on the others
  assert.equal(SKILL_DATA[201012].debuff, 1); // Intimidate
});

test('blacklist excludes skills and Hakuraku-derived starting builds obey the eligible pool', () => {
  const args = { uma: uma('Nige'), race: race(COURSE_1600), blacklist: ['200532'] };
  assert.ok(!eligibleSkills(args).includes(200532));
  const weights = new Map([[200502, 1], [200462, 1]]);
  const { population } = initialPopulation(weights, { size: 2, budget: 200, rng: mulberry32(23),
    sourceBuilds: [[200532, 200502], [200532, 200462]] });
  assert.equal(population.length, 2);
  assert.ok(population.every((build) => !build.includes(200532) && isValidBuild(build, { budget: 200 })));
});

test('isDebuff: only target codes that exclude the uma count; all-runner and unknown targets do not', async () => {
  const { isDebuff } = await import('../skill-targets.js');
  const alt = (...targets) => ({ effects: targets.map((target) => ({ target, type: 9, modifier: -100 })) });
  assert.equal(isDebuff([alt(9)]), true);
  assert.equal(isDebuff([alt(18), alt(21)]), true);
  assert.equal(isDebuff([alt(2)]), false); // everyone, the uma included
  assert.equal(isDebuff([alt(9, 1)]), false); // hybrid: also on the uma
  assert.equal(isDebuff([alt(9), alt(1)]), false); // self effect in another alternative
  assert.equal(isDebuff([alt(99)]), false); // unknown target code: possibly the uma
  assert.equal(isDebuff([{ effects: [] }]), false);
  assert.equal(isDebuff([]), false);
});
