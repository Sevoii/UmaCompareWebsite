// Pure logic of the skill optimizer (see docs/SKILL_OPTIMIZER_SPEC.md): costs, eligibility,
// prior, builds, search operators, stopping test. No DOM, no fetch; every random function
// takes an `rng` (a () => [0, 1) function, e.g. `mulberry32(seed)`) so it is deterministic.
//
// A build is a sorted array of skill ids (numbers), at most one per group (`groupOf`). A
// "weights" argument is a Map of skill id -> weight; its keys are the sampling pool.
import { Course, isSkill, skillIsInherited } from './globalsim/index.js';
import { SKILL_DATA } from './skill-data.js';
import { pairedDifferenceCi } from './compare.js';
import { OUTFITS } from './outfits.js';

// ---- RNG ----

/**
 * A seeded random generator (mulberry32) returning floats in [0, 1).
 * @param {number} seed
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- costs and groups ----

const data = (id) => SKILL_DATA[id];

/** The skill group of an id (tiers of one skill share it): `Math.floor(id / 10)`. */
export const groupOf = (id) => Math.floor(Number(id) / 10);

/**
 * SP needed for one skill after a hint discount, rounded per skill.
 * @param {number|string} id
 * @param {number} [pct] discount percent (0-40)
 */
export function discountedNeed(id, pct = 0) {
  return Math.round(data(id).need * (1 - pct / 100));
}

/**
 * SP cost of buying a skill: its own discounted need plus its lower tier's (rounded per
 * component, never on the sum).
 * @param {number|string} id
 * @param {number} [pct]
 */
export function skillCost(id, pct = 0) {
  // The whole upgrade chain below this skill is paid for too (e.g. Demon <- ◎ <- ○).
  const lower = data(id).lower;
  return discountedNeed(id, pct) + (lower ? skillCost(lower, pct) : 0);
}

// ---- builds ----

/**
 * Normalize ids into a build: numbers, deduplicated, sorted ascending.
 * @param {Iterable<number|string>} ids
 * @returns {number[]}
 */
export const normalizeBuild = (ids) => [...new Set([...ids].map(Number))].sort((a, b) => a - b);

/** Total SP cost of a build. */
export const buildCost = (build, pct = 0) => build.reduce((sum, id) => sum + skillCost(id, pct), 0);

/** Canonical string key of a build (sorted ids). */
export const canonicalKey = (build) => normalizeBuild(build).join(',');

/**
 * Whether a build is valid: at most one skill per group and total cost within budget.
 * @param {number[]} build
 * @param {{budget: number, pct?: number}} options
 */
export function isValidBuild(build, { budget, pct = 0 }) {
  const groups = new Set(build.map(groupOf));
  return groups.size === build.length && buildCost(build, pct) <= budget;
}

// ---- race context and eligibility ----

const STYLE_NUMBER = { Nige: 1, Senkou: 2, Sasi: 3, Oikomi: 4, Oonige: 5 };
const GROUND = { Firm: 1, Good: 2, Soft: 3, Heavy: 4 };
const WEATHER = { Sunny: 1, Cloudy: 2, Rainy: 3, Snowy: 4 };
const SEASON = { Spring: 1, Summer: 2, Autumn: 3, Winter: 4, Sakura: 5 };
const TIME = { Morning: 1, Midday: 2, Evening: 3, Night: 4 };

/** Running style number 1..5 (Nige..Oonige) from a Strategy name or a number. */
function styleNumber(strategy) {
  const n = typeof strategy === 'number' ? strategy : STYLE_NUMBER[strategy];
  if (!(n >= 1 && n <= 5)) throw new RangeError(`Unknown running style: ${strategy}`);
  return n;
}

/**
 * The values static skill conditions are evaluated against. `running_style` is the base style
 * (Runaway counts as 1), `motivation` 5 and `grade` 100 (Champions Meeting).
 * @param {{courseId: number, ground: string, weather: string, season: string, time: string}} race
 * @param {{strategy: string|number, speed?: number, stamina?: number, power?: number, guts?: number, wisdom?: number}} uma
 */
