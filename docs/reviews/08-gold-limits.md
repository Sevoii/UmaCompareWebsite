# Gold availability review

1. **Critical — `optimizer.js:171-202`: the optimizer page fails during module initialization.** `createUmaInlineEditor` synchronously emits `onUmaChange` during its initial `set()`. That calls `renderGolds()`, which reads `ownGoldList` before its `const` declaration has initialized, throwing a `ReferenceError`. This happens even with an empty draft, before startup loads the snapshot or attaches the remaining handlers. **Fix:** initialize the gold helper bindings before creating the editor, or defer the initial gold render until after all bindings are initialized. Add a browser startup test for both an empty and a saved draft.

2. **Low — `style.css:1600` and `optimizer.js:211-214`: the hidden gold suggestion box retains `display: grid`.** The `.uc-opt-suggest` rule explicitly sets `display: grid`, while the only overriding `[hidden]` rule applies inside `.uc-modal`. The gold box is outside a modal, so an empty query can leave its bordered suggestion container visible even when `hidden` is set. **Fix:** add `.uc-opt-suggest[hidden] { display: none; }` and exercise empty-query and selection states in a browser.

Subject to the startup failure above, the page freezes the union of own and user gold IDs before its first await and builds the prior from the filtered eligible set. Search operators draw/refill from that prior, tier changes require membership in it, and carried builds originate from the same run; no unrestricted gold insertion was found in those paths. Whites and inherited uniques are not filtered by the gold set. The generator converts awakening IDs to numbers and `--no-icons` checks existing WebP files without deleting or copying icons, by inspection. No browser integration test currently covers the page initialization.

`node --test tests/` passed all 70 tests.

## Fix check

Both findings are addressed. The editor is created after the gold helper bindings, and no intervening module-evaluation path requires an initialized editor; the early race callback safely uses optional chaining. The explicit `[hidden]` rule overrides the suggestion box's grid display. The user also verified page startup and gold interactions in a browser. `node --test tests/` passed all 70 tests.
