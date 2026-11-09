import { Aptitude, Strategy, isMember, nameOf, title } from './enums.js';
import { inheritedSkill, isSkill, isUma, skillDisplayName, skillIsInherited, skillLabel, uniqueSkill, umaLabel, } from './labels.js';
const MOODS = { [-2]: 'Awful', [-1]: 'Bad', 0: 'Normal', 1: 'Good', 2: 'Great' };
const STATS = [['speed', 'Speed'], ['stamina', 'Stamina'], ['power', 'Power'], ['guts', 'Guts'], ['wisdom', 'Wit']];
const APTITUDES = [['distanceAptitude', 'Distance'], ['surfaceAptitude', 'Surface'], ['strategyAptitude', 'Strategy']];
const KNOWN = new Set(['speed', 'stamina', 'power', 'guts', 'wisdom', 'strategy', 'distanceAptitude',
    'surfaceAptitude', 'strategyAptitude', 'charaId', 'mood', 'skills']);
// Python formats stats with str(int) or f'{float:g}'.
const formatNumber = (value) => Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(6)));
// Python's dict.get: a present null is kept (and then rejected), unlike `??`.
const get = (data, key, fallback) => key in data ? data[key] : fallback;
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
export class UmaBuilder {
    #uma;
    #stats;
    #strategy;
    #aptitudes;
    #skills = new Map();
    #mood = 0;
    #extra = {};
    constructor(uma) {
        if (!isUma(uma))
            throw new TypeError('uma must be a Uma member');
        this.#uma = uma;
    }
    /**
     * Load a runner from a JSON string or object. Character and skill IDs must
     * exist in the bundled catalog. Missing mood defaults to 0. Extra runner and
     * skill fields are retained.
     */
    static fromJson(value) {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        if (!isObject(parsed))
            throw new TypeError('Runner JSON must be an object');
        const data = structuredClone(parsed);
        const need = (key) => {
            if (!(key in data))
                throw new Error(`Missing runner field: ${key}`);
            return data[key];
        };
        const charaId = need('charaId');
        if (typeof charaId !== 'number' || !Number.isInteger(charaId))
            throw new Error('charaId must be an integer');
        if (!isUma(charaId))
            throw new RangeError(`Unknown character ID: ${charaId}`);
        const result = new UmaBuilder(charaId);
        const [speed, stamina, power, guts, wisdom] = STATS.map(([key]) => need(key));
        result.stats({ speed: speed, stamina: stamina, power: power, guts: guts, wisdom: wisdom });
        result.strategy(need('strategy'));
        result.aptitudes({ distance: need('distanceAptitude'), surface: need('surfaceAptitude'),
            strategy: need('strategyAptitude') });
        result.mood(get(data, 'mood', 0));
        const skills = get(data, 'skills', []);
        if (!Array.isArray(skills))
            throw new Error('skills must be an array');
        for (const entry of skills) {
            const rawId = isObject(entry) ? entry.skillId : entry;
            if (!(typeof rawId === 'number' && Number.isInteger(rawId) || typeof rawId === 'string' && /^\d+$/.test(rawId))) {
                throw new Error('skillId must be an integer or decimal string');
            }
            const skill = Number(rawId);
            if (!isSkill(skill))
                throw new RangeError(`Unknown skill ID: ${skill}`);
            if (isObject(entry)) {
                result.skill(skill, { level: get(entry, 'level', 1), unique: get(entry, 'isUnique', false) });
                // Keep extra fields, but emit the canonical ID the engine looks up.
                Object.assign(result.#skills.get(skill), entry, { skillId: String(skill) });
            }
            else {
                result.skill(skill);
            }
        }
        result.#extra = Object.fromEntries(Object.entries(data).filter(([key]) => !KNOWN.has(key)));
        return result;
    }
    /** Runner JSON accepted by `fromJson`; requires a complete builder. */
    toJson(indent = 2) {
        return JSON.stringify(this.build(), null, indent);
    }
    /** A readable summary; unset sections are shown as such. */
    toString() {
        const lines = [`${umaLabel(this.#uma)} (#${this.#uma})`];
        const row = (name, value) => lines.push(`  ${name.padEnd(10)} ${value}`);
        const unset = '(not set)';
        row('Strategy', this.#strategy === undefined ? unset : title(nameOf(Strategy, this.#strategy)));
        row('Mood', `${MOODS[this.#mood]} (${this.#mood >= 0 ? '+' : ''}${this.#mood})`);
        const stats = this.#stats;
        row('Stats', stats === undefined ? unset
            : STATS.map(([key, label]) => `${label} ${formatNumber(stats[key])}`).join('  '));
        const aptitudes = this.#aptitudes;
        row('Aptitudes', aptitudes === undefined ? unset
            : APTITUDES.map(([key, label]) => `${label} ${aptitudes[key]}`).join('  '));
        if (this.#skills.size) {
            row('Skills', this.#skills.size);
            const names = new Map([...this.#skills.keys()].map((id) => [id, skillDisplayName(id)]));
            const width = Math.max(...[...names.values()].map((name) => name.length));
            for (const [id, entry] of this.#skills) {
                const unique = entry.isUnique ? '  unique' : '';
                lines.push(`    ${names.get(id).padEnd(width)}  #${String(id).padEnd(9)}  Lv${entry.level}${unique}`);
            }
        }
        else {
            row('Skills', 'none');
        }
        if (Object.keys(this.#extra).length)
            row('Extra', Object.keys(this.#extra).sort().join(', '));
        return lines.join('\n');
    }
    stats(stats) {
        const values = { speed: stats.speed, stamina: stats.stamina, power: stats.power, guts: stats.guts, wisdom: stats.wisdom };
        if (Object.values(values).some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
            throw new RangeError('Stats must be finite nonnegative numbers');
        }
        this.#stats = values;
        return this;
    }
    strategy(strategy) {
        if (!isMember(Strategy, strategy))
            throw new RangeError(`Unknown strategy: ${String(strategy)}`);
        this.#strategy = strategy;
        return this;
    }
    aptitudes({ distance, surface, strategy }) {
        for (const value of [distance, surface, strategy]) {
            if (!isMember(Aptitude, value))
                throw new RangeError(`Unknown aptitude: ${String(value)}`);
        }
        this.#aptitudes = { distanceAptitude: distance, surfaceAptitude: surface, strategyAptitude: strategy };
        return this;
    }
    /** Add a skill. Repeating an ID replaces the earlier level. */
    skill(skill, { level = 1, unique = false } = {}) {
        if (!isSkill(skill))
            throw new TypeError('skill must be a Skill member');
        if (!Number.isInteger(level) || level < 1 || level > 6)
            throw new RangeError('Skill level must be an integer from 1 to 6');
        if (typeof unique !== 'boolean')
            throw new TypeError('unique must be a boolean');
        this.#skills.set(skill, { skillId: String(skill), level, isUnique: unique });
        return this;
    }
    /**
     * Add a parent's unique skill in its inherited form. Pass the parent's unique
     * (e.g. `Skill.SHOOTING_STAR_100011`) or the inherited member itself.
     * Inherited uniques don't level up, so the skill is added at level 1 and not
     * marked unique.
     */
    inherit(skill) {
        if (!isSkill(skill))
            throw new TypeError('skill must be a Skill member');
        const inherited = skillIsInherited(skill) ? skill : inheritedSkill(skill);
        const unique = uniqueSkill(inherited);
        if (this.#skills.get(unique)?.isUnique) {
            throw new Error(`${skillLabel(unique)} is this runner's own unique; it cannot also be inherited`);
        }
        return this.skill(inherited);
    }
    mood(mood) {
        if (!Number.isInteger(mood) || mood < -2 || mood > 2)
            throw new RangeError('Mood must be an integer from -2 to 2');
        this.#mood = mood;
        return this;
    }
    /** A new runner object; later builder changes do not affect it. */
    build() {
        if (this.#stats === undefined || this.#strategy === undefined || this.#aptitudes === undefined) {
            throw new Error('Set stats, strategy, and aptitudes before building');
        }
        return {
            ...structuredClone(this.#extra),
            charaId: this.#uma,
            mood: this.#mood,
            skills: structuredClone([...this.#skills.values()]),
            ...this.#stats,
            strategy: this.#strategy,
            ...this.#aptitudes,
        };
    }
}
//# sourceMappingURL=builder.js.map