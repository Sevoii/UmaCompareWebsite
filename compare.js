// Port of UmaSim src/compare_teams.py: compare two teams on identical races against
// random opponents from a team pool.
//
// Each trial draws a random race seed, 2 random opponent teams, and a random gate
// permutation. The same seed, opponents, and gates are then used for team A and team B,
// so the only difference between the two races is which team is being tested: the
// runner in team slot k gets the same gate in both races.
import {
  ChampionsMeeting, PreparedRace, RaceBuilder, Strategy, UmaBuilder, championsMeetingLabel, nameOf, umaLabel,
} from './globalsim/index.js';

export const MOOD = 2; // Champions Meeting runners are at Great mood
const SKILL_LINE = /^ {4}.* {2}#(\d+)\s+Lv\d/; // a skill row in UmaBuilder's summary
export const TEAM_SIZE = 3;
export const FIELD_SIZE = 9;
export const SEED_MAX = 2 ** 31 - 1; // the retail runtime requires signed 32-bit seeds
export const CONFIDENCE = 0.95;
const Z = 1.959963984540054; // NormalDist().inv_cdf(0.5 + 0.95 / 2)
const LEVEL = `${Math.round(CONFIDENCE * 100)}% CI`;

// Champions Meeting names in Global release order (UmaSim src/cm_names.py).
export const CM_NAMES = [
  'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio',
  'sagittarius', 'capricorn', 'aquarius', 'pisces', 'aries',
  'taurus 2', 'gemini 2', 'cancer 2', 'leo 2', 'virgo 2', 'libra 2',
  'scorpio 2', 'sagittarius 2', 'capricorn 2', 'aquarius 2',
];

/** The ChampionsMeeting preset for a 1-based meeting number. */
export function cmFromNumber(number) {
  const [name, round] = CM_NAMES[number - 1].split(' ');
  const cm = ChampionsMeeting[`${name.toUpperCase()}_CUP${round ? `_${round}` : ''}`];
  if (cm === undefined) throw new Error(`Unknown meeting number ${number}`);
  return cm;
}

export const cmLabel = (cm) => championsMeetingLabel(cm);

const titleCase = (name) => name.toLowerCase().split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const strategyName = (strategy) => titleCase(nameOf(Strategy, strategy) ?? String(strategy));

/** A team from a file: {"id": ..., "members": [...]} or a list of 3 runners. */
export function loadTeam(data, fileStem) {
  const team = Array.isArray(data) ? { id: fileStem, members: data } : { ...data };
  if (!Array.isArray(team.members) || team.members.length !== TEAM_SIZE) {
    throw new Error(`a team needs exactly ${TEAM_SIZE} members`);
  }
  team.id ??= fileStem;
  // Validate now rather than on the first trial.
  team.members.forEach((member, i) => {
    try {
      UmaBuilder.fromJson(member);
    } catch (error) {
      throw new Error(`member ${i + 1}: ${error.message}`);
    }
  });
  return team;
}

export function teamLabel(team) {
  return team.members.map((m) => `${umaLabel(m.charaId)} (${strategyName(m.strategy)})`).join(', ');
}

/**
 * Metres each runner is behind the line when the winner crosses it.
 *
 * Frames are sampled every 1/15 s, so the winner's exact finish time falls between
 * two frames. Take the last frame at or before it and advance every runner from
 * there by speed * (finish time - frame time).
 */
export function distancesFromTop(replay, courseDistance) {
  const winnerTime = Math.min(...replay.metadata.results.map((r) => r.finishTimeRaw));
  let index = replay.count - 1;
  while (index > 0 && replay.frame(index)[0] > winnerTime) index--;
  const [frameTime, values] = replay.frame(index);
  const dt = winnerTime - frameTime;
  const gaps = [];
  for (let i = 0; i < replay.horseCount; i++) {
    const position = values[6 * i];
    const speed = values[6 * i + 1];
    gaps.push(Math.max(0, courseDistance - (position + speed * dt)));
  }
  return gaps;
}

/** Seconds each runner finished after the winner (exact, unrounded finish times). */
export function timeGaps(results) {
  const winnerTime = Math.min(...results.map((r) => r.finishTimeRaw));
  return results.map((r) => r.finishTimeRaw - winnerTime);
}

