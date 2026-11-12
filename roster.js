// Uma roster: a user's umas and teams, persisted in localStorage.
//
// Every uma is keyed by the SHA-256 of its runner JSON and nickname (canonicalised, so key order
// doesn't matter; see umaIdOf). Adding the same uma twice is therefore a no-op, the same runner
// under another nickname is a separate uma, and editing or renaming an uma gives it a new id;
// teams that used it are repointed automatically. A team is an ordered list of 3 uma ids
// and is keyed the same way, by the hash of that list.
//
// Stored shape (one localStorage key):
//   { version: 2,
//     umas:  { [id]: { id, name, favorite, data, addedAt } },
//     teams: { [id]: { id, name, favorite, members: [umaId, umaId, umaId], addedAt } } }
//
// Usage:
//   import { Roster } from './roster.js';
//   const roster = Roster.load();
//   const a = await roster.addUma(runnerJson, { name: 'My Maruzensky' });
//   const t = await roster.addTeam([a, b, c], { name: 'Main team' });
//   roster.resolveTeam(t);   // { id, name, members: [runnerJson, ...] }, ready for loadTeam()
//   roster.toggleFavoriteUma(a);
//   roster.umas({ favoritesFirst: true });   // or { favoritesOnly: true }
//
// crypto.subtle needs a secure context: https:// (GitHub Pages) or http://localhost.

import { validateTeamMembers } from './team-rules.js';

export const STORAGE_KEY = 'umacompare:roster';
export const TEAM_SIZE = 3;
const VERSION = 2;

const emptyState = () => ({ version: VERSION, umas: {}, teams: {} });

