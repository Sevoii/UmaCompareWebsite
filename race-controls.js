// Shared race-condition controls: a Champions Meeting preset, or any course and conditions.
// A preset fills in the course and conditions; changing any of them turns the preset into
// "Custom" (or into a meeting whose conditions match).
import { Course, Ground, RacePreset, Season, Time, Weather, trackLabel } from './globalsim/index.js';
import { CM_NAMES, cmFromNumber, raceFromMeeting } from './compare.js';

const RACE_KEYS = ['courseId', 'ground', 'weather', 'season', 'time'];

/**
 * Wire up the race controls (all <select> elements, filled in here).
 * @param {object} [options]
 * @param {object} [options.ids] element ids: { preset, track, course, ground, weather, season, time }
 * @param {Document|HTMLElement} [options.root] where to look the elements up (default: document)
 * @param {() => void} [options.onChange] called after every change of the race (also at creation)
 * @returns {{
 *   meetings: number[], meetingRace: Map<number, object>, currentRace: () => object,
 *   currentCourse: () => object, selectMeeting: (number: number) => void,
 *   applyRace: (race: object) => void,
 * }}
 */
export function createRaceControls({ ids = {}, root = document, onChange = () => {} } = {}) {
  const id = {
    preset: 'racePreset', track: 'raceTrack', course: 'raceCourse', ground: 'raceGround',
    weather: 'raceWeather', season: 'raceSeason', time: 'raceTime', ...ids,
  };
  const $ = (key) => root.getElementById ? root.getElementById(id[key]) : root.querySelector(`#${id[key]}`);

  const MEETINGS = CM_NAMES.map((_, i) => CM_NAMES.length - i); // newest first
  const meetingRace = new Map(MEETINGS.map((n) => [n, raceFromMeeting(cmFromNumber(n))]));
  // Racecourses without a name aren't in Global (umalator leaves them out too).
  const COURSES = Course.all().filter((c) => !/^Track \d+$/.test(trackLabel(c.track)));
  const CONDITIONS = { ground: Ground, weather: Weather, season: Season, time: Time };

  $('preset').add(new Option('Custom', ''));
  for (const number of MEETINGS) {
    const preset = RacePreset.championsMeeting(cmFromNumber(number));
    $('preset').add(new Option(`CM${number}: ${preset.name} (${preset.date}), ${preset.course}`, String(number)));
  }
  for (const track of [...new Set(COURSES.map((c) => c.track))]) $('track').add(new Option(trackLabel(track), String(track)));
  for (const [key, values] of Object.entries(CONDITIONS)) {
    for (const value of Object.values(values)) $(key).add(new Option(value, value));
  }

  /** Fill the Course list for a racecourse, keeping a course with the same surface and distance if there is one. */
  function fillCourses(track, keep = null) {
    const select = $('course');
    select.innerHTML = '';
    const prefix = `${trackLabel(track)} `;
    const courses = COURSES.filter((c) => c.track === track)
      .sort((a, b) => a.surface - b.surface || a.distance - b.distance || a.layout - b.layout);
    for (const course of courses) select.add(new Option(String(course).replace(prefix, ''), String(course.id)));
    const same = keep && courses.find((c) => c.surface === keep.surface && c.distance === keep.distance);
    if (same) select.value = String(same.id);
  }

  /** The race conditions the controls describe (with the meeting's name if they are exactly a meeting's). */
  function currentRace() {
    const race = {
      courseId: Number($('course').value), ground: $('ground').value, weather: $('weather').value,
      season: $('season').value, time: $('time').value, preset: null,
    };
    const meeting = meetingRace.get(Number($('preset').value));
    if (meeting && RACE_KEYS.every((k) => meeting[k] === race[k])) race.preset = meeting.preset;
    return race;
  }
  const currentCourse = () => Course.get(Number($('course').value));

  function applyRace(race) {
    const course = Course.get(race.courseId);
    $('track').value = String(course.track);
    fillCourses(course.track);
    $('course').value = String(course.id);
    $('ground').value = race.ground;
    $('weather').value = race.weather;
    $('season').value = race.season;
    $('time').value = race.time;
  }

  /** Select a Champions Meeting preset (1-based number) and show its conditions. */
  function selectMeeting(number) {
    $('preset').value = String(number);
    applyRace(meetingRace.get(number));
    onChange();
  }

  /** After a manual change: show the meeting these conditions match, or "Custom". */
  function syncPreset() {
    const race = currentRace();
    const match = MEETINGS.find((n) => {
      const m = meetingRace.get(n);
      return RACE_KEYS.every((k) => m[k] === race[k]);
    });
    $('preset').value = match ? String(match) : '';
    onChange();
  }

  $('preset').addEventListener('change', () => {
    if ($('preset').value) selectMeeting(Number($('preset').value));
  });
  $('track').addEventListener('change', () => {
    fillCourses(Number($('track').value), currentCourse());
    syncPreset();
  });
  for (const key of ['course', ...Object.keys(CONDITIONS)]) $(key).addEventListener('change', syncPreset);
  selectMeeting(MEETINGS[0]);

  return { meetings: MEETINGS, meetingRace, currentRace, currentCourse, selectMeeting, applyRace };
}
