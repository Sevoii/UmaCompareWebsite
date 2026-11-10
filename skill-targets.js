// Which GlobalSim skill effect targets can never include the uma using the skill. From the engine's
// RaceField::skill_targets (GlobalSim src/race_field.rs): 4 visible runners, 9 runners ahead, 10
// runners behind, 18 / 21 runners of a running style, 19 / 20 rushed runners ahead / behind all
// exclude the owner. 23 (the runners that recently recovered stamina) is not filtered by the engine
// and can include the owner if it healed itself, but the only skills using it (Catch 'Em Off Guard,
// Oppression) drain stamina: hitting the owner could only hurt it, so they are still never worth
// buying, which is what "debuff" means here. Counted as others-only on purpose.
// 1 is the owner, and 2 (everyone), 11 (the team) and 22 (a character) can include it, as can any
// target code not listed here: unknown codes are treated as possibly the owner.
export const OTHERS_ONLY_TARGETS = new Set([4, 9, 10, 18, 19, 20, 21, 23]);

/**
 * Whether a skill is a pure debuff: it has effects and every one of them (across all its
 * alternatives) targets only other runners.
 * @param {{effects: {target: number}[]}[]} alternatives GlobalSim skill_data.json `alternatives`
 */
export function isDebuff(alternatives = []) {
  const targets = alternatives.flatMap((a) => (a.effects ?? []).map((e) => Number(e.target)));
  return targets.length > 0 && targets.every((t) => OTHERS_ONLY_TARGETS.has(t));
}
