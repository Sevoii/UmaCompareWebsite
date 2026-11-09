/** Lookups over the generated catalog: display names and unique/inherited skill pairs. */
import { BUNDLED_SKILL_IDS, CHAMPIONS_MEETING_LABELS, SKILL_LABELS, Skill, TRACK_LABELS, UMA_LABELS, } from './catalog.js';
const has = (table, key) => Object.prototype.hasOwnProperty.call(table, key);
let skillNames;
export function isSkill(id) {
    return typeof id === 'number' && Number.isInteger(id) && has(SKILL_LABELS, id);
}
export function isUma(id) {
    return typeof id === 'number' && Number.isInteger(id) && has(UMA_LABELS, id);
}
export function isTrack(id) {
    return typeof id === 'number' && Number.isInteger(id) && has(TRACK_LABELS, id);
}
export function isChampionsMeeting(id) {
    return typeof id === 'string' && has(CHAMPIONS_MEETING_LABELS, id);
}
function requireSkill(id) {
    if (!isSkill(id))
        throw new RangeError(`Unknown skill ID: ${String(id)}`);
    return id;
}
/** The `Skill` member name for an ID, e.g. `'SHOOTING_STAR_100011'`. */
export function skillName(skill) {
    skillNames ??= new Map(Object.entries(Skill).map(([name, id]) => [id, name]));
    return skillNames.get(requireSkill(skill));
}
/** Display name from uma-tools, e.g. `skillLabel(Skill.CORNER_ADEPT_CIRCLE) === 'Corner Adept ○'`. */
export function skillLabel(skill) {
    return SKILL_LABELS[requireSkill(skill)];
}
/** The label, marked "(inherited)" where the catalog gives both versions the same name. */
export function skillDisplayName(skill) {
    const label = skillLabel(skill);
    return skillIsInherited(skill) && !label.includes('(inherited)') ? `${label} (inherited)` : label;
}
/** Whether this is the inherited version of a unique (its ID with a leading 9 for the 1). */
export function skillIsInherited(skill) {
    const text = String(requireSkill(skill));
    return text[0] === '9' && has(SKILL_LABELS, Number('1' + text.slice(1)));
}
/** The inherited version of a unique skill. Throws if it has none. */
export function inheritedSkill(skill) {
    const text = String(requireSkill(skill));
    const id = Number('9' + text.slice(1));
    if (text[0] !== '1' || !isSkill(id))
        throw new RangeError(`${skillName(skill)} has no inherited version`);
    return id;
}
/** The unique an inherited skill comes from. Throws for skills that are not inherited. */
export function uniqueSkill(skill) {
    if (!skillIsInherited(skill))
        throw new RangeError(`${skillName(skill)} is not an inherited skill`);
    return Number('1' + String(skill).slice(1));
}
/**
 * Whether the bundled data/skill_data.json defines this skill. The engine
 * silently ignores skills missing from the table a race uses.
 */
export function skillInBundledTable(skill) {
    return BUNDLED_SKILL_IDS.has(requireSkill(skill));
}
export function umaLabel(uma) {
    if (!isUma(uma))
        throw new RangeError(`Unknown character ID: ${String(uma)}`);
    return UMA_LABELS[uma];
}
export function trackLabel(track) {
    if (!isTrack(track))
        throw new RangeError(`Unknown track ID: ${String(track)}`);
    return TRACK_LABELS[track];
}
export function championsMeetingLabel(cm) {
    if (!isChampionsMeeting(cm))
        throw new RangeError(`Unknown Champions Meeting: ${String(cm)}`);
    return CHAMPIONS_MEETING_LABELS[cm];
}
//# sourceMappingURL=labels.js.map