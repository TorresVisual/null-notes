# Mobile Credentials & Onboarding Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Give iOS a way to enter and store a Git HTTPS remote + personal access token, and thread that token into the three `git_mobile.rs` commands (`push_notes`, `fetch_and_compare`, `clone_repo`) that already accept one but have nothing supplying it — the gap both `docs/plans/git-mobile-gix.md` and `docs/plans/git-mobile-push.md` named as their own explicit follow-up.

**Architecture:** Three independent layers, built bottom-up: (1) a runtime platform check (`tauri-plugin-os`) so mobile-only code never runs on desktop, (2) an iOS-Keychain-backed credential store (`tauri-plugin-keyring`, gated to `target_os = "ios"` the same way `git_mobile.rs` itself is) holding a single PAT under a fixed key, (3) a small onboarding form that replaces `WorkspacePicker`'s folder/clone buttons on mobile, storing the token and driving the existing `clone_repo` command. The three commands that need the token (`push_notes`, `fetch_and_compare`, `clone_repo`) read it from the same credential store internally in `src/lib/tauri.ts`, so `useGitAutoPull.ts`, `src/lib/git.ts`, and any future caller need zero changes — this is the same "fix once in the shared function" shape `git_mobile.rs` itself already uses for its command wrappers.

**Tech Stack:** Rust (`tauri-plugin-os` 2.x, `tauri-plugin-keyring` 0.2.x — both new dependencies), TypeScript/React (`@tauri-apps/plugin-os`, `tauri-plugin-keyring-api` — new npm packages; `@tauri-apps/api/path`'s `documentDir()` — already available via the installed `@tauri-apps/api`).

**Spec:** `docs/specs/mobile-app-design.md` (Storage & sync → Onboarding flow, Credentials); direct follow-up to `docs/plans/git-mobile-gix.md` and `docs/plans/git-mobile-push.md`'s "known follow-ups" notes.

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [x] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [x] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- **No behavior change to desktop.** `git.rs`'s `push_notes`/`fetch_and_compare`/`clone_repo` keep their current signatures (no `token` param) and current credential handling (the real `git` CLI's own helpers). Every new dependency in this plan that isn't platform-agnostic (`tauri-plugin-keyring`, the iOS entitlement/Info.plist edits) is gated to `target_os = "ios"` — the same `[target.'cfg(target_os = "ios")'.dependencies]` technique `docs/plans/mobile-ios-scaffold.md`'s Task 1 established for `pdfium-render`.
- **`tauri-plugin-os` is the one exception** — it's cross-platform and registered unconditionally, since desktop also benefits from a real platform check (today nothing in this codebase distinguishes platforms at the frontend level at all).
- **The credential store never touches `settings.json` or any plain file** — CLAUDE.md's storage-boundary rule and the spec's Credentials section both rule that out explicitly for a secret.
- **No Mac exists locally.** Every iOS-target build/lint/Simulator check runs via `.github/workflows/ios-scaffold.yml` on a GitHub Actions `macos-latest` runner, triggered with `gh workflow run ios-scaffold.yml && gh run watch --exit-status` — the same loop `docs/plans/mobile-ios-scaffold.md` and `docs/plans/git-mobile-push.md`'s Task 3 Step 7 already established. Desktop-buildable Rust (everything outside the `target_os = "ios"` gate) still gets a plain local `cargo build`/`cargo test` pass on Windows.
- **A full HTTPS-clone-with-a-real-PAT round trip against a real remote is out of scope for automated verification.** The spec's own Testing section already settles this: "Mobile verification for v1 is manual QA on-device (or simulator)... not a new automated e2e harness." This plan's CI check (Task 5) proves the UI plumbing — token entry, Keychain write, `clone_repo` invocation with the token attached — via the same idb-tap-and-screenshot method `mobile-ios-scaffold.md`'s Task 3 used, not a real network clone.
- `cargo clippy -- -D warnings` and `cargo fmt --check` must stay clean on both the desktop and `aarch64-apple-ios-sim` targets before any commit that touches Rust in this plan.
- `npm run typecheck` and `npm test` must stay clean before any commit that touches TypeScript.

---

### Task 1: Runtime platform check

**Files:**
- Modify: `src-tauri/Cargo.toml` — add `tauri-plugin-os` to `[dependencies]`.
- Modify: `package.json` — add `@tauri-apps/plugin-os`.
- Modify: `src-tauri/src/lib.rs` — register the plugin.
- Modify: `src-tauri/capabilities/default.json` — grant its permission.
- Create: `src/lib/platform.ts`
- Test: `src/lib/platform.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (first task).
- Produces: `export function isMobile(): boolean` — Task 2's `gitCredentials.ts`, Task 3's `tauri.ts` edits, and Task 4's onboarding component all call this directly.

- [x] **Step 1: Add the dependency and register the plugin**

In `src-tauri/Cargo.toml`, `[dependencies]`:
```toml
tauri-plugin-os = "2"
```

```bash
npm install @tauri-apps/plugin-os
```

In `src-tauri/src/lib.rs`, add to the existing `.plugin(...)` chain (next to `tauri_plugin_opener::init()`/`tauri_plugin_dialog::init()` at lines 35-36):
```rust
        .plugin(tauri_plugin_os::init())
