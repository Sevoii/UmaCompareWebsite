# Debuff classification review

1. **Medium — `tools/gen-skill-data.mjs:126-127`: `target !== 1` is not generally equivalent to “other runners only.”** GlobalSim treats target 2 as all runners, including the owner (`race_solver_builder.rs:334-338`, `race_field.rs:415-417`); other target selectors can also include the owner. A future catalog skill whose sole effect targets 2 would be excluded even though it affects the owner. The current generated catalog contains no target-2 effects, so this does not affect the 42 current classifications. **Fix:** use an explicit set of target codes known to exclude the owner, conservatively retain unknown/all-runner targets, and add a synthetic target-2 regression test.

The current catalog has 42 flagged entries, all matching the generator's stated predicate against `GlobalSim/data/skill_data.json`. No catalog entry has an empty-effect alternative, or a self-effect-only-in-some-alternatives pattern; the nonempty check avoids classifying a wholly empty effects list as a debuff, and flattening retains mixed self/other alternatives. No `lower` edge connects entries with differing debuff flags, so the current recursive costs and tier changes do not cross that boundary. GlobalSim identifies target 1 as self; the broader non-1 assumption has the exception above.

`skill-data.js` is untracked in this workspace, so there is no Git baseline from which to independently verify that regeneration changed nothing except the flags. `node --test tests/` passed all 71 tests.

## Fix check

**Medium — `skill-targets.js:8`: target 23 is not guaranteed to exclude the owner.** In `GlobalSim/src/race_field.rs:442-452`, target 23 takes indices from heal history without filtering `i != index`; the later debuff filter also permits the owner unless immune. If the owner appears in that history, `isDebuff([{effects: [{target: 23}]}])` incorrectly excludes a skill that can affect its user. Remove 23 from `OTHERS_ONLY_TARGETS` for the stated conservative rule, update the spec/comment, regenerate the data, and test this case. Target 4 is correctly classified: both engine branches explicitly exclude `index` (`race_field.rs:420-426`).

The target-2 and unknown-target handling addresses the original finding; hybrid and empty cases are tested. The test suite passed all 72 tests. The pre-debuff comparison is as supplied by the user; no tracked baseline is available here.
