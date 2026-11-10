import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { init } from '../globalsim/node.js';
import { cmFromNumber, raceFromMeeting } from '../compare.js';
import {
  archetypeOptions, clearOptimizerCache, fetchArchetypeTeams, loadManifest, loadSnapshotData, slotsOfKey,
  snapshotForMeeting, teammatesFromTeams,
} from '../optimizer-data.js';
import { drawOptimizerTrials, evaluateTrial, scoreCandidates } from '../optimizer-eval.js';
import { mulberry32 } from '../optimizer-core.js';

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const jsonResponse = (body, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });

test('snapshotForMeeting picks the newest matching snapshot', () => {
  const manifest = { snapshots: [
    { snapshotId: 'cm22-2026-11-02', cmId: 'cm22', meta: { window: '2026-11-02' } },
    { snapshotId: 'cm22-2026-11-09', cmId: 'cm22', meta: { window: '2026-11-09' } },
    { snapshotId: 'cm2-2027-01-01', cmId: 'cm2', meta: { window: '2027-01-01' } },
    { snapshotId: 'cm21-2026-10-01', cmId: 'cm21', meta: { window: '2026-10-01' } },
  ] };
  assert.equal(snapshotForMeeting(manifest, 22).snapshotId, 'cm22-2026-11-09');
  assert.equal(snapshotForMeeting(manifest, 2).snapshotId, 'cm2-2027-01-01');
  assert.equal(snapshotForMeeting(manifest, 5), null);
});

test('archetypeOptions sorts by popularity and parses the key', async () => {
  const summary = await fixture('hakuraku-summary.json');
  const options = archetypeOptions(summary);
  assert.equal(options.length, summary.archetypes.length);
  for (let i = 1; i < options.length; i++) assert.ok(options[i - 1].teamPop >= options[i].teamPop);
  assert.deepEqual(archetypeOptions({ archetypes: [{ key: '1-2-6', name: 'x', teamPop: 0.1 }] })[0].styles, [1, 2, 6]);
  assert.deepEqual(slotsOfKey('1-2-6'), [{ style: 1 }, { style: 2 }, { style: 6 }]);
});

test('fetchArchetypeTeams builds the slots URL and pages until a short page', async () => {
  const urls = [];
  const page = (n) => ({ teams: Array.from({ length: n }, (_, i) => ({ id: `t${i}`, members: [] })) });
  const sizes = [100, 100, 40];
  const fetch = async (url) => { urls.push(url); return jsonResponse(page(sizes[urls.length - 1])); };
  const teams = await fetchArchetypeTeams('snap', '1-2-6', { fetch });
  assert.equal(teams.length, 240);
  assert.equal(urls.length, 3);
  const first = new URL(urls[0]);
  assert.ok(first.pathname.endsWith('/snapshots/snap/teams'));
  assert.deepEqual(JSON.parse(first.searchParams.get('slots')), [{ style: 1 }, { style: 2 }, { style: 6 }]);
  assert.equal(first.searchParams.get('players'), 'unique');
  assert.equal(first.searchParams.get('sort'), 'lower');
  assert.equal(first.searchParams.get('limit'), '100');
  assert.equal(new URL(urls[2]).searchParams.get('offset'), '200');
  // capped at maxTeams
  urls.length = 0;
  const full = async (url) => { urls.push(url); return jsonResponse(page(100)); };
  assert.equal((await fetchArchetypeTeams('snap', '1-2-6', { maxTeams: 150, fetch: full })).length, 150);
  assert.equal(urls.length, 2);
});

test('loadSnapshotData caches per snapshot; loadManifest reads the manifest', async () => {
  clearOptimizerCache();
  let calls = 0;
  const fetch = async (url) => { calls++; return jsonResponse({ url }); };
  const a = await loadSnapshotData('s1', { fetch });
  const b = await loadSnapshotData('s1', { fetch });
  assert.equal(calls, 2);
  assert.equal(a, b);
  assert.match(a.usage.url, /\/snapshots\/s1\/uma-usage$/);
  assert.match(a.summary.url, /\/snapshots\/s1\/summary$/);
  assert.match((await loadManifest({ fetch })).url, /\/manifest$/);
  await assert.rejects(loadSnapshotData('bad', { fetch: async () => jsonResponse({}, false) }));
  assert.ok((await loadSnapshotData('bad', { fetch })).usage.url.includes('/bad/')); // failure not cached
});

