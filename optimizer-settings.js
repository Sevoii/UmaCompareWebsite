// Settings of the optimizer page as data: the basic search settings and the "Advanced" tuning
// knobs (every numeric constant on the search path), their defaults, and validation. DOM-free so
// Node tests can check the defaults and the messages. The defaults reproduce the spec's behaviour.

/**
 * Basic settings: { id (form element), key (settings name), label, def, int, min, max }.
 * `max` omitted = unbounded; `exclusiveMin` makes `min` exclusive.
 */
export const BASIC = [
  { id: 'budget', key: 'budget', label: 'SP budget', def: 3000, int: true, min: 0 },
  { id: 'discount', key: 'pct', label: 'Hint discount %', def: 0, min: 0, max: 40 },
  { id: 'population', key: 'population', label: 'Population', def: 64, int: true, min: 2 },
  { id: 'trials', key: 'trials', label: 'Trials per build', def: 200, int: true, min: 2 },
  { id: 'generations', key: 'maxGenerations', label: 'Max generations', def: 12, int: true, min: 1 },
  { id: 'elite', key: 'eliteFraction', label: 'Elite fraction', def: 0.2, min: 0, max: 1, exclusive: true },
];

/** Advanced settings (same shape, plus `hint` shown under the field). Blank-able ones have `blank: true`. */
export const ADVANCED = [
  { id: 'staleLimit', key: 'staleLimit', label: 'Stale generations to stop', def: 2, int: true, min: 1,
    hint: 'Stop after this many consecutive generations without a significant improvement.' },
  { id: 'confidence', key: 'confidence', label: 'Improvement confidence', def: 0.95, min: 0, max: 1, exclusive: true,
    hint: 'Two-sided confidence level of the paired test deciding "significantly better".' },
  { id: 'minPartial', key: 'minPartialTrials', label: 'Min trials to score a cut generation', def: 2, int: true, min: 2,
    hint: 'After Stop, a generation is scored only if at least this many trials finished.' },
  { id: 'alpha', key: 'alpha', label: 'Distribution update rate (alpha)', def: 0.3, min: 0, max: 1,
    hint: 'p becomes (1 - alpha) * p + alpha * elite share each generation.' },
  { id: 'floorNumerator', key: 'floorNumerator', label: 'Probability floor numerator', def: 0.02, min: 0,
    hint: 'Each skill gets at least this / eligible-skill-count added to its probability.' },
  { id: 'crossShare', key: 'crossShare', label: 'Crossover share', def: 0.4, min: 0, max: 1,
    hint: 'Share of new builds made by crossover of two elites.' },
  { id: 'dropShare', key: 'dropShare', label: 'Drop-and-refill share', def: 0.3, min: 0, max: 1,
    hint: 'Share made by dropping skills from one elite and refilling.' },
  { id: 'diversityShare', key: 'diversityShare', label: 'Diversity mutation share', def: 0.1, min: 0, max: 1,
    hint: 'Share mutated from the best non-elite builds. The remaining share is sampled from the original prior.' },
  { id: 'diversityBand', key: 'diversityBand', label: 'Non-elite rank band', def: 0.2, min: 0.001, max: 1,
    hint: 'Fraction of the non-elite population eligible as diversity parents, starting with the best.' },
  { id: 'tournament', key: 'tournamentSize', label: 'Tournament size', def: 2, int: true, min: 1,
    hint: 'Elites compared when picking a crossover parent.' },
  { id: 'maxDrops', key: 'maxDrops', label: 'Max skills dropped', def: 3, int: true, min: 1,
    hint: 'Drop-and-refill removes between 1 and this many skills.' },
  { id: 'tierProb', key: 'tierChangeProb', label: 'Tier change probability', def: 0.25, min: 0, max: 1,
    hint: 'Chance drop-and-refill also swaps one skill for its upper or lower tier.' },
  { id: 'rateFloor', key: 'rateFloor', label: 'Removal weight epsilon', def: 0.05, min: 0, exclusive: true,
    hint: 'Skills are removed with weight 1 / (epsilon + activation rate).' },
  { id: 'retries', key: 'retries', label: 'Offspring retries', def: 20, int: true, min: 0,
    hint: 'Redraws of a duplicate offspring before the population is allowed to shrink.' },
  { id: 'initialRetries', key: 'initialRetries', label: 'Initial population retries', def: 20, int: true, min: 0,
    hint: 'Redraws of a duplicate initial build before giving up on that slot.' },
  { id: 'uniqueFallback', key: 'uniqueFallback', label: 'Unique level fallback', def: 4, int: true, min: 1, max: 6,
    hint: 'Used only when the uma has no unique skill level of its own.' },
  { id: 'maxTeams', key: 'maxTeams', label: 'Hakuraku teams to fetch', def: 300, int: true, min: 1,
    hint: 'Teammate teams fetched for the archetype (100 per request).' },
  { id: 'smoothing', key: 'smoothing', label: 'Prior smoothing', def: 5, min: 0, exclusive: true,
    hint: 'Added to every skill usage count, so skills nobody uses can still be sampled.' },
  { id: 'buildsShown', key: 'buildsShown', label: 'Builds shown (best + runner-ups)', def: 5, int: true, min: 1 },
  { id: 'maxChunk', key: 'maxChunk', label: 'Max trials per worker message', def: 10, int: true, min: 1,
    hint: 'Smaller chunks balance load and lose less on Stop; larger ones cost less overhead.' },
  { id: 'perWorker', key: 'perWorker', label: 'Chunks per worker (target)', def: 4, int: true, min: 1 },
  { id: 'workers', key: 'workers', label: 'Workers', def: '', int: true, min: 1, blank: true,
    hint: 'Blank = logical processors - 1 (at least 1).' },
  { id: 'seed', key: 'seed', label: 'Random seed', def: '', int: true, min: 0, max: 4294967295, blank: true,
    hint: 'Blank = random. A whole number from 0 to 4294967295 (32-bit) makes the search and the trials reproducible.' },
];

