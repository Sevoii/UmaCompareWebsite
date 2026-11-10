# Skill optimizer: spec

A new page, `optimizer.html`, that searches for the best set of skills to buy for one uma, given
its stats, aptitudes, running style, SP budget and a Champions Meeting, by simulating it inside
representative teams with GlobalSim.

## Ground rules

- Plain ES modules in the site root, no build step, no new dependencies. Bootstrap 5.3.8 from the
  CDN plus `style.css`, same dark theme and `uc-*` classes as `index.html`. Reuse, don't copy.
- JS style: 2-space indent, single quotes, semicolons, JSDoc on exported functions (match
  `compare.js`, `team-picker.js`). Inline `<script type="module">` in HTML uses 4 spaces (match
  `index.html`).
- Do not change the compare page's behaviour. Allowed edits outside the new files:
  - `compare.js`: `export` the existing `runTrial` (no logic change).
  - `index.html`: a nav link to the optimizer (and the same nav on the optimizer page).
  - `style.css`: append new `.uc-opt-*` rules at the end.
- Engine skill IDs are strings in runner JSON (`{ skillId: "200462", level: 1, isUnique: false }`).

## Existing pieces to reuse

| What | Where |
|---|---|
| Race conditions object `{courseId, ground, weather, season, time, preset}`, `raceFromMeeting(cm)`, `buildRace`, `cmFromNumber`, `CM_NAMES`, `drawTrials`, `meanCi`, `pairedDifferenceCi`, `wilsonCi`, `TEAM_SIZE`, `MOOD`, `strategyName`, `runTrial` (to export) | `compare.js` |
| Race-condition controls (preset + racecourse/course/ground/weather/season/time) | `index.html` script, "Race conditions" section. Factor it into a shared module `race-controls.js` used by both pages (keep index.html working identically) |
| Worker pool pattern (spawn `navigator.hardwareConcurrency` module workers, chunked batches, progress) | `runTrials` in `index.html` |
| Characters + costumes, unique skill of a costume (`uniqueForOutfit`), portraits | `outfits.js`, `team-picker.js` (`outfitsOf`, `uniqueForOutfit`, `portraitUrl`, `umaChipBody`, `escapeHtml`, `ICONS`), `uma-editor.js` (`skillIconUrl`, stat-rank glyphs) |
| hakuraku API base + team member -> runner JSON (`memberToRunner`) | `hakuraku-import.js` |
| Skill costs / tiers / static activation conditions | `skill-data.js` (generated; read its header) |
| Saving an uma | `roster.js` (`Roster.load().addUma(data, {name})`) |
| Opponent pools | `pools/index.json` + `pools/*.json` (arrays of `{id, members:[runner JSON x3]}`) |
| Labels | `globalsim/index.js`: `skillLabel`, `umaLabel`, `Strategy`, `Course`, `isSkill`, `inheritedSkill`, `skillIsInherited` |

## Inputs (form on the page)

1. **Race**: the shared race controls (preset / course / conditions).
2. **Uma**: character + costume (search list like the uma editor's combobox, built from
   `outfits.js`; the costume's unique = `uniqueForOutfit(outfitId)` if `isSkill`), unique level
   (1–6, default 4), the five stats (1–2000), running style (`Strategy` values), and the three
   aptitudes for this race: surface, distance, style (S..G). Note the aptitudes are entered for
   the selected course (as in the uma editor), not the full 10-aptitude table.
3. **SP budget** (integer, e.g. 3000) and **hint discount %** (0–40, default 0). One helper is
   used everywhere (sampling, mutation, UI, tests):
   `discountedNeed(id) = Math.round(SKILL_DATA[id].need * (1 - pct / 100))`;
   `skillCost(id) = discountedNeed(id) + (lower ? discountedNeed(lower) : 0)` (rounded per
   component, never on the sum).
4. **Inherited uniques the uma has**: multi-select over catalog skills where
   `skillIsInherited(id)` and the id is in `SKILL_DATA` (searchable list). Only these may be
   bought; none by default.
5. **Archetype + slot**: select from the snapshot's archetypes (see Data), sorted by
   popularity (`teamPop`), label e.g. `Front / Pace / Debuffer (12.3%)`; then which of its three
   slots the uma fills (default: first slot whose style equals the uma's running style; style 6
   "Debuffer" is a role, any running style may take it).
6. **Opponent pool**: select from `pools/index.json` (like the compare page). Default to a pool
   whose `cm` matches the selected meeting; if the chosen pool's `cm` differs (or the race is
   Custom), show a visible warning. The result header names all three sources: race, hakuraku
   snapshot, pool.
