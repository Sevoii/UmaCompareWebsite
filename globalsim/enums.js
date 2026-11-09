/** Hand-written enums, mirroring python/globalsim/builder.py and race.py. */
export const Strategy = {
    FRONT_RUNNER: 'Nige',
    PACE_CHASER: 'Senkou',
    LATE_SURGER: 'Sasi',
    END_CLOSER: 'Oikomi',
    RUNAWAY: 'Oonige',
};
export const Aptitude = { S: 'S', A: 'A', B: 'B', C: 'C', D: 'D', E: 'E', F: 'F', G: 'G' };
export const Surface = { TURF: 1, DIRT: 2 };
export const DistanceCategory = { SPRINT: 1, MILE: 2, MEDIUM: 3, LONG: 4 };
export const Layout = { NONE: 1, INNER: 2, OUTER: 3, OUTER_TO_INNER: 4 };
export const Turn = { RIGHT: 1, LEFT: 2, STRAIGHT: 4 };
/**
 * Ground conditions by their Global client names. The engine uses JP-derived
 * names, so these are translated when a request is built: Global "Firm" is sent
 * as `'Good'` and Global "Good" as `'Yielding'`. (Python's `Ground` enum stores
 * the engine names as values; here the values are the Global names so that a
 * plain `'Good'` cannot silently mean Firm.)
 */
export const Ground = { FIRM: 'Firm', GOOD: 'Good', SOFT: 'Soft', HEAVY: 'Heavy' };
const TO_ENGINE = { Firm: 'Good', Good: 'Yielding', Soft: 'Soft', Heavy: 'Heavy' };
const FROM_ENGINE = { Good: 'Firm', Yielding: 'Good', Soft: 'Soft', Heavy: 'Heavy' };
/** Global ground name to the engine's `groundCondition` value. */
export function groundToEngine(ground) {
    const value = TO_ENGINE[ground];
    if (value === undefined)
        throw new TypeError(`Unknown ground: ${String(ground)}`);
    return value;
}
/** The engine's `groundCondition` value to the Global ground name. */
export function groundFromEngine(ground) {
    const value = FROM_ENGINE[ground];
    if (value === undefined)
        throw new TypeError(`Unknown engine ground condition: ${String(ground)}`);
    return value;
}
export const Weather = { SUNNY: 'Sunny', CLOUDY: 'Cloudy', RAINY: 'Rainy', SNOWY: 'Snowy' };
export const Season = {
    SPRING: 'Spring', SUMMER: 'Summer', AUTUMN: 'Autumn', WINTER: 'Winter', SAKURA: 'Sakura',
};
export const Time = { MORNING: 'Morning', MIDDAY: 'Midday', EVENING: 'Evening', NIGHT: 'Night' };
export const Grade = {
    G1: 'G1', G2: 'G2', G3: 'G3', OP: 'OP', PRE_OP: 'Pre-OP', MAIDEN: 'Maiden', DEBUT: 'Debut', DAILY: 'Daily',
};
/** The member name for `value` in an enum object, or undefined. */
export function nameOf(members, value) {
    for (const key in members)
        if (members[key] === value)
            return key;
    return undefined;
}
/** Whether `value` is one of the enum object's values. */
export function isMember(members, value) {
    return nameOf(members, value) !== undefined;
}
/** `'OUTER_TO_INNER'` to `'Outer To Inner'`, like Python's `name.replace('_', ' ').title()`. */
export function title(name) {
    return name.toLowerCase().replace(/_/g, ' ').replace(/(^|[^a-z])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}
//# sourceMappingURL=enums.js.map