/** Per runner, the skill IDs (as strings) that activated at least once. */
function activatedSkills(metadata, horseCount) {
  const activated = Array.from({ length: horseCount }, () => new Set());
  for (const event of metadata.skillEvents) {
    const skillId = event.skillId;
    if (typeof skillId === 'string' && !/^\d+$/.test(skillId)) continue; // non-skill events such as "kakari"
    activated[event.horseIndex].add(String(Math.trunc(Number(skillId))));
  }
  return activated;
}

/**
 * Race the tested team (slots 0-2) against the opponents (slots 3-8). Returns the tested
 * team's finish orders (0 = 1st), metres and seconds behind the winner, and activated skills.
 */
async function runTrial(cm, tested, opponents, seed, gates) {
  const race = RaceBuilder.championsMeeting(cm).seed(seed);
  let slot = 0;
  [tested, ...opponents].forEach((team, t) => {
    for (const member of team.members) {
      race.runner(UmaBuilder.fromJson({ ...member, teamId: t + 1, gateIndex: gates[slot] }).mood(MOOD));
      slot++;
    }
  });
  const request = { ...race.build(), retainAllFrames: true };
  const prepared = await PreparedRace.create(request);
  let replay;
  try {
    replay = prepared.run(seed);
  } finally {
    prepared.close();
  }
  if ('error' in replay.metadata) throw new Error(`GlobalSim error: ${replay.metadata.error}`);
  const results = replay.metadata.results;
  const skills = activatedSkills(replay.metadata, results.length);
  return {
    orders: results.slice(0, TEAM_SIZE).map((r) => r.finishOrder),
    distances: distancesFromTop(replay, race.course.distance).slice(0, TEAM_SIZE),
    times: timeGaps(results).slice(0, TEAM_SIZE),
    skills: skills.slice(0, TEAM_SIZE).map((set) => [...set]),
  };
}

/** One trial for both tested teams with the same seed, opponents and gates. */
export async function runPairedTrial({ cm, teamA, teamB, pool }, [seed, opponentIndices, gates]) {
  const opponents = opponentIndices.map((i) => pool[i]);
  return [await runTrial(cm, teamA, opponents, seed, gates), await runTrial(cm, teamB, opponents, seed, gates)];
}

// Trial generation: Python's random.Random equivalents over a uniform [0, 1) source.
const randInt = (random, low, high) => low + Math.floor(random() * (high - low + 1));
function sample(random, n, k) {
  const items = Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(random() * (n - i));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items.slice(0, k);
}

/** Draw every trial up front: [seed, opponent indices, gates]. */
export function drawTrials(count, poolSize, random = Math.random) {
  return Array.from({ length: count }, () => [
    randInt(random, 0, SEED_MAX), sample(random, poolSize, 2), sample(random, FIELD_SIZE, FIELD_SIZE),
  ]);
}

// Statistics.
const fmean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
function stdev(values) {
  const mean = fmean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1));
}

/** (mean, half-width) of a normal-approximation confidence interval. */
function meanCi(values) {
  if (values.length < 2) return [fmean(values), Infinity];
  return [fmean(values), Z * stdev(values) / Math.sqrt(values.length)];
}

/**
 * (mean, half-width) for per-trial differences in {-1, 0, +1}. The plain normal interval
 * has zero width when every difference is equal (e.g. neither team ever wins), so the
 * half-width adds one +1 and one -1 pseudo-observation.
 */
function pairedDifferenceCi(differences) {
  return [fmean(differences), Z * stdev([...differences, 1, -1]) / Math.sqrt(differences.length)];
}

/** Wilson score interval for a proportion. */
function wilsonCi(successes, n) {
  const p = successes / n;
  const centre = (p + Z * Z / (2 * n)) / (1 + Z * Z / n);
  const half = Z * Math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n)) / (1 + Z * Z / n);
  return [centre - half, centre + half];
}

export class Tally {
  constructor(team, name) {
    this.team = team;
    this.name = name;
    this.wins = []; // 1 if a team member finished 1st, per trial
    this.winCount = 0;
    this.places = Array.from({ length: TEAM_SIZE }, () => []); // 1 = 1st
    this.distances = Array.from({ length: TEAM_SIZE }, () => []);
    this.times = Array.from({ length: TEAM_SIZE }, () => []);
    this.skillProcs = Array.from({ length: TEAM_SIZE }, () => new Map()); // races each skill activated in
  }

