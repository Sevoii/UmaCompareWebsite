// Message handling for optimizer-worker.js, kept free of worker globals so Node tests can drive it.
// Messages (every reply carries the request's `id`):
//   init { id, race, pool, teammates, slot } -> ready { id }. Any previous context is dropped
//        first, so a failed (re)initialization leaves the worker uninitialized, never on a stale race.
//   run  { id, candidates, trials } -> progress { id, trial, races, result } after each trial
//        (`result` = that trial's per-candidate results, so the page keeps finished trials even if
//        it terminates the worker mid-chunk), then done { id, results } (results[t][c]).
//   any failure -> error { id, message }. A run before a successful init errors.
import { validateContext } from './optimizer-eval.js';

/**
 * @param {{init: () => Promise<unknown>, evaluate: Function, post: (message: object) => void}} deps
 *   `init` readies the engine, `evaluate(context, candidates, trial)` races one trial.
 * @returns {(message: object) => Promise<void>} handles messages one at a time, in arrival order
 */
export function createOptimizerHandler({ init, evaluate, post }) {
  let context = null;
  let queue = Promise.resolve();

  async function handle(message) {
    const { id } = message;
    try {
      if (message.type === 'init') {
        context = null;
        const next = { race: message.race, pool: message.pool, teammates: message.teammates, slot: message.slot };
        validateContext(next);
        await init();
        context = next;
        post({ type: 'ready', id });
      } else if (message.type === 'run') {
        if (!context) throw new Error('Worker is not initialized');
        const results = [];
        for (const [i, trial] of message.trials.entries()) {
          const result = await evaluate(context, message.candidates, trial);
          results.push(result);
          post({ type: 'progress', id, trial: i, races: message.candidates.length, result });
        }
        post({ type: 'done', id, results });
      } else {
        throw new Error(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      post({ type: 'error', id, message: error?.message ?? String(error) });
    }
  }

  return (message) => (queue = queue.then(() => handle(message)));
}
