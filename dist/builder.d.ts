/** Construct a runner from trained stats and explicit aptitudes (python/globalsim/builder.py). */
import { Skill, Uma } from './catalog.js';
import { Aptitude, Strategy } from './enums.js';
import type { Runner } from './models.js';
export interface Stats {
    speed: number;
    stamina: number;
    power: number;
    guts: number;
    wisdom: number;
}
export interface Aptitudes {
    distance: Aptitude;
    surface: Aptitude;
    strategy: Aptitude;
}
export interface SkillOptions {
    level?: number;
    unique?: boolean;
}
export declare class UmaBuilder {
    #private;
    constructor(uma: Uma);
    /**
     * Load a runner from a JSON string or object. Character and skill IDs must
     * exist in the bundled catalog. Missing mood defaults to 0. Extra runner and
     * skill fields are retained.
     */
    static fromJson(value: string | Record<string, unknown>): UmaBuilder;
    /** Runner JSON accepted by `fromJson`; requires a complete builder. */
    toJson(indent?: number): string;
    /** A readable summary; unset sections are shown as such. */
    toString(): string;
    stats(stats: Stats): this;
    strategy(strategy: Strategy): this;
    aptitudes({ distance, surface, strategy }: Aptitudes): this;
    /** Add a skill. Repeating an ID replaces the earlier level. */
    skill(skill: Skill, { level, unique }?: SkillOptions): this;
    /**
     * Add a parent's unique skill in its inherited form. Pass the parent's unique
     * (e.g. `Skill.SHOOTING_STAR_100011`) or the inherited member itself.
     * Inherited uniques don't level up, so the skill is added at level 1 and not
     * marked unique.
     */
    inherit(skill: Skill): this;
    mood(mood: number): this;
    /** A new runner object; later builder changes do not affect it. */
    build(): Runner;
}
