# Workspace Recents Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Add Close Workspace, a File-menu "Recent Workspaces" list, and a Windows taskbar jump list showing the same recents.

**Architecture:** Parts A/B are pure frontend state + menu wiring on top of the existing `recentWorkspaces` store field and `remember_workspace`/`recent_workspaces` Tauri commands — no new backend surface. Part C is a new `#[cfg(windows)]` Rust module that mirrors the same recents list into the OS taskbar via `ICustomDestinationList` COM APIs, rebuilt on startup and on every recents-file write; it reuses the existing `--workspace=<path>` launch-arg path for opening, so there is no new IPC.

**Tech Stack:** React 19 + TypeScript (Zustand store, TipTap-adjacent UI unaffected), Rust/Tauri 2 backend, `windows` crate 0.61 (COM Shell APIs) for Part C.

**Spec:** `docs/specs/workspace-recents-design.md`

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

- No single-instance enforcement — a jump-list click while the app is running opens a second process (spec, Part C Non-Goals).
- No jump-list "Tasks" category, only "Recent Workspaces" (spec, Part C Non-Goals).
- No macOS/Linux jump-list equivalent — Part C is `#[cfg(windows)]`-gated, both at the module and at every call site, so non-Windows/mobile builds never reference it (spec §C.3).
- No change to how recents are stored or capped — `recent-workspaces.json` and `MAX_RECENTS = 8` in `commands/workspace.rs` stay the source of truth (spec, Part C Non-Goals).
- All Part C COM calls are best-effort: any `Err` aborts the rebuild before `CommitList`, never blocks startup/saving/opening, and leaves the previous jump list in place (spec §C.2, Error Handling).
- `cargo clippy -- -D warnings` and `cargo fmt --check` must pass locally before any Rust change is considered done (CLAUDE.md).
- `npm run typecheck` and `npm test` must pass after each TypeScript change (spec, Testing).

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
| `src-tauri/Cargo.toml` | Add Shell/COM feature flags to the existing `windows` dependency |
| `src-tauri/src/commands/jumplist.rs` | New. `rebuild(recents: &[String])`, `#[cfg(windows)]`, plus a unit-testable `folder_name` helper |
| `src-tauri/src/commands/mod.rs` | Register the new module |
| `src-tauri/src/lib.rs` | Set AUMID at startup; call `jumplist::rebuild` once in `.setup()` with the persisted recents |
| `src-tauri/src/commands/workspace.rs` | `remember_workspace` calls `jumplist::rebuild(&recents)` after writing the file; `present_recents` becomes `pub(crate)` so `lib.rs` can read the startup recents |

---

### Task 1: `closeWorkspace()` in the workspace hook

**Files:**
- Modify: `src/store/workspace.ts:34` (`setPath` type) and `:110` (`setPath` implementation stays the same body, only the type signature widens)
- Modify: `src/hooks/useWorkspace.ts:28-99`
- Test: `src/hooks/useWorkspace.test.ts`

**Interfaces:**
- Consumes: existing `useWorkspaceStore` fields/actions (`resetForNewWorkspace`, `setPath`, `recentWorkspaces` unaffected), existing `useNotesStore` actions (`setNotes`, `setFolders`), existing `clearNavigationHistory` from `src/lib/navigationHistory.ts`, existing `saveSession` from the same hook.
- Produces: `closeWorkspace(): Promise<void>`, returned from `useWorkspace()` alongside the existing `openWorkspace`, `openWorkspaceAt`, `saveSession`. Task 4 (`Layout.tsx`) calls this by name.

- [ ] **Step 1: Widen `setPath`'s type in the store**

In `src/store/workspace.ts`, change line 34:

```ts
  setPath: (path: string) => void
```

to:

```ts
  setPath: (path: string | null) => void
```

The implementation at line 110 (`setPath: (path) => set({ path, selectedFolder: path }),`) needs no change — it already just forwards whatever it's given.

- [ ] **Step 2: Write the failing test for `closeWorkspace`**

Add to `src/hooks/useWorkspace.test.ts`, inside the existing `describe('useWorkspace', ...)` block, after the last test:

```ts
  it('closeWorkspace flushes the session, clears state, and falls back to the picker', async () => {
    useWorkspaceStore.setState({
      path: '/ws',
      openTabs: ['/ws/a.md'],
      activeTab: '/ws/a.md',
      expandedFolders: ['/ws/folder'],
    })
    useNotesStore.setState({
      notes: [{ path: '/ws/a.md', title: 'a', tags: [] }],
      folders: ['/ws/folder'],
    })
    const { result } = renderHook(() => useWorkspace())

    await result.current.closeWorkspace()

    expect(workspace.save).toHaveBeenCalledWith('/ws', expect.any(Object))
    expect(useWorkspaceStore.getState().path).toBeNull()
    expect(useWorkspaceStore.getState().openTabs).toEqual([])
    expect(useNotesStore.getState().notes).toEqual([])
    expect(useNotesStore.getState().folders).toEqual([])
  })
```

This relies on the existing `notes.title`/`tags` shape already used elsewhere in the test file's `WorkspaceTree`/note types — if `useNotesStore`'s `notes` field expects a different shape, match whatever `emptyTree`'s sibling fixtures in this file already use.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- useWorkspace.test.ts`
Expected: FAIL — `result.current.closeWorkspace is not a function`

- [ ] **Step 4: Implement `closeWorkspace`**

In `src/hooks/useWorkspace.ts`, add the import for `useCallback` is already present. Add the new callback inside `useWorkspace()`, after `saveSession` (currently ending at line 37) and before `openWorkspaceAt`:

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

Update the final return statement (line 98) to include it:

```ts
  return { openWorkspace, openWorkspaceAt, saveSession, closeWorkspace }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- useWorkspace.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors — confirms the `setPath: string | null` widening doesn't break any other caller (every other call site passes a non-null `string`, which still satisfies the widened type).

- [ ] **Step 7: Commit**

```bash
git add src/store/workspace.ts src/hooks/useWorkspace.ts src/hooks/useWorkspace.test.ts
git commit -m "feat: add closeWorkspace to useWorkspace"
```

---

### Task 2: Wire Close Workspace into the File menu

**Files:**
- Modify: `src/components/Titlebar.tsx:26-41` (`FILE_MENU`)
- Modify: `src/components/Layout.tsx:133-256` (`runCommand`)

**Interfaces:**
- Consumes: `closeWorkspace()` from Task 1, `workspacePath` (already destructured in `Layout.tsx:65`).
- Produces: a `close-workspace` menu item id, handled the same way every other `runCommand` case is.

This task only adds a menu item + a switch case; Task 3 is what makes `FILE_MENU` a function, so do this one first against the still-static array to keep the diff small, then Task 3 converts it.

- [ ] **Step 1: Add the menu item**

In `src/components/Titlebar.tsx`, insert a new item and separator into `FILE_MENU` right after `'open-workspace'` (line 32):

```ts
  { id: 'open-workspace', label: 'Open Workspace…', accel: 'Ctrl+O' },
  { id: 'close-workspace', label: 'Close Workspace' },
  { separator: true },
```

(This replaces the single `{ separator: true }` that currently follows line 32 at line 33 — there is still exactly one separator between the "Open Workspace…" group and "Split Into Tasks", just after the new item instead of right after "Open Workspace…".)

- [ ] **Step 2: Add the `Titlebar` test for the new item**

Add to `src/components/Titlebar.test.tsx`, after the existing `'dispatches the command id when a File menu item is picked'` test:

```ts
  it('dispatches close-workspace when picked from the File menu', async () => {
    const user = userEvent.setup()
    const onCommand = vi.fn()
    render(<Titlebar title="null-notes" onCommand={onCommand} />)
    await user.click(screen.getByText('File'))
    await user.click(await screen.findByText('Close Workspace'))
    expect(onCommand).toHaveBeenCalledWith('close-workspace')
  })
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- Titlebar.test.tsx`
Expected: FAIL — "Close Workspace" not found (the label doesn't exist yet if Step 1 hasn't landed; if Step 1 already landed this instead confirms PASS, in which case skip to Step 5).

- [ ] **Step 4: Confirm Step 1 makes it pass**

Run: `npm test -- Titlebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire `runCommand`**

