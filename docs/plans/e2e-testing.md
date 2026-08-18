# Automated End-to-End Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Give null-notes a repeatable, scripted way to drive the real compiled desktop app (not just unit tests) so any new feature can be verified end to end, and record the recipe as a project skill for next time.

**Architecture:** A `--workspace <path>` startup arg (new Rust command + frontend hookup) lets a test launch `null-notes.exe` pointed straight at a fixture folder, skipping the native OS folder picker. WebdriverIO, via the official `@wdio/tauri-service`, drives the resulting WebView2 window through `tauri-driver`. The first spec creates a note, types into it, and asserts the `.md` file on disk — proving the mechanism — after which the recipe is written up as `.claude/skills/e2e-verify/SKILL.md`.

**Tech Stack:** Rust (`src-tauri`), React 19 + TypeScript (`src`), WebdriverIO + `@wdio/tauri-service` (`e2e/`), Mocha (via `@wdio/mocha-framework`).

**Spec:** `docs/specs/e2e-testing-design.md`

## Global Constraints

- Windows/WebView2 only — `driverProvider: 'official'` (external `tauri-driver`, not the Rust-side `'embedded'` provider), per the spec's decision to avoid adding a Cargo dependency and a Tauri v2 permissions/capabilities file.
- No blind `sleep`s in specs — poll on-disk/DOM state with `browser.waitUntil`, bounded past the relevant debounce (`SAVE_DEBOUNCE_MS` = 600ms, `REINDEX_DEBOUNCE_MS` = 2500ms, both in `src/hooks/useNote.ts`).
- Specs assert against files on disk (the app's actual source of truth), not just DOM state.
- The `--workspace` arg is the only production-code surface added for testability; it must not mutate the real user's `%APPDATA%\dev.nullnotes.app\recent-workspaces.json`.
- No CI integration, no second spec, no replacing `window.prompt()`/`confirm()` with DOM modals — all explicitly out of scope per the spec.

---

### Task 1: Rust — `--workspace` arg parsing (pure function)

**Files:**
- Modify: `src-tauri/src/commands/workspace.rs`

**Interfaces:**
- Produces: `pub fn initial_workspace_from_args<I: IntoIterator<Item = String>>(args: I) -> Option<String>` — used by Task 2.

- [ ] **Step 1: Write the failing tests**

Add to the existing `#[cfg(test)] mod tests` block at the bottom of `src-tauri/src/commands/workspace.rs` (it already has `use super::*;` and `use tempfile::tempdir;` — these new tests need neither extra import):

```rust
    #[test]
    fn test_initial_workspace_from_args_finds_the_flag() {
        let args = vec!["--workspace".to_string(), "/tmp/ws".to_string()];
        assert_eq!(initial_workspace_from_args(args), Some("/tmp/ws".to_string()));
    }

    #[test]
    fn test_initial_workspace_from_args_ignores_other_flags() {
        let args = vec!["--debug".to_string()];
        assert_eq!(initial_workspace_from_args(args), None);
    }

    #[test]
    fn test_initial_workspace_from_args_trailing_flag_with_no_value_returns_none() {
        let args = vec!["--workspace".to_string()];
        assert_eq!(initial_workspace_from_args(args), None);
    }

    #[test]
    fn test_initial_workspace_from_args_takes_the_value_immediately_after_the_flag() {
        let args = vec![
            "--debug".to_string(),
            "--workspace".to_string(),
            "/tmp/ws".to_string(),
            "--other".to_string(),
        ];
        assert_eq!(initial_workspace_from_args(args), Some("/tmp/ws".to_string()));
    }
```

- [ ] **Step 2: Run tests to verify they fail to compile**

Run: `cargo test --manifest-path src-tauri/Cargo.toml initial_workspace_from_args`
Expected: compile error — `initial_workspace_from_args` not found.

- [ ] **Step 3: Write the implementation**

Add above the `#[tauri::command]` functions in `src-tauri/src/commands/workspace.rs` (after the `push_recent` function, before `recent_workspaces`):

```rust
pub fn initial_workspace_from_args<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    let mut iter = args.into_iter();
    while let Some(arg) = iter.next() {
        if arg == "--workspace" {
            return iter.next();
        }
    }
    None
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml initial_workspace_from_args`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/workspace.rs
git commit -m "feat(e2e): add initial_workspace_from_args for a --workspace startup arg"
```

---

### Task 2: Rust — wire the arg into the app

**Files:**
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `initial_workspace_from_args` from Task 1.
- Produces: `#[tauri::command] pub fn initial_workspace(state: tauri::State<InitialWorkspace>) -> Option<String>` — used by Task 3's frontend call.

- [ ] **Step 1: Add managed state and the command**

In `src-tauri/src/commands/workspace.rs`, add directly above the existing `#[tauri::command] pub async fn recent_workspaces`:

```rust
pub struct InitialWorkspace(pub Option<String>);

#[tauri::command]
pub fn initial_workspace(state: tauri::State<InitialWorkspace>) -> Option<String> {
    state.0.clone()
}
```

- [ ] **Step 2: Parse argv and manage the state in `run()`**

In `src-tauri/src/lib.rs`, change:

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
```

to:

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_workspace = commands::workspace::initial_workspace_from_args(std::env::args().skip(1));

    tauri::Builder::default()
```

Then change the `.setup(|app| {` closure to `.setup(move |app| {` (it needs to capture `initial_workspace`) and add one line inside it, alongside the other `app.manage(...)` calls:

```rust
        .setup(move |app| {
            let data_dir = app.path().app_data_dir()?;
            let pool = tauri::async_runtime::block_on(db::init_db(&data_dir))
                .expect("failed to initialise database");
            app.manage(pool);
            app.manage(commands::watcher::WatcherState::default());
            app.manage(commands::terminal::PtyState::default());
            app.manage(commands::workspace::InitialWorkspace(initial_workspace));
            Ok(())
        })
```

- [ ] **Step 3: Register the command**

In the same file, add `commands::workspace::initial_workspace,` to the `tauri::generate_handler![...]` list, next to the other `commands::workspace::*` entries:

```rust
            commands::workspace::load_workspace,
            commands::workspace::save_workspace,
            commands::workspace::recent_workspaces,
            commands::workspace::remember_workspace,
            commands::workspace::initial_workspace,
```

- [ ] **Step 4: Build and lint**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds clean.

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
Expected: no warnings.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all existing tests plus Task 1's four still pass (this is thin IPC glue over an already-tested pure function — no new test needed here, matching the existing precedent for Tauri command wiring noted in `docs/specs/terminal-pane-design.md`'s Testing section).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/workspace.rs src-tauri/src/lib.rs
git commit -m "feat(e2e): expose --workspace startup arg via initial_workspace command"
```

---

### Task 3: Frontend — open the initial workspace on startup

**Files:**
- Modify: `src/lib/tauri.ts`
- Modify: `src/hooks/useWorkspace.ts`
- Modify: `src/hooks/useWorkspace.test.ts`
- Modify: `src/components/Layout.tsx`

**Interfaces:**
- Consumes: `initial_workspace` Tauri command from Task 2.
- Produces: `api.workspace.initialWorkspace(): Promise<string | null>`; `openWorkspaceAt(selected: string, opts?: { remember?: boolean }): Promise<void>` (the `opts` parameter is new — existing callers are unaffected since it's optional and defaults to remembering, same as today).

- [ ] **Step 1: Add the API wrapper**

In `src/lib/tauri.ts`, add to the `workspace` object, after `remember`:

```ts
    initialWorkspace: () =>
      invoke<string | null>('initial_workspace'),
