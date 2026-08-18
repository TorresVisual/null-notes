# Automated end-to-end verification

## Problem

CLAUDE.md's UI-testing guidance ("start the dev server and use the feature in a browser") only covers pure frontend logic. Anything touching the real save path, file I/O, PDF import, or git needs the actual Tauri window — a native WebView2 process, not a browser tab — and until now the only way to check it was a human clicking through `npm run tauri dev` by hand. The goal here isn't one test; it's a repeatable way to verify *any* new feature going forward, driving the real compiled app the way a user would.

Two things stand between a WebDriver script and that app:

- **The workspace picker** opens the native OS folder dialog — outside the WebView DOM, unreachable by WebDriver.
- **New-note naming** goes through a bare `window.prompt()` — a native modal, not a DOM element.

Both need an answer before any test can run end to end.

## Why tauri-driver + WebdriverIO, not Playwright

Playwright's `_electron` driver is Electron/Chromium-specific — it doesn't attach to a Tauri app, because Tauri renders through the OS's native WebView (WebView2 on Windows), not a bundled Chromium. `tauri-driver` is Tauri's own answer: it wraps the platform's native WebDriver server (`msedgedriver` on Windows, since WebView2 is Chromium-based under the hood) behind the standard WebDriver protocol, so any W3C WebDriver client — WebdriverIO here — can drive the real compiled `.exe`.

`msedgedriver` has to match the installed Edge major version (151.x locally); a mismatch fails the session at launch, not with a useful error. WebdriverIO ships an official `@wdio/tauri-service` that manages this itself — `autoInstallTauriDriver` runs `cargo install tauri-driver` on first use, `autoDownloadEdgeDriver` fetches the matching `msedgedriver` build, and the service spawns/tears down `tauri-driver` around each test session. Configured with `driverProvider: 'official'`, this needs no Rust-side changes — the alternative `'embedded'` provider gets a richer bridge but requires adding `tauri-plugin-wdio-webdriver` to `Cargo.toml` and a `wdio:default` entry in a Tauri v2 permissions/capabilities file this project doesn't have yet. `'official'` gets the same driving capability with the smaller diff, so that's the one this design uses — the `--workspace` startup arg stays the only Rust-side change.

## Architecture

```
┌─ src-tauri (Rust) ────────────┐        ┌─ e2e/ (Node, WebdriverIO) ────────────────┐
│ argv: --workspace <path>      │        │ wdio.conf.ts                              │
│  → managed state               │        │  services: [['@wdio/tauri-service', {     │
│  → #[tauri::command]           │        │    driverProvider: 'official',            │
│    initial_workspace()         │        │    autoInstallTauriDriver: true,          │
└────────────┬────────────────────┘        │    autoDownloadEdgeDriver: true }]]       │
             │ invoke on startup            │  capabilities: tauri:options.application  │
             ▼                              │    = target/debug/null-notes.exe,         │
┌─ Frontend ─────────────────────┐          │    args: ["--workspace", <fixture>]       │
│ App root: call                 │          │                                            │
│  initial_workspace() before    │          │ specs/*.e2e.ts                            │
│  rendering WorkspacePicker;    │          │  - create temp fixture workspace          │
│  Some(path) → openWorkspaceAt  │          │  - drive DOM via WebDriver                │
│  (same path recents already    │          │  - handle native prompt()/confirm()       │
│  use)                          │          │    via WebDriver alert API                │
└──────────────────────────────────┘        │  - assert against files on disk,          │
                                             │    not just DOM state                     │
                                             └────────────────────────────────────────────┘
```

## The `--workspace` startup arg

`src-tauri` parses `std::env::args()` at setup for a `--workspace <path>` pair, stores it in Tauri-managed state, and exposes it via a new `#[tauri::command] initial_workspace() -> Option<String>`. The frontend's startup effect (wherever `WorkspacePicker` currently decides whether to render) calls this once; `Some(path)` routes through the existing `openWorkspaceAt(path)` — the same function the Recent list already calls — instead of showing the picker. No picker UI changes, no new frontend state shape.

This isn't test-only scaffolding: it's a real "open null-notes.exe pointed at a folder" CLI entry point, which E2E tests happen to be the first consumer of. tauri-driver passes it through `tauri:options.args` in the WebdriverIO capabilities, so each test launches its own isolated fixture workspace — no dependency on or mutation of the real user's `recent-workspaces.json` in `%APPDATA%`.

## Reaching native dialogs

`window.prompt()` (used by `handleCreateNote` and friends) fires a genuine browser-engine modal, and WebView2 is Chromium under the hood — the same engine `msedgedriver` already knows how to drive. The W3C WebDriver spec's User Prompts handling (`sendAlertText` / `acceptAlert`, exposed by WebdriverIO as `browser.sendAlertText()` / `browser.acceptAlert()`) is the standard mechanism for exactly this. This is the one piece of the design that's unverified until the first real run — if it turns out `tauri-driver` doesn't forward dialog events correctly, the fallback is replacing the note-title `prompt()` with an in-DOM modal, which is a separate, larger change that would come back for its own design pass rather than being pre-built speculatively.

## `e2e/` layout

