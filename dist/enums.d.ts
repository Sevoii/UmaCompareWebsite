/** Hand-written enums, mirroring python/globalsim/builder.py and race.py. */
export declare const Strategy: {
    readonly FRONT_RUNNER: "Nige";
    readonly PACE_CHASER: "Senkou";
    readonly LATE_SURGER: "Sasi";
    readonly END_CLOSER: "Oikomi";
    readonly RUNAWAY: "Oonige";
};
export type Strategy = (typeof Strategy)[keyof typeof Strategy];
export declare const Aptitude: {
    readonly S: "S";
    readonly A: "A";
    readonly B: "B";
    readonly C: "C";
    readonly D: "D";
    readonly E: "E";
    readonly F: "F";
    readonly G: "G";
};
export type Aptitude = (typeof Aptitude)[keyof typeof Aptitude];
export declare const Surface: {
    readonly TURF: 1;
    readonly DIRT: 2;
};
export type Surface = (typeof Surface)[keyof typeof Surface];
export declare const DistanceCategory: {
    readonly SPRINT: 1;
    readonly MILE: 2;
    readonly MEDIUM: 3;
    readonly LONG: 4;
};
export type DistanceCategory = (typeof DistanceCategory)[keyof typeof DistanceCategory];
export declare const Layout: {
    readonly NONE: 1;
    readonly INNER: 2;
    readonly OUTER: 3;
    readonly OUTER_TO_INNER: 4;
};
export type Layout = (typeof Layout)[keyof typeof Layout];
export declare const Turn: {
    readonly RIGHT: 1;
    readonly LEFT: 2;
    readonly STRAIGHT: 4;
};
export type Turn = (typeof Turn)[keyof typeof Turn];
/**
 * Ground conditions by their Global client names. The engine uses JP-derived
 * names, so these are translated when a request is built: Global "Firm" is sent
 * as `'Good'` and Global "Good" as `'Yielding'`. (Python's `Ground` enum stores
 * the engine names as values; here the values are the Global names so that a
 * plain `'Good'` cannot silently mean Firm.)
 */
export declare const Ground: {
    readonly FIRM: "Firm";
    readonly GOOD: "Good";
    readonly SOFT: "Soft";
    readonly HEAVY: "Heavy";
};
export type Ground = (typeof Ground)[keyof typeof Ground];
/** The engine's `groundCondition` values. */
export type EngineGround = 'Good' | 'Yielding' | 'Soft' | 'Heavy';
/** Global ground name to the engine's `groundCondition` value. */
export declare function groundToEngine(ground: Ground): EngineGround;
/** The engine's `groundCondition` value to the Global ground name. */
export declare function groundFromEngine(ground: EngineGround): Ground;
export declare const Weather: {
    readonly SUNNY: "Sunny";
    readonly CLOUDY: "Cloudy";
    readonly RAINY: "Rainy";
    readonly SNOWY: "Snowy";
};
export type Weather = (typeof Weather)[keyof typeof Weather];
export declare const Season: {
    readonly SPRING: "Spring";
    readonly SUMMER: "Summer";
    readonly AUTUMN: "Autumn";
    readonly WINTER: "Winter";
    readonly SAKURA: "Sakura";
};
export type Season = (typeof Season)[keyof typeof Season];
export declare const Time: {
    readonly MORNING: "Morning";
    readonly MIDDAY: "Midday";
    readonly EVENING: "Evening";
    readonly NIGHT: "Night";
};
export type Time = (typeof Time)[keyof typeof Time];
export declare const Grade: {
    readonly G1: "G1";
    readonly G2: "G2";
    readonly G3: "G3";
    readonly OP: "OP";
    readonly PRE_OP: "Pre-OP";
    readonly MAIDEN: "Maiden";
    readonly DEBUT: "Debut";
    readonly DAILY: "Daily";
};
export type Grade = (typeof Grade)[keyof typeof Grade];
/** The member name for `value` in an enum object, or undefined. */
export declare function nameOf<T extends Record<string, string | number>>(members: T, value: unknown): keyof T & string | undefined;
/** Whether `value` is one of the enum object's values. */
export declare function isMember<T extends Record<string, string | number>>(members: T, value: unknown): value is T[keyof T];
/** `'OUTER_TO_INNER'` to `'Outer To Inner'`, like Python's `name.replace('_', ' ').title()`. */
export declare function title(name: string): string;