const rangeText = ({ int, min, max, exclusive }) => {
  const lo = min === undefined ? null : exclusive ? `greater than ${min}` : `at least ${min}`;
  const hi = max === undefined ? null : exclusive ? `less than ${max}` : `at most ${max}`;
  return `${int ? 'a whole number' : 'a number'}${[lo, hi].filter(Boolean).length ? ` ${[lo, hi].filter(Boolean).join(' and ')}` : ''}`;
};

/** HTML of one advanced field (a column in a row of the Advanced section). */
export function advancedField(def) {
  const step = def.int ? 1 : 'any';
  const min = def.min !== undefined && !def.exclusive ? ` min="${def.min}"` : '';
  const max = def.max !== undefined && !def.exclusive ? ` max="${def.max}"` : '';
  return `<div class="col-6 col-md-4"><label class="form-label" for="${def.id}">${def.label}</label>`
    + `<input class="form-control" type="number" id="${def.id}" value="${def.def}" step="${step}"${min}${max}`
    + `${def.blank ? ' placeholder="auto"' : ''}>${def.hint ? `<div class="form-text">${def.hint}</div>` : ''}</div>`;
}

/**
 * Read and validate every setting.
 * @param {(id: string) => string} read the raw text of a form field by id
 * @returns {object} settings by key (blank-able fields are null when blank), plus `metric`
 */
export function parseSettings(read) {
  const out = { metric: read('metric') };
  if (!['place', 'teamWin', 'umaWin'].includes(out.metric)) throw new Error('Unknown score.');
  for (const def of [...BASIC, ...ADVANCED]) {
    const raw = String(read(def.id) ?? '').trim();
    if (def.blank && raw === '') { out[def.key] = null; continue; }
    const value = Number(raw);
    const bad = raw === '' || !Number.isFinite(value) || (def.int && !Number.isInteger(value))
      || (def.min !== undefined && (def.exclusive ? value <= def.min : value < def.min))
      || (def.max !== undefined && (def.exclusive ? value >= def.max : value > def.max));
    if (bad) throw new Error(`${def.label} must be ${rangeText(def)}.`);
    out[def.key] = value;
  }
  if (out.crossShare + out.dropShare + out.diversityShare > 1 + 1e-12) throw new Error('Offspring shares must add up to at most 1.');
  if (out.minPartialTrials > out.trials) throw new Error('Min trials to score a cut generation cannot exceed the trials per build.');
  return out;
}
