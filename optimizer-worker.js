// Web Worker: evaluates skill-build candidates on batches of shared trials with its own copy of
// the engine. The message protocol is documented in optimizer-protocol.js.
import { init } from './globalsim/index.js';
import { evaluateTrial } from './optimizer-eval.js';
import { createOptimizerHandler } from './optimizer-protocol.js';

const handle = createOptimizerHandler({ init, evaluate: evaluateTrial, post: (m) => self.postMessage(m) });
self.addEventListener('message', (event) => { handle(event.data); });