```

In `src-tauri/capabilities/default.json`, add `"os:default"` to the `"permissions"` array (same blanket-`:default` shape already used there for `"opener:default"`).

- [x] **Step 2: Write `platform.ts` and its test**

```ts
// src/lib/platform.ts
import { platform } from '@tauri-apps/plugin-os'

export function isMobile(): boolean {
  return platform() === 'ios' || platform() === 'android'
}
```

```ts
// src/lib/platform.test.ts
import { describe, it, expect, vi } from 'vitest'
import { platform } from '@tauri-apps/plugin-os'
import { isMobile } from './platform'

vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn() }))

describe('isMobile', () => {
  it('is true on iOS', () => {
    vi.mocked(platform).mockReturnValue('ios')
    expect(isMobile()).toBe(true)
  })

  it('is false on desktop platforms', () => {
    vi.mocked(platform).mockReturnValue('windows')
    expect(isMobile()).toBe(false)
  })
})
```

- [x] **Step 3: Run the test**

Run: `npm test -- src/lib/platform.test.ts`
Expected: PASS, 2 tests.

- [x] **Step 4: Verify desktop still builds clean**

```bash
cd src-tauri
cargo build
cargo clippy -- -D warnings
cargo fmt --check
cd ..
npm run typecheck
```

- [x] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/capabilities/default.json package.json package-lock.json src/lib/platform.ts src/lib/platform.test.ts
git commit -m "feat(mobile): add a cross-platform mobile check via tauri-plugin-os"
```

---

### Task 2: iOS Keychain-backed token store

**Files:**
- Modify: `src-tauri/Cargo.toml` — add `tauri-plugin-keyring`, iOS-only.
- Modify: `package.json` — add `tauri-plugin-keyring-api`.
- Modify: `src-tauri/src/lib.rs` — register the plugin and initialize its service name, iOS-only.
- Modify: `src-tauri/capabilities/default.json` — grant its permissions.
- Modify: `src-tauri/gen/apple/null-notes_iOS/Info.plist` — add the `keychain-access-groups` entitlement key.
- Create: `src/lib/gitCredentials.ts`
- Test: `src/lib/gitCredentials.test.ts`

**Interfaces:**
- Consumes: `isMobile` (Task 1).
- Produces: `export async function getStoredGitToken(): Promise<string>` and `export async function setStoredGitToken(token: string): Promise<void>` — Task 3's `tauri.ts` edits and Task 4's onboarding component both call these directly.

- [x] **Step 1: Confirm the JS package's actual export name before writing code that imports it**

The plugin's own README is inconsistent between its install command (`npm add tauri-plugin-keyring-api`) and its usage example (`import { ... } from 'tauri-plugin-keyring'`). Run the install first, then check which name resolves:

```bash
npm install tauri-plugin-keyring-api
node -e "console.log(Object.keys(require('tauri-plugin-keyring-api')))"
```

Expected: prints `initializeKeyring, setPassword, getPassword, deletePassword, hasPassword, setSecret, getSecret, deleteSecret, hasSecret` (or a subset). If the package has no CJS entry and the `node -e` require fails, open `node_modules/tauri-plugin-keyring-api/package.json`'s `"main"`/`"exports"` field directly instead — either way, confirm the real import specifier (`'tauri-plugin-keyring-api'` vs `'tauri-plugin-keyring'`) before Step 3 uses it. Use whichever string actually resolves.

- [x] **Step 2: Add the Rust dependency, iOS-only**

In `src-tauri/Cargo.toml`, add a new target-specific table (same technique as the existing `pdf-native` iOS gate):
```toml
[target.'cfg(target_os = "ios")'.dependencies]
tauri-plugin-keyring = "0.2.0"
```

(If `src-tauri/Cargo.toml` already has a `[target.'cfg(target_os = "ios")'.dependencies]` table from an earlier plan, add the line to the existing table instead of creating a second one — `cargo` errors on a duplicate table key.)

- [x] **Step 3: Register the plugin and initialize its service name, iOS-only**

