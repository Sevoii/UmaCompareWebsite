/** GlobalSim for JavaScript: builders, catalog, prepared races and a worker pool over the wasm engine. */
export { Skill, Uma, Track, ChampionsMeeting, BUNDLED_SKILL_IDS, COURSES } from './catalog.js';
export { Aptitude, DistanceCategory, Grade, Ground, Layout, Season, Strategy, Surface, Time, Turn, Weather, groundFromEngine, groundToEngine, isMember, nameOf, type EngineGround, } from './enums.js';
export { championsMeetingLabel, inheritedSkill, isChampionsMeeting, isSkill, isTrack, isUma, skillDisplayName, skillInBundledTable, skillIsInherited, skillLabel, skillName, trackLabel, umaLabel, uniqueSkill, } from './labels.js';
export type { RaceFrame, RaceRequest, RaceResult, Runner, RunnerFrame, RunnerResult, SkillEntry } from './models.js';
export { UmaBuilder, type Aptitudes, type SkillOptions, type Stats } from './builder.js';
export { Course, RaceBuilder, RacePreset, type BuildOptions } from './race.js';
export { FIELDS, Replay, decode } from './replay.js';
export { PreparedRace, ensureGeometry, init, loadCourseGeometry, needsGeometry, registerCourseGeometry, setGeometrySource, type GeometryLoader, type RequestInput, type WasmSource, } from './engine.js';
export { RacePool, type PoolOptions, type PoolWorker, type RunOptions } from './pool.js';
