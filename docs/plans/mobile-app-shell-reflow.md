# Mobile App-Shell Reflow Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Make the app shell usable on an iOS phone screen — the sidebar becomes a drawer instead of a permanent 240px column, the window-chrome buttons that mean nothing without a window disappear, hover-only affordances get a tap-visible equivalent, and touch targets meet Apple's 44×44pt minimum — without changing anything about desktop's existing layout or behavior.

**Architecture:** Every behavioral fork (does the sidebar render as a drawer, do window-chrome buttons render at all) gates on `isMobile()` from `src/lib/platform.ts`, the same mechanism `WorkspacePicker.tsx` already established for the credentials-onboarding work — not a CSS viewport-width breakpoint, which would also collapse the sidebar on a narrow *desktop* window and change behavior this plan isn't scoped to touch. Pure visual sizing (touch target dimensions, hover-reveal fallback) instead gates on the CSS `(hover: none)` media feature, the standard way to detect "no precision pointing device" — a native platform check, not a second JS branch duplicating what `isMobile()` already answers for behavior. Drawer open/closed state lives in a new dedicated Zustand store (`src/store/mobileSidebar.ts`), mirroring the existing `src/store/focusMode.ts` shape exactly, because closing the drawer needs to be reachable from `Sidebar.tsx` without prop-drilling through `Layout.tsx`.

**Tech Stack:** No new dependencies — CSS media features (`hover`, `env(safe-area-inset-*)`) and the existing `isMobile()`/Zustand/Vitest stack.

**Spec:** `docs/specs/mobile-app-design.md` (UI section: "sidebar becomes a drawer/sheet, the command palette and dialogs need touch-appropriate sizing, hover-only affordances... need a tap-visible equivalent... scoped to the app shell only"); named as the direct follow-up in `docs/plans/mobile-credentials-onboarding.md` Task 5's result note ("the next mobile plan (app-shell reflow)").

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

- **No behavior change to desktop.** Every drawer/window-chrome fork checks `isMobile()` first; on desktop it must render byte-identical to today. `npm test` covers this per-task via an explicit "desktop unaffected" case in each modified component's test file.
- **Scoped to the app shell only**, per CLAUDE.md's styling section: `Sidebar`, `Titlebar`, dialogs/overlays, the command palette (`SearchModal`/`QuickSwitcher`), folder context menu. The TipTap editor surface and ink canvas are explicitly out of scope — they already consume pointer events generically per the spec's UI section.
- **No Mac exists locally.** This plan touches only TypeScript/React/CSS — nothing here needs an iOS compile. Visual verification (Task 5) uses the `ui-preview` skill against the Vite dev server, the same technique `mobile-credentials-onboarding.md` Task 4 Step 6 used, not a Simulator build. If a future plan wants this confirmed live on-device, that's a separate CI Simulator smoke-test addition (`.github/workflows/ios-scaffold.yml`), out of scope here.
- **A className with no matching rule in `index.css` renders as unstyled text** — this project's own recorded lesson (CLAUDE.md styling section). Every new class introduced below is grep-checked against `index.css` before a task is considered done.
- `npm run typecheck` and `npm test` must stay clean before every commit.

---

### Task 1: Mobile sidebar drawer store

**Files:**
- Create: `src/store/mobileSidebar.ts`
- Test: `src/store/mobileSidebar.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `export const useMobileSidebarStore: UseBoundStore<StoreApi<{ open: boolean; toggle: () => void; close: () => void }>>` — Task 2's `Titlebar.tsx` calls `toggle()`, Task 3's `Sidebar.tsx`/`Layout.tsx` call `open`/`close()`. No standalone `open()` action — nothing in this plan needs to force the drawer open other than the toggle, so one isn't added speculatively.

- [x] **Step 1: Write the failing test**

```ts
// src/store/mobileSidebar.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useMobileSidebarStore } from './mobileSidebar'

