/** Choose a course and conditions and build a race request (python/globalsim/race.py). */
import { ChampionsMeeting, Track } from './catalog.js';
import { DistanceCategory, Grade, Ground, Layout, Season, Surface, Time, Turn, Weather } from './enums.js';
import { UmaBuilder } from './builder.js';
import type { RaceRequest, Runner } from './models.js';
export declare class Course {
    #private;
    readonly id: number;
    readonly track: Track;
    readonly surface: Surface;
    readonly distance: number;
    readonly category: DistanceCategory;
    readonly layout: Layout;
    readonly turn: Turn;
    private constructor();
    /** The course with this ID. Instances are shared, so `===` compares courses. */
    static get(courseId: number): Course;
    static all(): Course[];
    /** The single course matching track, surface and distance (and layout, when given). */
    static find(track: Track, surface: Surface, distance: number, layout?: Layout): Course;
    toString(): string;
}
export declare class RacePreset {
    readonly name: string;
    /** ISO date, `YYYY-MM-DD`. */
    readonly date: string;
    readonly course: Course;
    readonly season: Season;
    readonly ground: Ground;
    readonly weather: Weather;
    readonly time: Time;
    private constructor();
    static championsMeeting(cm: ChampionsMeeting): RacePreset;
    /** Every Global Champions Meeting preset, oldest first. */
    static allChampionsMeetings(): RacePreset[];
}
export interface BuildOptions {
    /** Keep skills the race's table does not define (the engine silently ignores them). */
    allowUnknownSkills?: boolean;
}
export declare class RaceBuilder {
    #private;
    constructor(track: Track, surface: Surface, distance: number, { layout }?: {
        layout?: Layout;
    });
    static fromCourse(course: Course | number): RaceBuilder;
    static championsMeeting(cm: ChampionsMeeting): RaceBuilder;
    get course(): Course;
    /** Global ground name, e.g. `Ground.FIRM` (sent to the engine as `'Good'`). */
    ground(ground: Ground): this;
    weather(weather: Weather): this;
    season(season: Season): this;
    time(time: Time): this;
    grade(grade: Grade): this;
    seed(seed: number): this;
    /** Add a runner. An UmaBuilder is built now, so later edits to it don't apply. */
    runner(runner: Runner | UmaBuilder): this;
    runners(runners: Iterable<Runner | UmaBuilder>): this;
    /**
     * Send a replacement skill table as `skillData`; null uses the bundled table.
     * The table is copied now and shared (not copied) by each built request.
     */
    skillData(table: Record<string, unknown> | null): this;
    /**
     * `[runnerIndex, skillId]` for skills missing from the table this race uses.
     * The engine silently ignores such skills, so `build()` rejects them by default.
     */
    unknownSkills(): Array<[number, string]>;
    build({ allowUnknownSkills }?: BuildOptions): RaceRequest;
    toString(): string;
}