export function raceContext(race, uma) {
  const course = Course.get(race.courseId);
  const style = styleNumber(uma.strategy);
  return {
    running_style: style === 5 ? 1 : style,
    distance_type: course.category,
    ground_type: course.surface,
    rotation: course.turn,
    track_id: course.track,
    course_distance: course.distance,
    is_basis_distance: course.distance % 400 === 0 ? 1 : 0,
    ground_condition: GROUND[race.ground],
    weather: WEATHER[race.weather],
    season: SEASON[race.season],
    time: TIME[race.time],
    motivation: 5,
    grade: 100,
    base_speed: uma.speed,
    base_stamina: uma.stamina,
    base_power: uma.power,
    base_guts: uma.guts,
    base_wiz: uma.wisdom,
    base_wisdom: uma.wisdom,
  };
}

const OPS = {
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
  '>=': (a, b) => a >= b,
  '<=': (a, b) => a <= b,
  '>': (a, b) => a > b,
  '<': (a, b) => a < b,
};

/** One [key, op, value] term; unknown keys or values count as possibly true (conservative). */
function termHolds([key, op, value], ctx) {
  const actual = ctx[key];
  if (actual === undefined || actual === null || Number.isNaN(actual)) return true;
  const test = OPS[op];
  return test ? test(actual, value) : true;
}

/**
 * Whether a skill can possibly fire for a race context: no static options, or some option
 * (AND of terms) holds. Only the keys present in `options` are checked.
 * @param {number|string} id
 * @param {object} ctx from `raceContext`
 */
export function isPossible(id, ctx) {
  const options = data(id)?.options;
  if (!options) return true;
  return options.some((terms) => terms.every((term) => termHolds(term, ctx)));
}

/** Whether a skill is a gold (rarity 2 in skill-data.js; whites are 1, inherited uniques are whites). */
export const isGold = (id) => data(id)?.rarity === 2;

/**
 * The gold skills a costume has of its own (its awakening skills that are golds in the skill
 * data), as sorted numbers. Empty for an unknown or missing outfit.
 * @param {number|string|null|undefined} outfitId
 */
export function ownGolds(outfitId) {
  if (outfitId === null || outfitId === undefined) return [];
  const id = Number(outfitId);
  for (const list of Object.values(OUTFITS)) {
    const outfit = list.find((o) => o.id === id);
    if (outfit) return (outfit.skills ?? []).filter(isGold).sort((a, b) => a - b);
  }
  return [];
}

/**
 * Ids of the skills the uma may buy in this race, sorted ascending: grade >= 0, not the own
 * unique, not a 9-digit (evolved) id, not group 20205 (Runaway) unless the strategy is Oonige,
 * inherited uniques only if listed, golds only if in `availableGolds` (when given; null = every
 * gold, whites are never restricted), not a debuff (every effect on other runners; unless
 * `includeDebuffs`), and possible for the race.
 * @param {{uma: object, race: object, inheritedUniques?: Iterable<number|string>, ownUnique?: number|string|null,
 *   availableGolds?: Iterable<number|string>|null, includeDebuffs?: boolean}} args
 * @returns {number[]}
 */
export function eligibleSkills({ uma, race, inheritedUniques = [], ownUnique = null, availableGolds = null, includeDebuffs = false, blacklist = [] }) {
  const ctx = raceContext(race, uma);
  const inherited = new Set([...inheritedUniques].map(Number));
  const blocked = new Set([...blacklist].map(Number));
  const golds = availableGolds === null || availableGolds === undefined ? null : new Set([...availableGolds].map(Number));
  const own = ownUnique === null || ownUnique === undefined ? null : Number(ownUnique);
  const runaway = styleNumber(uma.strategy) === 5;
  const ids = [];
  for (const key of Object.keys(SKILL_DATA)) {
    const id = Number(key);
    if (blocked.has(id)) continue;
    if (data(key).grade < 0 || id === own || key.length === 9) continue;
    if (groupOf(id) === 20205 && !runaway) continue;
    if (isSkill(id) && skillIsInherited(id) && !inherited.has(id)) continue;
    if (golds && isGold(id) && !golds.has(id)) continue;
    if (!includeDebuffs && data(key).debuff) continue; // only hurts the others (Subdued, Frenzied, Intimidate, ...)
    if (!isPossible(id, ctx)) continue;
    ids.push(id);
  }
  return ids.sort((a, b) => a - b);
}

// ---- prior ----

/** The running-style numbers whose usage counts for a strategy (a Runaway also counts as 1). */
export const priorStyles = (strategy) => (styleNumber(strategy) === 5 ? [1, 5] : [styleNumber(strategy)]);

const usageCount = (usageSkills, styles) => {
  const counts = new Map();
  for (const { id, style, players } of usageSkills) {
    if (styles.includes(style)) counts.set(Number(id), (counts.get(Number(id)) ?? 0) + players);
  }
  return counts;
};