describe('useMobileSidebarStore', () => {
  beforeEach(() => {
    useMobileSidebarStore.setState({ open: false })
  })

  it('starts closed', () => {
    expect(useMobileSidebarStore.getState().open).toBe(false)
  })

  it('toggle flips open state', () => {
    useMobileSidebarStore.getState().toggle()
    expect(useMobileSidebarStore.getState().open).toBe(true)
    useMobileSidebarStore.getState().toggle()
    expect(useMobileSidebarStore.getState().open).toBe(false)
  })

  it('close sets open false', () => {
    useMobileSidebarStore.setState({ open: true })
    useMobileSidebarStore.getState().close()
    expect(useMobileSidebarStore.getState().open).toBe(false)
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- src/store/mobileSidebar.test.ts`
Expected: FAIL — `Failed to resolve import "./mobileSidebar"`.

- [x] **Step 3: Write the store**

```ts
// src/store/mobileSidebar.ts
import { create } from 'zustand'

interface MobileSidebarStore {
  open: boolean
  toggle: () => void
  close: () => void
}

/**
 * Session-only drawer-open state for the mobile sidebar (isMobile() gated —
 * see Sidebar.tsx/Titlebar.tsx). A dedicated store, mirroring focusMode.ts,
 * because Sidebar.tsx needs to close itself from deep inside a nav-action
 * handler without Layout.tsx threading the state down as a prop.
 */
export const useMobileSidebarStore = create<MobileSidebarStore>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
}))
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -- src/store/mobileSidebar.test.ts`
Expected: PASS, 3 tests.

- [x] **Step 5: Commit**

```bash
git add src/store/mobileSidebar.ts src/store/mobileSidebar.test.ts
git commit -m "feat(mobile): add a session-only store for mobile sidebar drawer state"
```

---

### Task 2: Titlebar — hamburger toggle on mobile, hide window-chrome buttons

**Files:**
- Modify: `src/components/Titlebar.tsx`
- Modify: `src/index.css`
- Test: `src/components/Titlebar.test.tsx` (existing file — add to it)

**Interfaces:**
- Consumes: `isMobile` (`src/lib/platform.ts`, already exists), `useMobileSidebarStore` (Task 1).
- Produces: nothing further downstream — Task 3 reads the same store independently in `Sidebar.tsx`.

- [x] **Step 1: Write the failing tests**

Read `src/components/Titlebar.test.tsx` first to match its existing render/mock setup, then add:

```tsx
// append to src/components/Titlebar.test.tsx
import { platform } from '@tauri-apps/plugin-os'
import { useMobileSidebarStore } from '../store/mobileSidebar'

vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn() }))

describe('Titlebar on mobile', () => {
  beforeEach(() => {
    useMobileSidebarStore.setState({ open: false })
  })

  it('shows a menu-toggle button and hides window-chrome buttons', () => {
    vi.mocked(platform).mockReturnValue('ios')
    render(<Titlebar title="test" onCommand={vi.fn()} />)

    expect(screen.getByLabelText('Toggle sidebar')).toBeInTheDocument()
    expect(screen.queryByLabelText('Minimize')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Maximize')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Close')).not.toBeInTheDocument()
  })

  it('toggle button flips the mobile sidebar store', async () => {
    const user = userEvent.setup()
    vi.mocked(platform).mockReturnValue('ios')
    render(<Titlebar title="test" onCommand={vi.fn()} />)

    await user.click(screen.getByLabelText('Toggle sidebar'))
    expect(useMobileSidebarStore.getState().open).toBe(true)
  })

  it('keeps window-chrome buttons and omits the toggle on desktop', () => {
    vi.mocked(platform).mockReturnValue('windows')
    render(<Titlebar title="test" onCommand={vi.fn()} />)

    expect(screen.queryByLabelText('Toggle sidebar')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Minimize')).toBeInTheDocument()
    expect(screen.getByLabelText('Close')).toBeInTheDocument()
  })
})
```

(If the existing file doesn't already import `render`/`screen`/`userEvent`/`vi`/`describe`/`it`/`expect`/`beforeEach` from `@testing-library/react`, `@testing-library/user-event`, and `vitest`, add whichever are missing to the existing top-of-file import block rather than re-importing.)

- [x] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/components/Titlebar.test.tsx`
Expected: FAIL — `getByLabelText('Toggle sidebar')` finds nothing; window-chrome buttons still render on mobile.

