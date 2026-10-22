# Phone-Native Mobile Shell Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Replace the phone's squeezed-desktop shell (sidebar drawer, window-chrome titlebar) with a bottom tab bar and a full-screen editor, and fix the open Android shell issues #115 (safe areas), #116 (Back), #117 (soft keyboard), #118 (touch targets) and #119 (Home overflow).

**Architecture:** `Layout` stays the controller (close-requested flush, git polling, workspace startup, overlays, note buffers). When `isMobile()` is true it returns `<MobileShell />` instead of its desktop JSX, passing React-node slots (overlays, git bars, editor, home) and a few callbacks; desktop JSX is only *hoisted into local consts*, never changed. `MobileShell` is view-only: it holds the active tab and the More-sheet flag, and derives "editor screen open" from the existing `activeTab !== null`. System Back goes through one pure resolver (`resolveBack`) driven by Tauri's `onBackButtonPress`. Keyboard handling is a native `WindowInsets` IME listener in `MainActivity.kt` plus a caret-scroll hook.

**Tech Stack:** React 19, Zustand, Vitest + Testing Library, `@tauri-apps/api/app` `onBackButtonPress` (already in the installed 2.x API), Kotlin (`androidx.core` `ViewCompat`, already a transitive dependency of `enableEdgeToEdge`). No new dependencies.

**Spec:** `docs/specs/mobile-native-shell-design.md` (builds on `docs/plans/mobile-app-shell-reflow.md`; emulator procedure in `docs/plans/android-parity-shell-verification.md` Task 1).

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [ ] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [ ] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- **Desktop renders byte-identical to today.** Every mobile fork gates on `isMobile()` (`src/lib/platform.ts`), never a viewport breakpoint. `Layout.test.tsx` and the desktop cases of `Sidebar.test.tsx`/`Titlebar.test.tsx` must pass unmodified; CSS added for mobile is either under `@media (hover: none)` or scoped to `[data-shell='mobile']`.
- **Tablets get the phone layout.** No tablet or stylus-first layouts, no ink-canvas changes beyond keyboard handling, no split panes/terminal/outline/title-bar menu on phones.
- **Finish line (spec):** on the Android emulator every screen renders inside the system bars, the soft keyboard never covers the line being typed, system Back walks overlay → editor → non-Home tab → exit, and every tappable target is ≥ 44 px.
- **iOS is not built or CI-run.** iOS behaviour (WKWebView does not resize for the keyboard) is recorded as unverified in the Task 9 result. No macOS CI minutes are spent.
- **A className with no matching rule in `src/index.css` renders as unstyled text** (CLAUDE.md, recorded lesson). Every task that adds a className greps `src/index.css` for it before it is done; new visuals use existing tokens (`--bg-raised`, `--border`, `--space-*`, `--accent`, …), never hardcoded colours.
- **Verify by measurement, not by className.** Emulator checks read DOM rects via the DevTools socket and compare against a reference element (per `feedback_ui_spacing_gaps`), with a screenshot as supporting evidence only.
- `npm run typecheck` and `npm test` stay clean before every commit. No `any`, no non-null `!`, named exports only, files ≤ ~150 lines per component.
- Commit style: `type(mobile): …` lowercase imperative, as in `git log`. Do not push.

## Review Focus

Failure modes the spec implies but no obvious task test covers; each has an owning test or emulator check below.

1. **No workspace open on a phone** (first launch, before cloning): there is nothing to show in Home/Notes except the workspace picker, and Settings must stay reachable. → Task 5 tests `MobileShell` with `hasWorkspace={false}`: picker slot shown, Search/Review disabled, More enabled.
2. **Back pressed on a note with unsaved edits:** leaving the editor screen must not lose text. → Task 5 sets `activeTab` to `null` (the same call desktop's Home button makes, so `useNote`'s flush-on-switch applies); Task 9 checks type → Back → reopen on the emulator.
3. **Back pressed while the More sheet is open over the editor-less Home:** must close the sheet, not exit. → Task 2 `resolveBack` table covers sheet-before-editor-before-tab-before-exit.
4. **A note opened from outside the Notes tab** (search result, Home "Continue", wiki-link) must land in the editor screen with the tab bar hidden. → Task 5 derives editor-open from `activeTab`, tested by setting the store directly.
5. **Keyboard open + toolbar:** the toolbar must sit directly on top of the IME with no gap and no overlap, and the caret line must stay above it. → Task 3 hook unit test + Task 9 DOM-rect check.

## File Structure

| File | Responsibility |
|---|---|
| `index.html` | `viewport-fit=cover` |
| `src/lib/backNavigation.ts` (new) | Pure `resolveBack(state): BackAction` and the `MobileTab` type |
| `src/hooks/useBackButton.ts` (new) | Registers `onBackButtonPress`, runs the handler `resolveBack` picks; owns `exit` |
| `src/editor/useKeepCaretVisible.ts` (new) | Scrolls the caret into view when the viewport resizes (keyboard) |
| `src/components/NoteList.tsx` (new) | Folder error + tag-filtered list / onboarding / `FolderTree`, extracted from `Sidebar` |
| `src/components/MobileShell.tsx` (new) | Tab state, screen switching, editor top bar, Back wiring |
| `src/components/MobileTabBar.tsx` (new) | The five-tab bar |
| `src/components/MoreSheet.tsx` (new) | Bottom sheet: Tasks, Graph, Formula sheet, Settings, Sync now |
| `src/components/MobileNotes.tsx` (new) | Notes tab: `SidebarHeader` + `NoteList` + `TagList` |
| `src-tauri/gen/android/.../AndroidManifest.xml`, `MainActivity.kt` | `adjustResize` + IME inset listener |
| `src/components/Layout.tsx` | Hoists overlays/git bars into consts; returns `<MobileShell />` on mobile; drawer removal |
| `src/components/Sidebar.tsx`, `SidebarRail.tsx`, `SidebarHeader.tsx`, `Titlebar.tsx` | Drawer/mobile branches removed (Task 6) |
| `src/store/mobileSidebar.ts` (+test) | Deleted (Task 6) |
| `src/index.css` | Safe-area vars, shell/tab-bar/sheet/top-bar styles, full-screen overlays, 44 px targets, Home grid fix |

## Phase 1 — Safe areas, Back, keyboard (usable on their own)

### Task 1: Safe-area insets (#115)

**Files:**
- Modify: `index.html:6`
- Modify: `src/index.css` (`.titlebar` hover:none block ~line 311, `.sidebar--drawer` ~line 380)

**Interfaces:**
- Consumes: nothing.
- Produces: CSS custom properties `--safe-top`, `--safe-bottom`, `--safe-left`, `--safe-right` on `:root`, used by every later task's CSS.

- [ ] **Step 1: Enable `viewport-fit=cover`**

In `index.html` replace the viewport meta with:

```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

- [ ] **Step 2: Add the variables and apply them to the existing mobile titlebar and drawer**

In `src/index.css`, immediately before the `/* Layout */` comment (~line 245):

```css
:root {
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
}
```

Replace the existing `@media (hover: none)` block under `.titlebar-menu-toggle` with:

```css
@media (hover: none) {
  .titlebar { height: calc(44px + var(--safe-top)); padding-top: var(--safe-top); }
  .titlebar-btn { width: 44px; }
}
```

In `.sidebar--drawer` change `top: 44px; /* below the mobile titlebar, see Task 2 */` to `top: calc(44px + var(--safe-top));` and `padding-bottom: max(12px, env(safe-area-inset-bottom));` to `padding-bottom: max(12px, var(--safe-bottom));`.

- [ ] **Step 3: Typecheck and test**

Run: `npm run typecheck; npm test`
Expected: PASS (CSS-only change; desktop `env()` resolves to `0px`).

- [ ] **Step 4: Measure on the emulator**

Build, install and launch exactly as `docs/plans/android-parity-shell-verification.md` Task 1 (`npx tauri android build --debug --target x86_64`, `adb install`, clone the fixture workspace). Through the DevTools socket evaluate:

```js
({ top: getComputedStyle(document.documentElement).getPropertyValue('--safe-top'),
   probe: (() => { const d = document.createElement('div'); d.style.paddingTop = 'env(safe-area-inset-top)'; document.body.append(d); const v = getComputedStyle(d).paddingTop; d.remove(); return v })(),
   toggle: document.querySelector('.titlebar-menu-toggle').getBoundingClientRect().toJSON(),
   innerHeight })
