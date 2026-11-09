/** Browser Web Worker entry for RacePool. */
import { serve } from './worker-core.js';
const scope = self;
serve({
    post: (message, transfer) => scope.postMessage(message, transfer ?? []),
    onMessage: (listener) => scope.addEventListener('message', (event) => listener(event.data)),
});
//# sourceMappingURL=worker.js.map