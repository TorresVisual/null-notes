# null-notes — Close Workspace & Recent Workspaces Design

**Date:** 2026-09-05
**Scope:** Three related TODO.md items, closed together since they all touch the same workspace-switching surface:

- **Close Workspace** — a way to return to `WorkspacePicker` without quitting the app.
- **Recent workspaces** — the File menu gets a "Recent Workspaces" section, mirroring what `WorkspacePicker` already shows before a workspace is open.
- **Recent workspaces in right-click menu** — right-clicking the app's **taskbar icon** on Windows shows a "Recent Workspaces" jump list. Confirmed with the user this means the OS taskbar, not an in-app context menu.

Parts A and B are small, in-codebase changes (bounded). Part C is native Windows Shell integration with no existing pattern in this codebase — the substantial piece of this batch.

---

## Part A — Close Workspace

New `closeWorkspace()` in `src/hooks/useWorkspace.ts`:

```ts
const closeWorkspace = useCallback(async () => {
  await saveSession()
  resetForNewWorkspace()
  clearNavigationHistory()
  setNotes([])
  setFolders([])
  setPath(null)
}, [saveSession, resetForNewWorkspace, setNotes, setFolders, setPath])
```

- `saveSession()` flushes the outgoing workspace's tabs/expanded-folders/etc. before anything is cleared, the same ordering `openWorkspaceAt` already uses when switching workspaces.
- `WorkspaceStore.setPath`'s type widens from `(path: string) => void` to `(path: string | null) => void`.
- Setting `path` to `null` is sufficient to fall back to `WorkspacePicker` — `Layout.tsx` already renders it on `!activeTab && !workspacePath`, and `useExternalChanges.ts`'s `workspace-changed` listener already no-ops when `path` is `null`. No new Rust command, no watcher teardown needed.

Wired as a new `close-workspace` item in `Titlebar.tsx`'s `FILE_MENU`, handled in `Layout.tsx`'s `runCommand`:

```ts
case 'close-workspace':
  if (workspacePath) await closeWorkspace()
  break
```

## Part B — Recent Workspaces (File menu)

`FILE_MENU` in `Titlebar.tsx` changes from a static array to a function of the current recent-workspaces list:

```ts
function buildFileMenu(recentWorkspaces: string[]): MenuItemSpec[]
```

Inserts one item per recent path directly after "Open Workspace…", each with id `open-recent:<path>` and label = `folderName(path)`. `Titlebar` takes a new `recentWorkspaces: string[]` prop, sourced in `Layout.tsx` from `useWorkspaceStore((s) => s.recentWorkspaces)`.

`Layout.tsx`'s `runCommand` gets one more branch:

```ts
if (id.startsWith('open-recent:')) {
  await openWorkspaceAt(id.slice('open-recent:'.length))
}
```

No submenu — a flat list under "Open Workspace…", matching how `WorkspacePicker` already presents recents.

## Part C — Recent Workspaces (Taskbar Jump List)

### Goals

1. Right-click the taskbar icon (pinned or running) → see a "Recent Workspaces" category listing the same paths as `recentWorkspaces` in the store, most-recent first, titled by folder name.
2. Clicking an entry opens that workspace, reusing the app's existing launch-arg path rather than adding a second one.
3. The list stays current: rebuilt every time the recent-workspaces list changes, and correct from the very first jump-list open after a fresh launch (not just after the first workspace switch in that session).

### Non-Goals

- **No single-instance enforcement.** Clicking a jump-list entry while the app is already running opens a *second* window/process. Confirmed acceptable — matches how this app already behaves (no single-instance lock exists today).
- **No jump-list "Tasks"** (static actions like "New Workspace"). Only the dynamic "Recent Workspaces" category.
- **No macOS/Linux equivalent.** This app is Windows-primary (per `CLAUDE.md`); the feature is `#[cfg(windows)]`-gated and simply absent elsewhere.
- **No change to how recents are stored or capped.** `recent-workspaces.json` and its existing cap (`MAX_RECENTS` in `commands/workspace.rs`) are the source of truth; the jump list mirrors whatever that file already holds.

### C.1 AppUserModelID

Windows jump lists are keyed to a process's AppUserModelID (AUMID), which must match the AUMID on the taskbar shortcut for the list to attach to the icon the user actually sees. Tauri's Windows installer already sets the shortcut's AUMID to the app's `identifier`, `dev.nullnotes.app` (`src-tauri/tauri.conf.json`).

In `src-tauri/src/lib.rs`'s `run()`, before the `tauri::Builder` is constructed, call:

```rust
#[cfg(windows)]
unsafe {
    let _ = windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(
        windows::core::w!("dev.nullnotes.app"),
    );
}
```

Best-effort: if this fails, the app still runs — the taskbar icon just won't get jump-list entries (same posture as the existing WebView2-accelerator `#[cfg(windows)]` block in the same file).

### C.2 Building the List

New module `src-tauri/src/commands/jumplist.rs`, entirely `#[cfg(windows)]`:

```rust
pub fn rebuild(recents: &[String]) -> windows::core::Result<()>
```

Steps, using `windows` crate COM APIs (`Win32_UI_Shell`, `Win32_System_Com`, `Win32_UI_Shell_PropertiesSystem` — new feature flags on the existing `windows = "0.61"` dependency in `Cargo.toml`, no new crate):

