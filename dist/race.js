/** Choose a course and conditions and build a race request (python/globalsim/race.py). */
import { CHAMPIONS_MEETINGS, COURSES, BUNDLED_SKILL_IDS, ChampionsMeeting } from './catalog.js';
import { DistanceCategory, Grade, Ground, Layout, Season, Strategy, Surface, Time, Turn, Weather, groundFromEngine, groundToEngine, isMember, nameOf, title, } from './enums.js';
import { UmaBuilder } from './builder.js';
import { championsMeetingLabel, isChampionsMeeting, isSkill, isTrack, isUma, skillDisplayName, skillIsInherited, trackLabel, umaLabel, } from './labels.js';
const enumTitle = (members, value) => title(nameOf(members, value));
export class Course {
    id;
    track;
    surface;
    distance;
    category;
    layout;
    turn;
    static #cache = new Map();
    constructor(id, track, surface, distance, category, layout, turn) {
        this.id = id;
        this.track = track;
        this.surface = surface;
        this.distance = distance;
        this.category = category;
        this.layout = layout;
        this.turn = turn;
        Object.freeze(this);
    }
    /** The course with this ID. Instances are shared, so `===` compares courses. */
    static get(courseId) {
        const cached = Course.#cache.get(courseId);
        if (cached)
            return cached;
        const row = Number.isInteger(courseId) ? COURSES[courseId] : undefined;
        if (!row)
            throw new RangeError(`Unknown course ID: ${String(courseId)}`);
        const [track, surface, distance, category, layout, turn] = row;
        const course = new Course(courseId, track, surface, distance, category, layout, turn);
        Course.#cache.set(courseId, course);
        return course;
    }
    static all() {
        return Object.keys(COURSES).map((id) => Course.get(Number(id)));
    }
    /** The single course matching track, surface and distance (and layout, when given). */
    static find(track, surface, distance, layout) {
        if (!isTrack(track))
            throw new RangeError(`Unknown track ID: ${String(track)}`);
        if (!isMember(Surface, surface))
            throw new RangeError(`Unknown surface: ${String(surface)}`);
        if (layout !== undefined && !isMember(Layout, layout))
            throw new RangeError(`Unknown layout: ${String(layout)}`);
        if (!Number.isInteger(distance))
            throw new TypeError('distance must be an integer number of meters');
        const onSurface = Course.all().filter((c) => c.track === track && c.surface === surface);
        const matches = onSurface.filter((c) => c.distance === distance && (layout === undefined || c.layout === layout));
        if (!matches.length) {
            const options = [...onSurface].sort((a, b) => a.distance - b.distance || a.layout - b.layout)
                .map((c) => `${c.distance}m` + (c.layout === Layout.NONE ? '' : ` ${enumTitle(Layout, c.layout).toLowerCase()}`))
                .join(', ');
            throw new RangeError(`No ${trackLabel(track)} ${enumTitle(Surface, surface).toLowerCase()} course of ${distance}m`
                + (layout !== undefined ? ` with layout ${nameOf(Layout, layout)}` : '')
                + (options ? `; available: ${options}` : ''));
        }
        if (matches.length > 1) {
            const choices = matches.map((c) => `#${c.id} (${nameOf(Layout, c.layout)})`).join(', ');
            const hint = new Set(matches.map((c) => c.layout)).size === matches.length
                ? 'pass a layout' : 'use RaceBuilder.fromCourse with one of the IDs';
            throw new RangeError(`${matches.length} courses match ${trackLabel(track)} ${enumTitle(Surface, surface)} `
                + `${distance}m: ${choices}; ${hint}`);
        }
        return matches[0];
    }
    toString() {
        const layout = this.layout === Layout.NONE ? '' : ` ${enumTitle(Layout, this.layout).toLowerCase()}`;
        const turn = this.turn === Turn.STRAIGHT ? 'straight' : `${enumTitle(Turn, this.turn).toLowerCase()}-handed`;
        return `${trackLabel(this.track)} ${enumTitle(Surface, this.surface)} ${this.distance}m${layout} `
            + `(${enumTitle(DistanceCategory, this.category)}, ${turn})`;
    }
}
export class RacePreset {
    name;
    date;
    course;
    season;
    ground;
    weather;
    time;
    constructor(name, 
    /** ISO date, `YYYY-MM-DD`. */
    date, course, season, ground, weather, time) {
        this.name = name;
        this.date = date;
        this.course = course;
        this.season = season;
        this.ground = ground;
        this.weather = weather;
        this.time = time;
        Object.freeze(this);
    }
    static championsMeeting(cm) {
        if (!isChampionsMeeting(cm))
            throw new TypeError('cm must be a ChampionsMeeting member');
        const [date, courseId, season, ground, weather, time] = CHAMPIONS_MEETINGS[cm];
        return new RacePreset(championsMeetingLabel(cm), date, Course.get(courseId), season, groundFromEngine(ground), weather, time);
    }
    /** Every Global Champions Meeting preset, oldest first. */
    static allChampionsMeetings() {
        return Object.values(ChampionsMeeting).map((cm) => RacePreset.championsMeeting(cm))
            .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    }
}
/** The table key the engine looks up for a runner's skill entry. */
function wireSkillId(entry) {
    const value = typeof entry === 'object' && entry !== null ? entry.skillId : entry;
    if (typeof value === 'string')
        return value;
    if (typeof value === 'number')
        return String(Math.trunc(value));
    return String(value);
}
function skillName(skillId) {
    const id = Number(skillId);
    return /^-?\d+$/.test(skillId) && isSkill(id) ? `${skillDisplayName(id)} #${skillId}` : `#${skillId}`;
}
const inheritedId = (skillId) => /^\d+$/.test(skillId) && isSkill(Number(skillId))
    && skillIsInherited(Number(skillId));
