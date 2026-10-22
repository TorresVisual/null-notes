# Phone-native mobile shell

## Goal

The phone UI should feel phone-native. Today it is the desktop shell with the sidebar turned into a drawer and the window chrome hidden (`mobile-app-shell-reflow.md`); navigation, safe areas, the keyboard and Back all still behave like a squeezed desktop. This pass replaces the drawer with a bottom tab bar and a full-screen editor, and folds in the open Android shell issues #115-#119.

**Finish line:** on the Android emulator, every screen below renders inside the system bars, the soft keyboard never covers the line being typed, system Back walks overlay → editor → non-Home tab → exit, and every tappable target is at least 44 px. Desktop renders byte-identical to today.

**Not in scope:** tablet or stylus-first layouts (tablets get the phone layout), ink canvas changes beyond keyboard handling, iOS builds or CI runs (iOS behaviour is recorded as unverified), split panes, terminal, outline panel and title-bar menu on phones (already cut by `mobile-feature-cuts.md`).

## Architecture

`Layout` stays the controller. It owns the close-requested flush, git polling and sync, workspace startup, overlays and note buffers, none of which should be duplicated. When `isMobile()` is true its returned JSX is replaced by `<MobileShell />`, which receives overlay openers, `syncNow`, the note state and the git bars as props. Desktop JSX is untouched, so `Layout.test.tsx` keeps passing as-is.

`MobileShell` is a view only. It holds the active tab (`home | notes | search | review | more`) and whether the editor screen is open.

The drawer is removed: `src/store/mobileSidebar.ts` and the `mobile` branches in `Sidebar`, `Titlebar` and `SidebarRail`, which become desktop-only.

Rejected: a shared `useAppSession` hook extracted from `Layout` (cleaner, but a refactor of desktop code for no desktop benefit); CSS-only reflow (cannot change navigation).

## Screens

| Tab | Screen | Built from |
|---|---|---|
| Home | landing page | `HomeView`, with the #119 overflow fix |
| Notes | file tree as a full page plus a "new note" button; tapping a note opens the editor screen | `FolderTree`, taller rows (#118) |
| Search | existing search overlay, full-screen | `SearchModal` |
| Review | existing review/deck flow, full-screen | `DeckView` / `ReviewSession` |
| More | bottom sheet: Tasks, Graph, Formula sheet, Settings, each opening its existing overlay | new `MoreSheet` |

- Overlays render full-screen with a back arrow instead of as centred dialogs. `useOverlayManager` is unchanged.
- **Editor screen:** tab bar hidden. A back arrow, the note title and save status in the top bar; git bars above the editor; formatting toolbar above the keyboard.
- **Safe areas (#115):** `viewport-fit=cover` in `index.html`; top bar and tab bar pad with `env(safe-area-inset-*)`.
- **Back (#116):** a single handler pops overlay, then editor, then a non-Home tab, then exits. Needs a native hook in `MainActivity.kt` unless Tauri exposes a back-button event.

## Keyboard and touch targets

- **Keyboard (#117):** `windowSoftInputMode="adjustResize"` in `AndroidManifest.xml` so the WebView shrinks above the IME; the toolbar pins to the bottom of the resized viewport and the caret is scrolled into view on focus. A `visualViewport` listener is the shared fallback; iOS WKWebView does not resize like this and is unverified.
- **Touch targets (#118):** tab-bar items, list rows and sheet actions are at least 44 px.

## Testing and verification

- Vitest component tests with `isMobile()` mocked: tab switching, editor open/back transitions, Back-handler order, the More sheet, and a desktop-unchanged check on `Layout`.
- Screenshots on the Android emulator, compared against a reference element rather than only checking that classNames exist. Every new className is grepped in `src/index.css` before a screen counts as done; the tab bar and sheet use the existing design tokens.

## Build order

1. Safe areas, keyboard and Back (#115-#117): usable on their own.
2. `MobileShell`, tab bar, `MoreSheet`, drawer removal.
3. Screen restyles: full-screen overlays, taller rows, Home overflow (#118, #119).

Each step leaves the app usable.