test('teammatesFromTeams drops our slot, keeps order, skips failures', async () => {
  const { teams } = await fixture('hakuraku-teams-1-2-6.json');
  const { teammates, skipped } = teammatesFromTeams(teams, 6);
  assert.equal(skipped, 0);
  assert.equal(teammates.length, teams.length);
  // team 0 is [style 2 (chara 1010), style 6 (chara 1011), style 1 (chara 1046)]
  assert.deepEqual(teammates[0].map((r) => r.charaId), [1010, 1046]);
  assert.equal(teammates[0][0].strategy, 'Senkou'); // racingStyle 2, not the role code
  // no member with that role
  assert.deepEqual(teammatesFromTeams(teams, 3), { teammates: [], skipped: teams.length });

  // duplicate role codes: the first match is dropped
  const member = (style, chara) => ({ ...teams[0].members[0], style, chara });
  const dup = { members: [member(1, 1010), member(1, 1011), member(2, 1046)] };
  assert.deepEqual(teammatesFromTeams([dup], 1).teammates[0].map((r) => r.charaId), [1011, 1046]);

  // conversion failure (unknown character) skips the team
  const broken = { members: [member(1, 1010), member(2, 999999), member(6, 1046)] };
  const r = teammatesFromTeams([broken, dup], 1);
  assert.equal(r.skipped, 1);
  assert.equal(r.teammates.length, 1);
  // the broken member is kept as a teammate here, and dropped (so fine) when it is our slot
  assert.equal(teammatesFromTeams([broken], 2).teammates.length, 1);
});