/**
 * Sampling weights: players using the skill (uma-usage `skills` for the strategy's styles) + `smoothing`
 * (default 5, so skills nobody uses can still be drawn).
 * @param {number[]} eligibleIds
 * @param {{id: number|string, style: number, players: number}[]} usageSkills
 * @param {string|number} strategy
 * @returns {Map<number, number>}
 */
export function priorWeights(eligibleIds, usageSkills, strategy, smoothing = 5) {
  const counts = usageCount(usageSkills, priorStyles(strategy));
  return new Map(eligibleIds.map((id) => [id, (counts.get(id) ?? 0) + smoothing]));
}

/**
 * Rows for the prior table: { id, cost, count, pct (fraction of the style's players), weight, share }.
 * @param {number[]} eligibleIds
 * @param {{id: number|string, style: number, players: number}[]} usageSkills
 * @param {{style: number, owners: number}[]} summaryStyles
 * @param {string|number} strategy
 * @param {number} [discountPct]
 * @param {number} [smoothing] as in priorWeights
 */
export function priorTable(eligibleIds, usageSkills, summaryStyles, strategy, discountPct = 0, smoothing = 5) {
  const styles = priorStyles(strategy);
  const counts = usageCount(usageSkills, styles);
  const owners = summaryStyles.filter((s) => styles.includes(s.style)).reduce((sum, s) => sum + s.owners, 0);
  const weights = priorWeights(eligibleIds, usageSkills, strategy, smoothing);
  const total = [...weights.values()].reduce((a, b) => a + b, 0);
  return eligibleIds.map((id) => {
    const count = counts.get(id) ?? 0;
    return {
      id, cost: skillCost(id, discountPct), count, pct: owners > 0 ? count / owners : 0,
      weight: weights.get(id), share: total > 0 ? weights.get(id) / total : 0,
    };
  });
}

/** A Map of weights scaled to sum to 1. */
export function normalizeWeights(weights) {
  const total = [...weights.values()].reduce((a, b) => a + b, 0);
  return new Map([...weights].map(([id, w]) => [id, total > 0 ? w / total : 1 / weights.size]));
}

// ---- sampling ----

/** Index drawn with probability proportional to `weightOf(item)` (uniform if all are 0). */
function pickWeighted(items, weightOf, rng) {
  let total = 0;
  const w = items.map((item) => {
    const x = Math.max(0, weightOf(item));
    total += x;
    return x;
  });
  if (!(total > 0)) return Math.min(items.length - 1, Math.floor(rng() * items.length));
  let r = rng() * total;
  for (let i = 0; i < w.length; i++) {
    r -= w[i];
    if (r < 0) return i;
  }
  return w.length - 1;
}

/**
 * Add skills to a build by weighted sampling without replacement, drawing only among skills
 * whose group is free and whose cost fits the remaining SP; stops when none fit.
 * @param {number[]} build starting build (not modified)
 * @param {Map<number, number>} weights
 * @param {{budget: number, pct?: number, rng: () => number}} options
 * @returns {number[]} the new sorted build
 */
export function greedyFill(build, weights, { budget, pct = 0, rng }) {
  // Only skills that still fit are drawn from, so the build is filled until nothing affordable
  // is left (no miss cutoff: a cheap low-weight skill is still found after expensive ones).
  const result = [...build];
  const held = new Set(result.map(groupOf));
  let remaining = budget - buildCost(result, pct);
  let pool = [...weights.keys()].filter((id) => !held.has(groupOf(id)));
  for (;;) {
    pool = pool.filter((id) => skillCost(id, pct) <= remaining);
    if (!pool.length) break;
    const id = pool[pickWeighted(pool, (other) => weights.get(other), rng)];
    result.push(id);
    remaining -= skillCost(id, pct);
    pool = pool.filter((other) => groupOf(other) !== groupOf(id));
  }
  return normalizeBuild(result);
}

/** A fresh greedy sample from the weights. */
export const freshSample = (weights, options) => greedyFill([], weights, options);

/**
 * Distinct initial builds by greedy sampling. A duplicate is redrawn up to `retries` times,
 * then that slot is given up, so the population may come out smaller (with a warning).
 * @param {Map<number, number>} weights
 * @param {{size: number, budget: number, pct?: number, rng: () => number, retries?: number}} options
 * @returns {{population: number[][], warning: string|null}}
 */