7. **Search settings**: population (default 64), trials per build per generation (default
   200), max generations (default 12), elite fraction (default 0.2), score (select, default
   **Average place**; also **Team win rate**, **Uma win rate**).
8. Buttons: **Optimize**, **Stop** (finishes nothing more; terminates workers, keeps results so far).
   **Resume** continues from the last fully evaluated generation, with the original frozen inputs,
   teams and random streams, for up to another configured maximum number of generations. The
   stopping counter resets on resume. A partial generation remains visible after Stop but is not
   used as a breeding checkpoint. Resume is available in memory until reload or a new optimization.

Persist the form in `localStorage` (`umacompare:optimizer`) with try/catch.

## Data (hakuraku, fetched at run start, cached in memory per snapshot)

API base `https://hakuraku.moe/api/simdata` (CORS open). Snapshot ids rotate (e.g. CM22 is
`cm22-2026-11-09` today): always read `/manifest` and pick the newest snapshot (by
`meta.window`) whose `cmId === 'cm' + meetingNumber`. For a Custom race, show a snapshot select
(all manifest snapshots) instead; default the newest.

- `/snapshots/{id}/uma-usage` → `skills: [{id, style, players}]` (style 0 = all, 1..5 running
  styles) and `archetypes: {"1-2-6": teamCount, ...}`.
- `/snapshots/{id}/summary` → `styles: [{style, name, owners, ...}]` (players per style, 1..6)
  and `archetypes: [{key, name, teamPop, team, owners, ...}]`.
- `/snapshots/{id}/teams?slots=<JSON>&players=unique&sort=lower&limit=100&offset=N` →
  `{totalTeams, teams: [{id, members: [hakuraku member]}]}`. Slots for archetype `"1-2-6"` are
  `[{"style":1},{"style":2},{"style":6}]`. Fetch up to 3 pages (300 teams).

## Skill pool and prior ("% distribution")

- **Eligible** skills: in `SKILL_DATA`, `grade >= 0`, not the uma's own unique (compare as
  numbers; the own unique is `uniqueForOutfit(outfitId)` and only exists if `isSkill` of it), not an evolved
  skill (9-digit ids), not group `20205` (Runaway: buying it changes the strategy) unless the uma's
  strategy is `Oonige`, inherited uniques only if listed, and **possible**: `options` absent, or
  some option whose every term holds for this uma + race (encodings in `skill-data.js` header;
  `running_style` uses the base style, Runaway counts as 1; `motivation` is 5 in a CM;
  `grade` is 100; `rotation` = `Course.get(courseId).turn`; `track_id` = course.track;
  `distance_type` = course.category; `ground_type` = course.surface; `ground_condition` from the
  Global ground name Firm/Good/Soft/Heavy = 1/2/3/4; weather/season/time from their names).
  `is_basis_distance` is already the effective meaning: its value is `distance % 400 === 0 ? 1 : 0`
  (the engine inverts internally; do not reproduce that). Test: skill 200131
  (`is_basis_distance==1`) must be possible on 1600 m and impossible on 1800 m; 200141
  (`is_basis_distance==0`) the opposite.
  The filter is deliberately **conservative**: only the keys present in `options` are checked;
  conditions on anything else (including `is_dirtgrade`, `is_tight_track`, positions, phases)
  are treated as possibly true, so a skill is excluded only when it can definitely never fire.
