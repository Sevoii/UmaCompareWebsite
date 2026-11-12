// Data access for the skill optimizer: hakuraku snapshots, archetypes and teams, plus the local
// opponent pools. All fetches take an injectable `fetch` so the helpers can be tested offline.
import { HAKURAKU_API, memberToRunner } from './hakuraku-import.js';

export { HAKURAKU_API };

const PAGE_SIZE = 100;
const snapshotCache = new Map(); // snapshotId -> Promise<{ usage, summary }>

/** Forget every cached snapshot (tests; or to force a refetch). */
export function clearOptimizerCache() {
  snapshotCache.clear();
}

async function getJson(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

/** The hakuraku manifest: { schemaVersion, snapshots: [{ snapshotId, cmId, label, meta: { window } }] }. */
export function loadManifest({ fetch: fetchImpl = globalThis.fetch } = {}) {
  return getJson(`${HAKURAKU_API}/manifest`, fetchImpl);
}

/**
 * The manifest's snapshots, newest first: by meeting number (cmId "cm22", "cm16-post", ...), then
 * by the date in `meta.window`. hakuraku's window strings mix formats ("2026-11-09", "20260919",
 * "CM16 post-balance collection"), so they are compared as their digits only, never as text.
 */
export function snapshotsNewestFirst(manifest) {
  const cm = (s) => Number(/^cm(\d+)/.exec(s.cmId ?? '')?.[1] ?? -1);
  const date = (s) => {
    const digits = String(s.meta?.window ?? '').replace(/\D/g, '');
    return digits.length === 8 ? Number(digits) : -1; // not a date (e.g. "post-balance collection")
  };
  return [...(manifest?.snapshots ?? [])].sort((a, b) => cm(b) - cm(a) || date(b) - date(a)
    || String(b.snapshotId ?? '').localeCompare(String(a.snapshotId ?? '')));
}

/**
 * The newest snapshot of Champions Meeting `meetingNumber` (cmId === 'cm' + n, ordered as in
 * snapshotsNewestFirst), or null if there is none.
 */
export function snapshotForMeeting(manifest, meetingNumber) {
  return snapshotsNewestFirst(manifest).find((s) => s.cmId === `cm${meetingNumber}`) ?? null;
}

/**
 * `{ usage, summary }` of a snapshot (`uma-usage` and `summary` endpoints), cached in memory per
 * snapshot id. A failed load is not cached.
 */
export function loadSnapshotData(snapshotId, { fetch: fetchImpl = globalThis.fetch } = {}) {
  if (!snapshotCache.has(snapshotId)) {
    const base = `${HAKURAKU_API}/snapshots/${encodeURIComponent(snapshotId)}`;
    const promise = Promise.all([getJson(`${base}/uma-usage`, fetchImpl), getJson(`${base}/summary`, fetchImpl)])
      .then(([usage, summary]) => ({ usage, summary }));
    promise.catch(() => snapshotCache.delete(snapshotId));
    snapshotCache.set(snapshotId, promise);
  }
  return snapshotCache.get(snapshotId);
}

/** Archetypes of a summary as [{ key, name, teamPop, styles: [3 role codes] }], most popular first. */
export function archetypeOptions(summary) {
  return (summary?.archetypes ?? [])
    .map((a) => ({ key: a.key, name: a.name, teamPop: a.teamPop, styles: a.key.split('-').map(Number) }))
    .sort((a, b) => b.teamPop - a.teamPop);
}

/** The `slots` filter of an archetype key: "1-2-6" -> [{ style: 1 }, { style: 2 }, { style: 6 }]. */
export const slotsOfKey = (key) => key.split('-').map((style) => ({ style: Number(style) }));

/**
 * Raw hakuraku teams of an archetype (unique players, best lower bound first), paged 100 at a
 * time until `maxTeams` or a short page. Returns the team objects ({ id, members }).
 */
export async function fetchArchetypeTeams(snapshotId, key, { maxTeams = 300, fetch: fetchImpl = globalThis.fetch } = {}) {
  const slots = encodeURIComponent(JSON.stringify(slotsOfKey(key)));
  const teams = [];
  for (let offset = 0; teams.length < maxTeams; offset += PAGE_SIZE) {
    const url = `${HAKURAKU_API}/snapshots/${encodeURIComponent(snapshotId)}/teams`
      + `?slots=${slots}&players=unique&sort=lower&limit=${PAGE_SIZE}&offset=${offset}`;
    const page = (await getJson(url, fetchImpl)).teams ?? [];
    teams.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return teams.slice(0, maxTeams);
}

/**
 * The teammate pairs for our slot. Per team: drop the first member whose archetype role code
 * `member.style` equals `slotStyle`, convert the other two with `memberToRunner` (order kept).
 * Teams without such a member, or with a member that fails to convert, are skipped.
 * @returns {{ teammates: object[][], skipped: number }} runner-JSON pairs, and the skipped team count
 */
export function teammatesFromTeams(teams, slotStyle) {
  const teammates = [];
  let skipped = 0;
  for (const team of teams) {
    const members = team.members ?? [];
    const own = members.findIndex((m) => m.style === slotStyle);
    if (own < 0) { skipped++; continue; }
    try {
      const pair = members.filter((_, i) => i !== own).map((m) => memberToRunner(m).runner);
      if (pair.length !== 2) { skipped++; continue; }
      teammates.push(pair);
    } catch {
      skipped++;
    }
  }
  return { teammates, skipped };
}

/** pools/index.json: [{ file, label, cm }]. */
export function loadPoolIndex({ fetch: fetchImpl = globalThis.fetch, base = './pools/' } = {}) {
  return getJson(`${base}index.json`, fetchImpl);
}

/** A pool file (pools/<file>): [{ id, members: [runner JSON x3] }]. */
export function loadPool(file, { fetch: fetchImpl = globalThis.fetch, base = './pools/' } = {}) {
  return getJson(`${base}${file}`, fetchImpl);
}