```

Expected: `probe` is non-zero (≈ 24 css px at dpr 2.75) and the toggle button's `top` ≥ `probe`.

**If `probe` is `0px`** (this WebView does not report insets): do Step 5. **If non-zero:** skip Step 5.

- [ ] **Step 5 (only if `probe` was `0px`): supply the insets natively instead**

Write Task 3's `MainActivity.kt` listener now, with the system bars included, so the WebView is padded away from the status and navigation bars (CSS `env()` stays `0px`, so no double padding):

```kotlin
    ViewCompat.setOnApplyWindowInsetsListener(findViewById<View>(android.R.id.content)) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
      WindowInsetsCompat.CONSUMED
    }
```

with the `View`, `ViewCompat`, `WindowInsetsCompat` imports from Task 3 Step 6. Task 3 Step 6's `MainActivity.kt` edit is then already done — skip it there (keep its manifest edit) and re-measure the toggle button's `top` here instead.

- [ ] **Step 6: Commit**

```bash
git add index.html src/index.css
git commit -m "fix(mobile): pad the mobile shell with safe-area insets (#115)"
```

(If Step 5 ran, add `src-tauri/gen/android/app/src/main/java/dev/nullnotes/app/MainActivity.kt` and say so in the message.)

---

### Task 2: System Back handler (#116)

**Files:**
- Create: `src/lib/backNavigation.ts`, `src/lib/backNavigation.test.ts`
- Create: `src/hooks/useBackButton.ts`, `src/hooks/useBackButton.test.ts`
- Modify: `src/components/Layout.tsx` (wire interim handler for the drawer shell)

**Interfaces:**
- Consumes: `isMobile` (`src/lib/platform.ts`), `onBackButtonPress` (`@tauri-apps/api/app`), `getCurrentWindow` (`@tauri-apps/api/window`).
- Produces:
  - `type MobileTab = 'home' | 'notes'`
  - `type BackAction = 'close-overlay' | 'close-sheet' | 'close-editor' | 'go-home' | 'exit'`
  - `interface BackState { overlayOpen: boolean; sheetOpen: boolean; editorOpen: boolean; tab: MobileTab }`
  - `function resolveBack(state: BackState): BackAction`
  - `type BackHandlers = Record<Exclude<BackAction, 'exit'>, () => void>`
  - `function useBackButton(state: BackState, handlers: BackHandlers): void` — `exit` is built in (closes the window through the existing flush-on-close path).

- [ ] **Step 1: Write the failing resolver test**

```ts
// src/lib/backNavigation.test.ts
import { describe, it, expect } from 'vitest'
import { resolveBack, type BackState } from './backNavigation'

const idle: BackState = { overlayOpen: false, sheetOpen: false, editorOpen: false, tab: 'home' }