  add({ orders, distances, times, skills }) {
    const win = Math.min(...orders) === 0 ? 1 : 0;
    this.wins.push(win);
    this.winCount += win;
    for (let k = 0; k < TEAM_SIZE; k++) {
      this.places[k].push(orders[k] + 1);
      this.distances[k].push(distances[k]);
      this.times[k].push(times[k]);
      for (const id of skills[k]) this.skillProcs[k].set(id, (this.skillProcs[k].get(id) ?? 0) + 1);
    }
  }
}

// Output, matching the Python script's text.

/**
 * x.toFixed(digits), but rounding exact ties to even like Python's format() (5.625 -> "5.62";
 * toFixed gives "5.63"). The 25 extra digits are exact for any tie a double can hold.
 */
function fixed(x, digits) {
  const rounded = x.toFixed(digits);
  if (!Number.isFinite(x)) return rounded;
  const extended = Math.abs(x).toFixed(Math.min(100, digits + 25));
  if (!/^50*$/.test(extended.slice(-25)) || Number(rounded.at(-1)) % 2 === 0) return rounded;
  const truncated = extended.slice(0, -25).replace(/\.$/, '');
  return (x < 0 ? '-' : '') + truncated;
}

const percent = (x) => `${fixed(x * 100, 1)}%`;
const signedPercent = (x) => (x < 0 || Object.is(x, -0) ? '-' : '+') + percent(Math.abs(x));

function statLine(tally, k) {
  const [place, placeHalf] = meanCi(tally.places[k]);
  const [metres, metresHalf] = meanCi(tally.distances[k]);
  const [secs, secsHalf] = meanCi(tally.times[k]);
  return `avg place ${fixed(place, 2)} ± ${fixed(placeHalf, 2)}   avg from top ${fixed(metres, 2)} ± `
    + `${fixed(metresHalf, 2)} m   ${fixed(secs, 2)} ± ${fixed(secsHalf, 2)} s`;
}

function winRateLine(tally, n) {
  const [low, high] = wilsonCi(tally.winCount, n);
  return `Team win rate  ${percent(tally.winCount / n)}  (${LEVEL} ${percent(low)} to ${percent(high)})`;
}

/** Append each skill's proc rate (% of races it activated in) to the UmaBuilder summary. */
function withProcRates(summary, procs, n) {
  const lines = summary.split('\n');
  const skillLines = lines.flatMap((line, i) => SKILL_LINE.test(line) ? [i] : []);
  if (skillLines.length) {
    const width = Math.max(...skillLines.map((i) => lines[i].length));
    for (const i of skillLines) {
      const skillId = SKILL_LINE.exec(lines[i])[1];
      lines[i] = `${lines[i].padEnd(width)}  ${percent((procs.get(skillId) ?? 0) / n).padStart(6)} procs`;
    }
  }
  return lines.join('\n');
}

function printFull(out, name, tally, n) {
  out.push('='.repeat(72), `${name}: ${tally.name}  (${teamLabel(tally.team)})`, winRateLine(tally, n), '='.repeat(72));
  tally.team.members.forEach((member, k) => {
    out.push('', withProcRates(String(UmaBuilder.fromJson(member).mood(MOOD)), tally.skillProcs[k], n));
    out.push(`  ${'Results'.padEnd(10)} ${statLine(tally, k)}`);
  });
  out.push('');
}

function printCompact(out, name, tally, n) {
  out.push(`${name}: ${tally.name}`, `  ${winRateLine(tally, n)}`);
  tally.team.members.forEach((member, k) => {
    const label = `${umaLabel(member.charaId)} (${strategyName(member.strategy)})`;
    out.push(`    ${label.padEnd(32)} ${statLine(tally, k)}`);
  });
  out.push('');
}

/** The comparison report for finished tallies. */
export function report({ cm, n, poolSize, tallyA, tallyB, compact }) {
  const out = ['', `${cmLabel(cm)}: ${n} trials against ${poolSize} possible opponent teams (${LEVEL})`, ''];
  for (const [name, tally] of [['A', tallyA], ['B', tallyB]]) (compact ? printCompact : printFull)(out, name, tally, n);
  // Both teams race the same seeds, opponents and gates, so compare them per trial.
  const [difference, half] = pairedDifferenceCi(tallyA.wins.map((a, i) => a - tallyB.wins[i]));
  out.push(`Team win % difference (${tallyA.name} - ${tallyB.name}): ${signedPercent(difference)}  `
    + `(${LEVEL} ${signedPercent(difference - half)} to ${signedPercent(difference + half)})`);
  return out.join('\n');
}
