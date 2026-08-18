---
name: e2e-verify
description: Use when asked to verify, test, or confirm that a new null-notes feature actually works end to end — driving the real compiled null-notes.exe with WebdriverIO, not just running unit tests or reading the code. Covers launching the app, writing a new spec, and known gotchas (native dialogs, the --workspace arg, click/type timing, save debounce).
---

# Verifying a null-notes feature end to end

## When to use this

`cargo test` / `npm test` check units in isolation. This drives the
actual compiled desktop app — the only way to verify anything that
touches the real save path, file I/O, PDF import, or git, matching
CLAUDE.md's "use the feature" guidance for changes `tauri dev` alone
can't automate away.

## One-time setup

    npm install

First `npm run test:e2e` run installs `tauri-driver` (via `cargo
install`) and downloads the matching `msedgedriver` build automatically
— see `e2e/README.md`.

## Launching the app under test

`e2e/wdio.conf.ts` points `@wdio/tauri-service` at
`src-tauri/target/debug/null-notes.exe` and passes
`--workspace=<fixture>` (see `e2e/fixtureWorkspace.ts`) so the app
opens directly into a fixture workspace, skipping the native
folder-picker dialog entirely.

Two things that aren't obvious and cost real time to find:

- **The binary must come from `npm run tauri build -- --debug`, not
  plain `cargo build`.** A plain debug build points at the Vite
  `devUrl` (Tauri's dev-profile default, meant for `tauri dev`'s own
  vite server) instead of the bundled frontend — nothing serves that
  URL during a test run, so the app loads a blank page. `pretest:e2e`
  already does this; don't "optimize" it back to a bare `cargo build`.
- **`--workspace` and its value must be one token
  (`--workspace=<path>`), not two (`--workspace <path>`).** The driver
  toolchain that launches the app for testing reorders and re-splits
  multi-token argv lists, silently detaching a flag from its value. A
  single joined token can't be reordered relative to anything else.

## Writing a new spec

1. Add `e2e/specs/<feature>.e2e.ts`.
2. Import the shared fixture path from `../fixtureWorkspace.js` (not
   an env var, not a fresh `mkdtemp` call — `wdio.conf.ts` loads in
   more than one Node process, so a per-load random directory means
   different processes see different folders; see the comment in
   `fixtureWorkspace.ts`). Every spec shares this one directory, so
   clean up whatever file your spec asserts on at the start of the
   test (`rmSync(path, { force: true })`) rather than assuming a blank
   slate.
3. **Click via in-page JS, not `Element#click()`.**
   WebdriverIO's `click()`/`waitForClickable()`/`waitForDisplayed()`
   run their own overlap/visibility polling before acting, and each
   poll iteration is a slow round trip through this specific driver —
   turning a near-instant UI state into a 10-20s stall per click. Use
   a helper like `create-note.e2e.ts`'s `clickInPage()`
   (`browser.execute((sel) => document.querySelector(sel).click(),
   selector)`) instead — `findElement` succeeding is already
   sufficient readiness signal here.
4. **Typing into a contenteditable needs a real focus + selection, not
   just a click.** A plain in-page `.click()` focuses the element but
   doesn't give ProseMirror a cursor position the way a mouse click
   does. Focus the element and explicitly collapse a DOM Selection to
   where you want to type (see `create-note.e2e.ts`'s selection-setup
   block) before sending keys. `browser.keys(...)` itself works fine
   and is fast — it's only element-readiness *waiting* that's slow.
5. **Native dialogs** (`window.prompt`/`confirm`, e.g. note/folder
   naming) render outside the WebView DOM — reach them with the
   standard WebDriver user-prompt commands: `await
   browser.sendAlertText('value'); await browser.acceptAlert()`,
   guarded by polling `browser.getAlertText()` in a try/catch until it
   stops throwing (see `create-note.e2e.ts`).
6. **Assert on disk, not just DOM.** This app's source of truth is the
   `.md` file / SQLite index / `.workspace.json`, not React state —
   read the fixture workspace with Node's `fs` and assert file
   content.
7. **Debounce-aware waits, never a blind sleep.** Autosave debounces
   `SAVE_DEBOUNCE_MS` (600ms default, `src/hooks/useNote.ts`) and
   reindex debounces `REINDEX_DEBOUNCE_MS` (2500ms). Use
   `browser.waitUntil(...)` polling the expected on-disk state.

## Running

    npm run test:e2e                                        # whole suite
    npm run test:e2e -- --spec e2e/specs/<feature>.e2e.ts    # one spec

## Known gotchas

- Each spec shares the one fixture workspace (see above) — clean up
  your own artifacts, don't rely on an empty directory.
- The real user's `%APPDATA%\dev.nullnotes.app\recent-workspaces.json`
  is never touched — the `--workspace` arg path opens via
  `openWorkspaceAt(path, { remember: false })` in `Layout.tsx`.
- `maxInstances`/`maxInstancesPerCapability` are pinned to `1` — one
  Tauri window at a time, no parallel specs.
- `@wdio/tauri-service`'s official driver has occasional per-command
  timing flakiness here unrelated to app behavior — `mochaOpts.retries`
  in `wdio.conf.ts` absorbs a one-off. A test failing *consistently*
  (including on retry) is a real bug, not driver noise.
- If a run hangs at launch rather than failing fast, check the
  installed Edge version against the downloaded `msedgedriver` first —
  a mismatch tends to fail silently rather than with a clear error.
