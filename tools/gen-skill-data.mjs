// Generate skill-data.js: what the skill optimizer needs to know about every buyable skill.
//
//   node tools/gen-skill-data.mjs <hakuraku checkout> <GlobalSim checkout>
//
// For each skill in the GlobalSim catalog that has an SP cost:
//   need     SP to buy it on its own (hakuraku umdb: SingleModeSkillNeedPoint, MIT)
//   rarity   1 white / normal, 2 gold, ... (hakuraku umdb Skill.rarity)
//   grade    Skill.grade_value; negative for the "×" self-penalty skills
//   lower    the next tier down that this skill upgrades, or absent. Within a group (id / 10),
//            the non-negative skills are ordered by rarity, then ○ before ◎ (◎ has the lower id), as
//            umalator does (uma-tools components/SkillList.tsx skillGroups/costForId); each skill's
//            lower is the one before it, so e.g. Right-Handed Demon <- ◎ <- ○. Negative "×" skills
//            are never part of the chain. A build lists only its top tier, and buying it costs the
//            whole chain below it too.
//   debuff   1 when every effect targets only other runners (skill-targets.js isDebuff), e.g.
//            Subdued / Hesitant / Frenzied ..., Intimidate. Skills that also buff the uma (Speed Eater,
//            Stamina Siphon, ...) are not debuffs. Absent otherwise.
//   options  when the skill can possibly activate, as static conditions: an array of options
//            (OR), each an array of [key, op, value] terms (AND). null = no static restriction.
//            From GlobalSim data/skill_data.json: alternatives x (condition '@' branches) x
//            (precondition '@' branches), keeping only terms decidable before the race (see
//            STATIC_KEYS). An option whose terms are all true for the uma + race means "possible".
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { isDebuff } from '../skill-targets.js';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const [hakuraku, globalsim] = process.argv.slice(2);
if (!hakuraku || !globalsim) throw new Error('usage: node tools/gen-skill-data.mjs <hakuraku checkout> <GlobalSim checkout>');

// Keys decidable from the uma and the race conditions alone (the engine's encodings, see
// GlobalSim src/activation_conditions.rs and race_parameters.rs; documented in skill-data.js).
// base_* stat conditions are deliberately left out: the engine compares mood/rank-adjusted
// stats, not the raw input, so they are treated as possibly true.
const STATIC_KEYS = new Set([
  'running_style', 'distance_type', 'ground_type', 'track_id', 'course_distance', 'is_basis_distance',
  'rotation', 'season', 'weather', 'ground_condition', 'time', 'grade', 'motivation',
]);

// ---- hakuraku umdb: costs, rarity, grade ----
function* fields(buf) {
  let i = 0;
  const varint = () => {
    let r = 0n, s = 0n;
    for (;;) { const b = buf[i++]; r |= BigInt(b & 0x7f) << s; if (!(b & 0x80)) return r; s += 7n; }
  };
  while (i < buf.length) {
    const key = Number(varint());
    const num = key >> 3, wire = key & 7;
    if (wire === 0) yield [num, wire, varint()];
    else if (wire === 2) { const n = Number(varint()); yield [num, wire, buf.subarray(i, i + n)]; i += n; }
    else if (wire === 1) i += 8;
    else if (wire === 5) i += 4;
    else throw new Error(`unsupported wire type ${wire}`);
  }
}
const zigzag = (v) => Number((v >> 1n) ^ -(v & 1n)); // sint32
const umdb = gunzipSync(readFileSync(join(hakuraku, 'public/data/umdb.binarypb.gz')));
const need = new Map();
const meta = new Map();
for (const [num, wire, value] of fields(umdb)) {
  if (wire !== 2) continue;
  if (num === 13) { // SingleModeSkillNeedPoint { id = 1, need_skill_point = 2 }
    let id, points;
    for (const [n, , v] of fields(value)) { if (n === 1) id = Number(v); if (n === 2) points = Number(v); }
    if (id) need.set(id, points);
  } else if (num === 7) { // Skill { id = 1, grade_value = 3 (sint32), rarity = 5 }
    let id, grade = 0, rarity;
    for (const [n, w, v] of fields(value)) {
      if (w !== 0) continue;
      if (n === 1) id = Number(v);
      if (n === 3) grade = zigzag(v);
      if (n === 5) rarity = Number(v);
    }
    if (id) meta.set(id, { grade, rarity });
  }
}

