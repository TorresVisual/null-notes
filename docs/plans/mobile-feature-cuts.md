# Mobile Feature-Cut UI Gating Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Hide the three desktop affordances iOS structurally cannot support — the code-block Run button/output panel, the "Open in IDE" button, and the terminal toggle — behind `isMobile()` checks, so a mobile build shows read-only content instead of a dead or silently-failing control.

**Architecture:** Every cut is a widget-decoration or render gate at the exact spot the affordance is already built, mirroring the pattern `Sidebar.tsx`/`Titlebar.tsx`/`WorkspacePicker.tsx` already established with `isMobile()` from `src/lib/platform.ts` — no new mechanism, per the spec's own framing ("gets a second condition, not a new mechanism"). `CodeBlockRun.ts`'s and `CodeBlockOpenInIde.ts`'s ProseMirror plugins each gate their `decorate()` function's output; `Sidebar.tsx` and `Titlebar.tsx`'s `VIEW_MENU` hide the terminal's two discoverable entry points; `Layout.tsx`'s `toggle-terminal` command handler adds `mobile` to its existing `workspacePath` guard so a physical Bluetooth keyboard's `Ctrl+\`` can't reach a component (`TerminalPane`) that would otherwise spawn a shell iOS has none of and hang on "Starting shell…" forever — the exact "shown-and-failing" state the spec rules out. No Rust changes: `code_run.rs`, `editor_launch.rs`, and `terminal.rs` already compile clean for the `aarch64-apple-ios-sim` target (confirmed by `ios-scaffold.yml`'s existing `cargo check` step) — they just must never be *called* from an iOS build, which is a frontend-only concern.

**Tech Stack:** No new dependencies — `src/lib/platform.ts`'s existing `isMobile()`, the same ProseMirror decoration/Zustand/Vitest stack every other extension in `src/editor/extensions/` already uses.

**Spec:** `docs/specs/mobile-app-design.md` (Feature cuts section: "Run button on code blocks... hidden, not shown-and-failing"; "'Open in IDE'... hidden"; "The P8 terminal... hidden on iOS"; "Both UI cuts are a `Platform.isMobile`... check at the toolbar level... gets a second condition, not a new mechanism") and its DoD ("A code block on iOS shows its content and any pinned output, with no Run button and no crash/error state").

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

