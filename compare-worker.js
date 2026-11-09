// Web Worker: runs batches of paired trials with its own copy of the engine.
import { init } from './globalsim/index.js';
import { runPairedTrial } from './compare.js';

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
      for (const trial of message.trials) results.push(await runPairedTrial(context, trial));
      self.postMessage({ type: 'done', results });
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message ?? String(error) });
  }
}

self.addEventListener('message', (event) => { queue = queue.then(() => handle(event.data)); });
