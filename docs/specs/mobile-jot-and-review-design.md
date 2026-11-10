# Mobile: jot, read and review (first slice of #228)

## Intent

The maintainer has barely used the phone build because the UI is the desktop UI squeezed down. On a phone they want three things: jot a quick note, read notes, review flashcards. They do not write at length on it. This slice makes those three comfortable. The rest of #228 (tabs, split panes, graph, canvas/base views, ink/table/PDF touch editing) stays open and follows later.

## What exists today (checked in code)

- `MobileShell` already provides a bottom tab bar (Home, Notes, Search, Review, More), a full-screen editor with a top bar and Back button, and a More sheet.
- `EditorToolbar` is the desktop toolbar reused on mobile: pinned to the bottom by `[data-shell='mobile'] .editor-toolbar` in `src/index.css`, horizontally scrolling. There is no bubble menu in `NoteEditor`; the issue text is wrong on that point. Slash menu and block handles are separate surfaces.
- `useKeepCaretVisible` / `caretScrollProps` keep the caret clear of the toolbar.
- `HomeView` already lists Continue, Recent, open tasks and due cards; the phone shell shows it as the Home tab.
- Notes open editable, always.

## Goals

1. A note opens in **read mode**: not editable, no keyboard, no toolbar. Scrolling and tapping never start an edit.
2. A **pencil button** (lower-right) enters edit mode: keyboard up, phone-sized toolbar above it. **Done** leaves edit mode.
3. A **+ button** creates a new blank note and opens it **already in edit mode**, no title prompt. The note is named `Quick note YYYY-MM-DD HH-MM` (hyphen: the backend turns `:` in a title into `-` for the filename) and keeps that name (no rename from the first line: a note's title is its filename, and renaming would break the one-buffer-per-path rule, tabs, wiki-links, sidecars and the index). If the user leaves with nothing typed beyond the generated heading, the file is deleted so no empty notes pile up in the synced folder. + is on Home and Notes, lower-right above the tab bar, and creates in the folder being browsed or the workspace root.
4. **Home** is review-first. The top card is the single best next action:
   - flashcards due: "N cards due, start review";
   - otherwise: "pick up where you left off" with the last-edited note (plus "All caught up" when the workspace has cards but none are due);
   - a workspace with no flashcards never shows review UI on Home.
   Below it: Continue, Recent, Open tasks. Review stops being a bottom tab; the tabs become Home, Notes, Search, More.
5. The edit toolbar on a phone is a **phone-sized subset**, not the desktop strip.

## Non-goals

- No rewrite of the mobile shell. No changes to desktop.
- Not in this slice: split panes, graph view, canvas/base views, ink/table/code-block/PDF touch editing, settings at phone width, Obsidian parity (#229), iOS-specific work (#230).
- Not in this slice, but expected next: the review screen (and likely every other view) needs its own mobile pass; the maintainer expects touch-sized grading and tap-to-reveal work. This slice only changes how review is reached.
- Renaming a note from its first line.

## Anti-goals

- Reading must never place a caret or raise the keyboard.
- A mode switch must never lose or overwrite text. Read/edit is a UI state; the note buffer, save path and watcher behaviour stay exactly as in CLAUDE.md "The save path".

## Constraints

- One buffer per note path (`src/store/noteBuffers.ts`); read mode must not give a view its own copy of the content. Toggling editability on the existing editor instance is the intended mechanism.
- Interactive content must still work in read mode: task checkboxes, links and wiki-links, opening an ink block. Each is verified individually; toggling a checkbox in read mode writes through the normal save path.
- Platform gate is `isMobile()` in `src/lib/platform.ts`. Desktop behaviour is untouched.
- Styling follows CLAUDE.md: app shell on Tailwind/shadcn bridged tokens, editor surface on plain CSS in `src/index.css`. Grep `index.css` for every new className before calling UI done.
- Verification is by screenshot on a device or emulator; `ui-preview` and `e2e-verify` cannot test touch. The author cannot see a device, so each step names what the maintainer should look at.

## Approaches considered (read/edit)

- **A. Focus-driven.** Editor always editable; toolbar shows on focus. Smallest change, but every tap while reading places a caret and raises the keyboard.
- **B. Explicit read/edit toggle (chosen).** Non-editable by default via TipTap `setEditable(false)`; pencil enters, Done leaves. Safe reading; costs per-element checks for checkboxes, links and ink in read mode.
- **C. Tap-to-edit.** Tap text to edit at that spot. Natural, but a scroll misread as a tap starts an accidental edit, and it is harder to get right on touch.

Chosen by the maintainer: B.

## Decided by the maintainer

- Read mode is the default; toolbar hidden until edit.
- Home shows the best next action as one large top card, as in the mockups (review-first), adapting to workspaces without flashcards.
- Quick-capture + opens a blank note in edit mode, named `Quick note <date time>`, deleted if left untouched.
- The review screen and the other views need a mobile pass of their own, after this slice.

## My calls (not yet confirmed)

- Review leaves the bottom tab bar (Home, Notes, Search, More) but stays reachable from the More sheet, so "All caught up" is not a dead end.
- Every route into a note (Notes, Search, Home cards, wiki-links, app resume) opens it in read mode; only + opens in edit mode. No per-note memory of the last mode.
- When the top Home card shows the last-edited note, the Continue list omits it.
- Order of work: read/edit mode and phone toolbar first, then Home.

## Left to the builder

- Which actions the phone toolbar keeps (guide: undo/redo, bold, italic, heading, list, task, link, Insert menu) and what moves behind a "more" control.
- Exact placement and animation of the pencil and Done controls, and how they sit with the safe-area inset and the keyboard.
- Whether the toolbar rides the keyboard via `visualViewport`/`interactive-widget` or stays `position: fixed`; `useKeepCaretVisible` currently has no `visualViewport` handling for the toolbar itself.
- How the existing "open note → editor" paths (`useBackButton`, `MobileShell`) reset to read mode when switching notes.
