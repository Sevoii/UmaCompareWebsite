import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Roster, STORAGE_KEY, hashOf, umaIdOf } from '../roster.js';

/** An in-memory localStorage stand-in. */
function memoryStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => { items.set(key, String(value)); },
    items,
  };
}

const runner = (charaId, speed = 1200) => ({ charaId, speed, strategy: 'Senkou', skills: [] });

test('the same runner with a different nickname is a separate uma', async () => {
  const roster = Roster.load({ storage: memoryStorage() });
  const plain = await roster.addUma(runner(1001));
  const named = await roster.addUma(runner(1001), { name: 'Maru A' });
  const other = await roster.addUma(runner(1001), { name: 'Maru B' });
  assert.equal(new Set([plain, named, other]).size, 3);
  assert.equal(plain, await hashOf(runner(1001))); // unnamed ids are unchanged from version 1
  assert.equal(named, await umaIdOf(runner(1001), 'Maru A'));
  // Adding the exact same runner and nickname again is the same uma.
  assert.equal(await roster.addUma(runner(1001), { name: 'Maru A' }), named);
  assert.equal(roster.umas().length, 3);
});

test('renaming an uma gives it a new id and repoints its teams', async () => {
  const roster = Roster.load({ storage: memoryStorage() });
  const a = await roster.addUma(runner(1001), { name: 'Old' });
  const b = await roster.addUma(runner(1002));
  const c = await roster.addUma(runner(1003));
  const team = await roster.addTeam([a, b, c], { name: 'Main' });
  roster.setFavoriteUma(a);

  const renamed = await roster.renameUma(a, 'New');
  assert.notEqual(renamed, a);
  assert.equal(roster.uma(a), null);
  assert.equal(roster.uma(renamed).name, 'New');
  assert.equal(roster.uma(renamed).favorite, true);
  assert.equal(roster.team(team), null);
  const [moved] = roster.teams();
  assert.deepEqual(moved.members, [renamed, b, c]);
  assert.equal(moved.name, 'Main');
});

test('updateUma keeps the nickname unless a new one is given', async () => {
  const roster = Roster.load({ storage: memoryStorage() });
  const id = await roster.addUma(runner(1001), { name: 'Maru' });
  const faster = await roster.updateUma(id, runner(1001, 1300));
  assert.equal(roster.uma(faster).name, 'Maru');
  assert.equal(faster, await umaIdOf(runner(1001, 1300), 'Maru'));
  const cleared = await roster.updateUma(faster, runner(1001, 1300), { name: null });
  assert.equal(cleared, await hashOf(runner(1001, 1300)));
  assert.equal(roster.uma(cleared).name, null);
});

test('a version 1 roster drops nicknamed umas and their teams, keeping a backup', async () => {
  const plain = [await hashOf(runner(1001)), await hashOf(runner(1002)), await hashOf(runner(1003))];
  const namedId = await hashOf(runner(1004)); // version 1 id: the runner alone
  const uma = (id, data, name = null) => ({ id, name, favorite: false, data, addedAt: 1 });
  const v1 = {
    version: 1,
    umas: {
      [plain[0]]: uma(plain[0], runner(1001)),
      [plain[1]]: uma(plain[1], runner(1002)),
      [plain[2]]: uma(plain[2], runner(1003)),
      [namedId]: uma(namedId, runner(1004), 'Nick'),
    },
    teams: {
      keep: { id: 'keep', name: 'Kept', favorite: false, members: plain, addedAt: 1 },
      drop: { id: 'drop', name: 'Dropped', favorite: false, members: [plain[0], plain[1], namedId], addedAt: 1 },
    },
  };
  const raw = JSON.stringify(v1);
  const storage = memoryStorage({ [STORAGE_KEY]: raw });
  const roster = Roster.load({ storage });

  assert.deepEqual(roster.umas().map((u) => u.id).sort(), [...plain].sort());
  assert.deepEqual(roster.teams().map((t) => t.name), ['Kept']);
  assert.equal(storage.getItem(`${STORAGE_KEY}:v1-backup`), raw);
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).version, 2);
  // Loading again reads the migrated version 2 data as is.
  assert.deepEqual(Roster.load({ storage }).teams().map((t) => t.name), ['Kept']);
});

test('importing a backup rehashes nicknamed umas with their names', async () => {
  const roster = Roster.load({ storage: memoryStorage() });
  const backup = {
    version: 1,
    umas: { old: { id: 'old', name: 'Nick', favorite: true, data: runner(1001), addedAt: 1 } },
    teams: {},
  };
  await roster.import(backup);
  const [imported] = roster.umas();
  assert.equal(imported.id, await umaIdOf(runner(1001), 'Nick'));
  assert.equal(imported.favorite, true);
});
