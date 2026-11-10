// Skill optimizer page: form, data loading, orchestration and rendering. The search itself lives
// in optimizer-run.js / optimizer-core.js (DOM-free, tested); this file wires it to optimizer.html.
import { Course, isSkill, skillIsInherited, skillLabel } from './globalsim/index.js';
import { SKILL_DATA } from './skill-data.js';
import { raceLabel } from './compare.js';
import { createRaceControls } from './race-controls.js';
import { Roster } from './roster.js';
import { createUmaInlineEditor, newUmaDraft, skillIconUrl } from './uma-editor.js';
import { escapeHtml, memberInfo, outfitOf, umaChipBody, uniqueForOutfit } from './team-picker.js';
import {
  archetypeOptions, fetchArchetypeTeams, loadManifest, loadPool, loadPoolIndex, loadSnapshotData,
  snapshotForMeeting, snapshotsNewestFirst, teammatesFromTeams,
} from './optimizer-data.js';
import {
  eligibleSkills, isGold, isPossible, ownGolds, priorTable, priorWeights, raceContext, runnerJson, skillCost,
} from './optimizer-core.js';
import { drawOptimizerTrials } from './optimizer-eval.js';
import { ADVANCED, advancedField, parseSettings } from './optimizer-settings.js';
import { StoppedError, WorkerPool, makeRngs, runOptimization } from './optimizer-run.js';

const STORAGE_KEY = 'umacompare:optimizer';
const $ = (id) => document.getElementById(id);
const FIELDS = ['budget', 'discount', 'metric', 'population', 'trials', 'generations', 'elite', ...ADVANCED.map((a) => a.id)];
$('advancedFields').innerHTML = ADVANCED.map(advancedField).join('');
const STYLE_NUMBER = { Nige: 1, Senkou: 2, Sasi: 3, Oikomi: 4, Oonige: 5 };
const ROLE_NAMES = { 1: 'Front', 2: 'Pace', 3: 'Late', 4: 'End', 5: 'Runaway', 6: 'Debuffer' };
const METRIC_NAMES = { place: 'Average place', teamWin: 'Team win rate', umaWin: 'Uma win rate' };

const roster = Roster.load();
const output = $('output');
const optimizeButton = $('optimize');
const stopButton = $('stop');

let uma = null; // valid runner JSON of the uma being edited, or null
let inherited = []; // inherited unique skill ids (numbers) the uma has
let manifest = null;
let snapshot = null; // the manifest entry in use
let snapshotData = null; // { usage, summary }
let archetypes = [];
let poolIndex = [];
let poolChosenByUser = false;
let snapshotToken = 0;
let snapshotLoading = false;
let running = null; // { pool, signal } while a search runs
let lastRun = null; // for the save / export buttons
let resumeSession = null; // in-memory checkpoint and frozen inputs
let saved = readSaved();
let userGolds = []; // gold skill ids (numbers) the user added; the uma's own golds are implicit
let blacklist = [];
let umaEditor = null; // created below; the race controls fire onChange before that
let restoring = true; // no persisting until start() has restored the saved form, or it would be overwritten

// ---- persistence ----
function readSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}; } catch { return {}; }
}