- **Tiers**: whites (and ○) are first-class: a build may hold a white on its own. A build holds
  at most **one skill per group** (`Math.floor(id / 10)`). An upper tier (`lower` set: gold over
  its white, ◎ over ○, possibly several steps: Demon <- ◎ <- ○) is listed instead of its lower
  tiers, never alongside them, and `skillCost(id)` pays the whole chain. Chains come from
  `skill-data.js` `lower` (umalator's ordering; "×" skills are never in a chain). Stat (`base_*`)
  conditions are not in the static filter (the engine uses mood-adjusted stats). So "white → gold" in a mutation means replacing the white with
  its gold (paying the gold's extra `discountedNeed`), and "gold → white" the reverse.
- **Prior weights** (the user's rule): for the uma's running style s (1..4; a Runaway uses
  styles 1 **and** 5 summed, since runaways also count as front runners),
  `count(id) = players` from `uma-usage.skills` where `style` is in that set (0 if absent); weight =
  `count + smoothing` (default 5) for every eligible skill (the smoothing makes every possible skill samplable). The
  displayed % is `count / stylePlayers`, with `stylePlayers` = `summary.styles[].owners` summed
  over the same style set. Show the prior on the page as a sortable table: skill, cost, %, weight
  share.

## Field per trial

- Our team = our uma at the chosen slot index + two **teammates**: pick a random fetched
  archetype team, drop the member occupying our slot, convert the other two with
  `memberToRunner` (skip the team on error), keep their order, and insert our uma at the slot
  index. Hakuraku members carry both `style` (the archetype role code 1..6, where 6 = Debuffer;
  this is what `/teams?slots=` filters on) and `racingStyle` (the real running style 1..5).
  Identify our slot's member by **`member.style === slotStyle`** (first match when two members
  share it; with identical role codes either is equivalent). Skip teams with no match.
  Pre-convert all teams once; keep the count of usable teams visible.
- **Opponents**: 2 distinct random teams from the selected local pool.
- Seed + gate permutation + opponents from `drawTrials`; teammate team index drawn per trial.
- Every candidate in a generation races on the **same** trial list (common random numbers) so
  comparisons are paired.

## Evaluation

- Worker `optimizer-worker.js` (module). Every message has an `id` echoed in its replies.
  `init {id, race, pool, teammates, slot}` → `ready {id}` (context validated with
  `validateContext` and kept only after the engine is ready); `run {id, candidates, trials}` →
  `progress {id, trial, races, result}` after each trial (`result` = that trial's per-candidate
  results, so Stop keeps finished trials), then `done {id, results}`; failures →
  `error {id, message}`; a run before a successful init errors, and any init first drops the old
  context. The handler lives in `optimizer-protocol.js` (tested in Node). For each trial and candidate: our uma's
  place (`orders[slot] + 1`), team win (`min(orders) === 0`), uma win (`orders[slot] === 0`), and
  the skill ids our uma activated (`skills[slot]`). Use `runTrial` from `compare.js`. Our runner
  JSON = base uma (stats, strategy, aptitudes, charaId, outfitId) + skills
  `[...(isSkill(unique) ? [{ skillId: String(unique), level: uniqueLevel, isUnique: true }] : []),
  ...bought.map(id => ({ skillId: String(id), level: 1, isUnique: false }))]` (never emit an
  undefined unique).
- Parallelism: like `runTrials`, chunk the trial list across workers; each worker message runs
  all candidates on its chunk of trials. Progress = races done / total.
- Per candidate: mean score with 95% CI (`meanCi` for place; win rates as proportions with
  `wilsonCi`), and per-skill activation rate for our uma.
- Ranking: by mean score (lower is better for place, higher for win rates).

## Search

1. **Initial population**: `population` builds by greedy sampling: draw eligible skills by
   weight without replacement, only among skills whose group isn't held and that fit the
   remaining SP; stop when none fit (implemented in `greedyFill`; no miss cutoff). Builds should be
   distinct (canonical key = sorted ids): retry a duplicate at most 20 times, then accept a
   smaller population (show a warning). All later math uses the actual population size.
2. Each generation: draw `trialsPerBuild` trials; evaluate every build; rank.
3. **Elites** = top `ceil(eliteFraction * population)`; carried over unchanged.
4. **Distribution update** (cross-entropy): `p ← 0.7·p + 0.3·f`, where `p` is the normalized
   prior and `f` the share of elites holding each skill; add a floor `0.02 / eligibleCount` so
   nothing reaches 0. Sampling for new skills uses this `p`.
5. **Offspring** (fill to `population`, distinct from each other and from elites):
   - 40% **crossover**: two elites (tournament of 2 by rank); union of their skills (one per group,
     upper tier wins); while over budget remove a skill chosen with weight
     `1 / (0.05 + activationRate × p)`; then greedy refill.
   - 30% **drop-and-refill** from one elite: remove 1–3 skills (count uniform), chosen with weight
     `1 / (0.05 + activationRate)` (rarely-firing skills go first); with 25% chance also try one
     tier change (white→its gold if affordable, or gold→white); then greedy refill.
   - 10% drop-and-refill from a uniformly selected parent in the best 20% of the non-elite population.
     If no non-elite parent exists, use a fresh sample.
   - 20% **fresh** greedy samples from the original prior, not the learned distribution.
   `activationRate` = that skill's activation rate for the parent in the last evaluation (0 if
   never seen).
6. **Stop** after `maxGenerations`, or when for 2 consecutive generations the new best does not
   significantly beat the previous generation's best. Each generation draws a new trial list, so
   the previous best is always included in the next generation's evaluation (it is an elite;
   force-include it even if elites change) and the comparison uses both builds' scores on the
   **current** trials: per-trial `d = current - previous`, `pairedDifferenceCi(d)`. Significant =
   CI upper bound `< 0` for Average place (lower is better), CI lower bound `> 0` for either win
   rate. The final winner is the best build on the last generation's trials (report its score
   and CI from those trials).