```

- [ ] **Step 2: Write the failing test for the `remember: false` opt-out**

Add to `src/hooks/useWorkspace.test.ts` (it already mocks `api.workspace` with `load/save/watch/remember` — add `remember` stays, just assert it's *not* called):

```ts
  it('does not persist to recent workspaces when remember is false', async () => {
    const { result } = renderHook(() => useWorkspace())

    await result.current.openWorkspaceAt('/ws', { remember: false })

    expect(workspace.remember).not.toHaveBeenCalled()
  })
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- useWorkspace`
Expected: FAIL — `openWorkspaceAt` doesn't accept a second argument yet, so `workspace.remember` is still called (`toHaveBeenCalled` assertion fails).

- [ ] **Step 4: Add the `remember` opt-out to `openWorkspaceAt`**

In `src/hooks/useWorkspace.ts`, change the `openWorkspaceAt` callback signature and its one call site:

```ts
  const openWorkspaceAt = useCallback(
    async (selected: string, opts: { remember?: boolean } = {}) => {
      const { remember = true } = opts
      const { setFolderError, setRecentWorkspaces, setGit, setRepoMode } = useWorkspaceStore.getState()
      let tree, session
      try {
        ;[tree, session] = await Promise.all([
          api.notes.scan(selected),
          api.workspace.load(selected),
        ])
      } catch (e) {
        setFolderError(e instanceof Error ? e.message : String(e))
        return
      }

      await saveSession()
      resetForNewWorkspace()

      setPath(selected)
      await api.workspace.watch(selected)
      setNotes(tree.notes)
      setFolders(tree.folders)
      setExpandedFolders(session.expandedFolders)
      setGit(session.git)
      for (const tab of session.openTabs) {
        openTab(tab)
      }
      await refreshTags()
      if (remember) {
        setRecentWorkspaces(await api.workspace.remember(selected))
      }
```

(Only the function signature's first line and the final `if (remember) { ... }` wrap change — everything else in the body is unchanged.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- useWorkspace`
Expected: PASS, including the existing tests (they call `openWorkspaceAt` with one argument, so `remember` defaults to `true` and behaves exactly as before).

- [ ] **Step 6: Wire it into Layout's startup effect**

In `src/components/Layout.tsx`, change the `useWorkspace()` destructure on line 54 from:

```tsx
  const { saveSession, openWorkspace } = useWorkspace()
```

to:

```tsx
  const { saveSession, openWorkspace, openWorkspaceAt } = useWorkspace()
```

Then change the startup effect (currently):

```tsx
  useEffect(() => {
    void refreshRecents()
    void api.settings.load().then(setSettings)
  }, [setSettings])
```

to:

```tsx
  useEffect(() => {
    void api.workspace.initialWorkspace().then((path) => {
      if (path) void openWorkspaceAt(path, { remember: false })
    })
    void refreshRecents()
    void api.settings.load().then(setSettings)
  }, [setSettings, openWorkspaceAt])
```

- [ ] **Step 7: Typecheck and unit-test**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 8: Manual smoke check**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`

Then (PowerShell):
```powershell
$fixture = New-Item -ItemType Directory -Path "$env:TEMP\null-notes-manual-check" -Force
& .\src-tauri\target\debug\null-notes.exe --workspace $fixture.FullName
```
Expected: the window opens directly into that empty folder — no `WorkspacePicker` screen. Close the window when confirmed.

- [ ] **Step 9: Commit**

```bash
git add src/lib/tauri.ts src/hooks/useWorkspace.ts src/hooks/useWorkspace.test.ts src/components/Layout.tsx
git commit -m "feat(e2e): open the --workspace startup arg on launch, skipping the picker"
```

---

### Task 4: E2E infrastructure and the first spec

**Files:**
- Create: `e2e/wdio.conf.ts`
- Create: `e2e/tsconfig.json`
- Create: `e2e/README.md`
- Create: `e2e/specs/create-note.e2e.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: the running `null-notes.exe` from Task 3 (must be freshly built before running).
- Produces: `npm run test:e2e` — the command the Task 5 skill documents.

- [ ] **Step 1: Install dependencies**

Run: `npm install --save-dev @wdio/cli @wdio/tauri-service @wdio/mocha-framework @wdio/spec-reporter @wdio/globals tsx`
Expected: `package.json`'s `devDependencies` gains these six packages; `package-lock.json` updates. (`@wdio/globals` is what the spec in Step 5 imports `browser`/`expect` from — explicit imports over ambient test-runner globals, consistent with this project's TypeScript conventions.)

- [ ] **Step 2: Add npm scripts**

In `package.json`, add to `"scripts"`, after `"test:ui"`:

```json
    "pretest:e2e": "cargo build --manifest-path src-tauri/Cargo.toml",
    "test:e2e": "wdio run e2e/wdio.conf.ts"
```

- [ ] **Step 3: Write the WebdriverIO config**

Create `e2e/wdio.conf.ts`:

```typescript
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Options } from '@wdio/types'

const here = dirname(fileURLToPath(import.meta.url))
const appBinaryPath = resolve(here, '../src-tauri/target/debug/null-notes.exe')

// One fixture workspace per test run, created once here and shared with
// specs via an env var — the local runner forks a fresh process per spec
// file, so a module-level constant re-imported from a spec would compute a
// different directory than the one baked into these capabilities.
const fixtureWorkspace = mkdtempSync(join(tmpdir(), 'null-notes-e2e-'))
process.env.NULL_NOTES_E2E_WORKSPACE = fixtureWorkspace

export const config: Options.Testrunner = {
  runner: 'local',
  specs: ['./specs/**/*.e2e.ts'],
  maxInstances: 1,
  maxInstancesPerCapability: 1,

  services: [
    [
      '@wdio/tauri-service',
      {
        appBinaryPath,
        appArgs: ['--workspace', fixtureWorkspace],
        driverProvider: 'official',
        autoInstallTauriDriver: true,
        autoDownloadEdgeDriver: true,
      },
    ],
  ],

  capabilities: [
    {
      browserName: 'tauri',
      'tauri:options': {
        application: appBinaryPath,
        args: ['--workspace', fixtureWorkspace],
      },
    },
  ],

  logLevel: 'info',
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 90000,
  connectionRetryCount: 3,

  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },

  reporters: ['spec'],
}
```

- [ ] **Step 4: Write the e2e TypeScript config**

Create `e2e/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["node", "@wdio/mocha-framework", "@wdio/globals/types"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["."]
}
```

This is separate from the root `tsconfig.json` (which only `include`s `src`) — `wdio`'s runner uses `tsx` to strip types at run time regardless, so this file is for editor support and is not part of `npm run build`/`npm run typecheck`.

- [ ] **Step 5: Write the first spec**

Create `e2e/specs/create-note.e2e.ts`:

```typescript
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'

describe('create note → type → save', () => {
  it('writes the typed content to the .md file on disk', async () => {
    const fixtureWorkspace = process.env.NULL_NOTES_E2E_WORKSPACE
    if (!fixtureWorkspace) {
      throw new Error('NULL_NOTES_E2E_WORKSPACE is not set — run this via `npm run test:e2e`')
    }

    const newNoteButton = await browser.$('button*=New Note')
    await newNoteButton.waitForClickable()
    await newNoteButton.click()

    // window.prompt() is a native modal outside the WebView DOM — the
    // standard WebDriver "user prompt" commands are the only way to reach it.
    await browser.waitUntil(
      async () => {
        try {
          await browser.getAlertText()
          return true
        } catch {
          return false
        }
      },
      { timeout: 5000, timeoutMsg: 'the note-title prompt() never appeared' },
    )
    await browser.sendAlertText('Test Note')
    await browser.acceptAlert()

    const editor = await browser.$('.ProseMirror')
    await editor.waitForDisplayed()
    await editor.click()
    await browser.keys('Hello from the E2E test')

    const notePath = join(fixtureWorkspace, 'Test Note.md')
    await browser.waitUntil(
      () => existsSync(notePath) && readFileSync(notePath, 'utf-8').includes('Hello from the E2E test'),
      { timeout: 5000, interval: 200, timeoutMsg: `${notePath} never contained the typed text` },
    )

    expect(readFileSync(notePath, 'utf-8')).toContain('Hello from the E2E test')
  })
})
```

- [ ] **Step 6: Write the setup README**

Create `e2e/README.md`:

```markdown
# End-to-end tests

Drives the real compiled `null-notes.exe` with WebdriverIO — see
`docs/specs/e2e-testing-design.md` for why, and
`.claude/skills/e2e-verify/SKILL.md` for how to add a new spec.

## Running

    npm run test:e2e                                     # whole suite
    npm run test:e2e -- --spec e2e/specs/<name>.e2e.ts    # one spec

The first run installs `tauri-driver` (via `cargo install`) and downloads
the `msedgedriver` build matching your installed Edge version — both are
one-time, cached by `@wdio/tauri-service`'s `autoInstallTauriDriver` and
`autoDownloadEdgeDriver` options in `wdio.conf.ts`. `npm run test:e2e`
always rebuilds the debug binary first via the `pretest:e2e` script.
```

- [ ] **Step 7: Build the app and run the suite**

Run: `npm run test:e2e`

This is a real integration run against freshly written infrastructure — read the actual output rather than assuming success. Expected happy path: 1 passing spec. If it fails:
- **"no such alert" / alert commands time out** — the flagged risk from the spec: `tauri-driver`'s official provider may not forward WebView2 JS-dialog events the way plain Edge does. Check the WebdriverIO Tauri troubleshooting docs (`npx ctx7@latest docs /websites/webdriver_io "tauri window.prompt dialog not intercepted troubleshooting"`) before changing app code — do not swap `window.prompt()` for a DOM modal without coming back to confirm that's actually the fix, per the spec's explicit call-out.
- **binary not found** — confirm `src-tauri/target/debug/null-notes.exe` exists (re-run `cargo build --manifest-path src-tauri/Cargo.toml`) and that `appBinaryPath`'s `resolve(here, '../src-tauri/...')` actually points at it (log it if unsure).
- **Edge/msedgedriver version mismatch** — `autoDownloadEdgeDriver: true` should handle this automatically; if it doesn't, this is the one thing the old manual-script approach the spec moved away from would have caught explicitly.

Iterate until the spec passes for real — do not mark this task done on a failing or skipped run.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json e2e/
git commit -m "feat(e2e): add WebdriverIO + tauri-driver infrastructure and first spec"
```

---

### Task 5: Project skill — `e2e-verify`

**Files:**
- Modify: `.gitignore`
- Create: `.claude/skills/e2e-verify/SKILL.md`

**Interfaces:**
- Consumes: everything proven working in Task 4.

- [ ] **Step 1: Un-ignore the skills directory**

`.gitignore` currently has a blanket `.claude/` rule (added by the IDE's auto-gitignore), which would silently exclude this skill from version control. Add, right after the existing `.claude/` line in the "Added by Null IDE Auto-Gitignore" block:

```gitignore
.claude/
.playwright-mcp/
.null/
!.claude/
.claude/*
!.claude/skills/
```

(The `!.claude/` + `.claude/*` pair re-excludes everything under `.claude/` individually so other local-only content — settings, session data — stays ignored, while `!.claude/skills/` carves the skills directory back in.)

- [ ] **Step 2: Verify the pattern**

Run: `git check-ignore -v .claude/skills/e2e-verify/SKILL.md`
Expected: no output and a non-zero exit code (meaning: not ignored). If it prints a matching rule, the pattern is wrong — fix it before continuing.

Run: `git check-ignore -v .claude/settings.local.json`
Expected: prints a matching `.claude/*` (or the original `.claude/`) rule — confirms other `.claude/` content is still ignored.

- [ ] **Step 3: Write the skill**

Create `.claude/skills/e2e-verify/SKILL.md`:

```markdown
---
name: e2e-verify
description: Use when asked to verify, test, or confirm that a new null-notes feature actually works end to end — driving the real compiled null-notes.exe with WebdriverIO, not just running unit tests or reading the code. Covers launching the app, writing a new spec, and known gotchas (native dialogs, the --workspace arg, save debounce timing).
---

# Verifying a null-notes feature end to end

## When to use this

`cargo test` / `npm test` check units in isolation. This drives the
actual compiled desktop app — the only way to verify anything that
touches the real save path, file I/O, PDF import, or git, matching
CLAUDE.md's "use the feature" guidance for changes `tauri dev` alone
can't automate away.

## One-time setup

    npm install                                        # pulls in @wdio/cli, @wdio/tauri-service, etc.

First `npm run test:e2e` run downloads `tauri-driver` (via `cargo
install`) and the matching `msedgedriver` automatically — no manual
driver install, see `e2e/README.md`.

## Launching the app under test

`e2e/wdio.conf.ts` points `@wdio/tauri-service` (`driverProvider:
'official'`) at `src-tauri/target/debug/null-notes.exe` and passes
`--workspace <fixture>` so the app opens directly into a temp fixture
workspace, skipping the native folder-picker dialog entirely. The
fixture directory is created once at config-load time and shared with
spec files via `process.env.NULL_NOTES_E2E_WORKSPACE` — read it, don't
recompute it (see the comment in `wdio.conf.ts` for why).

## Writing a new spec

1. Add `e2e/specs/<feature>.e2e.ts`.
2. Read the fixture workspace path from
   `process.env.NULL_NOTES_E2E_WORKSPACE` — throw if it's unset rather
   than falling back silently, so a spec run outside `npm run test:e2e`
   fails loudly instead of pointing at the wrong folder.
3. Drive the DOM with WebdriverIO selectors
   (`browser.$('button*=Label')`), same as any WDIO test.
4. **Native dialogs** (`window.prompt`/`confirm`, e.g. note/folder
   naming) render outside the WebView DOM — reach them with the
   standard WebDriver user-prompt commands instead of a selector:
   `await browser.sendAlertText('value'); await browser.acceptAlert()`.
   See `create-note.e2e.ts` for the wait-for-alert pattern.
5. **Assert on disk, not just DOM.** This app's source of truth is the
   `.md` file / SQLite index / `.workspace.json`, not React state —
   read the fixture workspace with Node's `fs` and assert file content.
6. **Debounce-aware waits, never a blind sleep.** Autosave debounces
   `SAVE_DEBOUNCE_MS` (600ms default, `src/hooks/useNote.ts`) and
   reindex debounces `REINDEX_DEBOUNCE_MS` (2500ms). Use
   `browser.waitUntil(...)` polling the expected on-disk state with a
   timeout comfortably past the relevant debounce.

## Running

    npm run test:e2e                                        # whole suite
    npm run test:e2e -- --spec e2e/specs/<feature>.e2e.ts    # one spec

## Known gotchas

- Each run gets a fresh fixture workspace — nothing persists between
  runs, and the real user's
  `%APPDATA%\dev.nullnotes.app\recent-workspaces.json` is untouched
  (the `--workspace` arg path opens via `openWorkspaceAt(path, {
  remember: false })` in `Layout.tsx`).
- `maxInstances`/`maxInstancesPerCapability` are pinned to `1` — one
  Tauri window at a time, no parallel specs.
- If a run hangs at launch rather than failing fast, check the
  installed Edge version against the downloaded `msedgedriver` first —
  a mismatch tends to fail silently rather than with a clear error.
```

- [ ] **Step 4: Verify the skill is tracked by git**

Run: `git status --short .claude/skills/`
Expected: shows `.claude/skills/e2e-verify/SKILL.md` as untracked (not silently absent, confirming Step 2's gitignore fix actually works end to end).

- [ ] **Step 5: Commit**

```bash
git add .gitignore .claude/skills/e2e-verify/SKILL.md
git commit -m "docs(e2e): un-ignore .claude/skills/ and add the e2e-verify skill"
```
