// Captured client races use different stat and aptitude fields from GlobalSim teams.
// Mirrors UmaSim's convert_race.py: import the player's team in member order.
import { inheritedSkill } from './globalsim/index.js';
import { loadTeam } from './compare.js';

const DISTANCES = {
  Short: 'proper_distance_short', Mile: 'proper_distance_mile',
  Middle: 'proper_distance_middle', Long: 'proper_distance_long',
};
const SURFACES = { 1: 'proper_ground_turf', 2: 'proper_ground_dirt' };
const STYLES = {
  1: ['Nige', 'proper_running_style_nige'],
  2: ['Senkou', 'proper_running_style_senko'],
  3: ['Sasi', 'proper_running_style_sashi'],
  4: ['Oikomi', 'proper_running_style_oikomi'],
};

function aptitude(data, field) {
  const grade = { 1: 'G', 2: 'F', 3: 'E', 4: 'D', 5: 'C', 6: 'B', 7: 'A', 8: 'S' }[data[field]];
  if (!grade) throw new Error(`Invalid replay aptitude ${field}: ${data[field]}`);
  return grade;
}

function runnerFromReplay(horse, distance, surface) {
  const data = horse.responseHorseData;
  const extended = String(horse.runningStyleEx ?? 'None');
  let style = STYLES[data.running_style];
  if (['oonige', 'runaway'].includes(extended.toLowerCase())) {
    style = ['Oonige', 'proper_running_style_nige'];
  } else if (extended !== 'None') {
    throw new Error(`Unknown replay runningStyleEx: ${extended}`);
  }
  if (!style) throw new Error(`Unknown replay running_style: ${data.running_style}`);
  if (!Array.isArray(data.skill_array)) throw new Error('Replay horse is missing skill_array');
  return {
    speed: data.speed, stamina: data.stamina, power: data.pow, guts: data.guts, wisdom: data.wiz,
    strategy: style[0],
    distanceAptitude: aptitude(data, distance), surfaceAptitude: aptitude(data, surface),
    strategyAptitude: aptitude(data, style[1]), charaId: data.chara_id,
    skills: data.skill_array.map(({ skill_id, level }) => {
      let isUnique = false;
      try { inheritedSkill(skill_id); isUnique = true; } catch { /* not an own unique */ }
      return { skillId: String(skill_id), level, isUnique };
    }),
  };
}

/** Accept a three-runner array, a saved team object, or a captured race replay. */
export function teamFromFile(json, fileStem) {
  if (json && !Array.isArray(json) && 'raceHorse' in json) {
    if (!Array.isArray(json.raceHorse)) throw new Error('Replay raceHorse must be an array');
    const distance = DISTANCES[json.courseDistanceType];
    const surface = SURFACES[json.raceCourseSet?.ground];
    if (!distance) throw new Error(`Unknown replay courseDistanceType: ${json.courseDistanceType}`);
    if (!surface) throw new Error(`Unknown replay ground: ${json.raceCourseSet?.ground}`);
    const teamId = json.playerTeamMemberArray?.[0]?.responseHorseData?.team_id;
    if (teamId == null) throw new Error('Replay is missing the player team ID');
    const horses = json.raceHorse
      .filter((horse) => horse.responseHorseData?.team_id === teamId)
      .sort((a, b) => a.responseHorseData.team_member_id - b.responseHorseData.team_member_id);
    if (!horses.length) throw new Error(`No player team ${teamId} in this replay`);
    return loadTeam({
      id: `${fileStem}-team${teamId}`,
      members: horses.map((horse) => runnerFromReplay(horse, distance, surface)),
    }, fileStem);
  }
  return loadTeam(json, fileStem);
}
