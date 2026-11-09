// Import a team from a hakuraku.moe UmaLogs link, e.g.
//   https://hakuraku.moe/umalogs?tab=archetypes&team=hjijsqt6VrhdUCuKx57Iv6WkT8ei5mdnQ_hjU8pfiSnQ
//
// The `team` parameter encodes the team's id the way hakuraku does (src/pages/SimDataPage/
// teamLinks.ts): the raw 64-hex id or `t<n>`, `h` + base64url(32-byte id), or
// `j` + base64url(JSON/string id). Teams are read from hakuraku's public SimData API, which
// allows cross-site requests. A team id belongs to one snapshot (one Champions Meeting) and the
// link doesn't say which, so snapshots are tried newest first (a preferred cm first).
//
// Members are converted exactly like UmaSim's scrape_umalogs.py, which built the opponent pools.
import { inheritedSkill, isSkill, isUma, skillIsInherited } from './globalsim/index.js';

export const HAKURAKU_API = 'https://hakuraku.moe/api/simdata';

// hakuraku racingStyle -> runner strategy ("style" 6 is hakuraku's Debuffer label, not a style).
const STRATEGIES = { 1: 'Nige', 2: 'Senkou', 3: 'Sasi', 4: 'Oikomi', 5: 'Oonige' };
const HASH_ID = /^[a-f0-9]{64}$/i;
const DISPLAY_ID = /^t\d+$/;
const validTeamId = (value) => HASH_ID.test(value) || DISPLAY_ID.test(value);

function base64UrlToBytes(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '='));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * The team id in a hakuraku link (or a bare `team` value / id). Throws if there isn't one.
 * Also returns `snapshot` when the link names one.
 */
export function parseHakurakuLink(input) {
  const text = String(input ?? '').trim();
  let team = text;
  let snapshot = null;
  if (/^https?:\/\//i.test(text) || text.includes('team=')) {
    const url = new URL(text, 'https://hakuraku.moe/');
    team = url.searchParams.get('team') ?? '';
    snapshot = url.searchParams.get('snapshot');
  }
  if (validTeamId(team)) return { teamId: team.toLowerCase(), snapshot };
  const bytes = team.length > 1 ? base64UrlToBytes(team.slice(1)) : null;
  if (bytes && team[0] === 'h' && (bytes.length === 32 || bytes.length === 64)) {
    return { teamId: [...bytes.slice(0, 32)].map((b) => b.toString(16).padStart(2, '0')).join(''), snapshot };
  }
  if (bytes && team[0] === 'j') {
    try {
      const decoded = new TextDecoder().decode(bytes);
      const id = decoded.startsWith('[') ? JSON.parse(decoded)?.[0] : decoded;
      if (typeof id === 'string' && validTeamId(id)) return { teamId: id, snapshot };
    } catch { /* fall through */ }
  }
  throw new Error('That doesn\'t look like a hakuraku team link (it needs a team=… part).');
}

/** A runner's own unique: a non-inherited skill that has an inherited version. */
function isOwnUnique(skill) {
  if (skillIsInherited(skill)) return false;
  try {
    inheritedSkill(skill);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a hakuraku team member into runner JSON (plus `outfitId`, the costume). Skills the
 * catalog doesn't know are left out and listed in `skipped`.
 */
export function memberToRunner(member) {
  const strategy = STRATEGIES[member.racingStyle];
  if (!strategy) throw new Error(`Unknown running style ${member.racingStyle}`);
  if (!isUma(member.chara)) throw new Error(`Unknown character ${member.chara}`);
  const [speed, stamina, power, guts, wisdom] = member.stats;
  const [distanceAptitude, surfaceAptitude, strategyAptitude] = member.aptitudes;
  const skills = [];
  const skipped = [];
  for (const [id, level] of member.skills) {
    if (!isSkill(id)) { skipped.push(id); continue; }
    skills.push({ skillId: String(id), level, isUnique: isOwnUnique(id) });
  }
  const runner = {
    speed, stamina, power, guts, wisdom, strategy, distanceAptitude, surfaceAptitude, strategyAptitude,
    charaId: member.chara, skills,
  };
  if (member.card) runner.outfitId = member.card;
  return { runner, skipped };
}

async function getJson(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

/**
 * Fetch a team from a hakuraku link. Returns { teamId, snapshot: { snapshotId, cmId, label },
 * owner, members: [runner JSON x3], skipped: [skill ids per member] }.
 * `preferCm` (e.g. 'cm22') is tried first when the link doesn't name a snapshot.
 */
export async function importHakurakuTeam(input, { preferCm = null, fetch: fetchImpl = globalThis.fetch } = {}) {
  const { teamId, snapshot: named } = parseHakurakuLink(input);
  const manifest = await getJson(`${HAKURAKU_API}/manifest`, fetchImpl);
  let snapshots = [...(manifest.snapshots ?? [])]
    .sort((a, b) => String(b.meta?.window ?? '').localeCompare(String(a.meta?.window ?? '')));
  if (named) snapshots = snapshots.filter((s) => s.snapshotId === named);
  else if (preferCm) snapshots.sort((a, b) => (b.cmId === preferCm) - (a.cmId === preferCm));
  for (const snapshot of snapshots) {
    let data;
    try {
      data = await getJson(`${HAKURAKU_API}/snapshots/${encodeURIComponent(snapshot.snapshotId)}/teams/${encodeURIComponent(teamId)}`, fetchImpl);
    } catch (error) {
      if (error.status === 404) continue; // not in this snapshot
      throw new Error(`Couldn't reach hakuraku (${error.message}).`);
    }
    const team = data.team ?? data;
    const converted = team.members.map(memberToRunner);
    return {
      teamId,
      snapshot: { snapshotId: snapshot.snapshotId, cmId: snapshot.cmId, label: snapshot.label },
      owner: team.owner?.names?.[0] ?? null,
      members: converted.map((c) => c.runner),
      skipped: converted.map((c) => c.skipped),
    };
  }
  throw new Error('hakuraku has no team with that id in any snapshot it currently serves.');
}

/** "CM22 · Player 4956" style name for an imported team. */
export const hakurakuTeamName = ({ snapshot, owner }) =>
  [snapshot.cmId?.toUpperCase(), owner].filter(Boolean).join(' · ') || 'hakuraku team';

