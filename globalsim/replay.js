export const FIELDS = ['pos', 'speed', 'hp', 'lane', 'temptationMode', 'blockFrontHorseIndex'];
const MAGIC = 'GSIMRP01';
const HEADER = 32;
export class Replay {
    metadata;
    count;
    horseCount;
    frames;
    constructor(
    /** Reply metadata: everything except the frames. */
    metadata, 
    /** Number of retained frames; zero for results-only output. */
    count, horseCount, 
    /**
     * Row-major frame values: per frame, the time followed by six values per
     * runner in `FIELDS` order. Row `i` starts at `i * width`.
     */
    frames) {
        this.metadata = metadata;
        this.count = count;
        this.horseCount = horseCount;
        this.frames = frames;
    }
    /** Values per frame: `1 + 6 * horseCount`. */
    get width() { return 1 + 6 * this.horseCount; }
    /** Bytes per frame on the wire: `8 + 48 * horseCount`. */
    get stride() { return 8 * this.width; }
    /** `[time, runnerValues]`, where runner `i` occupies `runnerValues[i * 6 .. i * 6 + 6]`. Views, not copies. */
    frame(index) {
        if (!Number.isInteger(index) || index < 0 || index >= this.count)
            throw new RangeError(`Frame index ${index} out of range`);
        const start = index * this.width;
        return [this.frames[start], this.frames.subarray(start + 1, start + this.width)];
    }
    /** One frame with named values; nonfinite values are kept. */
    typedFrame(index) {
        const [time, v] = this.frame(index);
        const horses = [];
        for (let i = 0; i < v.length; i += 6) {
            horses.push({ position: v[i], speed: v[i + 1], hp: v[i + 2], lane: v[i + 3],
                temptationMode: v[i + 4], blockFrontHorseIndex: v[i + 5] });
        }
        return { time, horses };
    }
    /** The conventional JSON reply shape, frames included; nonfinite numbers become null. */
    toJson() {
        if ('error' in this.metadata)
            return { ...this.metadata };
        const finite = (n) => Number.isFinite(n) ? n : null;
        const frames = [];
        for (let i = 0; i < this.count; i++) {
            const [t, row] = this.frame(i);
            const horses = [];
            for (let h = 0; h < row.length; h += 6) {
                horses.push(Object.fromEntries(FIELDS.map((field, k) => [field, finite(row[h + k])])));
            }
            frames.push({ t: finite(t), horses });
        }
        return { ...this.metadata, frames };
    }
}
/** Validate and decode one complete binary packet. */
export function decode(packet) {
    if (packet.byteLength < HEADER)
        throw new Error('Truncated GlobalSim header');
    const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
    const magic = String.fromCharCode(...packet.subarray(0, 8));
    const metadataSize = Number(view.getBigUint64(8, true));
    const count = view.getUint32(16, true);
    const horses = view.getUint32(20, true);
    const payload = Number(view.getBigUint64(24, true));
    if (magic !== MAGIC || payload !== count * (8 + 48 * horses) || horses > 120) {
        throw new Error('Invalid GlobalSim replay header');
    }
    const offset = HEADER + metadataSize;
    if (packet.byteLength !== offset + payload)
        throw new Error('GlobalSim reply length differs from its header');
    const metadata = JSON.parse(new TextDecoder().decode(packet.subarray(HEADER, offset)));
    if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata) || 'frames' in metadata) {
        throw new Error('Invalid GlobalSim replay metadata');
    }
    if ('error' in metadata && (count || horses || payload))
        throw new Error('Error reply contains replay data');
    // Little-endian f64s at an unaligned offset: copy once into an aligned buffer.
    // (Every browser and Node platform is little-endian.)
    const frames = new Float64Array(packet.slice(offset).buffer);
    return new Replay(metadata, count, horses, frames);
}
//# sourceMappingURL=replay.js.map