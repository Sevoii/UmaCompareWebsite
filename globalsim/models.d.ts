/** Request and reply shapes. These are the engine's JSON shapes, so plain objects work too. */
import type { EngineGround } from './enums.js';
export interface SkillEntry {
    skillId: string;
    level: number;
    isUnique: boolean;
    [field: string]: unknown;
}
/** One runner (a `horses` entry). Unlisted fields are passed to the engine unchanged. */
export interface Runner {
    speed: number;
    stamina: number;
    power: number;
    guts: number;
    wisdom: number;
    strategy: string;
    distanceAptitude: string;
    surfaceAptitude: string;
    strategyAptitude: string;
    charaId?: number;
    mood?: number;
    skills?: Array<SkillEntry | string | number>;
    [field: string]: unknown;
}
/** A race request; see docs/INTERFACE.md for every optional field. */
export interface RaceRequest {
    seed: number;
    courseId: number;
    groundCondition: EngineGround;
    weather: string;
    season: string;
    horses: Runner[];
    time?: string;
    grade?: string;
    skillData?: Record<string, unknown>;
    experimentalRetailGeometry?: boolean;
    [field: string]: unknown;
}
export interface RunnerResult {
    finishOrder: number;
    /** Enclosing simulation tick end. */
    finishTime: number;
    /** Interpolated crossing time; use this for numerical comparisons. */
    finishTimeRaw: number;
    [field: string]: unknown;
}
/** Reply metadata. `results` follows the request's runner order. */
export interface RaceResult {
    results: RunnerResult[];
    [field: string]: unknown;
}
export interface RunnerFrame {
    /** Wire field `pos`. */
    position: number;
    speed: number;
    hp: number;
    lane: number;
    temptationMode: number;
    /** -1 means there is no runner ahead. */
    blockFrontHorseIndex: number;
}
export interface RaceFrame {
    time: number;
    horses: RunnerFrame[];
}