`src-tauri/src/lib.rs`'s `run()` today is one unbroken chain: `tauri::Builder::default().plugin(tauri_plugin_opener::init()).plugin(tauri_plugin_dialog::init()).on_window_event(...).setup(move |app| {...}).invoke_handler(...).run(...)` (lines 34-45 start the chain). Break it at the `.plugin(...)` calls so an iOS-only `.plugin(...)` can be spliced in — replace:
```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        // Veto the close so the UI can flush unsaved edits; it calls
        // `confirm_close` once the buffer is safely on disk.
        .on_window_event(|window, event| {
```
with:
```rust
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init());
    #[cfg(target_os = "ios")]
    let builder = builder.plugin(tauri_plugin_keyring::init());
    builder
        // Veto the close so the UI can flush unsaved edits; it calls
        // `confirm_close` once the buffer is safely on disk.
        .on_window_event(|window, event| {
```
(`.plugin(tauri_plugin_os::init())` above is Task 1's line, already in place before this task starts — this step's diff is the `let builder = ...` restructuring and the new iOS-only `.plugin(tauri_plugin_keyring::init())` line.)

Inside the existing `.setup(move |app| { ... })` closure, add right after the `let data_dir = app.path().app_data_dir()?;` line:
```rust
            #[cfg(target_os = "ios")]
            {
                use tauri_plugin_keyring::KeyringExt;
                app.keyring().initialize_service("dev.nullnotes.app".to_string())?;
            }
```

(`"dev.nullnotes.app"` matches `src-tauri/tauri.conf.json`'s existing `"identifier"` — reuse that value verbatim, don't invent a new one.)

Also add the iOS plugin binding, at module scope (outside `run()`, anywhere else in the file — e.g. directly above `pub fn run()`), matching the plugin's documented iOS registration:
```rust
#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_keyring);
```

- [x] **Step 4: Add capabilities and the iOS entitlement**

In `src-tauri/capabilities/default.json`, add to `"permissions"`:
```json
    "keyring:allow-initialize-keyring",
    "keyring:allow-set-password",
    "keyring:allow-get-password",
    "keyring:allow-has-password"
```
(Only the four actually used — `delete-password`/`*-secret` aren't called anywhere in this plan; don't grant permissions for commands nothing invokes.)

In `src-tauri/gen/apple/null-notes_iOS/Info.plist`, add before the closing `</dict>`:
```xml
	<key>keychain-access-groups</key>
	<array>
		<string>$(AppIdentifierPrefix)</string>
	</array>
```

- [x] **Step 5: Write `gitCredentials.ts` and its test**

```ts
// src/lib/gitCredentials.ts
import { getPassword, setPassword } from 'tauri-plugin-keyring-api'
import { isMobile } from './platform'

const TOKEN_USERNAME = 'git-pat'

export async function getStoredGitToken(): Promise<string> {
  if (!isMobile()) return ''
  const stored = await getPassword(TOKEN_USERNAME)
  return stored ?? ''
}

export async function setStoredGitToken(token: string): Promise<void> {
  if (!isMobile()) return
  await setPassword(TOKEN_USERNAME, token)
}
```

(Replace the import specifier with whichever one Step 1 confirmed, if it turned out not to be `'tauri-plugin-keyring-api'`.)

```ts
// src/lib/gitCredentials.test.ts
import { describe, it, expect, vi } from 'vitest'
import { getPassword, setPassword } from 'tauri-plugin-keyring-api'
import { platform } from '@tauri-apps/plugin-os'
import { getStoredGitToken, setStoredGitToken } from './gitCredentials'

vi.mock('tauri-plugin-keyring-api', () => ({
  getPassword: vi.fn(),
  setPassword: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn() }))

describe('gitCredentials', () => {
  it('reads the stored token on iOS', async () => {
    vi.mocked(platform).mockReturnValue('ios')
    vi.mocked(getPassword).mockResolvedValue('ghp_abc123')

    await expect(getStoredGitToken()).resolves.toBe('ghp_abc123')
    expect(getPassword).toHaveBeenCalledWith('git-pat')
  })

  it('returns an empty string on desktop without touching the keyring', async () => {
    vi.mocked(platform).mockReturnValue('windows')

    await expect(getStoredGitToken()).resolves.toBe('')
    expect(getPassword).not.toHaveBeenCalled()
  })

  it('returns an empty string when nothing is stored yet', async () => {
    vi.mocked(platform).mockReturnValue('ios')
    vi.mocked(getPassword).mockResolvedValue(null)

    await expect(getStoredGitToken()).resolves.toBe('')
  })

  it('stores the token on iOS', async () => {
    vi.mocked(platform).mockReturnValue('ios')

    await setStoredGitToken('ghp_new')

    expect(setPassword).toHaveBeenCalledWith('git-pat', 'ghp_new')
  })

  it('does not store anything on desktop', async () => {
    vi.mocked(platform).mockReturnValue('windows')

    await setStoredGitToken('ghp_new')

    expect(setPassword).not.toHaveBeenCalled()
  })
})
```

- [x] **Step 6: Run the tests**

Run: `npm test -- src/lib/gitCredentials.test.ts`
Expected: PASS, 5 tests.

- [x] **Step 7: Verify desktop is unaffected and iOS cross-compiles**