test('drawOptimizerTrials shape and determinism', () => {
  const trials = drawOptimizerTrials(20, 50, 7, mulberry32(1));
  assert.equal(trials.length, 20);
  for (const t of trials) {
    assert.ok(Number.isInteger(t.seed) && t.seed >= 0 && t.seed <= 2 ** 31 - 1);
    assert.equal(t.opponentIndices.length, 2);
    assert.notEqual(t.opponentIndices[0], t.opponentIndices[1]);
    assert.ok(t.opponentIndices.every((i) => i >= 0 && i < 50));
    assert.deepEqual([...t.gates].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.ok(Number.isInteger(t.teammateIndex) && t.teammateIndex >= 0 && t.teammateIndex < 7);
  }
  assert.deepEqual(drawOptimizerTrials(20, 50, 7, mulberry32(1)), trials);
});

test('scoreCandidates for each metric', () => {
  const r = (place, teamWin, umaWin, skills) => ({ place, teamWin, umaWin, skills });
  const results = [
    [r(1, true, true, ['100', '200']), r(5, false, false, [])],
    [r(3, true, false, ['100']), r(4, false, false, ['300'])],
    [r(2, false, false, ['100']), r(9, false, false, [])],
    [r(4, false, false, []), r(1, true, true, ['300', '300'])],
  ];
  const place = scoreCandidates(results, 'place');
  assert.deepEqual(place[0].scores, [1, 3, 2, 4]);
  assert.equal(place[0].mean, 2.5);
  assert.ok(place[0].low < 2.5 && place[0].high > 2.5);
  assert.equal(place[0].rates.get(100), 0.75);
  assert.equal(place[0].rates.get(200), 0.25);
  assert.equal(place[1].rates.get(300), 0.5); // counted once per trial
  assert.ok(!place[1].rates.has(100));

  const team = scoreCandidates(results, 'teamWin');
  assert.deepEqual(team[0].scores, [1, 1, 0, 0]);
  assert.equal(team[0].mean, 0.5);
  assert.ok(team[0].low > 0 && team[0].high < 1 && team[0].low < 0.5 && team[0].high > 0.5);

  const uma = scoreCandidates(results, 'umaWin');
  assert.deepEqual(uma[0].scores, [1, 0, 0, 0]);
  assert.equal(uma[0].mean, 0.25);
  assert.deepEqual(uma[1].scores, [0, 0, 0, 1]);
  assert.throws(() => scoreCandidates(results, 'nope'), RangeError);
});

test('evaluateTrial runs real races (integration)', async () => {
  await init();
  const pool = JSON.parse(await readFile(new URL('../pools/cm22_teams.json', import.meta.url), 'utf8'));
  const race = raceFromMeeting(cmFromNumber(22));
  const teammates = [pool[0].members.slice(0, 2), pool[1].members.slice(1, 3)];
  const withSkills = pool[2].members[0];
  const bare = { ...withSkills, skills: [] };
  const trial = drawOptimizerTrials(1, pool.length - 3, teammates.length, mulberry32(7))[0];
  trial.opponentIndices = trial.opponentIndices.map((i) => i + 3);
  const out = await evaluateTrial({ race, pool, teammates, slot: 1 }, [withSkills, bare], trial);
  assert.equal(out.length, 2);
  for (const o of out) {
    assert.ok(Number.isInteger(o.place) && o.place >= 1 && o.place <= 9);
    assert.equal(typeof o.teamWin, 'boolean');
    assert.equal(typeof o.umaWin, 'boolean');
    assert.ok(Array.isArray(o.skills) && o.skills.every((s) => typeof s === 'string'));
    if (o.umaWin) assert.ok(o.teamWin);
  }
  assert.equal(out[1].skills.length, 0);
});

// ---- stage B review fixes (docs/reviews/03-stage-b.md) ----
import { validateContext } from '../optimizer-eval.js';

test('validateContext rejects empty teammates, small pools and bad slots with clear messages', () => {
  const runner = { charaId: 1001 };
  const ok = { race: { courseId: 10611 }, pool: [{}, {}], teammates: [[runner, runner]], slot: 1 };
  assert.doesNotThrow(() => validateContext(ok));
  assert.throws(() => validateContext({ ...ok, teammates: [] }), /No usable teammates/);
  assert.throws(() => validateContext({ ...ok, pool: [{}] }), /at least 2 teams/);
  assert.throws(() => validateContext({ ...ok, slot: 3 }), /Invalid team slot/);
  assert.throws(() => validateContext({ ...ok, teammates: [[runner]] }), /pair of runners/);
});

test('drawOptimizerTrials refuses impossible draws instead of producing bad indices', () => {
  assert.throws(() => drawOptimizerTrials(5, 1, 3), /at least 2 teams/);
  assert.throws(() => drawOptimizerTrials(5, 10, 0), /No usable teammates/);
});

// ---- snapshot order: hakuraku window strings mix formats ----
import { snapshotsNewestFirst } from '../optimizer-data.js';

test('snapshotsNewestFirst orders by meeting then date, ignoring mixed window formats', () => {
  const manifest = { snapshots: [
    { cmId: 'cm16-post', snapshotId: 'cm16-post-x', meta: { window: 'CM16 post-balance collection' } },
    { cmId: 'cm19', snapshotId: 'cm19-a', meta: { window: '20260919' } },
    { cmId: 'cm22', snapshotId: 'cm22-old', meta: { window: '2026-11-01' } },
    { cmId: 'cm22', snapshotId: 'cm22-new', meta: { window: '2026-11-09' } },
    { cmId: 'cm21', snapshotId: 'cm21-a', meta: { window: '2026-11-05' } },
  ] };
  assert.deepEqual(snapshotsNewestFirst(manifest).map((s) => s.snapshotId), ['cm22-new', 'cm22-old', 'cm21-a', 'cm19-a', 'cm16-post-x']);
  assert.equal(snapshotForMeeting(manifest, 22).snapshotId, 'cm22-new');
  assert.equal(snapshotForMeeting(manifest, 16), null); // cm16-post is not cm16
});
