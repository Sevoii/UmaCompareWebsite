import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOptimizerHandler } from '../optimizer-protocol.js';

const runner = { charaId: 1001 };
const ctx = (courseId) => ({ race: { courseId }, pool: [{}, {}], teammates: [[runner, runner]], slot: 0 });

function harness({ initFails = false } = {}) {
  const posted = [];
  const handle = createOptimizerHandler({
    init: async () => { if (initFails) throw new Error('engine failed'); },
    evaluate: async (context, candidates, trial) => candidates.map((c) => ({ course: context.race.courseId, c, seed: trial.seed })),
    post: (m) => posted.push(m),
  });
  return { posted, handle };
}

test('init then run: ids echoed, per-trial progress carries results, done merges in order', async () => {
  const { posted, handle } = harness();
  handle({ type: 'init', id: 1, ...ctx(10) });
  await handle({ type: 'run', id: 2, candidates: ['a', 'b'], trials: [{ seed: 7 }, { seed: 8 }] });
  assert.deepEqual(posted.map((m) => [m.type, m.id]), [['ready', 1], ['progress', 2], ['progress', 2], ['done', 2]]);
  assert.equal(posted[1].trial, 0);
  assert.equal(posted[1].races, 2);
  assert.deepEqual(posted[2].result.map((r) => r.seed), [8, 8]);
  assert.deepEqual(posted[3].results, [posted[1].result, posted[2].result]);
});

test('run before init is rejected with its own id', async () => {
  const { posted, handle } = harness();
  await handle({ type: 'run', id: 5, candidates: ['a'], trials: [{ seed: 1 }] });
  assert.deepEqual(posted, [{ type: 'error', id: 5, message: 'Worker is not initialized' }]);
});

test('engine init failure leaves the worker uninitialized', async () => {
  const { posted, handle } = harness({ initFails: true });
  handle({ type: 'init', id: 1, ...ctx(10) });
  await handle({ type: 'run', id: 2, candidates: ['a'], trials: [{ seed: 1 }] });
  assert.deepEqual(posted.map((m) => [m.type, m.id]), [['error', 1], ['error', 2]]);
  assert.equal(posted[0].message, 'engine failed');
});

test('failed re-init drops the previous race instead of silently reusing it', async () => {
  const { posted, handle } = harness();
  handle({ type: 'init', id: 1, ...ctx(10) });
  handle({ type: 'init', id: 2, ...ctx(20), teammates: [] });
  await handle({ type: 'run', id: 3, candidates: ['a'], trials: [{ seed: 1 }] });
  assert.deepEqual(posted.map((m) => [m.type, m.id]), [['ready', 1], ['error', 2], ['error', 3]]);
  assert.match(posted[1].message, /No usable teammates/);
});

test('queued requests are answered in arrival order', async () => {
  const { posted, handle } = harness();
  handle({ type: 'init', id: 1, ...ctx(10) });
  handle({ type: 'run', id: 2, candidates: ['a'], trials: [{ seed: 1 }] });
  await handle({ type: 'run', id: 3, candidates: ['a'], trials: [{ seed: 2 }] });
  assert.deepEqual(posted.filter((m) => m.type === 'done').map((m) => m.id), [2, 3]);
});