// ---- GlobalSim skill conditions ----
const skillData = JSON.parse(readFileSync(join(globalsim, 'data/skill_data.json'), 'utf8'));
const TERM = /^([a-z_0-9]+)(==|!=|>=|<=|>|<)(-?\d+(?:\.\d+)?)$/;
const staticTerms = (conjunction) => conjunction.split('&').map((part) => part.match(TERM))
  .filter((m) => m && STATIC_KEYS.has(m[1])).map((m) => [m[1], m[2], Number(m[3])]);
const branches = (text) => (text ? text.split('@') : ['']);

function options(id) {
  const entry = skillData[String(id)];
  if (!entry?.alternatives?.length) return null;
  const result = [];
  for (const alt of entry.alternatives) {
    for (const pre of branches(alt.precondition)) {
      for (const cond of branches(alt.condition)) {
        const terms = [...staticTerms(pre), ...staticTerms(cond)];
        if (!terms.length) return null; // some way to activate with no static restriction
        const key = JSON.stringify(terms);
        if (!result.some((o) => JSON.stringify(o) === key)) result.push(terms);
      }
    }
  }
  return result;
}

const { Skill } = await import(new URL('../globalsim/index.js', import.meta.url));
const catalog = new Set(Object.values(Skill));

// Upgrade chains: per group, the buyable non-negative skills sorted by rarity, then higher id
// first (○ before ◎); each skill's lower tier is the previous one.
const lowerTier = new Map();
const groups = new Map();
for (const id of catalog) {
  if (!need.has(id) || (meta.get(id)?.grade ?? 0) < 0) continue;
  const g = Math.floor(id / 10);
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push(id);
}
for (const ids of groups.values()) {
  ids.sort((a, b) => (meta.get(a)?.rarity ?? 1) - (meta.get(b)?.rarity ?? 1) || b - a);
  for (let i = 1; i < ids.length; i++) lowerTier.set(ids[i], ids[i - 1]);
}
const out = {};
for (const id of catalog) {
  if (!need.has(id)) continue; // no SP cost: not buyable (e.g. not on Global yet)
  const { grade = 0, rarity = 1 } = meta.get(id) ?? {};
  const entry = { need: need.get(id), rarity, grade };
  if (isDebuff(skillData[String(id)]?.alternatives)) entry.debuff = 1;
  const lower = lowerTier.get(id);
  if (lower) entry.lower = lower;
  const opts = options(id);
  if (opts) entry.options = opts;
  out[id] = entry;
}

writeFileSync(join(site, 'skill-data.js'),
  '// Generated by tools/gen-skill-data.mjs from hakuraku umdb (MIT) and GlobalSim data/skill_data.json. Do not edit.\n'
  + '// skill id -> { need, rarity, grade, lower?, debuff?, options? } (see the tool for field meanings).\n'
  + '// options: static activation conditions, [[[key, op, value], ...], ...] = OR of ANDs; absent = always possible.\n'
  + '// Value encodings (GlobalSim engine): running_style 1 Front (Runaway also matches 1), 2 Pace, 3 Late, 4 End;\n'
  + '// distance_type 1 Sprint..4 Long; ground_type 1 Turf 2 Dirt; rotation = course turn (1 right, 2 left, 4 straight);\n'
  + '// season 1 Spring 2 Summer 3 Autumn 4 Winter 5 Sakura; weather 1 Sunny 2 Cloudy 3 Rainy 4 Snowy;\n'
  + '// ground_condition 1 Firm 2 Good 3 Soft 4 Heavy (Global names); time 1 Morning 2 Midday 3 Evening 4 Night;\n'
  + '// grade 100 = G1; motivation = mood + 3 (Champions Meeting: 5); is_basis_distance 1 when distance % 400 == 0;\n'
  + '// base_speed etc. = the uma\'s stats; track_id / course_distance from the course.\n'
  + `export const SKILL_DATA = ${JSON.stringify(out)};\n`);
const counts = Object.values(out);
console.log(`${counts.length} buyable skills; ${counts.filter((s) => s.options).length} with static conditions; `
  + `${counts.filter((s) => s.lower).length} upgrades; ${counts.filter((s) => s.grade < 0).length} negative; ${counts.filter((s) => s.debuff).length} debuffs`);