## Output

- Live progress: generation n/max, races done, a table per generation (best score ± CI, elite
  mean, best build's SP used), and the current best build.
- Final: best build card: portrait, name, unique, skills with icons (`skillIconUrl`), each skill's
  cost and activation rate, SP used / budget, score ± CI; runner-up builds (top 5) collapsed.
- Buttons on a build: **Save to roster** (adds the runner JSON via `Roster.addUma`, name =
  "<character> (optimized)") and **Export JSON** (download).

## Files

- `optimizer.html`: page + inline module script (UI wiring only).
- `optimizer-core.js`: pure logic, no DOM, importable in Node: eligibility, costs, prior,
  greedy sampling, mutation, crossover, distribution update, stopping test, seeded RNG option
  (`mulberry32`) so tests are deterministic.
- `optimizer-data.js`: hakuraku fetch + snapshot/archetype helpers.
- `optimizer-worker.js`: evaluation worker.
- `race-controls.js`: shared race-condition controls (index.html switches to it, same behaviour).
- `tests/optimizer-core.test.mjs`: `node --test` tests for eligibility (style/distance/surface
  rules, `is_basis_distance` on 1600 vs 1800 m, Runaway matching style 1, tiers), cost (upgrade +
  per-component discount rounding), greedy fill never exceeds budget and fills as far as
  possible, mutations keep validity (one per group, within budget), bounded distinct population
  with a tiny budget (terminates, smaller population), distribution update, stopping rule
  direction for place vs win rate, runner JSON without a unique.

## Testing

- `node --test tests/` must pass.
- Browser: serve the site (`python -m http.server 8765` from the site root) and drive headless
  Edge via CDP. A working harness header is at
  `C:\Users\a\AppData\Local\Temp\claude\46130f5200a28e15\6f8e6b0d-12d9-4c84-a3b9-7c1e1182336d\scratchpad\cdp_header.mjs`
  (see `cdp_strips_body.mjs` next to it for usage; concatenate header + your body, run with
  `node file.mjs "<msedge.exe>" http://127.0.0.1:8765/optimizer.html <profile dir> <out dir>`).
  Run a small optimization (population 8, 20 trials, 2 generations) end to end and check the
  page shows a best build within budget. Also re-check index.html still loads and a comparison
  still runs (race controls refactor).

## Parameters

Every numeric tuning constant on the search path is a setting (Search card; the tuning knobs are in
a collapsible "Advanced" section), persisted in `umacompare:optimizer`, validated by
`optimizer-settings.js` (`parseSettings`, with a message naming the field) and passed down as
options with these defaults (the code functions keep the same defaults, so omitting an option is
backward compatible). Engine encodings (ground/weather codes, mood 5, grade 100, 2 opponent teams,
3-member teams) are not parameters.

| Setting (option) | Default | Where used |
|---|---|---|
| SP budget (`budget`) | 3000 | all builds |
| Hint discount % (`pct`) | 0 (0-40) | `skillCost` |
| Population (`population`) | 64 | `initialPopulation` |
| Trials per build (`trials`) | 200 | `drawOptimizerTrials` |
| Max generations (`maxGenerations`) | 12 | loop |
| Elite fraction (`eliteFraction`) | 0.2 | elites = ceil(fraction * size) |
| Stale generations to stop (`staleLimit`) | 2 | stopping rule |
| Improvement confidence (`confidence`) | 0.95 | `significantImprovement` (z via `zForConfidence`) |
| Min trials to score a cut generation (`minPartialTrials`) | 2 | Stop handling |
| Distribution update rate (`alpha`) | 0.3 | `updateDistribution` |
| Probability floor numerator (`floorNumerator`) | 0.02 | floor = numerator / eligible count |
| Crossover share (`crossShare`) | 0.4 | `nextGeneration` |
| Drop-and-refill share (`dropShare`) | 0.3 | `nextGeneration` |
| Diversity mutation share (`diversityShare`) | 0.1 | mutations of non-elite parents (fresh = the rest) |
| Non-elite rank band (`diversityBand`) | 0.2 | fraction of non-elites eligible as diversity parents |
| Tournament size (`tournamentSize`) | 2 | crossover parent choice |
| Max skills dropped (`maxDrops`) | 3 | `dropAndRefill` (1..max, uniform) |
| Tier change probability (`tierChangeProb`) | 0.25 | `dropAndRefill` |
| Removal weight epsilon (`rateFloor`) | 0.05 | `1 / (epsilon + rate [* p])` in crossover and drop |
| Offspring retries (`retries`) | 20 | `nextGeneration` duplicates |
| Initial population retries (`initialRetries`) | 20 | `initialPopulation` duplicates |
| Unique level fallback (`uniqueFallback`) | 4 | only if the uma has no unique level |
| Hakuraku teams to fetch (`maxTeams`) | 300 | `fetchArchetypeTeams` |
| Builds shown (`buildsShown`) | 5 | output: the best plus runner-ups, each as a full uma |
| Max trials per worker message (`maxChunk`) | 10 | `chunkRanges` |
| Chunks per worker (`perWorker`) | 4 | `chunkRanges` |
| Workers (`workers`) | logical processors - 1, min 1 | `WorkerPool` |
| Prior smoothing (`smoothing`) | 5 | `priorWeights` / `priorTable`: added to every usage count |
| Random seed (`seed`) | blank = random | 0..4294967295; `makeRngs`: search rng = mulberry32(seed), trial rng = mulberry32(seed XOR 0x9E3779B9) |

## Run behaviour (review fixes)

- Optimize freezes race, snapshot and its data, archetype, slot, pool, uma, inherited uniques and
  settings synchronously; the race, uma and search controls are disabled until the run ends.
- Stop aborts fetches, rejects pending worker jobs, and is checked after every await and before each
  generation. A generation cut short is scored on its finished trials if there are at least
  `minPartialTrials`.
- A worker error retires the whole pool (other workers terminated, no further chunks); a failed pool
  rejects every later call with the original error.
- Optimize is enabled only with an uma and valid snapshot data for the current race (data is cleared
  while loading or after a failure).

## Uma input and output (revised)

- The uma is edited inline on the page (`createUmaInlineEditor` in `uma-editor.js`, sharing the modal
  editor's code): character / costume combobox, stats, the three aptitudes, running style, and only the
  unique skill (choice and level). No other skills, no nickname, no dialog. It is stored only in
  `umacompare:optimizer` (key `uma`), never in the saved-umas roster; Import / Export buttons read and
  write a runner JSON (imports keep just the unique skill). Optimize is enabled only while the draft
  validates; the editor sits inside the controls fieldset, so it is disabled during a run.
- Output: the top `buildsShown` (default 5) builds, each shown as a full uma (portrait, name, stats,
  aptitudes) with its skills (icon, SP, activation rate) and score. Each has **Save to saved umas**
  (roster `addUma` of the full runner JSON incl. unique, named "<name> (optimized)"; the button turns
  to "Saved") and **Export JSON**.

## Gold availability (eligibility rule)

In the game a gold can only be bought if the player has access to it: the uma's own golds (its
costume's awakening skills), golds from support card events, and scenario golds. The card events are
not in any database we use, so the user lists them.

- A gold is a skill with `rarity === 2` in `skill-data.js`; whites are rarity 1 (inherited uniques are
  whites and are handled by the inherited-uniques rule, unaffected).
- `eligibleSkills({ ..., availableGolds })`: when `availableGolds` is given (iterable of ids), a gold
  is eligible only if it is in the set; `null` / omitted = no restriction (backward compatible).
  Whites are never restricted, so a gold's lower-tier white stays buyable on its own. Mutation and
  crossover only ever use skills of the eligible weights, so they cannot produce an unavailable gold.
- `outfits.js` carries each outfit's own skills (`skills`, from umalator `awakenings`; 115 outfits,
  113 distinct golds among them). `ownGolds(outfitId)` returns the gold ones.
- Page: "Available gold skills" next to the inherited uniques. The uma's own golds (from the editor's
  costume, updating when it changes) appear as non-removable "from the uma" chips; the user adds more
  by search (golds that can fire in the race are listed first, any gold is allowed) and can remove
  them again; they persist in `umacompare:optimizer` (`golds`). The set is frozen with the run
  config, so the eligible count and the prior table reflect the restriction. With no costume set,
  only the user-added golds count.

