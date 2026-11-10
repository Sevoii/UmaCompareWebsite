// Per-trial evaluation and scoring for the skill optimizer. Pure apart from the engine call in
// `evaluateTrial`, so the worker is a thin wrapper and Node tests can call it directly.
import { drawTrials, meanCi, runTrial, wilsonCi } from './compare.js';

/**
 * Check an evaluation context before any trial is drawn or raced: there must be at least one
 * teammate pair, at least 2 opponent teams, and a slot of 0..2. Throws with an actionable message.
 * @param {{race: object, pool: object[], teammates: object[][], slot: number}} context
 */
export function validateContext({ race, pool, teammates, slot }) {
  if (!race || race.courseId == null) throw new Error('No race conditions selected');
  if (!Array.isArray(pool) || pool.length < 2) {
    throw new Error('The opponent pool needs at least 2 teams');
  }
  if (!Array.isArray(teammates) || !teammates.length) {
    throw new Error('No usable teammates: no hakuraku team of this archetype could be converted');
  }
  if (!teammates.every((pair) => Array.isArray(pair) && pair.length === 2)) {
    throw new Error('Each teammate entry must be a pair of runners');
  }
  if (!Number.isInteger(slot) || slot < 0 || slot > 2) throw new Error(`Invalid team slot ${slot}`);
}

/**
 * Race every candidate on one trial. Our team is the teammate pair `teammates[teammateIndex]`
 * with the candidate inserted at `slot` (the archetype slot index, not the replaced member's
 * position in hakuraku's listing; every trial draws a random gate permutation, so the order
 * within the team doesn't bias anything); the opponents are `pool[i]` for `opponentIndices`.
 * @param {{race: object, pool: object[], teammates: object[][], slot: number}} context
 * @param {object[]} candidates runner JSON
 * @param {{seed: number, opponentIndices: number[], gates: number[], teammateIndex: number}} trial
 * @returns {Promise<{place: number, teamWin: boolean, umaWin: boolean, skills: string[]}[]>} one per candidate
 */
export async function evaluateTrial({ race, pool, teammates, slot }, candidates, trial) {
  const opponents = trial.opponentIndices.map((i) => pool[i]);
  const pair = teammates[trial.teammateIndex];
  const out = [];
  for (const candidate of candidates) {
    const members = [...pair];
    members.splice(slot, 0, candidate);
    const result = await runTrial(race, { members }, opponents, trial.seed, trial.gates);
    out.push({
      place: result.orders[slot] + 1,
      teamWin: Math.min(...result.orders) === 0,
      umaWin: result.orders[slot] === 0,
      skills: result.skills[slot],
    });
  }
  return out;
}

/**
 * Draw `n` trials as { seed, opponentIndices, gates, teammateIndex }. Seeds, opponents and gates
 * come from compare.js's `drawTrials`, fed with `rng` (a [0, 1) source such as mulberry32;
 * default Math.random), then one teammate team index per trial from the same `rng`.
 */
export function drawOptimizerTrials(n, poolSize, teammateCount, rng = Math.random) {
  if (poolSize < 2) throw new Error('The opponent pool needs at least 2 teams');
  if (teammateCount < 1) throw new Error('No usable teammates for this archetype');
  return drawTrials(n, poolSize, rng).map(([seed, opponentIndices, gates]) => ({
    seed, opponentIndices, gates, teammateIndex: Math.floor(rng() * teammateCount),
  }));
}

/**
 * Score candidates from worker results (`results[t][c]`, chunks merged in trial order).
 * Per candidate: `scores` (per trial: place, or 0/1 for the win metrics), `mean`, `low`/`high`
 * (95% CI: normal for place, Wilson for win rates) and `rates`, a Map skill id (number) ->
 * share of trials in which the uma activated it.
 * @param {object[][]} results
 * @param {'place'|'teamWin'|'umaWin'} metric
 */
export function scoreCandidates(results, metric) {
  if (!['place', 'teamWin', 'umaWin'].includes(metric)) throw new RangeError(`Unknown metric: ${metric}`);
  const n = results.length;
  const count = n ? results[0].length : 0;
  return Array.from({ length: count }, (_, c) => {
    const scores = results.map((trial) => (metric === 'place' ? trial[c].place : trial[c][metric] ? 1 : 0));
    const counts = new Map();
    for (const trial of results) {
      for (const id of new Set(trial[c].skills)) counts.set(Number(id), (counts.get(Number(id)) ?? 0) + 1);
    }
    const rates = new Map([...counts].map(([id, k]) => [id, k / n]));
    let mean, low, high;
    if (metric === 'place') {
      let half;
      [mean, half] = meanCi(scores);
      [low, high] = [mean - half, mean + half];
    } else {
      const wins = scores.reduce((a, b) => a + b, 0);
      mean = wins / n;
      [low, high] = wilsonCi(wins, n);
    }
    return { scores, mean, low, high, rates };
  });
}