export function initialPopulation(weights, { size, budget, pct = 0, rng, retries = 20, sourceBuilds = [] }) {
  const seen = new Set();
  const population = [];
  const sources = [...sourceBuilds];
  for (let i = sources.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [sources[i], sources[j]] = [sources[j], sources[i]];
  }
  for (const source of sources) {
    if (population.length >= Math.floor(size / 2)) break;
    const groups = new Set();
    const selected = [];
    let spent = 0;
    for (const id of normalizeBuild(source)) {
      if (!weights.has(id) || groups.has(groupOf(id))) continue;
      const cost = skillCost(id, pct);
      if (spent + cost > budget) continue;
      selected.push(id);
      spent += cost;
      groups.add(groupOf(id));
    }
    if (!selected.length) continue;
    const build = greedyFill(selected, weights, { budget, pct, rng });
    const key = canonicalKey(build);
    if (!seen.has(key)) { seen.add(key); population.push(build); }
  }
  for (let i = population.length; i < size; i++) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const build = freshSample(weights, { budget, pct, rng });
      const key = canonicalKey(build);
      if (!seen.has(key)) {
        seen.add(key);
        population.push(build);
        break;
      }
    }
  }
  return { population, warning: warningFor(population.length, size) };
}

const warningFor = (actual, wanted) =>
  actual < wanted ? `Only ${actual} distinct builds could be generated (wanted ${wanted}).` : null;

// ---- tiers ----

let uppersByLower = null;
/** Ids of the upper tiers (gold over white, ◎ over ○) of a lower-tier id. */
function uppersOf(id) {
  if (!uppersByLower) {
    uppersByLower = new Map();
    for (const [key, value] of Object.entries(SKILL_DATA)) {
      if (value.lower) uppersByLower.set(value.lower, [...(uppersByLower.get(value.lower) ?? []), Number(key)]);
    }
  }
  return uppersByLower.get(Number(id)) ?? [];
}

// ---- operators ----

/** Default `rateFloor`: the epsilon in the removal weight 1 / (rateFloor + rate * p). */
export const DEFAULT_RATE_FLOOR = 0.05;

/** The p-weighted removal draw: one id out of `build`, weight 1 / (rateFloor + rate * p). */
function removeOne(build, rng, rateOf, pOf = () => 1, rateFloor = DEFAULT_RATE_FLOOR) {
  const i = pickWeighted(build, (id) => 1 / (rateFloor + rateOf(id) * pOf(id)), rng);
  return build.filter((_, j) => j !== i);
}

/** True if `low` is somewhere in `high`'s upgrade chain (any number of tiers down). */
function isBelow(low, high) {
  for (let id = data(high).lower; id; id = data(id).lower) if (id === low) return true;
  return false;
}

const rateGetter = (rates) => (id) => (rates && (rates.get ? rates.get(id) : rates[id])) ?? 0;

/**
 * Crossover of two builds: union (one per group, the upper tier wins), then while over budget
 * remove a skill with weight 1 / (0.05 + activationRate * p), then greedy refill.
 * @param {number[]} a
 * @param {number[]} b
 * @param {{weights: Map<number, number>, rates?: Map<number, number>, budget: number, pct?: number, rng: () => number, rateFloor?: number}} options
 *   `weights` is the current distribution p; `rates` maps skill id -> activation rate;
 *   `rateFloor` (default 0.05) is the epsilon of the removal weight.
 */
export function crossover(a, b, { weights, rates, budget, pct = 0, rng, rateFloor = DEFAULT_RATE_FLOOR }) {
  const byGroup = new Map();
  for (const id of [...a, ...b]) {
    const group = groupOf(id);
    const held = byGroup.get(group);
    if (held === undefined || held === id) {
      byGroup.set(group, id);
    } else if (isBelow(id, held)) {
      // keep the higher tier already held
    } else if (isBelow(held, id)) {
      byGroup.set(group, id);
    } else if (skillCost(id, pct) > skillCost(held, pct)) {
      byGroup.set(group, id);
    }
  }
  let build = [...byGroup.values()];
  const rateOf = rateGetter(rates);
  while (build.length && buildCost(build, pct) > budget) {
    build = removeOne(build, rng, rateOf, (id) => weights.get(id) ?? 0, rateFloor);
  }
  return greedyFill(normalizeBuild(build), weights, { budget, pct, rng });
}

