# Stage C fixes and settings review

1. **Medium — `optimizer-settings.js:55`, `optimizer-run.js:249-252`: accepted seeds can collapse to the same streams.** Validation accepts any finite integer, including integers outside JavaScript's safe range; `mulberry32` further truncates seeds to 32 bits. For example, 0 and 4294967296 both produce the same search and trial streams, while sufficiently large inputs also lose integer precision before the `+ 1` trial seed is calculated. **Fix:** define and validate a signed or unsigned 32-bit seed range, document the mapping, and test the boundary and wraparound.

2. **Medium — `optimizer-settings.js:21`, `optimizer-core.js:501-508`: accepted confidence values can produce an infinite critical value.** A value such as `0.9999999999999999` passes validation but `0.5 + confidence / 2` rounds to 1, making `log(1 - q)` infinite; stopping comparisons then cannot succeed. **Fix:** compute the upper-tail probability as `(1 - confidence) / 2` without subtracting a rounded quantile from 1, or restrict confidence to a numerically safe interval. Add boundary tests asserting finite, monotonic critical values.

3. **Low — `optimizer-core.js:202-204`, `optimizer-settings.js:18`: the prior smoothing constant is not configurable.** The new feature and spec promise every numeric search tuning constant, but the `+ 5` prior weight is hard-coded and there is no setting for it. It directly controls sampling, especially for skills absent from usage data. **Fix:** add a validated smoothing setting defaulting to 5, pass it to both `priorWeights` and `priorTable`, and test that the displayed shares match the search distribution.

The six findings in `04-stage-c.md` are addressed in the inspected paths: Stop aborts loading and is checked before work, the run freezes its inputs and disables controls, snapshot loading gates Optimize, live actions have a current runner mapping, a run error retires the worker pool, and five runner-ups are rendered by default. Search and trial RNGs use the supplied seed; no unseeded `Math.random` call was found on the seeded search path. The ordinary default values and the default `pairedDifferenceCi` behavior match the previous implementation by inspection; the intended runner-up correction changes the displayed count. No compare/index behavior regression was identified in the reviewed diff.

`node --test tests/` passed all 62 tests. Browser behavior was not exercised in this review.

## Fix check

All addressed. Seed validation now limits inputs to unsigned 32-bit values and uses distinct deterministic stream states; the confidence calculation uses the upper tail directly; and configurable positive prior smoothing is passed to both sampling and the displayed table. The spec and boundary tests cover these changes. `node --test tests/` passed all 65 tests.