/** JSON with object keys sorted at every level, so equal data always hashes equal. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Hex SHA-256 of the canonical JSON of `value`. */
export async function hashOf(value) {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * An uma's id. The nickname is part of the uma: the same runner with a different nickname is a
 * different uma. Umas without a nickname hash their runner JSON alone.
 */
export function umaIdOf(data, name = null) {
  return name ? hashOf({ data, name }) : hashOf(data);
}

export class Roster {
  #storage;
  #key;
  #state;
  #listeners = new Set();

  /**
   * Open the roster saved under `key` (empty if there is none).
   * `storage` is anything with getItem/setItem; it defaults to localStorage.
   */
  static load({ storage = globalThis.localStorage, key = STORAGE_KEY } = {}) {
    return new Roster(storage, key);
  }

  constructor(storage, key = STORAGE_KEY) {
    this.#storage = storage;
    this.#key = key;
    this.#state = this.#read();
    // Another tab changed the roster: pick it up and notify.
    globalThis.addEventListener?.('storage', (event) => {
      if (event.key !== this.#key || event.storageArea !== this.#storage) return;
      this.#state = this.#read();
      this.#emit();
    });
  }

  // ---- umas -------------------------------------------------------------------------------

  /**
   * All umas, oldest first: [{ id, name, favorite, data, addedAt }].
   * `favoritesFirst` puts favorites at the top; `favoritesOnly` returns just the favorites.
   */
  umas(options) {
    return listOf(this.#state.umas, options);
  }

  uma(id) {
    return this.#state.umas[id] ?? null;
  }

  /**
   * Add an uma (runner JSON + nickname). Returns its id. The same runner and nickname again is the
   * same uma (only `favorite`, if given, is updated); a different nickname makes a separate uma.
   */
  async addUma(data, { name = null, favorite } = {}) {
    checkUmaData(data);
    name ||= null;
    const id = await umaIdOf(data, name);
    this.#commit((state) => {
      const existing = state.umas[id];
      if (existing) {
        if (favorite != null) existing.favorite = Boolean(favorite);
      } else {
        state.umas[id] = { id, name, favorite: Boolean(favorite), data: structuredClone(data), addedAt: Date.now() };
      }
    });
    return id;
  }

  /**
   * Replace an uma's data and/or nickname (`name` omitted = keep it). Returns the new id; teams
   * that used the old id now use the new one.
   */
  async updateUma(id, data, { name } = {}) {
    checkUmaData(data);
    const current = this.#require('umas', id);
    const nextName = (name === undefined ? current.name : name) || null;
    for (const team of this.teamsUsing(id)) {
      validateTeamMembers(team.members.map((m) => m === id ? data : this.#require('umas', m).data));
    }
    const newId = await umaIdOf(data, nextName);
    if (newId === id) return id;
    const remapped = await this.#remapTeams((members) => members.map((m) => (m === id ? newId : m)));
    this.#commit((state) => {
      const old = state.umas[id];
      delete state.umas[id];
      state.umas[newId] ??= { ...old, id: newId, name: nextName, data: structuredClone(data) };
      state.umas[newId].favorite = Boolean(state.umas[newId].favorite || old.favorite);
      state.teams = remapped;
    });
    return newId;
  }

  /** Change an uma's nickname. The nickname is part of its id, so this returns the new id. */
  renameUma(id, name) {
    return this.updateUma(id, this.#require('umas', id).data, { name });
  }

  setFavoriteUma(id, favorite = true) {
    this.#setFavorite('umas', id, favorite);
  }

  /** Flip the favorite flag; returns the new value. */
  toggleFavoriteUma(id) {
    return this.#setFavorite('umas', id, !this.#require('umas', id).favorite);
  }

  /**
   * Delete an uma. If teams use it this throws, unless `cascade` is set, in which case
   * those teams are deleted too.
   */
  removeUma(id, { cascade = false } = {}) {
    this.#require('umas', id);
    const users = this.teamsUsing(id);
    if (users.length && !cascade) {
      throw new Error(`uma is used by ${users.length} team(s): ${users.map(label).join(', ')}`);
    }
    this.#commit((state) => {
      delete state.umas[id];
      for (const team of users) delete state.teams[team.id];
    });
  }

  /** Teams that include the uma. */
  teamsUsing(umaId) {
    return this.teams().filter((team) => team.members.includes(umaId));
  }

  // ---- teams ------------------------------------------------------------------------------

  /** All teams, oldest first: [{ id, name, favorite, members: [umaId x3], addedAt }]. Same options as umas(). */
  teams(options) {
    return listOf(this.#state.teams, options);
  }

  team(id) {
    return this.#state.teams[id] ?? null;
  }

  /** Add a team of 3 existing uma ids (order matters: it's the gate/member order). Returns its id. */
  async addTeam(memberIds, { name = null, favorite } = {}) {
    this.#checkMembers(memberIds);
    const id = await hashOf(memberIds);
    this.#commit((state) => {
      const existing = state.teams[id];
      if (existing) {
        if (name != null) existing.name = name;
        if (favorite != null) existing.favorite = Boolean(favorite);
      } else {
        state.teams[id] = { id, name, favorite: Boolean(favorite), members: [...memberIds], addedAt: Date.now() };
      }
    });
    return id;
  }

  /** Change a team's members. Returns the new id. */
  async updateTeam(id, memberIds) {
    this.#require('teams', id);
    this.#checkMembers(memberIds);
    const newId = await hashOf(memberIds);
    if (newId === id) return id;
    this.#commit((state) => {
      const old = state.teams[id];
      delete state.teams[id];
      state.teams[newId] ??= { ...old, id: newId, members: [...memberIds] };
      state.teams[newId].favorite = Boolean(state.teams[newId].favorite || old.favorite);
    });
    return newId;
  }

  renameTeam(id, name) {
    this.#require('teams', id);
    this.#commit((state) => { state.teams[id].name = name; });
  }

  setFavoriteTeam(id, favorite = true) {
    this.#setFavorite('teams', id, favorite);
  }

  /** Flip the favorite flag; returns the new value. */
  toggleFavoriteTeam(id) {
    return this.#setFavorite('teams', id, !this.#require('teams', id).favorite);
  }

  removeTeam(id) {
    this.#require('teams', id);
    this.#commit((state) => { delete state.teams[id]; });
  }

  /** The team with its umas' runner JSON inlined: { id, name, favorite, members: [data x3], memberNames: [nickname or null x3] }. */
  resolveTeam(id) {
    const team = this.#require('teams', id);
    return {
      id: team.id,
      name: team.name,
      favorite: Boolean(team.favorite),
      members: team.members.map((umaId) => structuredClone(this.#require('umas', umaId).data)),
      memberNames: team.members.map((umaId) => this.#require('umas', umaId).name ?? null),
    };
  }

  /**
   * Add a team file ({ id?, members: [...] } or an array of runners): its umas are added
   * (or reused if already stored) and a team referencing them is created. Returns the team id.
   */
  async importTeam(teamJson, { name = null, favorite } = {}) {
    const members = Array.isArray(teamJson) ? teamJson : teamJson?.members;
    if (!Array.isArray(members) || members.length !== TEAM_SIZE) {
      throw new Error(`a team needs exactly ${TEAM_SIZE} members`);
    }
    members.forEach(checkUmaData);
    validateTeamMembers(members);
    const ids = [];
    for (const member of members) ids.push(await this.addUma(member));
    return this.addTeam(ids, { name, favorite });
  }

  // ---- whole roster -----------------------------------------------------------------------

  /** The whole roster as a JSON string (for a backup file). */
  export() {
    return JSON.stringify(this.#state, null, 2);
  }

  /**
   * Load a backup from export(). With `replace` the current roster is discarded; otherwise
   * the backup is merged in (existing names win; a favorite in either one stays a favorite). Ids are recomputed from the data, so a
   * hand-edited backup can't smuggle in wrong ids.
   */
  async import(json, { replace = false } = {}) {
    const backup = typeof json === 'string' ? JSON.parse(json) : json;
    if (!backup || typeof backup !== 'object' || !backup.umas || !backup.teams) {
      throw new Error('not a roster backup');
    }
    const next = replace ? emptyState() : structuredClone(this.#state);
    const idMap = new Map();
    for (const [oldId, uma] of Object.entries(backup.umas)) {
      checkUmaData(uma.data);
      const id = await umaIdOf(uma.data, uma.name || null);
      idMap.set(oldId, id);
      const existing = next.umas[id];
      if (existing) existing.favorite = Boolean(existing.favorite || uma.favorite);
      else next.umas[id] = { id, name: uma.name ?? null, favorite: Boolean(uma.favorite), data: uma.data, addedAt: uma.addedAt ?? Date.now() };
    }
    for (const team of Object.values(backup.teams)) {
      const members = team.members?.map((m) => idMap.get(m));
      if (!members || members.length !== TEAM_SIZE || members.some((m) => !m)) {
        throw new Error(`team ${label(team)} references umas missing from the backup`);
      }
      const id = await hashOf(members);
      const existing = next.teams[id];
      validateTeamMembers(members.map((m) => next.umas[m].data));
      if (existing) existing.favorite = Boolean(existing.favorite || team.favorite);
      else next.teams[id] = { id, name: team.name ?? null, favorite: Boolean(team.favorite), members, addedAt: team.addedAt ?? Date.now() };
    }
    this.#commit((state) => Object.assign(state, next));
  }

  /** Delete everything. */
  clear() {
    this.#commit((state) => Object.assign(state, emptyState()));
  }

  /** Call `listener(roster)` after every change, including changes made in other tabs. Returns an unsubscribe function. */
  onChange(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  // ---- internals --------------------------------------------------------------------------

  #read() {
    let raw = null;
    try {
      raw = this.#storage?.getItem(this.#key) ?? null;
    } catch {
      return emptyState(); // storage blocked (e.g. disabled site data)
    }
    if (raw == null) return emptyState();
    try {
      let state = JSON.parse(raw);
      if (state?.version === 1 && state.umas && state.teams) state = this.#migrateV1(state, raw);
      if (state?.version !== VERSION || !state.umas || !state.teams) throw new Error('bad shape');
      return state;
    } catch {
      // Keep the unreadable data aside instead of silently overwriting it on the next save.
      try { this.#storage.setItem(`${this.#key}:corrupt:${Date.now()}`, raw); } catch { /* ignore */ }
      return emptyState();
    }
  }

  /**
   * Version 1 ids were the hash of the runner alone; version 2 hashes the nickname too. Nicknamed
   * umas (and the teams using them) are dropped rather than rehashed; unnamed umas keep their ids.
   * The version 1 data is kept aside under `<key>:v1-backup`.
   */
  #migrateV1(state, raw) {
    const dropped = new Set(Object.values(state.umas).filter((uma) => uma.name).map((uma) => uma.id));
    const next = {
      version: VERSION,
      umas: Object.fromEntries(Object.entries(state.umas).filter(([id]) => !dropped.has(id))),
      teams: Object.fromEntries(Object.entries(state.teams).filter(([, team]) => !team.members?.some((m) => dropped.has(m)))),
    };
    try {
      this.#storage.setItem(`${this.#key}:v1-backup`, raw);
      this.#storage.setItem(this.#key, JSON.stringify(next));
    } catch { /* storage full or blocked: migrate again on the next load */ }
    return next;
  }

  /** Apply `mutate` to a copy, save it, and only then make it current (a failed save changes nothing). */
  #commit(mutate) {
    const next = structuredClone(this.#state);
    mutate(next);
    this.#storage?.setItem(this.#key, JSON.stringify(next)); // throws QuotaExceededError if full
    this.#state = next;
    this.#emit();
  }

  #emit() {
    for (const listener of this.#listeners) {
      try { listener(this); } catch (error) { console.error(error); }
    }
  }

  #setFavorite(kind, id, favorite) {
    this.#require(kind, id);
    const value = Boolean(favorite);
    this.#commit((state) => { state[kind][id].favorite = value; });
    return value;
  }

  #require(kind, id) {
    const item = this.#state[kind][id];
    if (!item) throw new Error(`no ${kind === 'umas' ? 'uma' : 'team'} with id ${id}`);
    return item;
  }

  #checkMembers(memberIds) {
    if (!Array.isArray(memberIds) || memberIds.length !== TEAM_SIZE) {
      throw new Error(`a team needs exactly ${TEAM_SIZE} members`);
    }
    for (const id of memberIds) this.#require('umas', id);
    validateTeamMembers(memberIds.map((id) => this.#require('umas', id).data));
  }

  /** Rebuild every team with `mapMembers` applied, rehashing ids (teams that collapse into one merge). */
  async #remapTeams(mapMembers) {
    const teams = {};
    for (const team of this.teams()) {
      const members = mapMembers(team.members);
      const id = await hashOf(members);
      if (teams[id]) teams[id].favorite = Boolean(teams[id].favorite || team.favorite);
      else teams[id] = { ...team, id, members };
    }
    return teams;
  }
}

/** Entries sorted oldest first, optionally with favorites first or only favorites. */
function listOf(entries, { favoritesFirst = false, favoritesOnly = false } = {}) {
  let list = Object.values(entries);
  if (favoritesOnly) list = list.filter((entry) => entry.favorite);
  return list.sort((a, b) =>
    (favoritesFirst ? Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) : 0) || a.addedAt - b.addedAt);
}

function checkUmaData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('an uma must be a runner JSON object');
  }
}

function label(team) {
  return team.name ?? team.id.slice(0, 8);
}
