/** Node worker-thread entry for RacePool. */
import { parentPort } from 'node:worker_threads';
import { serve } from './worker-core.js';
const port = parentPort;
serve({
    post: (message, transfer) => port.postMessage(message, transfer),
    onMessage: (listener) => port.on('message', (message) => listener(message)),
});
//# sourceMappingURL=node-worker.js.map