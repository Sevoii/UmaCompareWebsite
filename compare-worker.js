// Web Worker: runs batches of shared trials (every tested team under the same conditions)
// with its own copy of the engine.
import { init } from './globalsim/index.js';
import { runSharedTrial } from './compare.js';

let context;
let queue = Promise.resolve();

async function handle(message) {
  try {
    if (message.type === 'init') {
      context = message.context;
      await init();
      self.postMessage({ type: 'ready' });
    } else if (message.type === 'run') {
      const results = [];
      for (const trial of message.trials) results.push(await runSharedTrial(context, trial));
      self.postMessage({ type: 'done', results });
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message ?? String(error) });
  }
}

self.addEventListener('message', (event) => { queue = queue.then(() => handle(event.data)); });
