# Stage B fixes re-review

1. **Medium — `optimizer-worker.js:28-32`: completed trial results still disappear on Stop.** Progress messages contain only counts; results remain inside the worker until the entire chunk finishes. If Stop terminates workers during a chunk, even trials already reported as completed are lost, contrary to the spec's “keeps results so far” requirement. **Fix:** include each completed trial's results and index in its progress message, or send smaller completed batches that the page retains before termination. Test stopping after a progress message.

2. **Medium — `optimizer-worker.js:19-25`: a failed reinitialization leaves the previous context active.** After a successful init for race A, an invalid init for race B sends an error but leaves `context` pointing to A; a subsequent run silently races A. **Fix:** invalidate the active context when an init starts or explicitly define failed reinitialization as preserving it and require the caller to terminate the worker. Test success, failed reinit, then run.

3. **Low — `tests/optimizer-data.test.mjs:167`: the new tests do not exercise the worker protocol.** They cover the context and draw guards but not request IDs, ordered queued requests, progress payloads, init failure, or run-before-init. A protocol regression can therefore pass the suite. **Fix:** add a worker harness that sends these messages and checks replies, including a successful real or stubbed trial.

The init field names now match the spec, and the slot-order choice is documented. The empty-pool guards and per-trial progress counts address those portions of the earlier review. `node --test tests/` passed all 34 tests.