1. `CoCreateInstance(&ICustomDestinationList)`, call `.BeginList()` to get the max slot count and a removed-items array (ignored — this list has no user-removable pinned items).
2. Build an `IObjectCollection` (`CoCreateInstance(&EnumerableObjectCollection)`), and for each recent path (in `recents` order, already most-recent-first):
   - Create an `IShellLinkW` via `CoCreateInstance`.
   - `SetPath` → `std::env::current_exe()`.
   - `SetArguments` → `--workspace="<path>"` (same one-token flag `initial_workspace_from_args` already parses).
   - `SetIconLocation` → the exe itself, index 0.
   - Cast to `IPropertyStore`, `SetValue(&PKEY_Title, folder_name(path))`, `Commit()` — a jump-list shell link needs its title set this way; `SetDescription` alone doesn't drive the visible label.
   - `AddObject` onto the collection.
3. `list.AppendCategory("Recent Workspaces", &collection)`.
4. `list.CommitList()`.

`folder_name(path)` is a small helper (last path component) — equivalent to the frontend's `folderName()` in `src/lib/pathPrefix.ts`, reimplemented in Rust since this runs entirely on the backend.

Every step after `BeginList` is fallible; on any `Err`, return early without calling `CommitList` — matching the silent-swallow posture the WebView2-settings block in `lib.rs` already uses for best-effort Windows-only setup. Windows leaves the previous jump list in place if a new one is never committed, so a partial failure degrades to "stale but present" rather than "broken."

### C.3 Wiring

- **On startup:** in `lib.rs`'s `.setup()`, after loading `recent-workspaces.json` for `InitialWorkspace`/`recent_workspaces`, call `jumplist::rebuild(&recents)` once with whatever the file already contains — so the list is correct before the user ever switches workspaces in this session.
- **On every change:** `commands::workspace::remember_workspace` calls `jumplist::rebuild(&recents)` right after it writes the updated `recent-workspaces.json`, using the same `recents` vector it already computed for its return value.
- Both call sites are `#[cfg(windows)]`-gated at the call, not just inside `jumplist.rs`, so non-Windows builds (mobile target, per `#[cfg_attr(mobile, ...)]` in `lib.rs`) don't reference the module at all.

### C.4 Opening from the Jump List

No new code. A jump-list click launches `null-notes.exe --workspace="<path>"`; `initial_workspace_from_args` (already tested, `commands/workspace.rs`) parses it into `InitialWorkspace`, the `initial_workspace` command exposes it, and `Layout.tsx:358` already calls `api.workspace.initialWorkspace()` on mount and opens whatever it returns.

---

## File Structure

| File | Change |
|---|---|
| `src/store/workspace.ts` | Widen `setPath` to accept `string \| null` |
| `src/hooks/useWorkspace.ts` | Add `closeWorkspace()`; return it from the hook |
| `src/hooks/useWorkspace.test.ts` | Add test for `closeWorkspace()` |
| `src/components/Titlebar.tsx` | `FILE_MENU` → `buildFileMenu(recentWorkspaces)`; new `close-workspace` item; new `recentWorkspaces` prop |
| `src/components/Titlebar.test.tsx` | Add tests for the recent-workspace items and `close-workspace` |
| `src/components/Layout.tsx` | Pass `recentWorkspaces` to `Titlebar`; `runCommand` gets `close-workspace` and `open-recent:` handling |
| `src-tauri/Cargo.toml` | Add `Win32_UI_Shell`, `Win32_System_Com`, `Win32_UI_Shell_PropertiesSystem` to the existing `windows` dependency's features |
| `src-tauri/src/commands/jumplist.rs` | New. `rebuild(recents: &[String])`, `#[cfg(windows)]`, plus a unit-testable `folder_name` helper |
| `src-tauri/src/commands/mod.rs` | Register the new module |
| `src-tauri/src/lib.rs` | Set AUMID at startup; call `jumplist::rebuild` once in `.setup()` with the persisted recents |
| `src-tauri/src/commands/workspace.rs` | `remember_workspace` calls `jumplist::rebuild(&recents)` after writing the file |

---

## Error Handling

Part C's COM calls are best-effort and silently swallowed — a jump-list rebuild failure must never block startup, saving, or opening a workspace, matching the existing best-effort git-repo-detection pattern in `useWorkspace.ts`. Parts A and B introduce no new fallible operations beyond what `openWorkspaceAt`/`saveSession` already handle.

## Testing

- **A/B (TypeScript):** `closeWorkspace()` gets a unit test in `useWorkspace.test.ts` (populate state, call it, assert `path`/`notes`/`folders`/tabs are cleared and `saveSession` was called first). `Titlebar.test.tsx` gets tests asserting recent-workspace items render from props and that clicking one/​`close-workspace` fires the right `onCommand` id. `npm run typecheck` and `npm test` after each change.
- **C (Rust):** unit test `folder_name` the same way `initial_workspace_from_args` is already tested in `commands/workspace.rs`. The COM calls themselves aren't meaningfully unit-testable (no Windows Shell test harness in this repo) — verified manually: `npm run tauri build`, pin or run the built exe, right-click its taskbar icon, confirm "Recent Workspaces" lists the expected folders in the right order, click one, confirm a new window opens on that workspace. `cargo test` and `cargo clippy -- -D warnings` after the change.
- **Manual QA (A/B):** open a workspace, use File → Close Workspace, confirm `WorkspacePicker` appears and the closed workspace still shows under "Recent"; use File → Recent Workspaces to reopen it, confirm tabs/expanded folders from before the close are restored.