- **No behavior change to desktop.** Every gate added below checks `isMobile()` (or the `mobile` variable already computed from it) first; on desktop every plugin/component must render byte-identical to today. Each task's test file gets an explicit "unaffected on desktop" case alongside its "hidden on iOS" case.
- **Pinned output stays visible on mobile.** A pinned code-run output is a plain `codeBlock` with `language: ''` (`CodeBlockRun.ts`'s `formatRunOutput`/pin handler) — it never matches `RUNNABLE_LANGUAGES`, so it already renders as ordinary read-only code content regardless of platform. Nothing in this plan touches that path; it's called out here only so no task "fixes" it under the mistaken belief it needs a mobile-specific change.
- **Hidden, not shown-and-failing**, per the spec's own framing for all three cuts — the bar is that tapping/clicking where the affordance used to be does nothing observable, not that it silently no-ops after showing a spinner or partial UI forever.
- **No Rust changes.** `code_run.rs`, `editor_launch.rs`, and `terminal.rs` are untouched — the cut is entirely about never invoking their Tauri commands from a mobile build, not about making them iOS-aware.
- `npm run typecheck` and `npm test` must stay clean before every commit.

---

### Task 1: Hide the Run button and output panel on mobile

**Files:**
- Modify: `src/editor/extensions/CodeBlockRun.ts`
- Test: `src/editor/extensions/codeBlockRun.test.ts`

**Interfaces:**
- Consumes: `isMobile()` from `src/lib/platform.ts` (`export function isMobile(): boolean`, already reads `platform()` from `@tauri-apps/plugin-os`).
- Produces: no new exports — `decorate()` (module-private) now returns `DecorationSet.empty` on mobile before doing any work, so nothing downstream changes shape.

- [ ] **Step 1: Write the failing tests**

Add to `src/editor/extensions/codeBlockRun.test.ts`, alongside the existing `describe('CodeBlockRun panel visibility', ...)` block. First add the platform mock and import near the top of the file (this file currently has no `@tauri-apps/plugin-os` mock):

```ts
import { platform } from '@tauri-apps/plugin-os'

vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn() }))
```

Then add a new describe block after the existing one:

```ts
describe('CodeBlockRun on mobile', () => {
  it('hides the entire run panel on iOS even for a runnable language', () => {
    vi.mocked(platform).mockReturnValue('ios')
    mount(codeBlock('python'))
    expect(editor?.view.dom.querySelector('.code-run-run')).toBeNull()
    expect(editor?.view.dom.querySelector('.code-run-panel')).toBeNull()
  })

  it('still shows the run panel on desktop', () => {
    vi.mocked(platform).mockReturnValue('windows')
    mount(codeBlock('python'))
    expect(editor?.view.dom.querySelector('.code-run-run')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify the first one fails**

Run: `npm test -- codeBlockRun`
Expected: the new "hides the entire run panel on iOS" test FAILs (`.code-run-run` is found); the "still shows... on desktop" test passes already.

- [ ] **Step 3: Gate `decorate()` on `isMobile()`**

In `src/editor/extensions/CodeBlockRun.ts`, add the import alongside the existing ones near the top of the file:

```ts
import { isMobile } from '../../lib/platform'
```

Then change the `decorate` function (currently starting `function decorate(state: EditorState): DecorationSet {`) to bail out immediately on mobile, before the `state.doc.descendants` walk:

```ts
function decorate(state: EditorState): DecorationSet {
  if (isMobile()) return DecorationSet.empty

  const decorations: Decoration[] = []
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true
    const language = String(node.attrs['language'] ?? '')
    if (!RUNNABLE_LANGUAGES.has(language)) return false

    decorations.push(
      Decoration.widget(pos + node.nodeSize, () => runPanel(pos), {
        key: `code-run-${pos}`,
        side: 1,
        ignoreSelection: true,
        stopEvent: () => true,
      }),
    )
    return false
  })
  return DecorationSet.create(state.doc, decorations)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- codeBlockRun`
Expected: PASS, both new tests and the full existing file.

- [ ] **Step 5: Commit**

```bash
git add src/editor/extensions/CodeBlockRun.ts src/editor/extensions/codeBlockRun.test.ts
git commit -m "fix(mobile): hide the code-run panel on iOS"
```

---

### Task 2: Hide "Open in IDE" (and its backlinks badge) on mobile

**Files:**
- Modify: `src/editor/extensions/CodeBlockOpenInIde.ts`
- Test: `src/editor/extensions/codeBlockOpenInIde.test.ts`

**Interfaces:**
- Consumes: `isMobile()` from `src/lib/platform.ts`.
- Produces: no new exports — `decorate()` (module-private) returns `DecorationSet.empty` on mobile.

**Scope note:** the "N notes" backlinks badge (issue #37) is built into the *same* widget group as the "Open in IDE" button (`buildBacklinksBadge` is only ever appended inside the group `decorate()` builds after a link resolves — see `CodeBlockOpenInIde.ts`'s existing `decorate()`). The spec names only "Open in IDE" as a structural cut, but splitting the badge out into its own decoration so it could survive independently is new scope this plan doesn't need — the badge only ever appears next to a link that itself requires "no external editor to open" reasoning to justify hiding, and there's no separate spec requirement asking for it to persist on mobile. One gate covers both.

- [ ] **Step 1: Write the failing test**

Find the existing test setup in `src/editor/extensions/codeBlockOpenInIde.test.ts` — it mocks `../../lib/tauri` and mounts a real editor via `coreExtensions`/`mount()`. Add near the top, alongside the existing `vi.mock('../../lib/tauri', ...)`:

```ts
import { platform } from '@tauri-apps/plugin-os'

vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn() }))
```

Find the existing test that confirms the button appears once a link resolves (it calls `resolveCodeLinks.mockResolvedValue([...])`, mounts a code block whose first line is a recognized path, awaits `settle()`, then asserts via the file's `buttons(editor)` helper). Add a new test right after it:

```ts
it('never shows the Open-in-IDE button on iOS, even once the link resolves', async () => {
  vi.mocked(platform).mockReturnValue('ios')
  resolveCodeLinks.mockResolvedValue(['src/main.rs'])
  mount(codeBlock('// src/main.rs'))
  await settle()

  expect(buttons(editor!)).toHaveLength(0)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- codeBlockOpenInIde`
Expected: the new test FAILs (`buttons(editor!)` returns length 1, not 0).

- [ ] **Step 3: Gate `decorate()` on `isMobile()`**

In `src/editor/extensions/CodeBlockOpenInIde.ts`, add the import alongside the existing ones:

```ts
import { isMobile } from '../../lib/platform'
```

Change the top of the existing `decorate` function:

```ts
function decorate(state: EditorState, workspace: string | null, notePath: string): DecorationSet {
  if (!workspace || isMobile()) return DecorationSet.empty

  const decorations: Decoration[] = []
  // ...unchanged below
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- codeBlockOpenInIde`
Expected: PASS, both the new test and the full existing file.

- [ ] **Step 5: Commit**

```bash
git add src/editor/extensions/CodeBlockOpenInIde.ts src/editor/extensions/codeBlockOpenInIde.test.ts
git commit -m "fix(mobile): hide Open-in-IDE and its backlinks badge on iOS"
```

---

### Task 3: Hide the terminal toggle's two entry points on mobile

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/Titlebar.tsx`
- Test: `src/components/Sidebar.test.tsx`
- Test: `src/components/Titlebar.test.tsx`

**Interfaces:**
- Consumes: `isMobile()` (already imported and bound to a local `mobile` const in both files — `Sidebar.tsx:70`, `Titlebar.tsx:86`).
- Produces: `buildViewMenu(mobile: boolean): MenuItemSpec[]` replaces the current standalone `VIEW_MENU` const — Task 4 doesn't consume this, but note the rename so no other file is left importing the old `VIEW_MENU` name (grep confirms `VIEW_MENU` is only referenced within `Titlebar.tsx` itself).

- [ ] **Step 1: Write the failing tests**

In `src/components/Sidebar.test.tsx`, add a new test inside the existing `describe('Sidebar drawer on mobile', ...)` block (it already imports and mocks `platform`):

```ts
it('hides the terminal toolbar button on iOS', () => {
  vi.mocked(platform).mockReturnValue('ios')
  renderSidebar()
  expect(screen.queryByLabelText('Terminal')).not.toBeInTheDocument()
})

it('still shows the terminal toolbar button on desktop', () => {
  vi.mocked(platform).mockReturnValue('windows')
  renderSidebar()
  expect(screen.getByLabelText('Terminal')).toBeInTheDocument()
})
```

In `src/components/Titlebar.test.tsx`, add a new test inside the existing `describe('Titlebar on mobile', ...)` block (it already imports and mocks `platform`):

```ts
it('omits Toggle Terminal from the View menu on iOS', async () => {
  const user = userEvent.setup()
  vi.mocked(platform).mockReturnValue('ios')
  render(<Titlebar title="test" onCommand={vi.fn()} />)

  await user.click(screen.getByText('View'))
  expect(screen.queryByText('Toggle Terminal')).not.toBeInTheDocument()
})
```

And one more inside the existing (desktop-focused) `describe('Titlebar', ...)` block, to lock in the unaffected case:

```ts
it('keeps Toggle Terminal in the View menu on desktop', async () => {
  const user = userEvent.setup()
  render(<Titlebar title="null-notes" onCommand={vi.fn()} />)
  await user.click(screen.getByText('View'))
  expect(await screen.findByText('Toggle Terminal')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the tests to verify the new iOS-hiding ones fail**

Run: `npm test -- Sidebar.test Titlebar.test`
Expected: `hides the terminal toolbar button on iOS` and `omits Toggle Terminal from the View menu on iOS` FAIL; the other two new tests already pass.

- [ ] **Step 3: Hide the Sidebar terminal button on mobile**

In `src/components/Sidebar.tsx`, wrap the existing terminal `Tooltip` block (currently lines 203–215) in the `mobile` check already computed at line 70:

```tsx
{!mobile && (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        className="toolbar-button"
        onClick={() => { onTerminalToggle(); closeIfMobile() }}
        disabled={!workspacePath}
        aria-label="Terminal"
      >
        <SquareTerminal size={14} />
      </button>
    </TooltipTrigger>
    <TooltipContent>Terminal <kbd>Ctrl `</kbd></TooltipContent>
  </Tooltip>
)}
```

- [ ] **Step 4: Turn `VIEW_MENU` into a function that filters the terminal entry on mobile**

In `src/components/Titlebar.tsx`, replace the existing `const VIEW_MENU: MenuItemSpec[] = [...]` declaration with a function:

```ts
function buildViewMenu(mobile: boolean): MenuItemSpec[] {
  const items: MenuItemSpec[] = [
    { id: 'home', label: 'Home', accel: 'Ctrl+H' },
    { separator: true },
    { id: 'search', label: 'Search', accel: 'Ctrl+K' },
    { id: 'quick-switch', label: 'Quick Switcher', accel: 'Ctrl+P' },
    { id: 'toggle-view', label: 'Toggle Source/Preview', accel: 'Ctrl+E' },
    { id: 'insert-ink', label: 'Insert Ink Block', accel: 'Ctrl+Shift+I' },
    { id: 'graph-view', label: 'Connections Graph', accel: 'Ctrl+G' },
    { id: 'toggle-terminal', label: 'Toggle Terminal', accel: 'Ctrl+`' },
    { id: 'toggle-outline', label: 'Toggle Outline', accel: 'Ctrl+Shift+O' },
    { id: 'task-view', label: 'Tasks', accel: 'Ctrl+Shift+K' },
    { id: 'review', label: 'Review', accel: 'Ctrl+Shift+R' },
    { id: 'deck-view', label: 'Browse All Cards', accel: 'Ctrl+Shift+D' },
    { separator: true },
    { id: 'shortcuts-help', label: 'Keyboard Shortcuts' },
  ]
  return mobile ? items.filter((item) => !('id' in item && item.id === 'toggle-terminal')) : items
}
```

Then update the render call (currently `<TitlebarMenu label="View" items={VIEW_MENU} onCommand={onCommand} />`, right after the existing `mobile` const at line 86):

```tsx
<TitlebarMenu label="View" items={buildViewMenu(mobile)} onCommand={onCommand} />
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- Sidebar.test Titlebar.test`
Expected: PASS, all four new tests plus the full existing suites for both files.

- [ ] **Step 6: Commit**

```bash
git add src/components/Sidebar.tsx src/components/Titlebar.tsx src/components/Sidebar.test.tsx src/components/Titlebar.test.tsx
git commit -m "fix(mobile): hide the terminal toggle's entry points on iOS"
```

---

### Task 4: Guard the terminal command itself against a stray keyboard shortcut

**Files:**
- Modify: `src/components/Layout.tsx`
- Test: `src/components/Layout.test.tsx`

**Interfaces:**
- Consumes: `isMobile()` (already imported and bound to a local `mobile` const at `Layout.tsx:77`); `useTerminal` from `src/hooks/useTerminal.ts` (mocked in this task's test, not modified).
- Produces: nothing new — this closes the one remaining path (a physical/Bluetooth keyboard's `Ctrl+\``, which Task 3 doesn't touch since it doesn't go through the Sidebar button or View menu) that could still mount `TerminalPane` on mobile.

**Why this is needed on top of Task 3:** Task 3 removes the two *visible* entry points, but `Ctrl+\`` is wired as a raw `window` keydown listener (`Layout.tsx`'s `KEY_COMMANDS` map, `` '`': 'toggle-terminal' ``) that dispatches straight into the `case 'toggle-terminal':` branch regardless of whether any button for it is rendered. Left unguarded, that branch would mount `TerminalPane`, which calls `useTerminal` → `api.terminal.open(...)` → `terminal_open` (portable-pty spawning a shell) — a call iOS has no shell to satisfy, and per `useTerminal.ts`'s own `.then()` chain (no `.catch()`), a rejection there leaves `isReady` false forever, i.e. a permanently stuck "Starting shell…" panel. That's exactly the "shown-and-failing" state the spec's Feature-cuts section rules out for this cut specifically ("Hidden, not shown-and-failing").

- [ ] **Step 1: Write the failing test**

`TerminalPane` mounts real `@xterm/xterm`, which needs a canvas renderer jsdom doesn't provide (confirmed by `src/hooks/useTerminal.test.ts`, which mocks `@xterm/xterm` itself for exactly this reason). Rather than duplicate that mock here, stub the hook one level up so `TerminalPane` never touches xterm at all. Add to `src/components/Layout.test.tsx`, alongside the file's existing `vi.mock('../hooks/...')` calls:

```ts
vi.mock('../hooks/useTerminal', () => ({
  useTerminal: () => ({ insertText: vi.fn(), kill: vi.fn(), isReady: true }),
}))
```

And add the `platform` import at the top of the file (it's currently only mocked, not imported, in this file):

```ts
import { platform } from '@tauri-apps/plugin-os'
```

Then add a new describe block, after the existing `describe('Layout overlay exclusivity', ...)`:

```ts
describe('Layout terminal command on mobile', () => {
  it('does not mount the terminal pane on iOS even via the toggle-terminal command', () => {
    vi.mocked(platform).mockReturnValue('ios')
    useWorkspaceStore.setState({ path: '/ws', activeTab: null, tagFilter: null })
    render(<Layout />)

    act(() => runCommand('toggle-terminal'))

    expect(document.querySelector('.terminal-pane')).not.toBeInTheDocument()
  })

  it('still mounts the terminal pane on desktop', () => {
    vi.mocked(platform).mockReturnValue('windows')
    useWorkspaceStore.setState({ path: '/ws', activeTab: null, tagFilter: null })
    render(<Layout />)

    act(() => runCommand('toggle-terminal'))

    expect(document.querySelector('.terminal-pane')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify the first one fails**

Run: `npm test -- Layout.test`
Expected: `does not mount the terminal pane on iOS...` FAILs (`.terminal-pane` is found); `still mounts... on desktop` already passes.

- [ ] **Step 3: Add the `mobile` guard to the `toggle-terminal` command and its Sidebar prop**

In `src/components/Layout.tsx`, update the switch-case (currently at the lines matching `case 'toggle-terminal':`):

```tsx
case 'toggle-terminal':
  if (!workspacePath || mobile) break
  setTerminalMounted(true)
  setTerminalOpen((o) => !o)
  break
```

And the `onTerminalToggle` prop passed to `<Sidebar>` (the inline handler that duplicates the same mount logic for the now-hidden toolbar button — guarded too, so the two call sites can't drift):

```tsx
onTerminalToggle={() => {
  if (mobile) return
  setTerminalMounted(true)
  setTerminalOpen((o) => !o)
}}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- Layout.test`
Expected: PASS, both new tests plus the full existing suite.

- [ ] **Step 5: Run the full frontend suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/Layout.tsx src/components/Layout.test.tsx
git commit -m "fix(mobile): stop the toggle-terminal command from mounting a shell on iOS"
```

---

### Task 5: Record completion in the spec

**Files:**
- Modify: `docs/specs/mobile-app-design.md`

**Interfaces:** None — this task only records that the DoD item is met; it does not run new code.

- [ ] **Step 1: Update the DoD line**

In `docs/specs/mobile-app-design.md`'s Testing section, the DoD bullet currently reads:

> A code block on iOS shows its content and any pinned output, with no Run button and no crash/error state.

Leave that line as-is (it already states the requirement correctly) and add one dated sentence directly after the DoD list, matching the style of the pdfium spike's "Resolved 2026-09-14" note in the Engineering risk section:

```markdown
**Resolved 2026-09-15 — feature-cut UI gating done.** `docs/plans/mobile-feature-cuts.md` hid all three structural cuts (Run/output panel, Open in IDE, terminal) behind `isMobile()` at the exact widget/render points named above — no Rust changes, since `code_run.rs`/`editor_launch.rs`/`terminal.rs` already compiled clean for the iOS target; the gap was frontend-only. The terminal cut additionally guards the `toggle-terminal` command handler itself, not just its two toolbar/menu entry points, since a physical keyboard's `Ctrl+\`` bypasses both.
```

- [ ] **Step 2: Commit**

```bash
git add docs/specs/mobile-app-design.md
git commit -m "docs(mobile): record the feature-cut UI gating as done"
```

---

## Out of scope (this plan)

- **The Keyboard Shortcuts overlay still lists `Ctrl+\`` for Toggle Terminal on mobile.** It's an inert, informational list — nothing crashes or hangs from seeing an accelerator that no longer does anything if triggered on a device without a physical keyboard. Revisit only if user testing shows this is actually confusing.
- **A mobile-specific empty/disabled state explaining *why* Run/Open-in-IDE/terminal are missing.** The spec's own bar is "the affordance simply isn't there," not an explanation of the cut — matching how the rest of this codebase handles platform gaps (e.g., desktop's own feature gates never explain absent menu items either).
- **Android.** Same footnote as every prior mobile plan — nothing here is written as an iOS/Android abstraction.
- **The physical-device and rendering-path portions of the PDF-import mobile plan.** Unrelated to this plan's three cuts; tracked separately per `docs/plans/mobile-pdfium-ios-spike.md`'s own "Out of scope" section.