describe('resolveBack', () => {
  it('closes an overlay before anything else', () => {
    expect(resolveBack({ overlayOpen: true, sheetOpen: true, editorOpen: true, tab: 'notes' })).toBe('close-overlay')
  })
  it('closes the sheet before the editor', () => {
    expect(resolveBack({ ...idle, sheetOpen: true, editorOpen: true, tab: 'notes' })).toBe('close-sheet')
  })
  it('closes the editor before leaving the tab', () => {
    expect(resolveBack({ ...idle, editorOpen: true, tab: 'notes' })).toBe('close-editor')
  })
  it('returns to Home from a non-Home tab', () => {
    expect(resolveBack({ ...idle, tab: 'notes' })).toBe('go-home')
  })
  it('exits from idle Home', () => {
    expect(resolveBack(idle)).toBe('exit')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- src/lib/backNavigation.test.ts`
Expected: FAIL — cannot resolve `./backNavigation`.

- [ ] **Step 3: Write the resolver**

```ts
// src/lib/backNavigation.ts
export type MobileTab = 'home' | 'notes'
export type BackAction = 'close-overlay' | 'close-sheet' | 'close-editor' | 'go-home' | 'exit'

export interface BackState {
  overlayOpen: boolean
  sheetOpen: boolean
  editorOpen: boolean
  tab: MobileTab
}

export function resolveBack(s: BackState): BackAction {
  if (s.overlayOpen) return 'close-overlay'
  if (s.sheetOpen) return 'close-sheet'
  if (s.editorOpen) return 'close-editor'
  if (s.tab !== 'home') return 'go-home'
  return 'exit'
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- src/lib/backNavigation.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing hook test**

```ts
// src/hooks/useBackButton.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { platform } from '@tauri-apps/plugin-os'
import { onBackButtonPress } from '@tauri-apps/api/app'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useBackButton } from './useBackButton'
import type { BackState } from '../lib/backNavigation'

vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn() }))
vi.mock('@tauri-apps/api/app', () => ({ onBackButtonPress: vi.fn() }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }))

const idle: BackState = { overlayOpen: false, sheetOpen: false, editorOpen: false, tab: 'home' }
const handlers = () => ({
  'close-overlay': vi.fn(),
  'close-sheet': vi.fn(),
  'close-editor': vi.fn(),
  'go-home': vi.fn(),
})

let press: () => void
const unregister = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(platform).mockReturnValue('android')
  vi.mocked(onBackButtonPress).mockImplementation(async (cb) => {
    press = () => cb({ canGoBack: false })
    return { unregister } as never
  })
})

describe('useBackButton', () => {
  it('runs the handler resolveBack picks, using the latest state', () => {
    const h = handlers()
    const { rerender } = renderHook(({ s }) => useBackButton(s, h), { initialProps: { s: idle } })
    rerender({ s: { ...idle, editorOpen: true } })
    press()
    expect(h['close-editor']).toHaveBeenCalledTimes(1)
  })

  it('closes the window when nothing is left to pop', () => {
    const close = vi.fn()
    vi.mocked(getCurrentWindow).mockReturnValue({ close } as never)
    renderHook(() => useBackButton(idle, handlers()))
    press()
    expect(close).toHaveBeenCalled()
  })

  it('does not register on desktop', () => {
    vi.mocked(platform).mockReturnValue('windows')
    renderHook(() => useBackButton(idle, handlers()))
    expect(onBackButtonPress).not.toHaveBeenCalled()
  })

  it('unregisters on unmount', async () => {
    const { unmount } = renderHook(() => useBackButton(idle, handlers()))
    unmount()
    await Promise.resolve()
    expect(unregister).toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm test -- src/hooks/useBackButton.test.ts`
Expected: FAIL — cannot resolve `./useBackButton`.

- [ ] **Step 7: Write the hook**

```ts
// src/hooks/useBackButton.ts
import { useEffect, useRef } from 'react'
import { onBackButtonPress } from '@tauri-apps/api/app'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isMobile } from '../lib/platform'
import { resolveBack, type BackAction, type BackState } from '../lib/backNavigation'

export type BackHandlers = Record<Exclude<BackAction, 'exit'>, () => void>

// Registering a listener replaces the platform default (walk the WebView
// history, then finish the activity), so 'exit' has to be done here — through
// window.close() so Layout's flush-before-close still runs.
export function useBackButton(state: BackState, handlers: BackHandlers) {
  const latest = useRef({ state, handlers })
  useEffect(() => {
    latest.current = { state, handlers }
  })

  useEffect(() => {
    if (!isMobile()) return
    const listener = onBackButtonPress(() => {
      const { state, handlers } = latest.current
      const action = resolveBack(state)
      if (action === 'exit') void getCurrentWindow().close()
      else handlers[action]()
    })
    return () => void listener.then((l) => l.unregister())
  }, [])
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npm test -- src/hooks/useBackButton.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 9: Wire the interim handler into `Layout` (drawer shell)**

In `src/components/Layout.tsx` add imports `import { useBackButton } from '../hooks/useBackButton'`, then directly after the `const { activeOverlay, openOverlay, closeOverlay } = useOverlayManager()` line:

```tsx
  useBackButton(
    { overlayOpen: activeOverlay !== null, sheetOpen: mobileSidebarOpen, editorOpen: activeTab !== null, tab: 'home' },
    {
      'close-overlay': closeOverlay,
      'close-sheet': closeMobileSidebar,
      'close-editor': () => setActiveTab(null),
      'go-home': () => undefined,
    },
  )
```

(`mobileSidebarOpen`, `closeMobileSidebar`, `setActiveTab` are already declared above in `Layout`. `useBackButton` is a no-op on desktop, so `Layout.test.tsx` is unaffected; if it renders without the `@tauri-apps/api/app` mock the hook never reaches `onBackButtonPress` because `platform()` is mocked to `'windows'`.)

- [ ] **Step 10: Run the suite, then verify on the emulator**

Run: `npm run typecheck; npm test` — Expected: PASS.

Emulator (setup as in Task 1 Step 4): open the drawer, `adb shell input keyevent KEYCODE_BACK` → drawer closes and `pidof dev.nullnotes.app` still returns a pid. Open a note, Back → Home dashboard. Back again on Home → process exits (`pidof` empty). **If `window.close()` does not finish the activity** (the Rust `CloseRequested` veto in `lib.rs:118` runs, the frontend flushes and calls `confirm_close` → `destroy`, which may not end the Android activity): add a thin Rust command in `src-tauri/src/commands/window.rs` — `#[tauri::command] pub fn exit_app(app: tauri::AppHandle) { app.exit(0) }` — register it in `lib.rs`'s `generate_handler!` next to `confirm_close`, expose it as `api.window.exitApp()` in `src/lib/tauri.ts`, and make the `exit` branch in `useBackButton.ts` call `void api.window.exitApp()` instead of `getCurrentWindow().close()` (update the "closes the window" test to mock `api.window.exitApp`). Notes are already on disk by the autosave path; accept that this skips the close-time git flush. Do this only if the check fails; record which branch was taken in the commit body.

- [ ] **Step 11: Commit**

```bash
git add src/lib/backNavigation.ts src/lib/backNavigation.test.ts src/hooks/useBackButton.ts src/hooks/useBackButton.test.ts src/components/Layout.tsx
git commit -m "feat(mobile): route system Back through one resolver (#116)"
```

---

### Task 3: Soft keyboard (#117)

**Files:**
- Modify: `src-tauri/gen/android/app/src/main/AndroidManifest.xml:14`
- Modify: `src-tauri/gen/android/app/src/main/java/dev/nullnotes/app/MainActivity.kt`
- Create: `src/editor/useKeepCaretVisible.ts`, `src/editor/useKeepCaretVisible.test.ts`
- Modify: `src/editor/NoteEditor.tsx` (call the hook)

**Interfaces:**
- Consumes: `isMobile`, a TipTap `Editor`.
- Produces: `function useKeepCaretVisible(editor: Editor | null): void`.

The app runs edge-to-edge (`enableEdgeToEdge()`), where `adjustResize` alone no longer shrinks the content view; the IME inset listener is what actually moves the layout. The manifest flag is set as the spec requires and for pre-edge-to-edge fallbacks.

- [ ] **Step 1: Write the failing hook test**

```ts
// src/editor/useKeepCaretVisible.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { platform } from '@tauri-apps/plugin-os'
import { useKeepCaretVisible } from './useKeepCaretVisible'

vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn() }))

function fakeEditor(isFocused: boolean) {
  const scrollIntoView = vi.fn()
  return { editor: { isFocused, commands: { scrollIntoView } } as unknown as Editor, scrollIntoView }
}

beforeEach(() => vi.mocked(platform).mockReturnValue('android'))

describe('useKeepCaretVisible', () => {
  it('scrolls the caret into view when the viewport resizes while focused', () => {
    const { editor, scrollIntoView } = fakeEditor(true)
    renderHook(() => useKeepCaretVisible(editor))
    window.dispatchEvent(new Event('resize'))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the editor is not focused', () => {
    const { editor, scrollIntoView } = fakeEditor(false)
    renderHook(() => useKeepCaretVisible(editor))
    window.dispatchEvent(new Event('resize'))
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('does nothing on desktop', () => {
    vi.mocked(platform).mockReturnValue('windows')
    const { editor, scrollIntoView } = fakeEditor(true)
    renderHook(() => useKeepCaretVisible(editor))
    window.dispatchEvent(new Event('resize'))
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('stops listening after unmount', () => {
    const { editor, scrollIntoView } = fakeEditor(true)
    renderHook(() => useKeepCaretVisible(editor)).unmount()
    window.dispatchEvent(new Event('resize'))
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- src/editor/useKeepCaretVisible.test.ts`
Expected: FAIL — cannot resolve `./useKeepCaretVisible`.

- [ ] **Step 3: Write the hook**

```ts
// src/editor/useKeepCaretVisible.ts
import { useEffect } from 'react'
import type { Editor } from '@tiptap/core'
import { isMobile } from '../lib/platform'

// The keyboard opening shrinks the viewport but leaves the scroll offset, so
// the line being typed ends up under the IME. visualViewport is the shared
// signal; window 'resize' is the same event where it is missing (and in jsdom).
export function useKeepCaretVisible(editor: Editor | null) {
  useEffect(() => {
    if (!editor || !isMobile()) return
    const target: EventTarget = window.visualViewport ?? window
    const onResize = () => {
      if (editor.isFocused) editor.commands.scrollIntoView()
    }
    target.addEventListener('resize', onResize)
    return () => target.removeEventListener('resize', onResize)
  }, [editor])
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- src/editor/useKeepCaretVisible.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Call it from `NoteEditor`**

In `src/editor/NoteEditor.tsx` add `import { useKeepCaretVisible } from './useKeepCaretVisible'` and, immediately after the `editor` is created by `useEditor(...)` (before the `return`), add `useKeepCaretVisible(editor)`.

- [ ] **Step 6: Manifest and native IME listener**

In `AndroidManifest.xml`, add to the `<activity>` element (next to `android:launchMode`):

```xml
            android:windowSoftInputMode="adjustResize"
```

In `MainActivity.kt` (skip the listener if Task 1 Step 5 already wrote it) replace the file with:

```kotlin
package dev.nullnotes.app

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    io.crates.keyring.Keyring.initializeNdkContext(applicationContext)

    // edge-to-edge stops adjustResize from shrinking the content view, so lift
    // the WebView above the keyboard by hand. System-bar insets still reach the
    // page (returned unconsumed), where CSS pads for them via env().
    ViewCompat.setOnApplyWindowInsetsListener(findViewById<View>(android.R.id.content)) { view, insets ->
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(0, 0, 0, ime.bottom)
      insets
    }
  }
}
```

- [ ] **Step 7: Verify on the emulator**

Build/install/launch as Task 1 Step 4; open a note with ≥ 30 lines (`adb shell input keyevent KEYCODE_ENTER` loop as in `android-parity-shell-verification.md` Task 2 Step 7), tap the last line, `adb shell input text 'caret%sline'`. Evaluate over DevTools:

```js
({ vv: visualViewport.height, inner: innerHeight,
   caret: getSelection().getRangeAt(0).getBoundingClientRect().bottom })
```

Expected: `inner` < the pre-keyboard 808 (the page shrank) and `caret` ≤ `inner`. If `inner` is unchanged, the listener is not receiving IME insets — check `adb logcat` and that `windowSoftInputMode` is in the merged manifest. If the editor toolbar (still at the top until Task 7) is irrelevant here, ignore it.

- [ ] **Step 8: Commit**

```bash
git add src/editor/useKeepCaretVisible.ts src/editor/useKeepCaretVisible.test.ts src/editor/NoteEditor.tsx src-tauri/gen/android/app/src/main/AndroidManifest.xml src-tauri/gen/android/app/src/main/java/dev/nullnotes/app/MainActivity.kt
git commit -m "fix(mobile): lift the editor above the soft keyboard and keep the caret visible (#117)"
```

## Phase 2 — MobileShell, tab bar, More sheet, drawer removal

### Task 4: Extract `NoteList` from `Sidebar`

**Files:**
- Create: `src/components/NoteList.tsx`
- Modify: `src/components/Sidebar.tsx`
- Test: `src/components/Sidebar.test.tsx` (existing — must pass unmodified)

**Interfaces:**
- Consumes: `useNotesStore`, `useWorkspaceStore`, `FolderTree`, `buildFolderTree`, `api.notes.notesWithTag`.
- Produces: `export function NoteList(): JSX.Element` — renders, in this order, the folder-error alert, then either the tag-filtered list, the "No notes yet" onboarding, or `FolderTree`. Reads everything from stores; no props. Task 5's `MobileNotes` and `Sidebar` both render it.

Motivation: the Notes tab needs exactly what the sidebar panel shows. Extracting avoids a second copy of the tag-filter effect and keeps desktop DOM identical.

- [ ] **Step 1: Run the existing Sidebar tests as the baseline**

Run: `npm test -- src/components/Sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 2: Create `NoteList`**

```tsx
// src/components/NoteList.tsx
import { useEffect, useState } from 'react'
import { useNotesStore } from '../store/notes'
import { useWorkspaceStore } from '../store/workspace'
import { FolderTree } from './FolderTree'
import { buildFolderTree } from '../lib/folderTree'
import { api } from '../lib/tauri'
import type { NoteMetadata } from '../types'

export function NoteList() {
  const notes = useNotesStore((s) => s.notes)
  const folders = useNotesStore((s) => s.folders)
  const workspacePath = useWorkspaceStore((s) => s.path)
  const tagFilter = useWorkspaceStore((s) => s.tagFilter)
  const openTab = useWorkspaceStore((s) => s.openTab)
  const folderError = useWorkspaceStore((s) => s.folderError)
  const setFolderError = useWorkspaceStore((s) => s.setFolderError)
  const [tagFilteredNotes, setTagFilteredNotes] = useState<NoteMetadata[]>([])

  useEffect(() => {
    if (!tagFilter || !workspacePath) {
      setTagFilteredNotes([])
      return
    }
    let stale = false
    api.notes
      .notesWithTag(workspacePath, tagFilter)
      .then((found) => {
        if (!stale) setTagFilteredNotes(found)
      })
      .catch((err) => {
        if (stale) return
        setTagFilteredNotes([])
        setFolderError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      stale = true
    }
  }, [tagFilter, workspacePath, setFolderError])

  const tree = workspacePath ? buildFolderTree(workspacePath, folders, notes) : []

  return (
    <>
      {folderError && <p className="sidebar-error" role="alert">{folderError}</p>}
      {tagFilter ? (
        <ul className="folder-tree">
          {tagFilteredNotes.map((note) => (
            <li
              key={note.path}
              className="tree-row tree-note"
              tabIndex={0}
              onClick={() => openTab(note.path)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.preventDefault()
                openTab(note.path)
              }}
            >
              <span className="tree-label" title={note.title}>{note.title}</span>
            </li>
          ))}
        </ul>
      ) : workspacePath && tree.length === 0 ? (
        <p className="sidebar-onboarding">
          No notes yet — click <strong>+</strong> above, or Ctrl N, to create your first one.
        </p>
      ) : (
        <FolderTree entries={tree} />
      )}
    </>
  )
}
```

- [ ] **Step 3: Use it in `Sidebar`**

In `src/components/Sidebar.tsx`: delete the `notes`, `folders`, `tagFilter`, `openTab`, `folderError`, `setFolderError`, `tagFilteredNotes` declarations, the tag-filter `useEffect`, the `tree` const, and the JSX from `{folderError && …}` through the `FolderTree` ternary; replace that JSX with `<NoteList />`. Remove the now-unused imports (`useNotesStore`, `FolderTree`, `buildFolderTree`, `api`, `NoteMetadata`, `useState` if unused). Add `import { NoteList } from './NoteList'`. Leave every mobile/drawer line untouched in this task.

- [ ] **Step 4: Verify**

Run: `npm run typecheck; npm test -- src/components/Sidebar.test.tsx src/components/Layout.test.tsx`
Expected: PASS, no test file edited.

- [ ] **Step 5: Commit**

```bash
git add src/components/NoteList.tsx src/components/Sidebar.tsx
git commit -m "refactor(sidebar): extract NoteList so the mobile Notes tab can reuse it"
```

---

### Task 5: `MobileShell`, `MobileTabBar`, `MoreSheet`, `MobileNotes`

**Files:**
- Create: `src/components/MobileShell.tsx`, `MobileTabBar.tsx`, `MoreSheet.tsx`, `MobileNotes.tsx`
- Create: `src/components/MobileShell.test.tsx`
- Modify: `src/components/Layout.tsx`
- Modify: `src/components/Layout.test.tsx` (add one mobile case)
- Modify: `src/index.css` (styles below)

**Interfaces:**
- Consumes: Task 2's `useBackButton`, `MobileTab`; Task 4's `NoteList`; `SidebarHeader` (`{ onSearchOpen, onTemplateOpen, afterAction }`), `TagList`, `SaveStatus`; `OverlayKind` from `useOverlayManager`.
- Produces:
  - `type TabId = 'home' | 'notes' | 'search' | 'review' | 'more'`
  - `MobileTabBar({ active: TabId, hasWorkspace: boolean, onSelect: (id: TabId) => void })`
  - `MoreSheet({ onClose: () => void, onSelect: (kind: OverlayKind) => void, onSyncNow: (() => void) | null, syncing: boolean })`
  - `MobileNotes({ onSearchOpen: () => void, onTemplateOpen: () => void })`
  - `MobileShell(props: MobileShellProps)` with
    ```ts
    interface MobileShellProps {
      activeOverlay: OverlayKind | null
      openOverlay: (kind: OverlayKind) => void
      closeOverlay: () => void
      onReviewOpen: () => void          // Layout clears pendingCram then opens 'review'
      hasWorkspace: boolean
      noteTitle: string
      home: ReactNode                   // <HomeView … />
      editor: ReactNode                 // <EditorPane … />
      saveStatus: ReactNode             // <SaveStatus … />
      gitBars: ReactNode
      overlays: ReactNode               // the existing overlay block
      onSyncNow: (() => void) | null    // null when the workspace is not a repo
      syncing: boolean
    }
    ```

Design notes: the tab union is narrower than the spec's five-way `home | notes | search | review | more` — Search and Review are *openers* of existing overlays (their highlight is derived from `activeOverlay`), More is a sheet flag, so only Home/Notes are real screens (`MobileTab`). The editor screen is `activeTab !== null`, so a note opened from search, Home "Continue" or a wiki-link lands in it with no extra sync state, and the editor's back arrow is `setActiveTab(null)` — the same call desktop's Home button makes.

- [ ] **Step 1: Write the failing `MobileShell` tests**

```tsx
// src/components/MobileShell.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { platform } from '@tauri-apps/plugin-os'
import { onBackButtonPress } from '@tauri-apps/api/app'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { MobileShell } from './MobileShell'
import { useWorkspaceStore } from '../store/workspace'

vi.mock('@tauri-apps/plugin-os', () => ({ platform: vi.fn(() => 'android') }))
vi.mock('@tauri-apps/api/app', () => ({ onBackButtonPress: vi.fn() }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }))
vi.mock('./MobileNotes', () => ({ MobileNotes: () => <div>notes-screen</div> }))

let press: () => void

function setup(over: Partial<React.ComponentProps<typeof MobileShell>> = {}) {
  const props: React.ComponentProps<typeof MobileShell> = {
    activeOverlay: null,
    openOverlay: vi.fn(),
    closeOverlay: vi.fn(),
    onReviewOpen: vi.fn(),
    hasWorkspace: true,
    noteTitle: 'Lecture 7',
    home: <div>home-screen</div>,
    editor: <div>editor-screen</div>,
    saveStatus: <span>saved</span>,
    gitBars: <div>git-bars</div>,
    overlays: <div>overlays</div>,
    onSyncNow: vi.fn(),
    syncing: false,
    ...over,
  }
  const view = render(<MobileShell {...props} />)
  return { props, ...view }
}

beforeEach(() => {
  useWorkspaceStore.setState({ activeTab: null, openTabs: [], repoMode: null })
  vi.mocked(onBackButtonPress).mockImplementation(async (cb) => {
    press = () => cb({ canGoBack: false })
    return { unregister: vi.fn() } as never
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('MobileShell tabs', () => {
  it('starts on Home and switches to Notes', async () => {
    setup()
    expect(screen.getByText('home-screen')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }))
    expect(screen.getByText('notes-screen')).toBeInTheDocument()
    expect(screen.queryByText('home-screen')).not.toBeInTheDocument()
  })

  it('Search and Review open their overlays instead of switching screen', async () => {
    const { props } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(props.openOverlay).toHaveBeenCalledWith('search')
    await userEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(props.onReviewOpen).toHaveBeenCalled()
    expect(screen.getByText('home-screen')).toBeInTheDocument()
  })

  it('highlights the tab whose overlay is open', () => {
    setup({ activeOverlay: 'search' })
    expect(screen.getByRole('button', { name: 'Search' })).toHaveAttribute('aria-current', 'page')
  })
})

describe('MobileShell More sheet', () => {
  it('opens, hands the chosen overlay to openOverlay, and closes', async () => {
    const { props } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(props.openOverlay).toHaveBeenCalledWith('settings')
    expect(screen.queryByRole('button', { name: 'Tasks' })).not.toBeInTheDocument()
  })

  it('offers Sync now only when a sync handler exists', async () => {
    const { unmount } = setup({ onSyncNow: null })
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument()
    unmount()
    const { props } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    expect(props.onSyncNow).toHaveBeenCalled()
  })
})

describe('MobileShell editor screen', () => {
  it('shows the editor, title and save status, and hides the tab bar when a note is active', () => {
    useWorkspaceStore.setState({ activeTab: '/ws/a.md', openTabs: ['/ws/a.md'] })
    setup()
    expect(screen.getByText('editor-screen')).toBeInTheDocument()
    expect(screen.getByText('Lecture 7')).toBeInTheDocument()
    expect(screen.getByText('saved')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
  })

  it('the back arrow leaves the editor but keeps the tab open', async () => {
    useWorkspaceStore.setState({ activeTab: '/ws/a.md', openTabs: ['/ws/a.md'] })
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(useWorkspaceStore.getState().activeTab).toBeNull()
    expect(useWorkspaceStore.getState().openTabs).toEqual(['/ws/a.md'])
    expect(screen.getByText('home-screen')).toBeInTheDocument()
  })
})

describe('MobileShell system Back', () => {
  it('pops overlay, then editor, then non-Home tab, then exits', async () => {
    const close = vi.fn()
    vi.mocked(getCurrentWindow).mockReturnValue({ close } as never)
    useWorkspaceStore.setState({ activeTab: '/ws/a.md', openTabs: ['/ws/a.md'] })
    const { props, rerender } = setup({ activeOverlay: 'settings' })
    await act(async () => {})

    act(() => press())
    expect(props.closeOverlay).toHaveBeenCalledTimes(1)

    rerender(<MobileShell {...props} activeOverlay={null} />)
    act(() => press())
    expect(useWorkspaceStore.getState().activeTab).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Notes' }))
    act(() => press())
    expect(screen.getByText('home-screen')).toBeInTheDocument()

    act(() => press())
    expect(close).toHaveBeenCalledTimes(1)
  })
})

describe('MobileShell without a workspace', () => {
  it('shows the picker slot, disables Search/Review, keeps More reachable', async () => {
    const { props } = setup({ hasWorkspace: false })
    expect(screen.getByText('editor-screen')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Review' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(props.openOverlay).toHaveBeenCalledWith('settings')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- src/components/MobileShell.test.tsx`
Expected: FAIL — cannot resolve `./MobileShell`.

- [ ] **Step 3: `MobileTabBar`**

```tsx
// src/components/MobileTabBar.tsx
import { Home, FolderTree, Search, GraduationCap, Menu, type LucideIcon } from 'lucide-react'

export type TabId = 'home' | 'notes' | 'search' | 'review' | 'more'

interface TabSpec {
  id: TabId
  label: string
  icon: LucideIcon
  needsWorkspace: boolean
}

const TABS: TabSpec[] = [
  { id: 'home', label: 'Home', icon: Home, needsWorkspace: false },
  { id: 'notes', label: 'Notes', icon: FolderTree, needsWorkspace: false },
  { id: 'search', label: 'Search', icon: Search, needsWorkspace: true },
  { id: 'review', label: 'Review', icon: GraduationCap, needsWorkspace: true },
  { id: 'more', label: 'More', icon: Menu, needsWorkspace: false },
]

interface MobileTabBarProps {
  active: TabId
  hasWorkspace: boolean
  onSelect: (id: TabId) => void
}

export function MobileTabBar({ active, hasWorkspace, onSelect }: MobileTabBarProps) {
  return (
    <nav className="mobile-tabbar" aria-label="Main">
      {TABS.map(({ id, label, icon: Icon, needsWorkspace }) => (
        <button
          key={id}
          className={`mobile-tab${id === active ? ' is-active' : ''}`}
          aria-current={id === active ? 'page' : undefined}
          disabled={needsWorkspace && !hasWorkspace}
          onClick={() => onSelect(id)}
        >
          <Icon size={20} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}
```

- [ ] **Step 4: `MoreSheet`**

```tsx
// src/components/MoreSheet.tsx
import { ListChecks, Network, RefreshCw, Settings, Sigma, type LucideIcon } from 'lucide-react'
import type { OverlayKind } from '../hooks/useOverlayManager'

interface Item {
  kind: OverlayKind
  label: string
  icon: LucideIcon
}

const ITEMS: Item[] = [
  { kind: 'task', label: 'Tasks', icon: ListChecks },
  { kind: 'graph', label: 'Graph view', icon: Network },
  { kind: 'formulaSheet', label: 'Formula sheet', icon: Sigma },
  { kind: 'settings', label: 'Settings', icon: Settings },
]

interface MoreSheetProps {
  onClose: () => void
  onSelect: (kind: OverlayKind) => void
  onSyncNow: (() => void) | null
  syncing: boolean
}

export function MoreSheet({ onClose, onSelect, onSyncNow, syncing }: MoreSheetProps) {
  return (
    <>
      <div className="mobile-sheet-backdrop" onClick={onClose} />
      <div className="mobile-sheet" role="dialog" aria-label="More">
        {ITEMS.map(({ kind, label, icon: Icon }) => (
          <button key={kind} className="mobile-sheet-action" onClick={() => onSelect(kind)}>
            <Icon size={18} /> {label}
          </button>
        ))}
        {onSyncNow && (
          <button className="mobile-sheet-action" disabled={syncing} onClick={onSyncNow}>
            <RefreshCw size={18} className={syncing ? 'spin' : ''} /> Sync now
          </button>
        )}
      </div>
    </>
  )
}
```

- [ ] **Step 5: `MobileNotes`**

```tsx
// src/components/MobileNotes.tsx
import { SidebarHeader } from './SidebarHeader'
import { NoteList } from './NoteList'
import { TagList } from './TagList'

interface MobileNotesProps {
  onSearchOpen: () => void
  onTemplateOpen: () => void
}

export function MobileNotes({ onSearchOpen, onTemplateOpen }: MobileNotesProps) {
  return (
    <div className="mobile-notes sidebar-panel">
      <SidebarHeader onSearchOpen={onSearchOpen} onTemplateOpen={onTemplateOpen} afterAction={() => undefined} />
      <NoteList />
      <TagList />
    </div>
  )
}
```

(`SidebarHeader`'s `afterAction` prop is removed in Task 6; update this call then.)

- [ ] **Step 6: `MobileShell`**

```tsx
// src/components/MobileShell.tsx
import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useWorkspaceStore } from '../store/workspace'
import { useBackButton } from '../hooks/useBackButton'
import type { OverlayKind } from '../hooks/useOverlayManager'
import type { MobileTab } from '../lib/backNavigation'
import { MobileTabBar, type TabId } from './MobileTabBar'
import { MoreSheet } from './MoreSheet'
import { MobileNotes } from './MobileNotes'

interface MobileShellProps {
  activeOverlay: OverlayKind | null
  openOverlay: (kind: OverlayKind) => void
  closeOverlay: () => void
  onReviewOpen: () => void
  hasWorkspace: boolean
  noteTitle: string
  home: ReactNode
  editor: ReactNode
  saveStatus: ReactNode
  gitBars: ReactNode
  overlays: ReactNode
  onSyncNow: (() => void) | null
  syncing: boolean
}

function highlightedTab(tab: MobileTab, moreOpen: boolean, overlay: OverlayKind | null): TabId {
  if (moreOpen) return 'more'
  if (overlay === 'search') return 'search'
  if (overlay === 'review' || overlay === 'deck') return 'review'
  return tab
}

export function MobileShell({
  activeOverlay,
  openOverlay,
  closeOverlay,
  onReviewOpen,
  hasWorkspace,
  noteTitle,
  home,
  editor,
  saveStatus,
  gitBars,
  overlays,
  onSyncNow,
  syncing,
}: MobileShellProps) {
  const [tab, setTab] = useState<MobileTab>('home')
  const [moreOpen, setMoreOpen] = useState(false)
  const activeTab = useWorkspaceStore((s) => s.activeTab)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const editorOpen = hasWorkspace && activeTab !== null

  // Dialogs portal to <body>, outside .app-shell, so full-screen overlay CSS
  // keys off the root element rather than a wrapper class.
  useEffect(() => {
    document.documentElement.dataset.shell = 'mobile'
    return () => {
      delete document.documentElement.dataset.shell
    }
  }, [])

  useBackButton(
    { overlayOpen: activeOverlay !== null, sheetOpen: moreOpen, editorOpen, tab },
    {
      'close-overlay': closeOverlay,
      'close-sheet': () => setMoreOpen(false),
      'close-editor': () => setActiveTab(null),
      'go-home': () => setTab('home'),
    },
  )

  function selectTab(id: TabId) {
    if (id === 'search') openOverlay('search')
    else if (id === 'review') onReviewOpen()
    else if (id === 'more') setMoreOpen(true)
    else setTab(id)
  }

  function selectFromSheet(kind: OverlayKind) {
    setMoreOpen(false)
    openOverlay(kind)
  }

  const screen = !hasWorkspace ? editor : tab === 'notes'
    ? <MobileNotes onSearchOpen={() => openOverlay('search')} onTemplateOpen={() => openOverlay('template')} />
    : home

  return (
    <div className="app-shell mobile-shell">
      {overlays}
      {editorOpen ? (
        <>
          <header className="mobile-topbar">
            <button className="mobile-topbar-back" aria-label="Back" onClick={() => setActiveTab(null)}>
              <ArrowLeft size={20} />
            </button>
            <span className="mobile-topbar-title">{noteTitle}</span>
            {saveStatus}
          </header>
          {gitBars}
          <main className="mobile-screen mobile-screen--editor">{editor}</main>
        </>
      ) : (
        <>
          <main className="mobile-screen">{screen}</main>
          <MobileTabBar
            active={highlightedTab(tab, moreOpen, activeOverlay)}
            hasWorkspace={hasWorkspace}
            onSelect={selectTab}
          />
        </>
      )}
      {moreOpen && (
        <MoreSheet
          onClose={() => setMoreOpen(false)}
          onSelect={selectFromSheet}
          onSyncNow={onSyncNow}
          syncing={syncing}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 7: Run to verify the shell tests pass**

Run: `npm test -- src/components/MobileShell.test.tsx`
Expected: PASS (all 9 tests). If `SaveStatus`/`MobileNotes` imports pull in Tauri modules, the `vi.mock` lines at the top already stub `./MobileNotes`; add stubs rather than loosening assertions.

- [ ] **Step 8: Styles**

Append to `src/index.css` (after the `.sidebar--drawer` block; it is deleted in Task 6, these stay):

```css
/* Phone shell: screen above a bottom tab bar, or a full-screen editor. */
.mobile-shell { padding-left: var(--safe-left); padding-right: var(--safe-right); }

.mobile-screen {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-top: var(--safe-top);
}

.mobile-screen--editor { padding-top: 0; display: flex; flex-direction: column; }

.mobile-tabbar {
  display: flex;
  flex-shrink: 0;
  background: var(--bg-raised);
  border-top: 1px solid var(--border);
  padding-bottom: var(--safe-bottom);
}

.mobile-tab {
  flex: 1;
  min-height: 56px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  background: none;
  border: none;
  color: var(--text-tertiary);
  font-size: 11px;
}

.mobile-tab.is-active { color: var(--accent); }
.mobile-tab:disabled { opacity: 0.4; }

.mobile-topbar {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-shrink: 0;
  padding: var(--safe-top) var(--space-sm) 0;
  min-height: calc(48px + var(--safe-top));
  background: var(--bg-raised);
  border-bottom: 1px solid var(--border);
}

.mobile-topbar-back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  background: none;
  border: none;
  color: var(--text-secondary);
}

.mobile-topbar-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  color: var(--text-primary);
}

.mobile-notes { width: 100%; border-right: 0; }

.mobile-sheet-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 90;
}

.mobile-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 91;
  display: flex;
  flex-direction: column;
  padding: var(--space-sm) var(--space-sm) calc(var(--space-sm) + var(--safe-bottom));
  background: var(--bg-raised);
  border-top: 1px solid var(--border-strong);
  border-radius: 12px 12px 0 0;
  box-shadow: var(--shadow-modal);
}