function persist() {
  if (restoring) return;
  try {
    const form = Object.fromEntries(FIELDS.map((f) => [f, $(f).value]));
    // While the archetype / slot / snapshot lists are still loading their selects are empty: keep the
    // saved choice rather than replacing it with a blank.
    saved = {
      form, uma: umaDraft, inherited, golds: userGolds, blacklist, race: races.currentRace(),
      archetype: $('archetype').value || saved.archetype, slot: $('archetype').value ? $('slot').value : saved.slot,
      pool: $('pool').value || saved.pool, snapshot: $('snapshot').value || saved.snapshot,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch { /* storage unavailable: the form just isn't remembered */ }
}

// ---- race, pool, snapshot ----
const races = createRaceControls({ onChange: () => { onRaceChange(); } });
const meetingNumber = () => Number($('racePreset').value) || null;

function showPoolWarning() {
  const box = $('poolWarning');
  const entry = poolIndex.find((e) => e.file === $('pool').value);
  const meeting = meetingNumber();
  let text = '';
  if (entry && !meeting) text = 'The race is custom, so the pool may not match it. Results are only as representative as the pool.';
  else if (entry && entry.cm && entry.cm !== meeting) text = `This pool is from CM${entry.cm} but the race is CM${meeting}. The opponents may not represent this meeting.`;
  else if (entry && !entry.cm) text = 'This pool is not tied to a meeting, so it may not match the race.';
  box.textContent = text;
  box.hidden = !text;
}

function onRaceChange() {
  umaEditor?.setCourse(races.currentCourse());
  if (!poolIndex.length) return;
  const meeting = meetingNumber();
  if (!poolChosenByUser && meeting) {
    const match = poolIndex.find((e) => e.cm === meeting);
    if (match) $('pool').value = match.file;
  }
  showPoolWarning();
  refreshSnapshot();
  persist();
}

function showError(message) {
  output.innerHTML = message ? `<div class="alert alert-danger uc-opt-error" role="alert">${escapeHtml(message)}</div>` : '';
}

/** Pick the hakuraku snapshot for the race and fill the archetype list. */
async function refreshSnapshot() {
  const token = ++snapshotToken;
  const meeting = meetingNumber();
  $('snapshotRow').hidden = Boolean(meeting);
  snapshot = null;
  snapshotData = null;
  snapshotLoading = true;
  updateOptimizeEnabled();
  try {
    manifest ??= await loadManifest();
    if (token !== snapshotToken) return;
    const all = snapshotsNewestFirst(manifest);
    if (!$('snapshot').options.length) {
      for (const s of all) $('snapshot').add(new Option(s.label ?? s.snapshotId, s.snapshotId));
      if (saved.snapshot && all.some((s) => s.snapshotId === saved.snapshot)) $('snapshot').value = saved.snapshot;
    }
    const chosen = meeting ? snapshotForMeeting(manifest, meeting) : all.find((s) => s.snapshotId === $('snapshot').value);
    if (!chosen) throw new Error(`hakuraku has no snapshot for CM${meeting}`);
    const data = await loadSnapshotData(chosen.snapshotId);
    if (token !== snapshotToken) return;
    snapshot = chosen;
    snapshotData = data;
    archetypes = archetypeOptions(data.summary);
    const previous = $('archetype').value || saved.archetype;
    $('archetype').innerHTML = '';
    for (const a of archetypes) {
      $('archetype').add(new Option(`${a.name} (${(a.teamPop * 100).toFixed(1)}%)`, a.key));
    }
    if (archetypes.some((a) => a.key === previous)) $('archetype').value = previous;
    fillSlots(true);
    snapshotLoading = false;
    showError(null);
  } catch (error) {
    if (token !== snapshotToken) return;
    snapshotLoading = false;
    showError(`Could not load hakuraku data: ${error.message}`);
  } finally {
    if (token === snapshotToken) updateOptimizeEnabled();
  }
}

/** Fill the slot select for the archetype; choose the first slot matching the uma's style. */
function fillSlots(useSaved = false) {
  const select = $('slot');
  select.innerHTML = '';
  const arch = archetypes.find((a) => a.key === $('archetype').value);
  if (!arch) return;
  const roleName = (s) => snapshotData?.summary?.styles?.find((x) => x.style === s)?.name ?? ROLE_NAMES[s];
  arch.styles.forEach((style, i) => select.add(new Option(`${i + 1}: ${roleName(style)}`, String(i))));
  const own = uma ? STYLE_NUMBER[uma.strategy] : null;
  let slot = arch.styles.indexOf(own);
  if (slot < 0 && own === 5) slot = arch.styles.indexOf(1);
  if (slot < 0) slot = arch.styles.indexOf(6);
  select.value = String(slot < 0 ? 0 : slot);
  if (useSaved && saved.slot !== undefined && saved.archetype === arch.key && select.options[Number(saved.slot)]) {
    select.value = String(saved.slot);
  }
}

// ---- uma ----
// The uma lives only on this page (localStorage `umacompare:optimizer`), edited inline: not the
// saved-umas roster, which is only used to save the results. `uma` is the valid runner JSON, or
// null while the draft is incomplete; `umaDraft` is whatever is in the editor.
let umaDraft = saved.uma && typeof saved.uma === 'object' ? saved.uma : newUmaDraft();
let lastStrategy = null;

function onUmaChange(draft, error) {
  umaDraft = draft;
  uma = error ? null : draft;
  if (uma && uma.strategy !== lastStrategy) fillSlots();
  lastStrategy = uma?.strategy ?? lastStrategy;
  renderGolds(); // the costume may have changed
  updateOptimizeEnabled();
  persist();
}

/** The one place Optimize is enabled: a valid uma, valid snapshot data for the current race, nothing loading or running. */
function updateOptimizeEnabled() {
  optimizeButton.disabled = !(uma && snapshot && snapshotData && archetypes.length && !snapshotLoading && !running);
}

// ---- available golds ----
const ALL_GOLDS = Object.keys(SKILL_DATA).map(Number).filter((id) => isSkill(id) && isGold(id));

/** The costume the editor currently has (its outfitId, or the one its unique skill implies). */
const currentOutfitId = () => outfitOf(umaDraft)?.id ?? umaDraft.outfitId ?? null;
/** Golds the uma has of its own, always available. */
const uniqueIds = (ids) => [...new Set(ids)];
const ownGoldList = () => ownGolds(currentOutfitId());
/** Every gold the run may buy: the uma's own plus the ones the user added. */
const availableGoldList = () => uniqueIds([...ownGoldList(), ...userGolds]);

function renderGolds() {
  const own = ownGoldList();
  const chip = (id, removable) => `<span class="uc-opt-chip${removable ? '' : ' uc-opt-chip-own'}"${removable ? '' : ' title="From the uma"'}>`
    + `<img src="${skillIconUrl(id)}" alt="">${escapeHtml(skillLabel(id))}`
    + (removable ? `<button type="button" data-remove="${id}" aria-label="Remove ${escapeHtml(skillLabel(id))}">&times;</button>` : '<small>from the uma</small>')
    + '</span>';
  $('goldChips').innerHTML = own.map((id) => chip(id, false)).join('')
    + userGolds.filter((id) => !own.includes(id)).map((id) => chip(id, true)).join('');
}

function renderGoldSuggestions() {
  const query = $('goldSearch').value.trim().toLowerCase();
  const box = $('goldResults');
  if (!query) { box.hidden = true; return; }
  const have = new Set(availableGoldList());
  let ctx = null;
  try { if (uma) ctx = raceContext(races.currentRace(), uma); } catch { /* no race context: no ordering */ }
  const possible = (id) => (ctx ? isPossible(id, ctx) : true);
  const hits = ALL_GOLDS.filter((id) => !have.has(id) && skillLabel(id).toLowerCase().includes(query))
    .sort((a, b) => Number(possible(b)) - Number(possible(a))) // golds that can fire in this race first
    .slice(0, 12);
  box.innerHTML = hits.map((id) => `<button type="button" data-add="${id}"><img src="${skillIconUrl(id)}" alt="">`
    + `${escapeHtml(skillLabel(id))}${possible(id) ? '' : ' <small>(not usable in this race)</small>'}</button>`).join('')
    || '<span class="uc-opt-hint">No match</span>';
  box.hidden = false;
}

$('goldSearch').addEventListener('input', renderGoldSuggestions);
$('goldResults').addEventListener('click', (event) => {
  const id = Number(event.target.closest('[data-add]')?.dataset.add);
  if (!id) return;
  userGolds.push(id);
  $('goldSearch').value = '';
  renderGoldSuggestions();
  renderGolds();
  persist();
});
$('goldChips').addEventListener('click', (event) => {
  const id = Number(event.target.closest('[data-remove]')?.dataset.remove);
  if (!id) return;
  userGolds = userGolds.filter((x) => x !== id);
  renderGolds();
  persist();
});

// ---- inherited uniques ----
const BLACKLISTABLE = Object.keys(SKILL_DATA).map(Number).filter(isSkill);
function renderBlacklist() {
  $('blacklistChips').innerHTML = blacklist.map((id) => `<span class="uc-opt-chip"><img src="${skillIconUrl(id)}" alt="">`
    + `${escapeHtml(skillLabel(id))}<button type="button" data-remove="${id}" aria-label="Remove ${escapeHtml(skillLabel(id))}">&times;</button></span>`).join('');
}
function renderBlacklistSuggestions() {
  const query = $('blacklistSearch').value.trim().toLowerCase();
  const box = $('blacklistResults');
  if (!query) { box.hidden = true; return; }
  const hits = BLACKLISTABLE.filter((id) => !blacklist.includes(id) && skillLabel(id).toLowerCase().includes(query)).slice(0, 12);
  box.innerHTML = hits.map((id) => `<button type="button" data-add="${id}"><img src="${skillIconUrl(id)}" alt="">${escapeHtml(skillLabel(id))}</button>`).join('') || '<span class="uc-opt-hint">No match</span>';
  box.hidden = false;
}
$('blacklistSearch').addEventListener('input', renderBlacklistSuggestions);
$('blacklistResults').addEventListener('click', (event) => {
  const id = Number(event.target.closest('[data-add]')?.dataset.add);
  if (!id) return;
  blacklist.push(id);
  $('blacklistSearch').value = '';
  renderBlacklistSuggestions();
  renderBlacklist();
  persist();
});
$('blacklistChips').addEventListener('click', (event) => {
  const id = Number(event.target.closest('[data-remove]')?.dataset.remove);
  if (!id) return;
  blacklist = blacklist.filter((x) => x !== id);
  renderBlacklist();
  persist();
});

const INHERITABLE = Object.keys(SKILL_DATA).map(Number).filter((id) => isSkill(id) && skillIsInherited(id));

function renderInherited() {
  $('inheritedChips').innerHTML = inherited.map((id) => `<span class="uc-opt-chip"><img src="${skillIconUrl(id)}" alt="">`
    + `${escapeHtml(skillLabel(id))}<button type="button" data-remove="${id}" aria-label="Remove ${escapeHtml(skillLabel(id))}">&times;</button></span>`).join('');
}

function renderSuggestions() {
  const query = $('inheritedSearch').value.trim().toLowerCase();
  const box = $('inheritedResults');
  if (!query) { box.hidden = true; return; }
  const hits = INHERITABLE.filter((id) => !inherited.includes(id) && skillLabel(id).toLowerCase().includes(query)).slice(0, 12);
  box.innerHTML = hits.map((id) => `<button type="button" data-add="${id}"><img src="${skillIconUrl(id)}" alt="">${escapeHtml(skillLabel(id))}</button>`).join('')
    || '<span class="uc-opt-hint">No match</span>';
  box.hidden = false;
}

$('inheritedSearch').addEventListener('input', renderSuggestions);
$('inheritedResults').addEventListener('click', (event) => {
  const id = Number(event.target.closest('[data-add]')?.dataset.add);
  if (!id) return;
  inherited.push(id);
  $('inheritedSearch').value = '';
  renderSuggestions();
  renderInherited();
  persist();
});
$('inheritedChips').addEventListener('click', (event) => {
  const id = Number(event.target.closest('[data-remove]')?.dataset.remove);
  if (!id) return;
  inherited = inherited.filter((x) => x !== id);
  renderInherited();
  persist();
});

// ---- form wiring ----
for (const field of FIELDS) $(field).addEventListener('change', persist);
$('archetype').addEventListener('change', () => { fillSlots(); persist(); });
$('slot').addEventListener('change', persist);
$('snapshot').addEventListener('change', () => { refreshSnapshot(); persist(); });
$('pool').addEventListener('change', () => { poolChosenByUser = true; showPoolWarning(); persist(); });

const readSettings = () => parseSettings((id) => $(id).value);

// ---- rendering results ----
const fmtScore = (metric, s) => (metric === 'place'
  ? `${s.mean.toFixed(2)} (${s.low.toFixed(2)} to ${s.high.toFixed(2)})`
  : `${(s.mean * 100).toFixed(1)}% (${(s.low * 100).toFixed(1)} to ${(s.high * 100).toFixed(1)})`);
const pct1 = (x) => `${(x * 100).toFixed(0)}%`;

function uniqueRow(entry, runner) {
  const unique = runner(entry.build).skills?.find((s) => s.isUnique);
  if (!unique) return '';
  const id = Number(unique.skillId);
  return `<li class="uc-opt-skill uc-opt-skill-unique"><img src="${skillIconUrl(id)}" alt="">`
    + `<span>${escapeHtml(skillLabel(id))}</span><small>Unique Lv ${Number(unique.level) || 1}</small>`
    + `<small>${pct1(entry.score.rates.get(id) ?? 0)} activated</small></li>`;
}

function skillRows(entry, settings) {
  return entry.build.map((id) => ({ id, cost: skillCost(id, settings.pct), rate: entry.score.rates.get(id) ?? 0 }))
    .sort((a, b) => b.cost - a.cost)
    .map(({ id, cost, rate }) => `<li class="uc-opt-skill"><img src="${skillIconUrl(id)}" alt="">`
      + `<span>${escapeHtml(skillLabel(id))}</span><small>${cost} SP</small><small>${pct1(rate)} activated</small></li>`).join('');
}

function buildCard(entry, settings, index, runner, { open = false } = {}) {
  return `<details class="uc-opt-build"${open ? ' open' : ''}>
    <summary><strong>#${index + 1}</strong> ${escapeHtml(fmtScore(settings.metric, entry.score))}
      <small>${entry.cost}/${settings.budget} SP, ${entry.build.length} skills</small></summary>
    <div class="uc-opt-build-uma"><div class="uc-member">${umaChipBody(runner(entry.build), null)}</div></div>
    <ul class="uc-opt-skills">${uniqueRow(entry, runner)}${skillRows(entry, settings)}</ul>
    <div class="uc-opt-build-actions">
      <button type="button" class="btn btn-sm btn-pink" data-save="${index}">Save to saved umas</button>
      <button type="button" class="btn btn-sm btn-outline-pink" data-export="${index}">Export JSON</button>
    </div></details>`;
}

function historyTable(history, settings) {
  const rows = history.map((g) => `<tr><td>${g.generation}${g.partial ? ' (cut short)' : ''}</td><td>${g.trials}</td>`
    + `<td>${escapeHtml(fmtScore(settings.metric, g.best.score))}</td>`
    + `<td>${settings.metric === 'place' ? g.eliteMean.toFixed(2) : pct1(g.eliteMean)}</td><td>${g.best.cost}</td>`
    + `<td>${g.significant === null ? '' : g.significant ? 'yes' : 'no'}</td></tr>`).join('');
  return `<table class="table table-sm uc-opt-table"><thead><tr><th>Gen</th><th>Trials</th><th>Best</th>`
    + `<th>Elite mean</th><th>SP</th><th>Better?</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function headerHtml(ctx) {
  return `<p class="uc-opt-sources"><span>Race</span> ${escapeHtml(ctx.raceName)} <span>Snapshot</span> ${escapeHtml(ctx.snapshotId)}`
    + ` <span>Pool</span> ${escapeHtml(ctx.poolLabel)} <span>Teammate teams</span> ${ctx.teammates}`
    + ` <span>Eligible skills</span> ${ctx.eligible}</p>`;
}

function priorHtml(rows) {
  const body = rows.map((r) => `<tr><td>${escapeHtml(skillLabel(r.id))}</td><td>${r.cost}</td><td>${(r.pct * 100).toFixed(1)}</td><td>${(r.share * 100).toFixed(2)}</td></tr>`).join('');
  return `<details class="uc-opt-prior"><summary>Skill prior (${rows.length} eligible skills)</summary>
    <div class="uc-opt-prior-scroll"><table class="table table-sm uc-opt-table" id="priorTable"><thead><tr>
    <th data-sort="0">Skill</th><th data-sort="1">Cost</th><th data-sort="2">Used by %</th><th data-sort="3">Weight %</th></tr></thead>
    <tbody>${body}</tbody></table></div></details>`;
}

/** Click a prior-table header to sort by it (text for the first column, numbers otherwise; again to flip). */
output.addEventListener('click', (event) => {
  const th = event.target.closest('#priorTable th');
  if (!th) return;
  const column = Number(th.dataset.sort);
  const body = th.closest('table').tBodies[0];
  const sign = th.dataset.dir === 'desc' ? 1 : -1; // first click: largest first
  th.closest('tr').querySelectorAll('th').forEach((h) => delete h.dataset.dir);
  th.dataset.dir = sign === -1 ? 'desc' : 'asc';
  const value = (row) => row.cells[column].textContent;
  const rows = [...body.rows].sort((a, b) => (column === 0
    ? value(a).localeCompare(value(b)) * -sign
    : (Number(value(a)) - Number(value(b))) * sign));
  body.append(...rows);
});

output.addEventListener('click', async (event) => {
  const save = event.target.closest('[data-save]');
  const exp = event.target.closest('[data-export]');
  if (!lastRun || (!save && !exp)) return;
  const entry = lastRun.top[Number((save ?? exp).dataset.save ?? (save ?? exp).dataset.export)];
  const json = lastRun.runner(entry.build);
  if (save) {
    try {
      await roster.addUma(json, { name: `${memberInfo(json).name} (optimized)` });
      save.textContent = 'Saved';
      save.disabled = true;
    } catch (error) {
      showError(`Could not save: ${error.message}`);
    }
  } else {
    const url = URL.createObjectURL(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: `${memberInfo(json).name}-optimized.json` });
    link.click();
    URL.revokeObjectURL(url);
  }
});

// ---- the run ----
function render({ ctx, settings, progress, history, current, final, warnings, prior, runner }) {
  const bar = progress
    ? `<div class="progress uc-opt-progress" role="progressbar"><div class="progress-bar" style="width:${(progress.done / Math.max(1, progress.total) * 100).toFixed(1)}%"></div></div>`
      + `<p class="uc-opt-status">${escapeHtml(progress.text)}</p>` : '';
  const top = final ?? (current ? [current] : []);
  const bestCard = top.length ? `<h3 class="uc-opt-heading">${final ? 'Best build' : 'Best so far'}</h3>${buildCard(top[0], settings, 0, runner, { open: true })}` : '';
  const others = final && top.length > 1
    ? `<details class="uc-opt-others" open><summary>Runner-up builds (${top.length - 1})</summary>${top.slice(1).map((e, i) => buildCard(e, settings, i + 1, runner)).join('')}</details>` : '';
  const warn = warnings.map((w) => `<div class="alert alert-warning uc-opt-warning">${escapeHtml(w)}</div>`).join('');
  const openPrior = output.querySelector('.uc-opt-prior')?.open ? ' open' : '';
  output.innerHTML = `${headerHtml(ctx)}${warn}${bar}${bestCard}${others}`
    + `${history.length ? `<h3 class="uc-opt-heading">Generations</h3>${historyTable(history, settings)}` : ''}${prior.replace('<details', `<details${openPrior}`)}`;
}

/** Disable (or re-enable) the race card, uma card and search settings while a run prepares / runs. */
const setBusy = (busy) => { $('controls').disabled = busy; };

async function optimize(resume = false) {
  if (running || (resume ? !resumeSession : optimizeButton.disabled)) return;
  showError(null);
  // Freeze everything the run uses before the first await: later changes cannot leak into it.
  let config;
  try {
    if (resume) config = resumeSession.config;
    else {
      if (!uma) throw new Error('Choose an uma first.');
      const arch = archetypes.find((a) => a.key === $('archetype').value);
      if (!arch) throw new Error('Choose an archetype.');
      const poolEntry = poolIndex.find((e) => e.file === $('pool').value);
      if (!poolEntry) throw new Error('Choose an opponent pool.');
      config = {
        settings: readSettings(), race: races.currentRace(), snapshot, snapshotData, arch, poolEntry,
        slot: Number($('slot').value), uma: structuredClone(uma), inherited: [...inherited], golds: availableGoldList(), blacklist: [...blacklist],
      };
    }
  } catch (error) {
    showError(error.message);
    return;
  }
  const { settings, race, arch, slot, poolEntry } = config;
  const controller = new AbortController();
  const signal = { aborted: false };
  running = { signal, controller, pool: null };
  setBusy(true);
  updateOptimizeEnabled();
  stopButton.disabled = false;
  if (!resume) { lastRun = null; resumeSession = null; }
  $('resume').disabled = true;
  const warnings = [];
  let pool = null;
  const checkStop = () => { if (signal.aborted) throw new StoppedError(); };
  // Fetches abort with Stop.
  const fetchImpl = (url, options) => fetch(url, { ...options, signal: controller.signal });
  try {
    output.innerHTML = '<p class="uc-opt-status">Loading teams...</p>';
    const runUma = config.uma;
    const own = runUma.skills?.find?.((s) => s.isUnique);
    const unique = own?.skillId ?? (outfitOf(runUma) ? uniqueForOutfit(outfitOf(runUma).id) : null);
    const uniqueLevel = Number(own?.level) || settings.uniqueFallback;
    const base = { ...runUma };
    delete base.skills;
    const runner = (build) => runnerJson({ base, unique, uniqueLevel, skills: build });

    const eligible = eligibleSkills({ uma: runUma, race, inheritedUniques: config.inherited, ownUnique: unique, availableGolds: config.golds, blacklist: config.blacklist });
    const usage = config.snapshotData.usage.skills ?? [];
    const prior = priorWeights(eligible, usage, runUma.strategy, settings.smoothing);
    const priorRows = priorTable(eligible, usage, config.snapshotData.summary.styles ?? [], runUma.strategy, settings.pct, settings.smoothing);

    const rawTeams = resume ? null : await fetchArchetypeTeams(config.snapshot.snapshotId, arch.key, { maxTeams: settings.maxTeams, fetch: fetchImpl });
    checkStop();
    const sourceBuilds = resume ? [] : rawTeams.flatMap((team) => (team.members ?? [])
      .filter((member) => member.racingStyle === STYLE_NUMBER[runUma.strategy])
      .map((member) => (member.skills ?? []).map(([id]) => Number(id))));
    const { teammates, skipped } = resume ? { teammates: resumeSession.teammates, skipped: 0 } : teammatesFromTeams(rawTeams, arch.styles[slot]);
    if (skipped) warnings.push(`${skipped} of ${rawTeams.length} hakuraku teams were unusable and skipped.`);
    const poolTeams = resume ? resumeSession.poolTeams : await loadPool(poolEntry.file, { fetch: fetchImpl });
    checkStop();
    const ctx = {
      raceName: raceLabel(race), snapshotId: config.snapshot.snapshotId, poolLabel: poolEntry.label,
      teammates: teammates.length, eligible: eligible.length,
    };
    const view = { ctx, settings, history: resume ? [...resumeSession.state.history] : [], warnings, prior: priorHtml(priorRows), runner };
    if (!teammates.length) throw new Error('No usable hakuraku teams for this archetype and slot.');
    if (!eligible.length) throw new Error('No skills are eligible for this uma in this race.');

    const workers = settings.workers ?? Math.max(1, (navigator.hardwareConcurrency || 2) - 1);
    checkStop();
    pool = new WorkerPool({
      size: workers, chunking: { maxChunk: settings.maxChunk, perWorker: settings.perWorker },
      createWorker: () => new Worker(new URL('./optimizer-worker.js', import.meta.url), { type: 'module' }),
    });
    running.pool = pool;
    render({ ...view, progress: { done: 0, total: 1, text: `Starting ${workers} worker(s)...` } });
    await pool.init({ race, pool: poolTeams, teammates, slot });
    checkStop();

    const { rng, trialRng } = resume ? resumeSession : makeRngs(settings.seed);
    let generationNumber = resume ? resumeSession.state.generation + 1 : 1;
    const lastGeneration = generationNumber + settings.maxGenerations - 1;
    let current = resume ? resumeSession.state.previous : null;
    const result = await runOptimization({
      prior, settings, rng, signal, makeRunner: runner, sourceBuilds, resumeState: resume ? resumeSession.state : null,
      drawTrials: (n) => drawOptimizerTrials(n, poolTeams.length, teammates.length, trialRng),
      evaluate: (candidates, trials) => {
        const total = candidates.length * trials.length;
        let done = 0;
        const text = () => `Generation ${generationNumber}/${lastGeneration}: ${done}/${total} races`;
        render({ ...view, current, progress: { done, total, text: text() } });
        let last = 0;
        return pool.run(candidates, trials, (n) => {
          done += n;
          const now = performance.now();
          if (now - last < 150 && done < total) return;
          last = now;
          const bar = output.querySelector('.progress-bar');
          if (bar) bar.style.width = `${(done / total * 100).toFixed(1)}%`;
          const status = output.querySelector('.uc-opt-status');
          if (status) status.textContent = text();
        });
      },
      onGeneration: (info) => {
        view.history.push(info);
        current = info.best;
        lastRun = { top: [info.best], runner }; // so the "Best so far" card's buttons work
        generationNumber = info.generation + 1;
        render({ ...view, current, progress: { done: 0, total: 1, text: 'Preparing the next generation...' } });
      },
    });
    for (const w of result.warnings) if (!warnings.includes(w)) warnings.push(w);
    if (result.resumeState) resumeSession = { config, teammates, poolTeams, rng, trialRng, state: result.resumeState };
    if (!result.best) {
      output.innerHTML = `${headerHtml(ctx)}<p class="uc-opt-status">Stopped before the first generation finished.</p>`;
      return;
    }
    lastRun = { top: result.top, runner };
    const why = result.stopped ? 'Stopped by you' : result.reason === 'no-improvement'
      ? `No measurable improvement for ${settings.staleLimit} generation(s)` : 'Reached the maximum number of generations';
    render({
      ...view, history: result.history, final: result.top.slice(0, settings.buildsShown), warnings,
      progress: { done: 1, total: 1, text: `${why}. ${result.history.length} generation(s), score: ${METRIC_NAMES[settings.metric]}.` },
    });
  } catch (error) {
    if (error?.stopped || signal.aborted) {
      output.innerHTML = lastRun ? output.innerHTML : '<p class="uc-opt-status">Stopped.</p>';
    } else {
      showError(error?.message ?? String(error));
    }
  } finally {
    pool?.terminate();
    running = null;
    setBusy(false);
    stopButton.disabled = true;
    $('resume').disabled = !resumeSession;
    updateOptimizeEnabled();
  }
}

optimizeButton.addEventListener('click', () => optimize());
$('resume').addEventListener('click', () => optimize(true));
stopButton.addEventListener('click', () => {
  if (!running) return;
  running.signal.aborted = true;
  running.controller.abort();
  running.pool?.terminate();
});

// ---- the inline uma editor ----
// Created last: its first onChange runs synchronously and touches the gold, slot and persistence
// code above, which must all be defined by then.
umaEditor = createUmaInlineEditor({
  container: $('umaEditorInline'), onChange: onUmaChange, draft: umaDraft, course: races.currentCourse(),
});

// ---- startup ----
(async function start() {
  try {
    // Migrate the former default mix without overwriting a deliberately customized value.
    if (saved.form && saved.form.diversityShare === undefined && Number(saved.form.dropShare) === 0.4) {
      saved.form.dropShare = '0.3';
    }
    for (const f of FIELDS) if (saved.form?.[f] !== undefined) $(f).value = saved.form[f];
    if (Array.isArray(saved.inherited)) inherited = saved.inherited.map(Number).filter((id) => INHERITABLE.includes(id));
    if (Array.isArray(saved.golds)) userGolds = saved.golds.map(Number).filter((id) => ALL_GOLDS.includes(id));
    if (Array.isArray(saved.blacklist)) blacklist = [...new Set(saved.blacklist.map(Number).filter((id) => BLACKLISTABLE.includes(id)))];
    renderInherited();
    renderGolds();
    renderBlacklist();
    poolIndex = await loadPoolIndex();
    for (const entry of poolIndex) $('pool').add(new Option(entry.label, entry.file));
    if (saved.race?.courseId !== undefined) {
      try {
        Course.get(saved.race.courseId);
        races.applyRace(saved.race);
        $('raceCourse').dispatchEvent(new Event('change')); // re-derive the preset (or Custom)
      } catch { /* keep the default race */ }
    }
    if (saved.pool && poolIndex.some((e) => e.file === saved.pool)) {
      $('pool').value = saved.pool;
      poolChosenByUser = true;
    }
    restoring = false;
    onRaceChange();
  } catch (error) {
    restoring = false;
    showError(`Could not start: ${error.message}`);
  }
})();
