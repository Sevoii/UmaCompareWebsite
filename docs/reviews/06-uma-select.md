# Uma selection review

No correctness findings by inspection. Direct mode selects on card click or Enter/Space, leaves Escape to close the list, and does not enter the preview. `showList` preserves the hidden Create button when `onNew` is absent. The compare page still supplies both callbacks and defaults to preview mode; its preview, back, Escape, Create and Edit paths remain intact. The optimizer retains `skillIconUrl` from `uma-editor.js` for skill icons but has no remaining editor wiring or dialog.

`node --test tests/` passed all 65 tests. The suite does not exercise these modal interactions in a browser, so this conclusion is based on code inspection.