In `src/components/Layout.tsx`, add a case right after `case 'open-workspace':` (currently lines 154-156):

```ts
        case 'open-workspace':
          await openWorkspace()
          break
        case 'close-workspace':
          if (workspacePath) await closeWorkspace()
          break
```

`closeWorkspace` must come from `useWorkspace()` — check the top of `Layout.tsx` for the existing `useWorkspace()` destructure (it already pulls `openWorkspace`/`openWorkspaceAt`) and add `closeWorkspace` to it. Add `closeWorkspace` to the `runCommand` `useCallback`'s dependency array (currently ending at line 254, alongside `openWorkspace`).

- [ ] **Step 6: Typecheck and run the full frontend suite**

Run: `npm run typecheck && npm test`
Expected: no errors, all tests green.

- [ ] **Step 7: Commit**

```bash
git add src/components/Titlebar.tsx src/components/Titlebar.test.tsx src/components/Layout.tsx
git commit -m "feat: add Close Workspace to the File menu"
```

---

### Task 3: Recent Workspaces in the File menu

**Files:**
- Modify: `src/components/Titlebar.tsx` (`FILE_MENU` → `buildFileMenu`, new prop)
- Modify: `src/components/Titlebar.test.tsx`

**Interfaces:**
- Consumes: `folderName` from `src/lib/pathPrefix.ts:3` (already exported, already used elsewhere in the codebase for the same purpose).
- Produces: `buildFileMenu(recentWorkspaces: string[]): MenuItemSpec[]`; `TitlebarProps` gains `recentWorkspaces: string[]`. Task 4 passes this prop from `Layout.tsx`.

- [ ] **Step 1: Write the failing test**

Add to `src/components/Titlebar.test.tsx`:

```ts
  it('lists recent workspaces under Open Workspace, most-recent first', async () => {
    const user = userEvent.setup()
    render(
      <Titlebar
        title="null-notes"
        onCommand={vi.fn()}
        recentWorkspaces={['/ws/Lecture Notes', '/ws/CS 101']}
      />,
    )
    await user.click(screen.getByText('File'))
    expect(await screen.findByText('Lecture Notes')).toBeInTheDocument()
    expect(screen.getByText('CS 101')).toBeInTheDocument()
  })

  it('dispatches open-recent:<path> when a recent workspace is picked', async () => {
    const user = userEvent.setup()
    const onCommand = vi.fn()
    render(
      <Titlebar title="null-notes" onCommand={onCommand} recentWorkspaces={['/ws/Lecture Notes']} />,
    )
    await user.click(screen.getByText('File'))
    await user.click(await screen.findByText('Lecture Notes'))
    expect(onCommand).toHaveBeenCalledWith('open-recent:/ws/Lecture Notes')
  })
```

The two existing tests that render `<Titlebar>` without a `recentWorkspaces` prop (`'shows the given title'`, `'dispatches the command id...'`, `'wires the window controls...'`, and the Task 2 `'dispatches close-workspace...'` test) must keep working with an empty list — see Step 2's default.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- Titlebar.test.tsx`
Expected: FAIL — TypeScript will also complain that `recentWorkspaces` is missing on the other call sites once the prop is required, so make it optional (`recentWorkspaces?: string[]`, default `[]`) precisely so Step 1's new tests fail only on missing content, not on type errors from the other tests in this file.

- [ ] **Step 3: Implement `buildFileMenu` and the new prop**

In `src/components/Titlebar.tsx`, replace the static `FILE_MENU` array (lines 26-41) with a function:

```ts
function buildFileMenu(recentWorkspaces: string[]): MenuItemSpec[] {
  return [
    { id: 'new-note', label: 'New Note', accel: 'Ctrl+N' },
    { id: 'new-folder', label: 'New Folder', accel: 'Ctrl+Shift+N' },
    { id: 'new-canvas', label: 'New Canvas Note' },
    { id: 'new-from-template', label: 'New from Template…', accel: 'Ctrl+Shift+T' },
    { separator: true },
    { id: 'open-workspace', label: 'Open Workspace…', accel: 'Ctrl+O' },
    { id: 'close-workspace', label: 'Close Workspace' },
    ...recentWorkspaces.map((path) => ({ id: `open-recent:${path}`, label: folderName(path) })),
    { separator: true },
    { id: 'split-tasks', label: 'Split Into Tasks' },
    { id: 'generate-formula-sheet', label: 'Generate Formula Sheet…' },
    { separator: true },
    { id: 'export-pdf', label: 'Export to PDF…' },
    { id: 'print', label: 'Print…' },
    { separator: true },
    { id: 'settings', label: 'Settings…', accel: 'Ctrl+,' },
  ]
}
```

Add the import: `import { folderName } from '../lib/pathPrefix'` at the top of the file.

Update `TitlebarProps` (currently lines 60-63):

```ts
interface TitlebarProps {
  title: string
  onCommand: (id: string) => void
  recentWorkspaces?: string[]
}
```

Update the component signature and the `FILE_MENU` usage (lines 65 and 78):

```ts
export function Titlebar({ title, onCommand, recentWorkspaces = [] }: TitlebarProps) {
  ...
  <TitlebarMenu label="File" items={buildFileMenu(recentWorkspaces)} onCommand={onCommand} />
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- Titlebar.test.tsx`
Expected: PASS, all tests in the file green including the pre-existing ones.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/Titlebar.tsx src/components/Titlebar.test.tsx
git commit -m "feat: list recent workspaces in the File menu"
```

---

### Task 4: Wire Recent Workspaces and Close Workspace into Layout

**Files:**
- Modify: `src/components/Layout.tsx`

**Interfaces:**
- Consumes: `buildFileMenu`'s `recentWorkspaces` prop (Task 3), `useWorkspaceStore((s) => s.recentWorkspaces)` (already exists in the store), `openWorkspaceAt` (already destructured in `Layout.tsx`), `closeWorkspace` (Task 1/2).
- Produces: nothing new for later tasks — this is the last frontend task.

- [ ] **Step 1: Read `recentWorkspaces` from the store**

In `src/components/Layout.tsx`, near the existing `const workspacePath = useWorkspaceStore((s) => s.path)` (line 65), add:

```ts
  const recentWorkspaces = useWorkspaceStore((s) => s.recentWorkspaces)
```

- [ ] **Step 2: Pass it to `Titlebar`**

Update line 376:

```tsx
    <Titlebar title={windowTitle} onCommand={runCommand} recentWorkspaces={recentWorkspaces} />
