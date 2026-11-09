/** GlobalSim for JavaScript: builders, catalog, prepared races and a worker pool over the wasm engine. */
export { Skill, Uma, Track, ChampionsMeeting, BUNDLED_SKILL_IDS, COURSES } from './catalog.js';
export { Aptitude, DistanceCategory, Grade, Ground, Layout, Season, Strategy, Surface, Time, Turn, Weather, groundFromEngine, groundToEngine, isMember, nameOf, } from './enums.js';
export { championsMeetingLabel, inheritedSkill, isChampionsMeeting, isSkill, isTrack, isUma, skillDisplayName, skillInBundledTable, skillIsInherited, skillLabel, skillName, trackLabel, umaLabel, uniqueSkill, } from './labels.js';
export { UmaBuilder } from './builder.js';
export { Course, RaceBuilder, RacePreset } from './race.js';
export { FIELDS, Replay, decode } from './replay.js';
export { PreparedRace, ensureGeometry, init, loadCourseGeometry, needsGeometry, registerCourseGeometry, setGeometrySource, } from './engine.js';
export { RacePool } from './pool.js';
//# sourceMappingURL=index.js.map