function runnerName(runner) {
    const name = isUma(runner.charaId) ? umaLabel(runner.charaId) : 'Runner';
    const strategy = nameOf(Strategy, runner.strategy);
    return `${name} (${strategy ? title(strategy) : String(runner.strategy)})`;
}
export class RaceBuilder {
    #course;
    #preset;
    #ground = Ground.FIRM;
    #weather = Weather.SUNNY;
    #season = Season.SPRING;
    #time = Time.MIDDAY;
    #grade = Grade.G1;
    #seed;
    #runners = [];
    #skillData;
    // Set by fromCourse for the one constructor call it makes.
    static #pending;
    constructor(track, surface, distance, { layout } = {}) {
        const pending = RaceBuilder.#pending;
        RaceBuilder.#pending = undefined;
        this.#course = pending ?? Course.find(track, surface, distance, layout);
    }
    static fromCourse(course) {
        RaceBuilder.#pending = course instanceof Course ? course : Course.get(course);
        return new RaceBuilder(0, 0, 0);
    }
    static championsMeeting(cm) {
        const preset = RacePreset.championsMeeting(cm);
        const result = RaceBuilder.fromCourse(preset.course);
        result.#preset = preset;
        result.#ground = preset.ground;
        result.#weather = preset.weather;
        result.#season = preset.season;
        result.#time = preset.time;
        return result;
    }
    get course() { return this.#course; }
    /** Global ground name, e.g. `Ground.FIRM` (sent to the engine as `'Good'`). */
    ground(ground) {
        if (!isMember(Ground, ground))
            throw new RangeError(`ground must be a Ground member, e.g. Ground.FIRM; got ${String(ground)}`);
        this.#ground = ground;
        return this;
    }
    weather(weather) { this.#weather = check(Weather, weather, 'weather'); return this; }
    season(season) { this.#season = check(Season, season, 'season'); return this; }
    time(time) { this.#time = check(Time, time, 'time'); return this; }
    grade(grade) { this.#grade = check(Grade, grade, 'grade'); return this; }
    seed(seed) {
        if (!Number.isSafeInteger(seed))
            throw new RangeError('seed must be a safe integer');
        this.#seed = seed;
        return this;
    }
    /** Add a runner. An UmaBuilder is built now, so later edits to it don't apply. */
    runner(runner) {
        if (runner instanceof UmaBuilder)
            this.#runners.push(runner.build());
        else if (typeof runner === 'object' && runner !== null)
            this.#runners.push(structuredClone(runner));
        else
            throw new TypeError('runner must be a Runner object or UmaBuilder');
        return this;
    }
    runners(runners) {
        for (const runner of runners)
            this.runner(runner);
        return this;
    }
    /**
     * Send a replacement skill table as `skillData`; null uses the bundled table.
     * The table is copied now and shared (not copied) by each built request.
     */
    skillData(table) {
        if (table !== null && (typeof table !== 'object' || Array.isArray(table))) {
            throw new TypeError('skill table must be an object keyed by skill ID, or null');
        }
        this.#skillData = table === null ? undefined : structuredClone(table);
        return this;
    }
    /**
     * `[runnerIndex, skillId]` for skills missing from the table this race uses.
     * The engine silently ignores such skills, so `build()` rejects them by default.
     */
    unknownSkills() {
        const known = this.#skillData === undefined ? null : new Set(Object.keys(this.#skillData));
        const isKnown = (id) => known ? known.has(id) : /^\d+$/.test(id) && BUNDLED_SKILL_IDS.has(Number(id));
        const unknown = [];
        this.#runners.forEach((runner, i) => {
            for (const id of (Array.isArray(runner.skills) ? runner.skills : []).map(wireSkillId)) {
                if (!isKnown(id))
                    unknown.push([i, id]);
            }
        });
        return unknown;
    }
    build({ allowUnknownSkills = false } = {}) {
        if (this.#seed === undefined)
            throw new Error('Set a seed before building');
        if (!this.#runners.length)
            throw new Error('Add at least one runner before building');
        const unknown = allowUnknownSkills ? [] : this.unknownSkills();
        if (unknown.length) {
            const table = this.#skillData === undefined ? 'bundled skill table' : 'supplied skillData table';
            const listed = unknown.map(([i, id]) => `runner ${i} (${runnerName(this.#runners[i])}): ${skillName(id)}`).join('; ');
            const hint = unknown.some(([, id]) => inheritedId(id))
                ? ' Inherited versions of newer uniques have no definition in the bundled table; only a supplied '
                    + 'table that defines them can simulate them.' : '';
            throw new Error(`${unknown.length} skill(s) are not in the ${table}, so the engine would silently ignore `
                + `them: ${listed}.${hint} Use skillData() to supply a table that defines them, or `
                + 'build({ allowUnknownSkills: true }).');
        }
        return {
            time: this.#time,
            grade: this.#grade,
            ...(this.#skillData === undefined ? {} : { skillData: this.#skillData }),
            seed: this.#seed,
            courseId: this.#course.id,
            groundCondition: groundToEngine(this.#ground),
            weather: this.#weather,
            season: this.#season,
            horses: structuredClone(this.#runners),
        };
    }
    #matchesPreset() {
        const p = this.#preset;
        return p !== undefined && p.course === this.#course && p.ground === this.#ground && p.weather === this.#weather
            && p.season === this.#season && p.time === this.#time;
    }
    toString() {
        const titleLine = this.#matchesPreset() ? `${this.#preset.name} (${this.#preset.date})` : String(this.#course);
        const conditions = [enumTitle(Ground, this.#ground), enumTitle(Weather, this.#weather),
            enumTitle(Season, this.#season), enumTitle(Time, this.#time)].join(', ');
        const lines = [titleLine,
            `  Course      ${this.#course} #${this.#course.id}`,
            `  Conditions  ${conditions}, ${this.#grade}`,
            `  Seed        ${this.#seed === undefined ? '(not set)' : this.#seed}`,
            `  Runners     ${this.#runners.length || 'none'}`];
        this.#runners.forEach((runner, i) => lines.push(`    ${i + 1}. ${runnerName(runner)}`));
        return lines.join('\n');
    }
}
function check(members, value, name) {
    if (!isMember(members, value))
        throw new RangeError(`Unknown ${name}: ${String(value)}`);
    return value;
}
//# sourceMappingURL=race.js.map