- [x] **Step 3: Add the hamburger button and gate window-chrome buttons**

In `src/components/Titlebar.tsx`, add imports:
```ts
import { Menu, Copy, Minus, Square, X } from 'lucide-react'
import { isMobile } from '../lib/platform'
import { useMobileSidebarStore } from '../store/mobileSidebar'
```
(`Menu` is new; `Copy, Minus, Square, X` already exist in the current import line — merge into one `lucide-react` import rather than two.)

Replace the component body's return (currently lines 83-120) with:
```tsx
  const toggleSidebar = useMobileSidebarStore((s) => s.toggle)
  const mobile = isMobile()

  return (
    <div className="titlebar" data-tauri-drag-region>
      {mobile && (
        <button className="titlebar-btn titlebar-menu-toggle" aria-label="Toggle sidebar" onClick={toggleSidebar}>
          <Menu size={16} />
        </button>
      )}
      <div className="titlebar-menus">
        <TitlebarMenu label="File" items={buildFileMenu(recentWorkspaces)} onCommand={onCommand} />
        <TitlebarMenu label="View" items={VIEW_MENU} onCommand={onCommand} />
      </div>
      <div
        className="titlebar-title"
        data-tauri-drag-region
        onDoubleClick={() => void getCurrentWindow().toggleMaximize()}
      >
        {title}
      </div>
      {!mobile && (
        <div className="titlebar-controls">
          <button
            className="titlebar-btn"
            aria-label="Minimize"
            onClick={() => void getCurrentWindow().minimize()}
          >
            <Minus size={14} />
          </button>
          <button
            className="titlebar-btn"
            aria-label={maximized ? 'Restore' : 'Maximize'}
            onClick={() => void getCurrentWindow().toggleMaximize()}
          >
            {maximized ? <Copy size={12} /> : <Square size={12} />}
          </button>
          <button
            className="titlebar-btn titlebar-btn-close"
            aria-label="Close"
            onClick={() => void getCurrentWindow().close()}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
```
(iOS has no window to minimize/maximize/close — Tauri mobile has no equivalent APIs wired to these buttons, so they're hidden outright rather than left to no-op or throw.)

- [x] **Step 4: Add CSS for the new button and mobile titlebar height**

In `src/index.css`, immediately after the existing `.titlebar-btn-close:hover` rule (line 302):
```css
.titlebar-menu-toggle { margin-right: 4px; }

@media (hover: none) {
  .titlebar { height: 44px; }
  .titlebar-btn { width: 44px; }
}
```
(The height/width bump is under `(hover: none)`, not `isMobile()`-driven, because it's pure sizing for a touch pointer — matching this plan's CSS-vs-JS split described in Architecture above. `.titlebar-btn`'s existing `height: 100%` already inherits the bumped 44px titlebar height, so only `width` needs restating.)

- [x] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/components/Titlebar.test.tsx`
Expected: PASS, all tests including the 3 new ones.

- [x] **Step 6: Run the full suite and typecheck**

```bash
npm run typecheck
npm test
```

- [x] **Step 7: Commit**

```bash
git add src/components/Titlebar.tsx src/components/Titlebar.test.tsx src/index.css
git commit -m "feat(mobile): add a sidebar toggle and hide window-chrome buttons on iOS"
```

---

### Task 3: Sidebar renders as a drawer on mobile and closes on navigation

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/Layout.tsx`
- Modify: `src/index.css`
- Test: `src/components/Sidebar.test.tsx` (existing file — add to it)

**Interfaces:**
- Consumes: `isMobile` (existing), `useMobileSidebarStore` (Task 1).
- Produces: nothing further downstream — last task touching drawer mechanics.

- [x] **Step 1: Write the failing tests**

Read `src/components/Sidebar.test.tsx` first to match its existing mocking setup (it already mocks `useWorkspaceStore`/`useNotesStore`/hooks), then add:

```tsx
// append to src/components/Sidebar.test.tsx
import { platform } from '@tauri-apps/plugin-os'
import { useMobileSidebarStore } from '../store/mobileSidebar'

vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn() }))

describe('Sidebar drawer on mobile', () => {
  beforeEach(() => {
    useMobileSidebarStore.setState({ open: true })
  })

  it('has the drawer class and is open when the store says open', () => {
    vi.mocked(platform).mockReturnValue('ios')
    const { container } = render(<Sidebar {...requiredProps} />)

    const aside = container.querySelector('aside')
    expect(aside).toHaveClass('sidebar--drawer')
    expect(aside).toHaveClass('sidebar--open')
  })

  it('closes when activeTab changes', () => {
    vi.mocked(platform).mockReturnValue('ios')
    const { rerender } = render(<Sidebar {...requiredProps} />)
    expect(useMobileSidebarStore.getState().open).toBe(true)

    useWorkspaceStore.setState({ activeTab: '/ws/note.md' })
    rerender(<Sidebar {...requiredProps} />)

    expect(useMobileSidebarStore.getState().open).toBe(false)
  })

  it('closes when a secondary action (e.g. Search) is triggered', async () => {
    const user = userEvent.setup()
    vi.mocked(platform).mockReturnValue('ios')
    const onSearchOpen = vi.fn()
    render(<Sidebar {...requiredProps} onSearchOpen={onSearchOpen} />)

    await user.click(screen.getByText('Search'))

    expect(onSearchOpen).toHaveBeenCalled()
    expect(useMobileSidebarStore.getState().open).toBe(false)
  })

  it('has no drawer class on desktop', () => {
    vi.mocked(platform).mockReturnValue('windows')
    const { container } = render(<Sidebar {...requiredProps} />)

    expect(container.querySelector('aside')).not.toHaveClass('sidebar--drawer')
  })
})
```

(`requiredProps` should reuse whatever prop-stub object the existing test file already builds for `<Sidebar />` — check the top of the file for an existing `defaultProps`/`props` constant before introducing a new one. If none exists, build one from `SidebarProps`: `{ onSearchOpen: vi.fn(), onSettingsOpen: vi.fn(), onTemplateOpen: vi.fn(), onGraphOpen: vi.fn(), onTaskOpen: vi.fn(), onReviewOpen: vi.fn(), onFormulaSheetOpen: vi.fn(), onTerminalToggle: vi.fn() }`.)

- [x] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/components/Sidebar.test.tsx`
Expected: FAIL — no `sidebar--drawer` class exists yet; store stays `open: true` after simulated navigation.

- [x] **Step 3: Wire the drawer state into Sidebar.tsx**

Add imports:
```ts
import { isMobile } from '../lib/platform'
import { useMobileSidebarStore } from '../store/mobileSidebar'
```

Inside the component, after the existing store reads (near the `folderLoading` line):
```ts
  const activeTab = useWorkspaceStore((s) => s.activeTab)
  const mobile = isMobile()
  const drawerOpen = useMobileSidebarStore((s) => s.open)
  const closeDrawer = useMobileSidebarStore((s) => s.close)

  useEffect(() => {
    if (mobile) closeDrawer()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])
```
(Mirrors `Layout.tsx`'s own `useEffect(() => { setViewMode('wysiwyg') }, [activeTab])` pattern at line 456 — react to the tab changing, not to `mobile`/`closeDrawer` themselves changing.)

Wrap every action that should dismiss the drawer — everything in `.sidebar-group` and `.sidebar-secondary-actions` plus `Open Workspace` — with a close call. Replace the relevant handlers:
```tsx
  function closeIfMobile() {
    if (mobile) closeDrawer()
  }
```
and thread it into the existing onClick handlers (only the onClick line of each button changes — nothing else in the JSX moves):
```tsx
      <button className="sidebar-workspace-btn" onClick={() => { void openWorkspace(); closeIfMobile() }} disabled={folderLoading}>
```
```tsx
        <button className="sidebar-nav-btn" onClick={() => { setActiveTab(null); closeIfMobile() }} disabled={!workspacePath}>
```
```tsx
        <button className="sidebar-nav-btn" onClick={() => { onSearchOpen(); closeIfMobile() }}>
```
```tsx
        <button className="sidebar-nav-btn" onClick={() => { onSettingsOpen(); closeIfMobile() }}>
```
and the four `.toolbar-button`s in `.sidebar-secondary-actions` (`onGraphOpen`, `onTaskOpen`, `onReviewOpen`, `onTerminalToggle`, `onFormulaSheetOpen` — five, not four; all five get the same `{ onXOpen(); closeIfMobile() }` treatment).

`setActiveTab(null)` above already triggers the `activeTab`-watching `useEffect` too, so wrapping it is technically redundant with Step 3's effect — kept anyway for the same reason `handleMobileClone` in `WorkspacePicker.tsx` doesn't rely on an indirect effect for its own navigation: an explicit close next to the action that causes it is easier to read than inferring it from a dependency array two screens away.

Finally, the `<aside>` tag:
```tsx
    <aside className={`sidebar${mobile ? ` sidebar--drawer${drawerOpen ? ' sidebar--open' : ''}` : ''}`}>
```

- [x] **Step 4: Render a backdrop from Layout.tsx when the drawer is open**

In `src/components/Layout.tsx`, add imports:
```ts
import { isMobile } from '../lib/platform'
import { useMobileSidebarStore } from '../store/mobileSidebar'
```

Inside `Layout()`, alongside the other store reads:
```ts
  const mobile = isMobile()
  const mobileSidebarOpen = useMobileSidebarStore((s) => s.open)
  const closeMobileSidebar = useMobileSidebarStore((s) => s.close)
```

Immediately before the existing `{!focusMode && (<Sidebar ...`  block (line 529), add:
```tsx
      {mobile && mobileSidebarOpen && (
        <div className="sidebar-backdrop" onClick={closeMobileSidebar} />
      )}
```

- [x] **Step 5: Add the drawer and backdrop CSS**

In `src/index.css`, immediately after the existing `.sidebar { ... }` rule (the block starting at line 310):
```css
.sidebar-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 90;
}

.sidebar--drawer {
  position: fixed;
  top: 44px; /* below the mobile titlebar, see Task 2 */
  bottom: 0;
  left: 0;
  width: 85vw;
  max-width: 320px;
  z-index: 91;
  transform: translateX(-100%);
  transition: transform var(--duration-base) var(--ease-standard);
  box-shadow: var(--shadow-modal);
  padding-bottom: max(12px, env(safe-area-inset-bottom));
}

.sidebar--drawer.sidebar--open {
  transform: translateX(0);
}
```
(`var(--shadow-modal)` and `var(--duration-base)`/`var(--ease-standard)` are confirmed existing tokens used elsewhere in this file, e.g. `.search-modal`'s `box-shadow: var(--shadow-modal)` at line 2079 — no new tokens introduced. `z-index: 90/91` sits below `.toast-stack`'s `200` and `.search-modal`'s wrapper `100`, so opening a dialog while the drawer is open still shows the dialog on top — acceptable since Step 3's `activeTab`/action-triggered closes mean the drawer is essentially always closed by the time a dialog opens anyway.)

- [x] **Step 6: Run tests to verify they pass**

Run: `npm test -- src/components/Sidebar.test.tsx`
Expected: PASS, all tests including the 4 new ones.

- [x] **Step 7: Run the full suite and typecheck**

```bash
npm run typecheck
npm test
```
Expected: no regressions — `Layout.test.tsx`'s existing cases render on `platform() === undefined`/desktop-default, so `isMobile()` must resolve falsy there already (confirm by reading `platform.ts`'s mock default in `Layout.test.tsx`; if the file doesn't mock `@tauri-apps/plugin-os` at all, `platform()` throws outside a Tauri context — add the same `vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn(() => 'windows') }))` used elsewhere in this plan to its existing mock block).

- [x] **Step 8: Commit**

```bash
git add src/components/Sidebar.tsx src/components/Layout.tsx src/components/Sidebar.test.tsx src/components/Layout.test.tsx src/index.css
git commit -m "feat(mobile): render the sidebar as a closeable drawer on iOS"
```

---

### Task 4: Tap-visible tree actions and minimum touch-target sizing (sidebar + dialogs)

**Files:**
- Modify: `src/index.css`

**Interfaces:**
- Consumes: nothing (pure CSS, no component changes).
- Produces: nothing downstream.

No JS/TS changes in this task — every rule below keys off the CSS `(hover: none)` media feature (true on a touchscreen with no mouse/trackpad, false on Windows desktop), so there is nothing to unit-test; verification is visual (Task 5).

- [x] **Step 1: Reveal hover-only tree actions on touch**

`FolderTree`'s per-row rename/delete buttons are `opacity: 0` until `.tree-row:hover` (`src/index.css` lines 2555-2573) — unreachable on a device with no hover state at all, exactly the "hover-only affordance" gap the spec's UI section calls out. Immediately after the existing rule:
```css
.sidebar .tree-row:hover .tree-delete,
.sidebar .tree-row:hover .tree-rename { opacity: 1; }
```
add:
```css
@media (hover: none) {
  .sidebar .tree-delete,
  .sidebar .tree-rename {
    opacity: 1;
  }
}
```

- [x] **Step 2: Bump touch targets to Apple's 44×44pt minimum**

`.toolbar-button` is 28×28px (`src/index.css` line 1844), `.sidebar button` (New/Home/Search/Settings rows) has only 7px vertical padding at 13px font, and `.dialog-action`/`.dialog-action-primary` (every dialog's Cancel/OK-style buttons — Settings, Template picker, Import-mode, Flashcard-type, Diagram-picker) are 28px tall — all below the minimum. This is the "dialogs need touch-appropriate sizing" half of the spec's UI section; dialog *width* is already viewport-clamped by every dialog's existing `max-width: calc(100vw - 40px)`/`min(Npx, 90vw)` rules (confirmed by reading `.settings-panel`, `.import-mode-dialog`, `.graph-view`, `.task-view`, `.review-session` — no width fix needed), so only button height needs addressing here. Immediately after the existing `.toolbar-button { ... }` rule:
```css
@media (hover: none) {
  .toolbar-button { width: 44px; height: 44px; }
  .sidebar button { padding: 13px 10px; }
  .tab .tab-close { min-width: 32px; min-height: 32px; }
  .dialog-action, .dialog-action-primary { min-height: 44px; padding: 0 16px; }
}
```
(`.tab .tab-close` gets 32px, not 44px — tabs themselves are already narrow and packed edge-to-edge in `TabBar`; 44px would force horizontal scrolling with very few tabs visible. 32px matches this project's existing secondary-control sizing elsewhere, e.g. `.titlebar-btn`'s pre-Task-2 44px is reserved for primary chrome, not every small in-row control. `min-height` rather than `height` on the dialog actions so a button that already grew for its own content — e.g. a longer label — never shrinks back down.)

- [x] **Step 3: Verify no other selector wins over the new rules**

```bash
npm run typecheck
```
(No runtime tests apply — `@media (hover: none)` can't be exercised by jsdom, which has no pointer concept; Vitest's DOM environment always reports no-hover isn't reliable to assert against. Confirm visually in Task 5 instead.)

- [x] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "feat(mobile): reveal hover-only tree actions and enlarge touch targets"
```