```bash
cd src-tauri
cargo build
cargo clippy -- -D warnings
cargo fmt --check
```
(`tauri-plugin-keyring` is target-gated, so none of the above touch it — confirms desktop truly sees no change.)

```bash
gh workflow run ios-scaffold.yml
gh run watch --exit-status
```
Expected: green, including `cargo check --target aarch64-apple-ios-sim` and `cargo clippy --target aarch64-apple-ios-sim -- -D warnings` now compiling `tauri-plugin-keyring` and the `lib.rs` changes for the first time. Fix and re-run on any failure before continuing — this is the only place this task's Rust code is ever actually compiled.

- [x] **Step 8: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/capabilities/default.json "src-tauri/gen/apple/null-notes_iOS/Info.plist" package.json package-lock.json src/lib/gitCredentials.ts src/lib/gitCredentials.test.ts
git commit -m "feat(mobile): store the git PAT in the iOS Keychain via tauri-plugin-keyring"
```

---

### Task 3: Thread the token into `push_notes`/`fetch_and_compare`/`clone_repo`

**Files:**
- Modify: `src/lib/tauri.ts:115-137` (the `git:` block of `api`)
- Test: `src/lib/tauri.test.ts` (create if it doesn't already exist — check first)

**Interfaces:**
- Consumes: `getStoredGitToken` (Task 2).
- Produces: no signature change to `api.git.pushNotes`/`fetchAndCompare`/`cloneRepo` from the caller's point of view — `src/hooks/useGitAutoPull.ts`, `src/lib/git.ts`, and Task 4's onboarding component all call them exactly as they're called today.

- [x] **Step 1: Check whether `src/lib/tauri.test.ts` already exists**

```bash
ls src/lib/tauri.test.ts 2>/dev/null || echo "does not exist"
```
If it exists, add the new tests below to it (matching its existing mocking style for `invoke`). If not, create it fresh as shown in Step 3.

- [x] **Step 2: Update the three commands in `src/lib/tauri.ts`**

Replace the existing `pushNotes`, `fetchAndCompare`, and `cloneRepo` entries (current lines 122-125, and `cloneRepo` further down) with:
```ts
    pushNotes: async (workspace: string, mode: RepoMode, allowCodeRepoPush: boolean) => {
      const args: Record<string, unknown> = { workspace, mode, allowCodeRepoPush }
      if (isMobile()) args.token = await getStoredGitToken()
      return invoke<PushOutcome>('push_notes', args)
    },
    fetchAndCompare: async (workspace: string) => {
      const args: Record<string, unknown> = { workspace }
      if (isMobile()) args.token = await getStoredGitToken()
      return invoke<PullOutcome>('fetch_and_compare', args)
    },
```
and (wherever `cloneRepo` is defined further down in the same `git:` block):
```ts
    cloneRepo: async (url: string, parentDir: string) => {
      const args: Record<string, unknown> = { url, parentDir }
      if (isMobile()) args.token = await getStoredGitToken()
      return invoke<string>('clone_repo', args)
    },
```

Add the two new imports at the top of the file:
```ts
import { isMobile } from './platform'
import { getStoredGitToken } from './gitCredentials'
```

Desktop's Rust commands (`git.rs`) don't declare a `token` parameter at all, so `isMobile()` being `false` there means the `args` object never gains the extra key — this is why the branch is needed rather than always sending `token: ''`, which would send an argument desktop's command struct doesn't expect.

- [x] **Step 3: Write the tests**

```ts
// src/lib/tauri.test.ts (new file, or append to existing)
import { describe, it, expect, vi, afterEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { platform } from '@tauri-apps/plugin-os'
import { getPassword } from 'tauri-plugin-keyring-api'
import { api } from './tauri'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn() }))
vi.mock('tauri-plugin-keyring-api', () => ({
  getPassword: vi.fn(),
  setPassword: vi.fn(),
}))

afterEach(() => vi.clearAllMocks())