/**
 * Drop 1-3 skills (rarely-firing first, weight 1 / (0.05 + rate)); with 25% chance also one
 * tier change (white -> its gold if affordable, or gold -> its white); then greedy refill.
 * Tier change targets must be keys of `weights`.
 * @param {number[]} build
 * Options `maxDrops` (3), `tierChangeProb` (0.25) and `rateFloor` (0.05) tune those numbers.
 * @param {{weights: Map<number, number>, rates?: Map<number, number>, budget: number, pct?: number, rng: () => number,
 *   maxDrops?: number, tierChangeProb?: number, rateFloor?: number}} options
 */
export function dropAndRefill(build, {
  weights, rates, budget, pct = 0, rng, maxDrops = 3, tierChangeProb = 0.25, rateFloor = DEFAULT_RATE_FLOOR,
}) {
  const rateOf = rateGetter(rates);
  let current = [...build];
  const drops = Math.min(current.length, 1 + Math.floor(rng() * maxDrops));
  for (let i = 0; i < drops; i++) current = removeOne(current, rng, rateOf, () => 1, rateFloor);
  if (rng() < tierChangeProb) current = tierChange(current, { weights, budget, pct, rng });
  return greedyFill(normalizeBuild(current), weights, { budget, pct, rng });
}

/** Replace one skill by its upper (if affordable) or lower tier; unchanged if none can change. */
function tierChange(build, { weights, budget, pct, rng }) {
  const spent = buildCost(build, pct);
  const moves = [];
  for (const id of build) {
    for (const upper of uppersOf(id)) {
      if (weights.has(upper) && spent - skillCost(id, pct) + skillCost(upper, pct) <= budget) moves.push([id, upper]);
    }
    const lower = data(id).lower;
    if (lower && weights.has(lower)) moves.push([id, lower]);
  }
  if (!moves.length) return build;
  const [from, to] = moves[Math.min(moves.length - 1, Math.floor(rng() * moves.length))];
  return build.map((id) => (id === from ? to : id));
}

/**
 * Cross-entropy update of the sampling distribution: p <- (1 - alpha) * p + alpha * f + floor,
 * where f is each skill's share of all skill slots in the elites (so f sums to 1), then the
 * result is normalized to sum to 1 (crossover's removal weights use p's absolute scale).
 * @param {Map<number, number>} p current distribution (normalized prior at the start)
 * @param {number[][]} elites builds
 * @param {number} [alpha]
 * @param {number} [floor] default `floorNumerator` / number of skills
 * @param {number} [floorNumerator] default 0.02
 * @returns {Map<number, number>}
 */
export function updateDistribution(p, elites, alpha = 0.3, floor = undefined, floorNumerator = 0.02) {
  floor ??= floorNumerator / p.size;
  const next = new Map();
  const slots = elites.reduce((n, build) => n + build.length, 0);
  for (const [id, value] of p) {
    const f = slots ? elites.filter((build) => build.includes(id)).length / slots : 0;
    next.set(id, (1 - alpha) * value + alpha * f + floor);
  }
  const total = [...next.values()].reduce((a, b) => a + b, 0) || 1;
  for (const [id, value] of next) next.set(id, value / total);
  return next;
}

/**
 * The next population: the elites unchanged, then offspring that are distinct from each other
 * and the elites: by default 40% crossover, 30% elite mutations, 10% non-elite mutations,
 * and 20% fresh samples from `freshWeights`. An empty diversity pool falls back to fresh samples.
 * Each offspring gets `retries` redraws if it duplicates; if it still does the population ends
 * up smaller and a warning is returned.
 * @param {{
 *   elites: {build: number[], rates?: Map<number, number>}[], size: number, p: Map<number, number>,
 *   budget: number, pct?: number, rng: () => number, retries?: number,
 * }} args elites in rank order, best first
 * @returns {{builds: number[][], warning: string|null}}
 */