.mobile-sheet-action {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  min-height: 48px;
  padding: 0 var(--space-md);
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: 15px;
  text-align: left;
}

.mobile-sheet-action:disabled { opacity: 0.5; }
```

Then confirm every new class exists:

```bash
for c in mobile-shell mobile-screen mobile-screen--editor mobile-tabbar mobile-tab mobile-topbar mobile-topbar-back mobile-topbar-title mobile-notes mobile-sheet-backdrop mobile-sheet mobile-sheet-action; do grep -q "\.$c\b" src/index.css || echo "MISSING $c"; done
```

Expected: no output. Also confirm the tokens exist: `grep -c -e '--space-sm' -e '--space-md' -e '--shadow-modal' -e '--accent' src/index.css` is non-zero for each (they are used elsewhere in the file).

- [ ] **Step 9: Hoist `Layout`'s overlays and git bars, and return `MobileShell` on mobile**

In `src/components/Layout.tsx`:

1. Import `MobileShell`, `SaveStatus`, `HomeView` is already imported.
2. Immediately before `return (` at the bottom, define the three nodes by **moving** (not rewriting) existing JSX:

```tsx
  const overlays = (
    <>
      {activeOverlay === 'search' && <SearchModal onClose={closeOverlay} />}
      {/* …the existing block from 'switcher' through the diagramPicker overlay, byte-for-byte, including <PromptDialog />, <ToastStack /> and the <Suspense> export/print block … */}
    </>
  )

  const gitBars = (
    <>
      {/* …the existing gitDiverged / gitPullBlocked / gitAhead / GitAutoCommitPrompt blocks, byte-for-byte … */}
    </>
  )
```

   and in the desktop return replace those two regions with `{overlays}` and `{gitBars}`. The rendered DOM is unchanged.

3. Add, right after those consts:

```tsx
  if (mobile) {
    return (
      <TooltipProvider>
        <MobileShell
          activeOverlay={activeOverlay}
          openOverlay={openOverlay}
          closeOverlay={closeOverlay}
          onReviewOpen={() => {
            setPendingCram(null)
            openOverlay('review')
          }}
          hasWorkspace={workspacePath !== null}
          noteTitle={currentNote?.title ?? ''}
          home={
            <HomeView
              onOpenTaskView={() => openOverlay('task')}
              onOpenReview={() => {
                setPendingCram(null)
                openOverlay('review')
              }}
              onOpenDeckView={() => openOverlay('deck')}
              onOpenSettings={() => openOverlay('settings')}
              overlayOpen={activeOverlay !== null}
            />
          }
          editor={primaryEditorPane}
          saveStatus={
            <SaveStatus state={saveState} error={saveError} onRetry={() => void retrySave()} onDismiss={dismissError} />
          }
          gitBars={gitBars}
          overlays={overlays}
          onSyncNow={repoMode ? () => void syncNow() : null}
          syncing={syncingNow}
        />
      </TooltipProvider>
    )
  }
```

   where `primaryEditorPane` is the existing primary `<EditorPane … />` element **extracted into a const** (same props as today; the desktop `.pane-wrapper` renders `{primaryEditorPane}` in its place). The `mobile` hook-order rule holds because every hook is called above this early return.

4. In `src/components/Layout.test.tsx` add (reusing the file's existing `render`/store setup and `platform` import):

```tsx
  it('renders the phone shell instead of the desktop chrome on mobile', async () => {
    vi.mocked(platform).mockReturnValue('android')
    const { container } = render(<Layout />)
    expect(container.querySelector('.mobile-shell')).not.toBeNull()
    expect(container.querySelector('.titlebar')).toBeNull()
    expect(container.querySelector('aside.sidebar')).toBeNull()
    vi.mocked(platform).mockReturnValue('windows')
  })
```

   and add `vi.mock('@tauri-apps/api/app', () => ({ onBackButtonPress: vi.fn().mockResolvedValue({ unregister: vi.fn() }) }))` to the file's mock block.

- [ ] **Step 10: Remove the interim Back wiring from `Layout`**

Delete the Task 2 Step 9 `useBackButton(...)` call and its import from `Layout.tsx` (the shell now owns Back on mobile; desktop never used it).

- [ ] **Step 11: Verify**

Run: `npm run typecheck; npm test`
Expected: PASS, including the unmodified desktop `Layout.test.tsx` cases.

- [ ] **Step 12: Commit**

```bash
git add src/components/MobileShell.tsx src/components/MobileTabBar.tsx src/components/MoreSheet.tsx src/components/MobileNotes.tsx src/components/MobileShell.test.tsx src/components/Layout.tsx src/components/Layout.test.tsx src/index.css
git commit -m "feat(mobile): add a bottom-tab phone shell with a full-screen editor and More sheet"
```

---

### Task 6: Remove the drawer

**Files:**
- Delete: `src/store/mobileSidebar.ts`, `src/store/mobileSidebar.test.ts`
- Modify: `src/components/Sidebar.tsx`, `SidebarRail.tsx`, `SidebarHeader.tsx`, `Titlebar.tsx`, `MobileNotes.tsx`, `Layout.tsx`
- Modify: `src/components/Sidebar.test.tsx`, `Titlebar.test.tsx` (delete only the mobile `describe` blocks)
- Modify: `src/index.css`

**Interfaces:**
- Consumes: Task 5's shell (nothing on mobile renders `Sidebar`/`Titlebar` any more).
- Produces: desktop-only `Sidebar`, `SidebarRail` (no `bar`, no `afterAction`), `SidebarHeader` (no `afterAction`), `Titlebar` (no mobile branches).

- [ ] **Step 1: Delete the tests that describe the removed behaviour**

In `Sidebar.test.tsx` delete the `describe('Sidebar drawer on mobile', …)` block (line ~150) and its `useMobileSidebarStore`/`platform` imports and mock if no longer used. In `Titlebar.test.tsx` delete `describe('Titlebar on mobile', …)` (line ~93) and the same now-unused imports. Run `npm test -- src/components/Sidebar.test.tsx src/components/Titlebar.test.tsx`; Expected: PASS (desktop cases only).

- [ ] **Step 2: Strip the mobile branches**

- `Sidebar.tsx`: remove `isMobile`/`useMobileSidebarStore` imports, `mobile`, `drawerOpen`, `closeDrawer`, `isFirstRender` + its effect, `closeIfMobile`, `afterAction` from `railProps`, the `sidebar--drawer`/`sidebar--open` class branch, the trailing `{mobile && <SidebarRail bar … />}`, and `inert={!mobile && collapsed}` → `inert={collapsed}`; render `<SidebarRail {...railProps} />` unconditionally and drop the now-unused `useRef`/`useEffect` imports.
- `SidebarRail.tsx`: remove the `bar` prop, the `if (bar)` branch, `afterAction` and the `run()` wrapper (use `onClick: action` directly), and the `home` item's `run(...)` wrapping.
- `SidebarHeader.tsx`: remove the `afterAction` prop and its calls (`onSelect={() => { void openWorkspaceAt(p) }}` etc.).
- `MobileNotes.tsx`: drop `afterAction={() => undefined}`.
- `Titlebar.tsx`: remove the `Menu` icon import, `isMobile`, `useMobileSidebarStore`, the hamburger button, the `{!mobile && …}` gate around window controls (always render them), and `buildViewMenu(mobile)` → restore the constant `VIEW_MENU` array with the terminal entry (the titlebar never renders on a phone now).
- `Layout.tsx`: remove the `useMobileSidebarStore` import and its two reads, the `sidebar-backdrop` JSX, and the `if (mobile) return` inside the Sidebar's `onTerminalToggle` (Sidebar never renders on mobile). Keep `const mobile = isMobile()` — the `toggle-terminal` shortcut guard and the mobile early return still use it.
- `git rm src/store/mobileSidebar.ts src/store/mobileSidebar.test.ts`.

- [ ] **Step 3: Remove the dead CSS**

Delete from `src/index.css`: `.sidebar-backdrop`, `.sidebar--drawer`, `.sidebar--drawer.sidebar--open`, `.sidebar--drawer .sidebar-panel`, `.sidebar--drawer .sidebar-panel > *`, `.sidebar-rail--bar`, `.sidebar .sidebar-rail--bar .rail-btn`, `.titlebar-menu-toggle`, and the `.titlebar`/`.titlebar-btn` rules inside the `@media (hover: none)` block that Task 1 touched (delete the whole block). Keep the `.sidebar button` / `.toolbar-button` / `.dialog-action` hover:none rules — overlays and the editor still use them.

- [ ] **Step 4: Verify nothing references what was removed**

```bash
git grep -n "mobileSidebar\|sidebar--drawer\|sidebar-rail--bar\|sidebar-backdrop\|titlebar-menu-toggle\|afterAction" -- src
```

Expected: no output. Then `npm run typecheck; npm test` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "refactor(mobile): remove the sidebar drawer now that the tab shell replaces it"
```

## Phase 3 — Screen restyles

### Task 7: Full-screen overlays, bottom editor toolbar, 44 px targets (#118)

**Files:**
- Modify: `src/index.css`

**Interfaces:** Consumes the `[data-shell='mobile']` attribute set by `MobileShell` (Task 5) and `--safe-*` (Task 1). Produces nothing downstream.

CSS-only, so the check is measurement (Task 9) plus the className grep. Overlay panels that render through plain `.search-overlay` wrappers are `.graph-view`, `.task-view` (also used by `DeckView`), `.review-session`, `.formula-sheet-prompt`; Settings and the command palettes render through shadcn `DialogContent` (Tailwind-centred), so they need their centring reset with `translate`/`scale`, not `transform` (see `project_tailwind_v4_transform_reset`).

- [ ] **Step 1: Full-screen overlay rules**

Append to `src/index.css`:

```css
/* Phone: every overlay is a full screen with the close control first (left),
   not a centred card. */
[data-shell='mobile'] .settings-panel,
[data-shell='mobile'] .search-modal,
[data-shell='mobile'] .graph-view,
[data-shell='mobile'] .task-view,
[data-shell='mobile'] .review-session,
[data-shell='mobile'] .formula-sheet-prompt {
  position: fixed;
  inset: 0;
  translate: none;
  scale: none;
  width: 100%;
  max-width: none;
  height: 100dvh;
  max-height: none;
  border: 0;
  border-radius: 0;
  padding-top: calc(var(--space-lg) + var(--safe-top));
  padding-bottom: calc(var(--space-lg) + var(--safe-bottom));
}

[data-shell='mobile'] .settings-panel-header { flex-direction: row; }
[data-shell='mobile'] .settings-panel-close {
  order: -1;
  min-width: 44px;
  min-height: 44px;
}
```

Run `grep -n "CommandDialog" src/components/SearchModal.tsx src/components/QuickSwitcher.tsx` and confirm both pass `className="search-modal"` (SearchModal does, line 71); if `QuickSwitcher` uses a different class, add it to the selector list above.

- [ ] **Step 2: Editor toolbar pinned above the keyboard**

```css
/* The viewport bottom is the keyboard top (MainActivity lifts the WebView), so
   a fixed bottom bar sits directly on the IME. The scroll area gets matching
   bottom padding so the last line is never under it. */
[data-shell='mobile'] .editor-toolbar {
  position: fixed;
  top: auto;
  bottom: 0;
  left: 0;
  right: 0;
  margin: 0;
  padding: 6px var(--space-sm) calc(6px + var(--safe-bottom));
  border-top: 1px solid var(--border);
  border-bottom: 0;
  z-index: 20;
}

[data-shell='mobile'] .mobile-screen--editor .editor-scroll {
  padding-bottom: calc(56px + var(--safe-bottom));
}
```

- [ ] **Step 3: 44 px targets for rows**

```css
@media (hover: none) {
  .tree-row { min-height: 44px; }
  .mobile-sheet-action { min-height: 48px; }
  .nav-history button { min-width: 44px; min-height: 44px; }
}
```

(The tab-bar items, top-bar back arrow and sheet actions were already sized in Task 5; the rail buttons that #118 names no longer exist after Task 6.)

- [ ] **Step 4: Confirm every class used exists, and run the suite**

```bash
for c in settings-panel search-modal graph-view task-view review-session formula-sheet-prompt settings-panel-header settings-panel-close editor-toolbar editor-scroll tree-row; do grep -q "\.$c\b" src/index.css || echo "MISSING $c"; done
npm run typecheck; npm test
```

Expected: no `MISSING` lines; tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.css
git commit -m "feat(mobile): full-screen overlays, keyboard-top editor toolbar and 44px rows (#118)"
```

---

### Task 8: Home overflow (#119)

**Files:**
- Modify: `src/index.css` (`.home-section--primary`, ~line 4708)

- [ ] **Step 1: Stop the primary card forcing a second column on a narrow screen**

A `span 2` item in an `auto-fit, minmax(240px, 1fr)` grid creates an implicit second column even when only one 240 px track fits, which is the 9 px overflow at 393 px. Replace the rule's `grid-column: span 2;` with the span applied only when two tracks fit:

```css
.home-section--primary {
  padding: var(--space-lg) var(--space-lg) var(--space-md);
}

@media (min-width: 560px) {
  .home-section--primary { grid-column: span 2; }
}
```

(Desktop windows are ≥ 560 px, so desktop keeps the two-column span; the existing desktop minimum window width is above that. Confirm with `grep -n "minWidth" src-tauri/tauri.conf.json`.)

- [ ] **Step 2: Verify the desktop minimum is not below the breakpoint**

Run: `grep -n "minWidth" src-tauri/tauri.conf.json`
Expected: a value ≥ 560. If lower, set the media query to that value so desktop stays identical.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "fix(mobile): keep the Home dashboard inside a 393px viewport (#119)"
```

---

### Task 9: Emulator verification and close-out

**Files:**
- Modify: `docs/plans/mobile-native-shell.md` (append the result)
- Modify: `docs/ROADMAP.md` (P16 Android entry, only if one tracks this)

Procedure and helper functions (calibration, tap-by-selector, screencap) are `docs/plans/android-parity-shell-verification.md` Task 1; reuse them, do not rewrite.

- [ ] **Step 1: Build, install, launch, clone the fixture workspace** (Task 1 Step 4 commands).

- [ ] **Step 2: Measure each finish-line criterion over the DevTools socket**

| Criterion | Evaluate | Pass |
|---|---|---|
| Inside system bars | `.mobile-tabbar` and `.mobile-topbar` rects vs `innerHeight`; `--safe-top` probe | tab bar bottom ≤ `innerHeight − navbar`; top-bar back button centre ≥ status-bar height |
| Tab bar targets | every `.mobile-tab` rect | width ≥ 44 and height ≥ 44 |
| Rows / sheet / back arrow | `.tree-row`, `.mobile-sheet-action`, `.mobile-topbar-back` rects | height ≥ 44 |
| Home overflow | `document.documentElement.scrollWidth` vs `innerWidth` on Home | equal |
| Keyboard | focus last line of a 30-line note, `adb shell input text`; caret rect bottom vs `.editor-toolbar` top; toolbar bottom vs `innerHeight` | caret bottom ≤ toolbar top; toolbar bottom within 1 px of `innerHeight` |
| Back order | open Settings from More; `KEYCODE_BACK` ×4 (overlay → sheet gone → editor → exit), also Notes tab → Back → Home | each press changes exactly one layer; `pidof` empty only after the last |
| Back keeps edits | type in a note, Back, reopen from Notes | typed text present |

If the keyboard row shows the toolbar floating `navbar-height` px **above** the IME (double padding: WebView lifted by `ime.bottom` *and* `--safe-bottom` padding), change the toolbar rule's bottom padding in Task 7 Step 2 to `6px` and keep `--safe-bottom` only for the closed-keyboard case by setting the native padding to `maxOf(0, ime.bottom - bars.bottom)` — apply exactly one of the two fixes, re-measure, and note which in the result.

- [ ] **Step 3: Screenshots**

`adb shell screencap` Home, Notes, editor with keyboard open, More sheet, Settings full-screen; view each and compare spacing against a reference element (e.g. the tab bar's item gap against `.mobile-sheet-action` padding), not just that classes exist.

- [ ] **Step 4: Run the full suites**

```bash
npm run typecheck; npm test
cd src-tauri; cargo clippy -- -D warnings; cargo fmt --check
```

Expected: all clean (`cargo` only matters if the Task 2 `exit_app` fallback was taken).

- [ ] **Step 5: Record the result**

Append a `**Result:**` paragraph below this step listing each table row with the measured values, which conditional branches were taken (Task 1 Step 5; Task 2 Step 10 exit fallback; Task 9 keyboard-padding fix), and: *iOS behaviour unverified — WKWebView does not resize for the keyboard, so Task 3's `visualViewport` fallback is untested on iOS and may need `Keyboard` insets there.* Close #115–#119 with `gh issue close <n> --repo TorresVisual/null-notes --comment "<commit hash>"` only after the user confirms.

- [ ] **Step 6: Commit**

```bash
git add docs/plans/mobile-native-shell.md docs/ROADMAP.md
git commit -m "docs(mobile): record the phone-native shell emulator result"
```

---

## Out of scope (this plan)

- **Tablet / stylus-first layouts, split panes, terminal, outline, title-bar menu on phones** — spec "Not in scope"; tablets get the phone layout.
- **iOS builds and CI** — iOS keyboard and safe-area behaviour are recorded unverified (no macOS minutes spent).
- **Per-dialog content redesign** — overlays go full-screen with a left-aligned close button; the content inside Settings/Graph/Tasks keeps its current layout.
- **Back-arrow glyph on overlays** — the spec asks for a back arrow; this plan reorders the existing `X` close button to the left (CSS only). Swapping the icon means editing each dialog's header (`SettingsPanel`, `GraphView`, `TaskView`, `DeckView`, `ReviewSession`, …); add if the `X` on the left reads wrong on device.