describe('api.git token threading', () => {
  it('omits token on desktop for pushNotes', async () => {
    vi.mocked(platform).mockReturnValue('windows')
    vi.mocked(invoke).mockResolvedValue('Pushed')

    await api.git.pushNotes('/ws', 'notesOnly', false)

    expect(invoke).toHaveBeenCalledWith('push_notes', {
      workspace: '/ws',
      mode: 'notesOnly',
      allowCodeRepoPush: false,
    })
    expect(getPassword).not.toHaveBeenCalled()
  })

  it('attaches the stored token on iOS for pushNotes', async () => {
    vi.mocked(platform).mockReturnValue('ios')
    vi.mocked(getPassword).mockResolvedValue('ghp_abc')
    vi.mocked(invoke).mockResolvedValue('Pushed')

    await api.git.pushNotes('/ws', 'notesOnly', false)

    expect(invoke).toHaveBeenCalledWith('push_notes', {
      workspace: '/ws',
      mode: 'notesOnly',
      allowCodeRepoPush: false,
      token: 'ghp_abc',
    })
  })

  it('attaches the stored token on iOS for fetchAndCompare', async () => {
    vi.mocked(platform).mockReturnValue('ios')
    vi.mocked(getPassword).mockResolvedValue('ghp_abc')
    vi.mocked(invoke).mockResolvedValue('UpToDate')

    await api.git.fetchAndCompare('/ws')

    expect(invoke).toHaveBeenCalledWith('fetch_and_compare', { workspace: '/ws', token: 'ghp_abc' })
  })

  it('attaches the stored token on iOS for cloneRepo', async () => {
    vi.mocked(platform).mockReturnValue('ios')
    vi.mocked(getPassword).mockResolvedValue('ghp_abc')
    vi.mocked(invoke).mockResolvedValue('/Documents/notes')

    await api.git.cloneRepo('https://example.com/notes.git', '/Documents')

    expect(invoke).toHaveBeenCalledWith('clone_repo', {
      url: 'https://example.com/notes.git',
      parentDir: '/Documents',
      token: 'ghp_abc',
    })
  })
})
```

(`RepoMode` is a plain string-literal union — `'notesOnly' | 'codeRepo' | 'notesMonorepo'`, `src/types/index.ts:66` — not an enum, hence the bare string literals above rather than an import.)

- [x] **Step 4: Run the tests**

Run: `npm test -- src/lib/tauri.test.ts`
Expected: PASS, 4 new tests (plus any pre-existing ones in the file if it already existed).

- [x] **Step 5: Run the full frontend test suite and typecheck**

```bash
npm run typecheck
npm test
```
Expected: no regressions — `src/hooks/useGitAutoPull.ts` and `src/lib/git.ts` call `pushNotes`/`fetchAndCompare` with the same arguments as before, so their existing tests must still pass unmodified.

- [x] **Step 6: Commit**

```bash
git add src/lib/tauri.ts src/lib/tauri.test.ts
git commit -m "feat(mobile): thread the stored git token into push/pull/clone on iOS"
```

---

### Task 4: Mobile onboarding form

**Files:**
- Modify: `src/components/WorkspacePicker.tsx`
- Modify: `src/index.css` (new onboarding-field styles, scoped under the existing `.workspace-picker` rules)
- Test: `src/components/WorkspacePicker.test.tsx` (create if it doesn't already exist — check first)

**Interfaces:**
- Consumes: `isMobile` (Task 1), `setStoredGitToken` (Task 2), `api.git.cloneRepo` (Task 3, unchanged signature), `useWorkspace().openWorkspaceAt` (existing, `src/hooks/useWorkspace.ts:53`).
- Produces: nothing further downstream — this is the last task before Task 5's device verification.

- [x] **Step 1: Check for an existing test file**

```bash
ls src/components/WorkspacePicker.test.tsx 2>/dev/null || echo "does not exist"
```

- [x] **Step 2: Add the onboarding branch to `WorkspacePicker.tsx`**

```tsx
import { useState } from 'react'
import { FolderOpen, GitBranch, History } from 'lucide-react'
import { documentDir } from '@tauri-apps/api/path'
import { useWorkspaceStore } from '../store/workspace'
import { useWorkspace } from '../hooks/useWorkspace'
import { folderName } from '../lib/pathPrefix'
import { CloneWorkspaceDialog } from './CloneWorkspaceDialog'
import { isMobile } from '../lib/platform'
import { setStoredGitToken } from '../lib/gitCredentials'
import { api } from '../lib/tauri'
import { showToast } from '../store/toast'