## Debuffs (eligibility rule)

Skills whose every effect targets only other runners are debuffs (`skill-targets.js` `isDebuff`:
target codes 4, 9, 10 and 18-21 exclude the uma; 23 can reach it in theory but only drains stamina, so
it counts too; 1 is the uma, and 2 / 11 / 22 or any unknown
code may include it, so such skills are never debuffs): `skill-data.js` marks them `debuff: 1` (42 skills: Subdued / Flustered / Hesitant /
Frenzied ..., Intimidate, Dominator, Mystifying Murmur, ...). They are never eligible
(`eligibleSkills({ includeDebuffs: false })`, the default), since the optimizer scores one uma's
own result and a debuff can only help indirectly. Skills that also buff the uma (Speed Eater,
Stamina Siphon, Keen Eye, Wild Wind, ...) are not debuffs and stay eligible.

## Blacklist and initial population

The user may blacklist buyable skill IDs. The blacklist is saved with the optimizer form and
frozen at run start; it excludes those IDs from the eligible pool and prior, including when
seeding builds from Hakuraku. The uma's own unique is not a purchased skill and is unchanged.
Up to half the initial population is seeded from matching-running-style members of the fetched
archetype teams. Their skills are filtered against eligibility, trimmed to one per group and the
budget, then refilled from the prior. Remaining slots use fresh weighted samples; if too few
distinct source builds are usable, fresh samples fill the shortfall. Resume keeps its original
population and frozen blacklist.