export function nextGeneration({
  elites, diversityParents = [], size, p, freshWeights = p, budget, pct = 0, rng, retries = 20,
  crossShare = 0.4, dropShare = 0.3, diversityShare = 0.1, tournamentSize = 2,
  maxDrops = 3, tierChangeProb = 0.25, rateFloor = DEFAULT_RATE_FLOOR,
}) {
  if (!(crossShare >= 0 && dropShare >= 0 && diversityShare >= 0 && crossShare + dropShare + diversityShare <= 1 + 1e-12)) {
    throw new RangeError('offspring shares must be >= 0 and sum to at most 1');
  }
  const builds = elites.map((e) => e.build);
  const seen = new Set(builds.map(canonicalKey));
  const need = Math.max(0, size - builds.length);
  const crossCount = Math.round(crossShare * need);
  const dropCount = Math.min(need - crossCount, Math.round(dropShare * need));
  const diversityCount = Math.min(need - crossCount - dropCount, Math.round(diversityShare * need));
  const options = { weights: p, budget, pct, rng, maxDrops, tierChangeProb, rateFloor };
  const tournament = () => {
    let best = Infinity;
    for (let k = 0; k < tournamentSize; k++) best = Math.min(best, Math.floor(rng() * elites.length));
    return elites[best];
  };
  const make = (kind) => {
    if (kind === 'cross' && elites.length) {
      const [x, y] = [tournament(), tournament()];
      const rates = new Map([...(y.rates ?? []), ...(x.rates ?? [])]);
      return crossover(x.build, y.build, { ...options, rates });
    }
    if (kind === 'drop' && elites.length) {
      const parent = elites[Math.floor(rng() * elites.length)];
      return dropAndRefill(parent.build, { ...options, rates: parent.rates });
    }
    if (kind === 'diversity' && diversityParents.length) {
      const parent = diversityParents[Math.floor(rng() * diversityParents.length)];
      return dropAndRefill(parent.build, { ...options, rates: parent.rates });
    }
    return freshSample(freshWeights, { budget, pct, rng });
  };
  for (let n = 0; n < need; n++) {
    const kind = n < crossCount ? 'cross' : n < crossCount + dropCount ? 'drop'
      : n < crossCount + dropCount + diversityCount ? 'diversity' : 'fresh';
    for (let attempt = 0; attempt <= retries; attempt++) {
      const build = make(kind);
      const key = canonicalKey(build);
      if (!seen.has(key)) {
        seen.add(key);
        builds.push(build);
        break;
      }
    }
  }
  return { builds, warning: warningFor(builds.length, size) };
}

// ---- stopping ----

/**
 * The two-sided normal critical value for a confidence level in (0, 1): 0.95 gives exactly the
 * 1.959963984540054 the compare page uses; other levels use Acklam's inverse-normal approximation.
 */
export function zForConfidence(confidence = 0.95) {
  if (!(confidence > 0 && confidence < 1)) throw new RangeError('confidence must be between 0 and 1');
  if (confidence === 0.95) return 1.959963984540054;
  const tail = (1 - confidence) / 2; // upper-tail probability, computed without rounding q to 1
  const q = 1 - tail;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  if (tail < 0.02425) {
    const r = Math.sqrt(-2 * Math.log(tail));
    return -(((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1);
  }
  const r = (q - 0.5) ** 2;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * (q - 0.5)
    / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Whether a smaller value of the metric is better (only the average place). */
export function lowerIsBetter(metric) {
  if (metric === 'place') return true;
  if (metric === 'teamWin' || metric === 'umaWin') return false;
  throw new RangeError(`Unknown metric: ${metric}`);
}

/**
 * Whether the current best significantly beats the previous best, both scored on the same
 * (current) trials. d = current - previous per trial; `pairedDifferenceCi` gives [mean, half].
 * Place (lower is better): significant if the CI upper bound < 0; win rates: lower bound > 0.
 * @param {number[]} currentScores per-trial values (place, or 0/1 wins)
 * @param {number[]} previousScores
 * @param {'place'|'teamWin'|'umaWin'} metric
 * @param {number} [confidence] two-sided confidence level of the interval (default 0.95)
 */
export function significantImprovement(currentScores, previousScores, metric, confidence = 0.95) {
  const lower = lowerIsBetter(metric);
  const [mean, half] = pairedDifferenceCi(currentScores.map((v, i) => v - previousScores[i]), zForConfidence(confidence));
  return lower ? mean + half < 0 : mean - half > 0;
}

// ---- runner JSON ----

/**
 * The runner JSON of the uma with a set of bought skills. The unique is only emitted when it
 * is a real catalog skill (never an undefined one).
 * @param {{base: object, unique?: number|string|null, uniqueLevel?: number, skills?: Iterable<number|string>}} args
 */
export function runnerJson({ base, unique = null, uniqueLevel = 4, skills = [] }) {
  const uniqueId = unique === null || unique === undefined ? NaN : Number(unique);
  return {
    ...base,
    skills: [
      ...(isSkill(uniqueId) ? [{ skillId: String(uniqueId), level: uniqueLevel, isUnique: true }] : []),
      ...[...skills].map((id) => ({ skillId: String(id), level: 1, isUnique: false })),
    ],
  };
}