```
e2e/
  wdio.conf.ts       — services: @wdio/tauri-service (driverProvider: 'official',
                        autoInstallTauriDriver, autoDownloadEdgeDriver); capabilities
                        point at target/debug/null-notes.exe
  tsconfig.json        — separate from the root src/ tsconfig; picks up WDIO's own types
  specs/
    create-note.e2e.ts
  README.md            — one-time setup notes, how to add a new spec
```

devDependencies: `@wdio/cli`, `@wdio/tauri-service`, `@wdio/mocha-framework`, `@wdio/spec-reporter` (`mocha` itself comes along as `@wdio/mocha-framework`'s dependency). `autoInstallTauriDriver: true` runs `cargo install tauri-driver` on first use and `autoDownloadEdgeDriver: true` fetches the matching `msedgedriver` build — both one-time, cached, no repo-side script needed.

npm scripts:

```
"pretest:e2e": "cargo build --manifest-path src-tauri/Cargo.toml",
"test:e2e": "wdio run e2e/wdio.conf.ts"
```

## First spec: create → type → save

`e2e/specs/create-note.e2e.ts`:

1. Create a real OS temp directory as the fixture workspace (no `.workspace.json`, no notes — a clean start).
2. Session launches `null-notes.exe --workspace <tmpdir>` via capabilities; app opens directly into it, no picker.
3. Click the sidebar "new note" affordance; handle the resulting `prompt()` via `sendAlertText('Test Note')` + `acceptAlert()`.
4. Type known text into the now-open editor's DOM node.
5. `browser.waitUntil(...)` polling `<tmpdir>/Test Note.md` on disk (Node `fs`) until it contains the typed text, bounded by a timeout comfortably past `SAVE_DEBOUNCE_MS` (600ms) — not a blind sleep.
6. Assert file content; clean up the temp dir.

Asserting against the on-disk file rather than DOM state matches CLAUDE.md's own framing of the save path as the thing that actually matters — a green DOM with a corrupt or missing file would be a false pass.

## The project skill

Once this spec is written and actually passes — proving the mechanics, especially the alert-handling step — author `.claude/skills/e2e-verify/SKILL.md` (via `superpowers:writing-skills`) covering:

- How to launch the app under test (the `--workspace` arg, spawning `tauri-driver`, where `msedgedriver` lives).
- How to write a *new* spec for a *new* feature: fixture-workspace setup, reaching past native dialogs, asserting on-disk state, debounce-aware polling instead of sleeps.
- Where specs live and how to run one in isolation (`npm run test:e2e -- --spec e2e/specs/<name>.e2e.ts`).

This is the actual deliverable the request is after: the next time a feature needs verifying, the recipe is already on record rather than rediscovered from scratch — matching the built-in `run` skill's own guidance to promote a working ad hoc setup into a project skill.

## Testing

The E2E suite *is* the test — no meta-tests of the harness itself. Existing `cargo test`/`vitest` suites are untouched; this is a new, separate layer for verifying real app behavior end to end, not a replacement for unit coverage.

## Out of scope

- **CI integration.** This runs locally against a Windows machine with Edge installed; wiring it into CI (which per CLAUDE.md's PDF-pipeline precedent already lacks some native dependencies) is a separate decision.
- **Non-Windows drivers.** `tauri-driver` supports other platforms via different native drivers; this design only covers the Windows/WebView2/msedgedriver path this project actually runs on.
- **Replacing `window.prompt()`/`confirm()` calls with DOM modals.** Only happens if the WebDriver alert API genuinely can't reach them — not pre-built speculatively.
- **A second/third spec.** This design covers the infrastructure and one proof-of-concept spec; further specs are written on demand using the resulting skill, not enumerated here.

## As built: where reality diverged

Running the actual first spec surfaced three things this design got wrong or didn't anticipate — recorded here since the sections above still describe the pre-implementation assumptions, and `.claude/skills/e2e-verify/SKILL.md` is the accurate reference for writing new specs.

- **`--workspace <path>` (two argv tokens) doesn't survive the driver toolchain intact.** Something in the launch path reorders and re-splits multi-token argv, silently detaching the flag from its value. Fixed as a single `--workspace=<path>` token, which can't be reordered relative to anything else. `initial_workspace_from_args` parses this form only.
- **A plain `cargo build` loads the Vite `devUrl`, not the bundled frontend.** Tauri's debug-profile default assumes `tauri dev`'s own vite server is running; nothing serves that URL during a standalone test run, so the app rendered a blank page. `pretest:e2e` uses `npm run tauri build -- --debug` instead — this also means the fixture workspace has to be a fixed shared path (`e2e/fixtureWorkspace.ts`), not a fresh `mkdtemp` per run, because `wdio.conf.ts` loads in more than one Node process (the CLI launcher and each worker) and a per-load random directory left the app and the assertion looking at two different folders.
- **The alert-handling risk flagged above turned out fine** — `sendAlertText`/`acceptAlert` work correctly through `tauri-driver`. The real surprise was WebdriverIO's own `Element#click()`/`waitForClickable()`/`waitForDisplayed()`: their overlap-detection polling is slow *per iteration* through this specific driver, turning near-instant real UI state into 10-20s stalls. Specs drive clicks via in-page `browser.execute()` instead. A plain in-page `.click()` also doesn't give a contenteditable a real cursor position — typing needs an explicit focus + DOM Selection first.