```

- [ ] **Step 3: Handle `open-recent:` in `runCommand`**

Add a branch at the top of the `switch` in `runCommand` (before the `switch`, since this needs a prefix check rather than an exact match) — insert immediately after the `async (id: string) => {` line (134):

```ts
    async (id: string) => {
      if (id.startsWith('open-recent:')) {
        await openWorkspaceAt(id.slice('open-recent:'.length))
        return
      }
      switch (id) {
```

Add `recentWorkspaces` (not required — the id itself carries the path, no store read needed here) — no dependency-array change needed for this branch since `openWorkspaceAt` is already a dependency of `runCommand`.

- [ ] **Step 4: Manual smoke check**

Run: `npm run tauri dev`, open a workspace, confirm the title bar's File menu now shows "Close Workspace" and (once at least one workspace has been opened before) the recent-workspace entries below it; click one, confirm it reopens that workspace.

- [ ] **Step 5: Typecheck and full frontend suite**

Run: `npm run typecheck && npm test`
Expected: no errors, all tests green.

- [ ] **Step 6: Commit**

```bash
git add src/components/Layout.tsx
git commit -m "feat: wire recent-workspace and close-workspace menu commands"
```

---

### Task 5: Jump-list module (`jumplist.rs`)

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/commands/jumplist.rs`
- Modify: `src-tauri/src/commands/mod.rs`

**Interfaces:**
- Consumes: nothing from earlier tasks (Parts A-D are independent of Part C).
- Produces: `pub fn rebuild(recents: &[String]) -> windows::core::Result<()>` and `pub(crate) fn folder_name(path: &str) -> String`, both `#[cfg(windows)]`. Task 6 calls `rebuild` from `lib.rs`; Task 7 calls it from `workspace.rs`.

**Caveat carried into this task:** the spec lists three `windows` crate features (`Win32_UI_Shell`, `Win32_System_Com`, `Win32_UI_Shell_PropertiesSystem`). Building the title `PROPVARIANT` via `InitPropVariantFromString` additionally needs `Win32_System_Com_StructuredStorage` (that's where `PROPVARIANT`/`InitPropVariantFromString` live in this crate), and `IObjectArray`/`IObjectCollection` may need `Win32_UI_Shell_Common` if the compiler reports them unresolved under plain `Win32_UI_Shell` — Step 4 (`cargo build`) is where this gets settled for real; add whichever feature the compiler asks for.

- [ ] **Step 1: Add Cargo features**

In `src-tauri/Cargo.toml`, change line 44:

```toml
windows = { version = "0.61", features = ["Win32_Graphics_Printing"] }
```

to:

```toml
windows = { version = "0.61", features = [
    "Win32_Graphics_Printing",
    "Win32_UI_Shell",
    "Win32_UI_Shell_PropertiesSystem",
    "Win32_System_Com",
    "Win32_System_Com_StructuredStorage",
] }
```

- [ ] **Step 2: Write the failing unit test**

Create `src-tauri/src/commands/jumplist.rs` with just the test and the not-yet-implemented function, following the same `#[cfg(test)] mod tests` placement style already used in `commands/workspace.rs`:

```rust
#![cfg(windows)]

pub fn folder_name(path: &str) -> String {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_folder_name_takes_the_last_component() {
        assert_eq!(folder_name(r"C:\notes\Lecture 7"), "Lecture 7");
    }

    #[test]
    fn test_folder_name_falls_back_to_the_whole_path_for_a_drive_root() {
        assert_eq!(folder_name(r"C:\"), r"C:\");
    }
}
```

- [ ] **Step 3: Register the module**

In `src-tauri/src/commands/mod.rs`, add alongside the other `pub mod` lines (alphabetical, so between `ink` and `notes`):

```rust
pub mod jumplist;
```

- [ ] **Step 4: Run the test to verify it fails**

Run (from `src-tauri/`): `cargo test jumplist`
Expected: panic — `not yet implemented` (the `todo!()`).

- [ ] **Step 5: Implement `folder_name` and `rebuild`**

Replace the `todo!()` placeholder and add `rebuild`, matching the same last-path-component logic as the frontend's `folderName` in `src/lib/pathPrefix.ts:3-5`:

```rust
#![cfg(windows)]

use windows::core::{Interface, Result, HSTRING};
use windows::Win32::Foundation::E_FAIL;
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
use windows::Win32::System::Com::StructuredStorage::InitPropVariantFromString;
use windows::Win32::UI::Shell::{
    DestinationList, EnumerableObjectCollection, ICustomDestinationList, IObjectArray,
    IObjectCollection, IShellLinkW, ShellLink,
};
use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, PKEY_Title};

pub fn folder_name(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

/// Rebuilds the taskbar icon's "Recent Workspaces" jump-list category from
/// `recents` (already most-recent-first, already capped by the caller).
/// Every step past `BeginList` is fallible; on any `Err` this returns early
/// without calling `CommitList`, so a partial failure leaves the previous
/// jump list in place rather than a half-built one.
pub fn rebuild(recents: &[String]) -> Result<()> {
    let exe = std::env::current_exe().map_err(|_| windows::core::Error::from(E_FAIL))?;
    let exe = HSTRING::from(exe.as_os_str());

    unsafe {
        let list: ICustomDestinationList =
            CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER)?;
        let mut max_slots: u32 = 0;
        let _removed: IObjectArray = list.BeginList(&mut max_slots)?;

        let collection: IObjectCollection =
            CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;

        for path in recents {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            link.SetPath(&exe)?;
            link.SetArguments(&HSTRING::from(format!("--workspace=\"{path}\"")))?;
            link.SetIconLocation(&exe, 0)?;

            let store: IPropertyStore = link.cast()?;
            let title = InitPropVariantFromString(&HSTRING::from(folder_name(path)))?;
            store.SetValue(&PKEY_Title, &title)?;
            store.Commit()?;

            collection.AddObject(&link)?;
        }

        let object_array: IObjectArray = collection.cast()?;
        list.AppendCategory(&HSTRING::from("Recent Workspaces"), &object_array)?;
        list.CommitList()?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_folder_name_takes_the_last_component() {
        assert_eq!(folder_name(r"C:\notes\Lecture 7"), "Lecture 7");
    }

    #[test]
    fn test_folder_name_falls_back_to_the_whole_path_for_a_drive_root() {
        assert_eq!(folder_name(r"C:\"), r"C:\");
    }
}
```

- [ ] **Step 6: Build and fix whatever the compiler reports**

Run (from `src-tauri/`): `cargo build`
Expected: this is where the Task's Caveat gets resolved — if `IObjectArray`/`IObjectCollection` are unresolved, add `Win32_UI_Shell_Common` to the Cargo.toml feature list from Step 1 and rebuild; repeat until it compiles clean. Do not change the logic in Step 5 to work around a compile error — only add features, since the shape of the calls already matches the spec's COM call sequence.

- [ ] **Step 7: Run the test to verify it passes**

Run: `cargo test jumplist`
Expected: PASS (both `folder_name` tests — `rebuild` itself is exercised only by the manual QA in Task 7).

- [ ] **Step 8: Lint and format**

Run: `cargo clippy -- -D warnings && cargo fmt --check`
Expected: clean. Run `cargo fmt` first if the check fails on formatting.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/commands/jumplist.rs src-tauri/src/commands/mod.rs
git commit -m "feat: add Windows jump-list rebuild module"
```

---

### Task 6: Set the AppUserModelID at startup

**Files:**
- Modify: `src-tauri/src/lib.rs:14-18`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by other tasks — this only needs to run once, before the taskbar icon exists, so jump lists attach to the right icon.

- [ ] **Step 1: Add the AUMID call**

In `src-tauri/src/lib.rs`, insert before `tauri::Builder::default()` is constructed (i.e. between the `initial_workspace` computation on line 16-17 and line 19):

```rust
    #[cfg(windows)]
    unsafe {
        let _ = windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(
            windows::core::w!("dev.nullnotes.app"),
        );
    }

    tauri::Builder::default()
```

This needs the `Win32_UI_Shell` feature already added in Task 5, Step 1 — no further Cargo.toml change here.

- [ ] **Step 2: Build**

Run (from `src-tauri/`): `cargo build`
Expected: clean build.

- [ ] **Step 3: Lint and format**

Run: `cargo clippy -- -D warnings && cargo fmt --check`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: set AppUserModelID for taskbar jump-list attachment"
```

---

### Task 7: Wire jump-list rebuilds into startup and `remember_workspace`

**Files:**
- Modify: `src-tauri/src/commands/workspace.rs:36, 84-87` (`present_recents` visibility, `remember_workspace`)
- Modify: `src-tauri/src/lib.rs:30-73` (`.setup()`)

**Interfaces:**
- Consumes: `jumplist::rebuild` (Task 5), `commands::workspace::present_recents` (existing, widened to `pub(crate)`).
- Produces: nothing further downstream — this is the last task.

- [ ] **Step 1: Widen `present_recents`'s visibility**

In `src-tauri/src/commands/workspace.rs`, change line 36:

```rust
async fn present_recents(dir: &Path) -> anyhow::Result<Vec<String>> {
```

to:

```rust
pub(crate) async fn present_recents(dir: &Path) -> anyhow::Result<Vec<String>> {
```

- [ ] **Step 2: Call `rebuild` from `remember_workspace`**

In the same file, update `remember_workspace` (lines 83-87):

```rust
#[tauri::command]
pub async fn remember_workspace(app: AppHandle, path: String) -> Result<Vec<String>, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let recents = push_recent(&dir, &path).await.map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let _ = crate::commands::jumplist::rebuild(&recents);
    Ok(recents)
}
```

- [ ] **Step 3: Call `rebuild` once at startup**

In `src-tauri/src/lib.rs`, inside `.setup()`, after `let data_dir = app.path().app_data_dir()?;` (line 31):

```rust
        .setup(move |app| {
            let data_dir = app.path().app_data_dir()?;
            #[cfg(windows)]
            {
                let recents = tauri::async_runtime::block_on(
                    commands::workspace::present_recents(&data_dir),
                )
                .unwrap_or_default();
                let _ = commands::jumplist::rebuild(&recents);
            }
            let _ = ERROR_LOG_DIR.set(data_dir.clone());
```

This matches the existing `tauri::async_runtime::block_on(db::init_db(&data_dir))` pattern two lines below it, and the `unwrap_or_default()` matches the best-effort posture — a missing/corrupt recents file yields an empty jump list rather than blocking startup.

- [ ] **Step 4: Build**

Run (from `src-tauri/`): `cargo build`
Expected: clean build.

- [ ] **Step 5: Run the full Rust test suite**

Run: `cargo test`
Expected: PASS, including the existing `present_recents` tests in `workspace.rs` (visibility change doesn't affect their behavior) and the two `folder_name` tests from Task 5.

- [ ] **Step 6: Lint and format**

Run: `cargo clippy -- -D warnings && cargo fmt --check`
Expected: clean.

- [ ] **Step 7: Manual QA (the only real verification for the COM calls)**

Run: `npm run tauri build`, then run or pin the built `null-notes.exe`. Right-click its taskbar icon and confirm:
- A "Recent Workspaces" category appears, listing the same folders `recentWorkspaces` shows in the File menu, most-recent first.
- Clicking an entry launches a new window already open on that workspace.
- The list is already correct the first time you right-click after a fresh launch (not just after switching workspaces once in that session).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/commands/workspace.rs src-tauri/src/lib.rs
git commit -m "feat: rebuild the jump list on startup and on every recents write"
```

---

## Self-Review

**Spec coverage:**
- Part A (`closeWorkspace`, `setPath` widening, File-menu wiring) → Tasks 1-2.
- Part B (`buildFileMenu`, recent-workspace items, `open-recent:` handling) → Tasks 3-4.
- Part C.1 (AUMID) → Task 6.
- Part C.2 (`jumplist::rebuild`, `folder_name`) → Task 5.
- Part C.3 (startup + `remember_workspace` wiring, `#[cfg(windows)]` at both call sites) → Task 7.
- Part C.4 (opening from the jump list) → no task: spec is explicit this needs no new code, since `initial_workspace_from_args`/`initial_workspace`/`Layout.tsx`'s mount effect already handle it.
- Error Handling (best-effort, silent swallow) → built into Task 5's `rebuild` (early-return on `Err`) and Task 7's `let _ =` call sites.
- Testing section → `closeWorkspace` unit test (Task 1), `Titlebar` tests (Tasks 2-3), `folder_name` unit test (Task 5), manual QA for both A/B (Task 4, Step 4) and C (Task 7, Step 7).
- File Structure table → every row maps to a task above; `present_recents` visibility (not in the spec's table, since it's an implementation detail needed to satisfy the table's own `lib.rs` row) is called out explicitly in Task 7.

**Placeholder scan:** the only `todo!()` is Task 5 Step 2's intentional pre-test-failure stub, replaced in Step 5 of the same task — not a leftover.

**Type consistency:** `closeWorkspace(): Promise<void>` (Task 1) is the exact name/signature used in Task 2's `runCommand` case and Task 2's dependency array. `buildFileMenu(recentWorkspaces: string[])` (Task 3) matches the `recentWorkspaces` prop type and the `useWorkspaceStore((s) => s.recentWorkspaces)` read in Task 4. `jumplist::rebuild(recents: &[String]) -> windows::core::Result<()>` (Task 5) matches both call sites in Task 7.