export function WorkspacePicker() {
  const recents = useWorkspaceStore((s) => s.recentWorkspaces)
  const folderLoading = useWorkspaceStore((s) => s.folderLoading)
  const { openWorkspace, openWorkspaceAt } = useWorkspace()
  const [cloning, setCloning] = useState(false)
  const [onboardUrl, setOnboardUrl] = useState('')
  const [onboardToken, setOnboardToken] = useState('')
  const [onboarding, setOnboarding] = useState(false)

  async function handleMobileClone(e: React.FormEvent) {
    e.preventDefault()
    setOnboarding(true)
    try {
      await setStoredGitToken(onboardToken)
      const parentDir = await documentDir()
      const clonedPath = await api.git.cloneRepo(onboardUrl, parentDir)
      await openWorkspaceAt(clonedPath)
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err))
      setOnboarding(false)
    }
  }

  return (
    <div className="workspace-picker">
      <img src="/favicon.svg" alt="" width={56} height={56} className="workspace-picker-mark" />
      <h1 className="workspace-picker-title">null-notes</h1>
      <p className="workspace-picker-tagline">
        WYSIWYG Markdown for CS coursework — plain <code>.md</code> files you own, not a
        database. Paste in a lecture PDF and get real, editable text and equations back, not a
        scan.
      </p>

      {recents.length > 0 && (
        <>
          <h2 className="workspace-picker-heading">
            <History size={13} /> Recent
          </h2>
          <ul className="workspace-picker-recents">
            {recents.map((path) => (
              <li key={path}>
                <button onClick={() => void openWorkspaceAt(path)} title={path} disabled={folderLoading}>
                  <span className="workspace-picker-name">{folderName(path)}</span>
                  <span className="workspace-picker-path">{path}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {isMobile() ? (
        <form className="workspace-picker-onboarding" onSubmit={(e) => void handleMobileClone(e)}>
          <p className="workspace-picker-subtitle">
            Clone an existing git-synced notes workspace from your desktop.
          </p>
          <label className="workspace-picker-field">
            Repository URL
            <input
              type="url"
              value={onboardUrl}
              onChange={(e) => setOnboardUrl(e.target.value)}
              placeholder="https://github.com/me/notes.git"
              disabled={onboarding}
              required
            />
          </label>
          <label className="workspace-picker-field">
            Personal access token
            <input
              type="password"
              value={onboardToken}
              onChange={(e) => setOnboardToken(e.target.value)}
              disabled={onboarding}
              required
            />
          </label>
          <button className="workspace-picker-browse" type="submit" disabled={onboarding}>
            <GitBranch size={14} /> {onboarding ? 'Cloning…' : 'Clone workspace'}
          </button>
        </form>
      ) : (
        <>
          <p className="workspace-picker-subtitle">
            Open a folder of Markdown notes to get started.
          </p>
          <button className="workspace-picker-browse" onClick={() => void openWorkspace()} disabled={folderLoading}>
            <FolderOpen size={14} /> {folderLoading ? 'Opening…' : 'Choose a folder…'}
          </button>
          <button className="workspace-picker-clone" onClick={() => setCloning(true)} disabled={folderLoading}>
            <GitBranch size={14} /> Clone workspace…
          </button>
          {cloning && <CloneWorkspaceDialog onClose={() => setCloning(false)} />}
        </>
      )}
    </div>
  )
}
```

- [x] **Step 3: Add the onboarding field CSS**

In `src/index.css`, immediately after the existing `.workspace-picker-clone:focus-visible` rule (around line 2306):
```css
.workspace-picker-onboarding {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin-top: var(--space-xs);
}

.workspace-picker-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-tertiary);
}

.workspace-picker-field input {
  padding: 10px 12px;
  background: var(--bg-sunken);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 400;
}

.workspace-picker-field input:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}
```
(`--bg-sunken` and the other tokens above are confirmed existing entries in `src/index.css`'s `:root` block, lines 9-31 — no new tokens introduced.)

- [x] **Step 4: Write the tests**

```tsx
// src/components/WorkspacePicker.test.tsx (new file, or append to existing)
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkspacePicker } from './WorkspacePicker'
import { useWorkspaceStore } from '../store/workspace'
import { useWorkspace } from '../hooks/useWorkspace'
import { platform } from '@tauri-apps/plugin-os'
import { documentDir } from '@tauri-apps/api/path'
import { api } from '../lib/tauri'
import { setStoredGitToken } from '../lib/gitCredentials'
import { showToast } from '../store/toast'