---

### Task 5: Visual verification

**Files:** none modified — this task only screenshots and confirms.

- [x] **Step 1: Start the dev server**

```bash
npm run dev
```

- [x] **Step 2: Force `isMobile()` true for the preview**

Temporarily hardcode `src/lib/platform.ts`'s `isMobile()` to `return true` (same technique `mobile-credentials-onboarding.md` Task 4 Step 6 used) — do not commit this change.

- [x] **Step 3: Use the `ui-preview` skill to screenshot each state**

Against the running dev server, resize the browser viewport to a phone width (390×844, iPhone 15 dimensions) and capture:
1. Default load — no titlebar minimize/maximize/close buttons, hamburger button present, sidebar drawer closed (no backdrop).
2. Tap the hamburger — drawer slides in from the left, backdrop visible behind it, drawer content fits within 320px without horizontal overflow.
3. Tap a note in the drawer's folder tree — drawer closes, note opens in the editor pane.
4. Reopen the drawer, tap-and-hold is unnecessary — confirm the rename/delete icons on a note row are visible without hovering (Task 4 Step 1).
5. Open Search (`Ctrl K` or the drawer's Search row) — confirm `.search-modal` fits the 390px viewport without clipping and the input doesn't trigger a layout shift on focus.

For each, confirm against `src/index.css`'s actual rendered output — per this project's recorded lesson, a className existing in the stylesheet is not the same as it rendering correctly at this viewport size.

- [x] **Step 4: Revert the hardcoded `isMobile()` override**

Confirm `git diff src/lib/platform.ts` is empty before continuing.

- [x] **Step 5: Run the full suite one more time**

```bash
npm run typecheck
npm test
```

- [x] **Step 6: Record the result**

Note any visual issue found in Step 3 as a short addendum to this plan file (matching `mobile-credentials-onboarding.md` Task 5 Step 4's "Result:" convention) — if something needs a follow-up fix, fix it in this same task before moving on; this plan has no next task depending on Task 5 passing cleanly, so there's no reason to defer.

**Result:** The running `tauri dev` Vite server (port 1421) crashed to the app's `ErrorBoundary` on plain navigation — pre-existing, unrelated to this plan: `Titlebar`'s and `useWindowTitle`'s mount effects call `getCurrentWindow()` synchronously, which reads `window.__TAURI_INTERNALS__.metadata` and throws outside a real Tauri webview, and `React.StrictMode`'s dev double-invoke turns that into a full-tree unmount. Worked around by injecting a minimal `window.__TAURI_INTERNALS__` stub (`metadata.currentWindow`/`currentWebview` labels, `invoke` rejecting) via Playwright's `addInitScript` before reload — app code unchanged, screenshots discarded after review, not committed. With that stub: (1) default load showed the hamburger button, no minimize/maximize/close buttons, drawer closed, no backdrop — matches Task 2's `!mobile` gate; (2) tapping the hamburger slid the drawer in from the left over a visible backdrop, content fit within the 320px max-width with no horizontal overflow; (3) clicking Search in the drawer closed the drawer (confirming Task 3's `closeIfMobile()` wiring fires from a live click, not just the unit test) and opened `.search-modal`, which fit the 390px viewport with no clipping. Task 4 Step 1 (tap-visible rename/delete icons) could not be visually confirmed this way — the preview has no workspace/note data, so `FolderTree` renders no rows; the `@media (hover: none)` rule itself was already typecheck-verified in Task 4 and needs a real workspace (`e2e-verify`) to see a populated row, which is out of this plan's own Task 5 scope. No follow-up fix needed — nothing regressed from the plan's intended CSS/behavior, only the ui-preview skill's documented gap around `getCurrentWindow()` was hit and worked around.

---

## Out of scope (this plan)

- **Command palette/dialog content re-layout beyond width/safe-area.** `SettingsPanel`, `TaskView`, `GraphView`, etc. each have their own internal layouts (rows, lists, panes) that may still feel cramped on a phone; this plan only guarantees the *dialog shell* fits the viewport and its primary input doesn't trigger iOS's auto-zoom. Per-dialog content redesign is real, separate design work — YAGNI until a specific dialog is reported as actually broken on-device, not assumed here.
- **Folder context menu (right-click) touch equivalent (long-press).** iOS has no right-click; a long-press-to-open-context-menu gesture is a new interaction pattern, not a CSS/sizing fix, and isn't named in the spec's UI section as this plan's job. Separate follow-up if mobile users actually need rename/delete/move beyond what the now-tap-visible row buttons (Task 4) already cover.
- **`TabBar` horizontal-scroll/overflow behavior on narrow widths.** Only `.tab-close`'s tap target was addressed (Task 4); whether many open tabs need a swipe-to-scroll affordance or a collapse-into-menu treatment on a 390px screen is unaddressed. Revisit once real on-device use shows whether it's actually a problem — most mobile sessions are expected to have few tabs open at once.
- **A CI Simulator smoke test for any of this.** `mobile-ios-scaffold.md`'s CI workflow proves the app *launches*; extending it to tap through the drawer/dialogs the way `mobile-credentials-onboarding.md` Task 5 did for onboarding is possible but not required by this plan's own DoD (Task 5's dev-server visual check). Add if a regression here specifically needs device-level (not dev-server) coverage.
- **Android.** Same footnote as every prior mobile plan — this reflow is expected to transfer, but Android gets its own pass.
