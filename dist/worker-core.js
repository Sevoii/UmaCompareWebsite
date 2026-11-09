/** The message loop shared by the browser worker and the Node worker thread. */
import { PreparedRace, init, isTrapped, registerCourseGeometry } from './engine.js';
const messageOf = (error) => error instanceof Error ? error.message : String(error);
export function serve(port) {
    let race;
    let queue = Promise.resolve();
    async function handle(message) {
        if (message.type === 'init') {
            try {
                await init(message.module);
                port.post({ type: 'ready' });
            }
            catch (error) {
                port.post({ type: 'initError', message: messageOf(error) });
            }
            return;
        }
        try {
            if (message.geometry)
                registerCourseGeometry(...message.geometry);
            if (message.request !== undefined) {
                if (race)
                    race.prepare(message.request);
                else
                    race = new PreparedRace(message.request);
            }
            if (!race)
                throw new Error('No race has been prepared in this worker');
            if (message.mode === 'results') {
                port.post({ type: 'done', results: message.seeds.map((seed) => race.runResults(seed)) });
            }
            else {
                const packets = message.seeds.map((seed) => race.runWire(seed));
                port.post({ type: 'done', results: packets }, packets.map((packet) => packet.buffer));
            }
        }
        catch (error) {
            port.post({ type: 'error', message: messageOf(error), fatal: isTrapped() });
        }
    }
    port.onMessage((message) => { queue = queue.then(() => handle(message)); });
}
//# sourceMappingURL=worker-core.js.map