vi.mock('../hooks/useWorkspace')
vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({ documentDir: vi.fn() }))
vi.mock('../lib/tauri', () => ({ api: { git: { cloneRepo: vi.fn() } } }))
vi.mock('../lib/gitCredentials', () => ({ setStoredGitToken: vi.fn() }))
vi.mock('../store/toast', () => ({ showToast: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function setup() {
  useWorkspaceStore.setState({ recentWorkspaces: [], folderLoading: false })
  const openWorkspaceAt = vi.fn().mockResolvedValue(undefined)
  vi.mocked(useWorkspace).mockReturnValue({
    openWorkspace: vi.fn(),
    openWorkspaceAt,
    saveSession: vi.fn(),
    closeWorkspace: vi.fn(),
  })
  return { openWorkspaceAt }
}

describe('WorkspacePicker on mobile', () => {
  it('shows the onboarding form instead of the folder picker', () => {
    vi.mocked(platform).mockReturnValue('ios')
    setup()

    render(<WorkspacePicker />)

    expect(screen.getByPlaceholderText('https://github.com/me/notes.git')).toBeInTheDocument()
    expect(screen.queryByText('Choose a folder…')).not.toBeInTheDocument()
  })

  it('stores the token and clones into the Documents dir on submit', async () => {
    const user = userEvent.setup()
    vi.mocked(platform).mockReturnValue('ios')
    vi.mocked(documentDir).mockResolvedValue('/var/mobile/Documents')
    vi.mocked(api.git.cloneRepo).mockResolvedValue('/var/mobile/Documents/notes')
    const { openWorkspaceAt } = setup()

    render(<WorkspacePicker />)
    await user.type(screen.getByPlaceholderText('https://github.com/me/notes.git'), 'https://github.com/me/notes.git')
    await user.type(screen.getByLabelText('Personal access token'), 'ghp_abc')
    await user.click(screen.getByRole('button', { name: /Clone workspace/ }))

    expect(setStoredGitToken).toHaveBeenCalledWith('ghp_abc')
    expect(api.git.cloneRepo).toHaveBeenCalledWith('https://github.com/me/notes.git', '/var/mobile/Documents')
    expect(openWorkspaceAt).toHaveBeenCalledWith('/var/mobile/Documents/notes')
  })

  it('shows a toast and stays on the form when clone fails', async () => {
    const user = userEvent.setup()
    vi.mocked(platform).mockReturnValue('ios')
    vi.mocked(documentDir).mockResolvedValue('/var/mobile/Documents')
    vi.mocked(api.git.cloneRepo).mockRejectedValue(new Error('authentication failed'))
    setup()

    render(<WorkspacePicker />)
    await user.type(screen.getByPlaceholderText('https://github.com/me/notes.git'), 'https://github.com/me/notes.git')
    await user.type(screen.getByLabelText('Personal access token'), 'ghp_bad')
    await user.click(screen.getByRole('button', { name: /Clone workspace/ }))

    expect(showToast).toHaveBeenCalledWith('authentication failed')
  })
})

describe('WorkspacePicker on desktop', () => {
  it('keeps the existing folder/clone buttons', () => {
    vi.mocked(platform).mockReturnValue('windows')
    setup()

    render(<WorkspacePicker />)

    expect(screen.getByText('Choose a folder…')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('https://github.com/me/notes.git')).not.toBeInTheDocument()
  })
})
```

(`showToast` is asserted via the mock call only, matching `CloneWorkspaceDialog.test.tsx`'s equivalent "shows a toast... when the clone fails" test — the toast itself renders through a separate store-driven portal this component doesn't mount, so there's nothing in `screen` to query for.)

- [x] **Step 5: Run the tests**

Run: `npm test -- src/components/WorkspacePicker.test.tsx`
Expected: PASS, 4 tests.

- [x] **Step 6: Visual check**

Use the `ui-preview` skill against the Vite dev server to confirm the onboarding form actually renders with the new CSS (not just that the classNames exist in `index.css` — per this project's own recorded lesson that a className with no matching rule renders as unstyled text). Force `isMobile()` to return `true` for the preview (temporarily hardcode `return true` in `src/lib/platform.ts`, screenshot, then revert — do not leave the hardcode in the commit).

- [x] **Step 7: Run the full suite**

```bash
npm run typecheck
npm test
```

- [x] **Step 8: Commit**

```bash
git add src/components/WorkspacePicker.tsx src/components/WorkspacePicker.test.tsx src/index.css
git commit -m "feat(mobile): add the onboarding form (remote URL + PAT) for iOS"
```

---

### Task 5: On-device verification (CI Simulator smoke test)

**Files:**
- Modify: `.github/workflows/ios-scaffold.yml` (extend the existing Simulator smoke-test job from `docs/plans/mobile-ios-scaffold.md`'s Task 3)

**Interfaces:**
- Consumes: the built `.app` and `idb`/`simctl` tooling already set up by Task 3 of `mobile-ios-scaffold.md`.
- Produces: nothing further downstream — this is the plan's last task.

- [x] **Step 1: Locate the existing smoke-test steps**

Read `.github/workflows/ios-scaffold.yml`'s current smoke-test job (the one `mobile-ios-scaffold.md`'s Task 3 Step 1 added — install, launch, `xcrun simctl io booted screenshot` before/after an `idb ui tap`). This task appends to that same job rather than creating a new one, reusing its Simulator boot/install/launch steps as-is.

- [x] **Step 2: Add a tap-and-type sequence for the onboarding form**

Append after the existing tap/screenshot steps:
```yaml
      - name: Screenshot onboarding form
        run: xcrun simctl io booted screenshot onboarding-before.png

      - name: Tap the URL field and type
        run: |
          idb ui tap --udid booted <URL_FIELD_X> <URL_FIELD_Y>
          idb ui text --udid booted "https://example.com/no-such-repo.git"

      - name: Tap the token field and type
        run: |
          idb ui tap --udid booted <TOKEN_FIELD_X> <TOKEN_FIELD_Y>
          idb ui text --udid booted "dummy-token-for-ci"

      - name: Tap Clone workspace
        run: idb ui tap --udid booted <CLONE_BUTTON_X> <CLONE_BUTTON_Y>

      - name: Wait for the clone attempt to fail (unreachable host)
        run: sleep 5

      - name: Screenshot the result
        run: xcrun simctl io booted screenshot onboarding-after.png

      - name: Upload onboarding screenshots
        uses: actions/upload-artifact@v4
        with:
          name: mobile-onboarding-screenshots
          path: |
            onboarding-before.png
            onboarding-after.png
```

`<URL_FIELD_X>/<URL_FIELD_Y>` etc. are placeholders — `mobile-ios-scaffold.md`'s own Task 3 found its real tap coordinates by trial (screenshot, look, adjust) rather than computing them, since idb has no accessibility-tree query in this project's existing setup; do the same here once the real screenshot from Step 3 below is available. The deliberately unreachable URL (`https://example.com/no-such-repo.git`) is intentional — see this plan's Global Constraints on why a real network clone isn't attempted in CI; the goal here is proving the form accepts input and the clone attempt is actually dispatched (visible as a network-failure toast, not a crash or a frozen UI), not a successful clone.

- [x] **Step 3: Trigger and inspect**

```bash
gh workflow run ios-scaffold.yml
gh run watch --exit-status
gh run download --name mobile-onboarding-screenshots
```
Open both PNGs. Expected in `onboarding-before.png`: the two text fields showing the typed URL and a masked/dotted token field. Adjust the tap coordinates in Step 2 and re-run if the taps landed on the wrong element (same iterative process `mobile-ios-scaffold.md`'s Task 3 documented). Expected in `onboarding-after.png`: a visible error/toast state (proving `cloneRepo` was actually invoked and the Rust side attempted and failed a connection) rather than the form still sitting untouched or the app crashed/blank.

- [x] **Step 4: Record the result**

Note the final tap coordinates used and the workflow run URL in this task's own commit message or a short addendum to this plan file — the next mobile plan (app-shell reflow) will resize/reposition this form, which will invalidate these coordinates; leaving a record here is what lets that plan know to re-verify rather than assume this smoke test still passes.

**Result:** Final tap coordinates (UIKit points, iPhone 15 Simulator): URL field `(320, 605)`, token field `(320, 677)`, Clone workspace button `(320, 726)`. A first guess of `(196, 380/460/520)` landed inside the sidebar instead of the content pane (confirmed via a no-op `onboarding-after.png`); the coordinates above were computed from that run's real `onboarding-before.png` and verified working in run [34869255875](https://github.com/TorresVisual/null-notes/actions/runs/34869255875) — `onboarding-after.png` shows the typed URL, a masked token field, and the button reverted from "Cloning…" back to "Clone workspace", confirming `cloneRepo` was dispatched and the failure path completed rather than hanging. Also visible in that screenshot: the form is clipped/scrolled by the desktop-width sidebar on this device size — expected, out of this plan's scope (see the app-shell reflow note above).

Also discovered mid-task and fixed: `tauri-plugin-keyring`'s iOS backend is an unimplemented `ping`-only stub (not a real Keychain bridge), and the crate version the original plan draft named doesn't exist on crates.io. Task 2 was executed against the `keyring` crate directly instead (two thin `#[tauri::command]`s in `src-tauri/src/commands/git_credentials.rs`), which also needed `apple-native-keyring-store`'s `protected` feature enabled explicitly for iOS — a real CI run caught the missing feature.

- [x] **Step 5: Commit**

```bash
git add .github/workflows/ios-scaffold.yml
git commit -m "test(mobile): extend the CI Simulator smoke test to cover onboarding"
```

---

## Out of scope (this plan)

- **A real HTTPS clone against a real remote with a real PAT, verified in CI.** No safe way to hold a real credential in this repo's CI for that; matches the spec's own "manual QA on-device" testing posture. Manual QA (a human, or the maintainer, running the compiled app against their real GitHub PAT) is what actually exercises this path end-to-end — not automated here.
- **Token rotation, "forget this token" / logout, or multiple stored tokens.** v1 has exactly one PAT for the one remote mobile ever joins (per spec: "mobile always joins an existing... workspace" — no multi-workspace mobile support exists yet either). Add a `deletePassword`/`clearStoredGitToken` path when a real need for it shows up (e.g. token rotation UI), not speculatively.
- **Android.** This plan's `tauri-plugin-keyring` dependency is gated to `target_os = "ios"` only, matching every other mobile-specific gate in this codebase so far — Android is a separate, later pass per the spec.
- **Biometric-gating the stored token** (Face ID/Touch ID before a push/pull). The `tauri-plugin-keyring` ecosystem has a sibling `biometric` plugin for this; nothing in the spec's DoD requires it for v1.
- **Validating the pasted URL or token format client-side before submit.** The existing desktop `CloneWorkspaceDialog` doesn't validate either — errors surface from the actual `git clone` attempt via the same `showToast` path this plan reuses; no new validation layer is warranted for parity with the desktop flow it replaces.
