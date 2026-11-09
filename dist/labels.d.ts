/** Lookups over the generated catalog: display names and unique/inherited skill pairs. */
import { ChampionsMeeting, Skill, Track, Uma } from './catalog.js';
export declare function isSkill(id: unknown): id is Skill;
export declare function isUma(id: unknown): id is Uma;
export declare function isTrack(id: unknown): id is Track;
export declare function isChampionsMeeting(id: unknown): id is ChampionsMeeting;
/** The `Skill` member name for an ID, e.g. `'SHOOTING_STAR_100011'`. */
export declare function skillName(skill: Skill): string;
/** Display name from uma-tools, e.g. `skillLabel(Skill.CORNER_ADEPT_CIRCLE) === 'Corner Adept ○'`. */
export declare function skillLabel(skill: Skill): string;
/** The label, marked "(inherited)" where the catalog gives both versions the same name. */
export declare function skillDisplayName(skill: Skill): string;
/** Whether this is the inherited version of a unique (its ID with a leading 9 for the 1). */
export declare function skillIsInherited(skill: Skill): boolean;
/** The inherited version of a unique skill. Throws if it has none. */
export declare function inheritedSkill(skill: Skill): Skill;
/** The unique an inherited skill comes from. Throws for skills that are not inherited. */
export declare function uniqueSkill(skill: Skill): Skill;
/**
 * Whether the bundled data/skill_data.json defines this skill. The engine
 * silently ignores skills missing from the table a race uses.
 */
export declare function skillInBundledTable(skill: Skill): boolean;
export declare function umaLabel(uma: Uma): string;
export declare function trackLabel(track: Track): string;
export declare function championsMeetingLabel(cm: ChampionsMeeting): string;
