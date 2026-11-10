# Mobile Jot-and-Review Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** On the phone shell, notes open read-only with a pencil to edit, + creates a quick note already in edit mode, and Home leads with one "best next action" card.

**Architecture:** Read/edit is UI state only: a small Zustand store holds the one path being edited, and `NoteEditor` calls `editor.setEditable()` on the existing editor instance, so buffers, the save path and the watcher are untouched. Everything is gated on `isMobile()`; desktop behaviour does not change.

**Tech Stack:** React 19, TypeScript strict, TipTap 3, Zustand, Vitest + Testing Library, Tailwind v4/plain CSS in `src/index.css`.

**Spec:** `docs/specs/mobile-jot-and-review-design.md`

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

- A note opens **read-only**; only the + flow opens one already in edit mode. No per-note memory of the mode.
- Read mode never places a caret or raises the keyboard.
- Read/edit never touches note content, buffers (`src/store/noteBuffers.ts`), `write_atomic`, or the watcher. One buffer per path stays true.
- Quick-note title is `Quick note YYYY-MM-DD HH-MM` (hyphen, not colon: the backend's `safe_stem` turns `:` into `-`, which would make the title differ from the filename). Folder: `selectedFolder ?? workspacePath`. Deleted if left with nothing typed beyond the generated `# <title>` heading.
- Bottom tabs become Home, Notes, Search, More. Review is reachable from the More sheet.
- Every new className must exist in `src/index.css` before the task is done (CLAUDE.md "Styling"). Shell chrome is plain CSS classes there, as `.mobile-tabbar` / `.mobile-sheet` are.
- No `any`, no `!`, no `.unwrap()`; no comments unless the WHY is non-obvious.
- Each task ends green on `npm run typecheck`, `npm run lint` and `npm test`.
- Commit per task, message style `feat(mobile): …`, no push.

## Review Focus

1. **Back out of edit mode, open another note** — the second note must open read-only (state resets on leaving the editor). Test in Task 2.
2. **Content arriving while read-only** (external edit, peer view, conflict reload) — the content-sync effect must still update a non-editable editor. Test in Task 2.
3. **Abandoned quick note** — heading-only is deleted; any other text is kept; text typed then erased back to the heading is deleted. Test in Task 6.
4. **Double-tap on +** — exactly one note is created (`useCreateNote` already holds an `inFlight` guard; keep it in the path). Test in Task 6.
5. **Workspace with no notes and no flashcards** — Home shows no hero and no review UI, and + still works. Test in Task 8.

---

### Task 1: Edit-mode store

**Files:**
- Create: `src/store/mobileEdit.ts`
- Test: `src/store/mobileEdit.test.ts`

**Interfaces:**
- Produces: `useMobileEditStore` (Zustand) with `editingPath: string | null`, `startEditing(path: string): void`, `stopEditing(): void`.

- [ ] **Step 1: Write the failing test** — `startEditing('a.md')` sets `editingPath` to `'a.md'`; `startEditing('b.md')` replaces it; `stopEditing()` returns it to `null`.
- [ ] **Step 2: Run** `npx vitest run src/store/mobileEdit.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the store as specified. No persistence.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): edit-mode store`.

### Task 2: Read mode, pencil and Done in `NoteEditor`

**Files:**
- Create: `src/editor/MobileEditToggle.tsx`, `src/editor/useMobileEditMode.ts`
- Modify: `src/editor/NoteEditor.tsx` (toolbar render at the bottom, near `<EditorToolbar …/>`), `src/components/MobileShell.tsx` (`close-editor` handler), `src/index.css`
- Test: `src/editor/mobileEditMode.test.tsx`

**Interfaces:**
- Consumes: `useMobileEditStore` (Task 1); `isMobile()` from `src/lib/platform.ts`.
- Produces: `useMobileEditMode(editor: Editor | null, notePath: string): { readOnly: boolean; startEditing: () => void; stopEditing: () => void }`. `readOnly` is `isMobile() && editingPath !== notePath`. `MobileEditToggle({ readOnly, onEdit, onDone })` renders a button named **Edit note** when read-only, **Done** otherwise.

- [ ] **Step 1: Write the failing tests** (mount through `useEditor`/`EditorContent` with the same `editorProps` as `NoteEditor`, per CLAUDE.md; mock `platform()` to `'android'`):
  - the `textbox` has `contenteditable="false"` and no `role="toolbar"` is rendered;
  - clicking **Edit note** makes the textbox editable, renders the toolbar, and clicking **Done** reverses both;
  - with `editingPath` set to a different note's path, this note is still read-only (Review Focus 1);
  - re-rendering with a new `content` prop while read-only updates the displayed text (Review Focus 2);
  - with `platform()` `'windows'` the editor is editable and no pencil is rendered.
- [ ] **Step 2: Run** `npx vitest run src/editor/mobileEditMode.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** `useMobileEditMode`: an effect calls `editor.setEditable(!readOnly)`. `startEditing` also calls `editor.commands.focus()` so the keyboard rises; `stopEditing` blurs. In `NoteEditor`, render `<EditorToolbar>` only when `!readOnly` and render `MobileEditToggle` only on mobile. In `MobileShell`'s `close-editor` handler call `useMobileEditStore.getState().stopEditing()` before `setActiveTab(null)`.
- [ ] **Step 4: Add CSS** for `.mobile-edit-toggle` (lower-right, above `var(--safe-bottom)`, 44px minimum target, shown in both states; in edit mode it sits above the bottom toolbar) in the mobile block near `src/index.css:568`.
- [ ] **Step 5: Run** the tests plus `npx vitest run src/editor src/components/MobileShell.test.tsx`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(mobile): read-only notes with an explicit edit mode`.

### Task 3: Interactive content still works in read mode

**Files:**
- Modify: `src/editor/extensions/index.ts` (`TaskItemInLists`, ~line 143), `src/editor/extensions/InkBlockView.tsx`
- Test: `src/editor/readModeInteraction.test.tsx`

**Interfaces:**
- Consumes: the read-only editor from Task 2's test harness.

- [ ] **Step 1: Write the failing tests** on a non-editable editor: (a) clicking a task checkbox flips `checked` in the document and calls `onChange` with the new markdown; (b) a wiki-link click still navigates (assert on whatever `WikiLink.tsx` calls today); (c) tapping an ink block's preview opens the full-screen ink editor on mobile.
- [ ] **Step 2: Run** `npx vitest run src/editor/readModeInteraction.test.tsx`. Expected: (a) and (c) FAIL.
- [ ] **Step 3: Implement (a).** TipTap's stock task item ignores checkbox taps when the editor is not editable, and its `onReadOnlyChecked(node, checked)` option is only a callback — it does not apply the change. Configure it on `TaskItemInLists` to locate that node in `editor.state.doc` and dispatch `setNodeMarkup` with the new `checked`; return `true`. This transaction goes through the normal `onUpdate` → save path.
- [ ] **Step 4: Implement (c).** `InkBlockView` passes `editable={editor.isEditable}` to `InkPreview`; read `InkPreview` and make a tap open the full-screen editor on mobile regardless of editability. Do not enable ink drawing from read mode beyond opening that editor.
- [ ] **Step 5: Run** the tests plus `npx vitest run src/editor`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(mobile): checkboxes, links and ink open in read mode`.

### Task 4: Phone toolbar above the keyboard

**Files:**
- Modify: `src/editor/toolbar/EditorToolbar.tsx`, `src/index.css` (`[data-shell='mobile'] .editor-toolbar`), `src/editor/useKeepCaretVisible.ts`
- Test: `src/editor/toolbar/editorToolbar.test.tsx` (extend)

**Interfaces:**
- Consumes: `isMobile()`.

- [ ] **Step 1: Write the failing test** — with `platform()` `'android'` the toolbar renders the text-format and Insert groups and does not render the sheet group (the exercise-sheet actions); on `'windows'` all three render as today.
- [ ] **Step 2: Run** `npx vitest run src/editor/toolbar/editorToolbar.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the conditional in `EditorToolbar`: skip `<SheetGroup>` and its separator when `isMobile()`. The bar stays one horizontally scrollable row.
- [ ] **Step 4: Keyboard behaviour.** Make the bar track the soft keyboard: on resize of `window.visualViewport`, offset the fixed bar by `window.innerHeight - visualViewport.height - visualViewport.offsetTop` (falling back to 0 where `visualViewport` is missing, as `useKeepCaretVisible` does). Keep `TOOLBAR_CLEARANCE_PX` consistent with the bar's height. This cannot be proven in jsdom: unit-test the offset arithmetic as a pure function, and add the device check to Task 9.
- [ ] **Step 5: Run** `npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(mobile): phone-sized edit toolbar that rides the keyboard`.

### Task 5: Quick-note title and emptiness check

**Files:**
- Create: `src/lib/quickNote.ts`
- Test: `src/lib/quickNote.test.ts`

**Interfaces:**
- Produces: `quickNoteTitle(now: Date): string` → `Quick note 2026-11-10 14-32` (local time, zero-padded); `isUntouchedQuickNote(title: string, markdown: string): boolean` → true when `markdown.trim()` equals `# <title>` (frontmatter-free).

- [ ] **Step 1: Write the failing tests** — `quickNoteTitle(new Date(2026, 10, 10, 9, 5))` is `'Quick note 2026-11-10 09-05'`; `isUntouchedQuickNote('T', '# T\n')` is true; `'# T\n\nhello'` is false; `''` is true.
- [ ] **Step 2: Run** `npx vitest run src/lib/quickNote.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both functions as specified.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): quick-note title helpers`.

### Task 6: `useQuickNote`, with cleanup on Done and Back

**Files:**
- Create: `src/hooks/useQuickNote.ts`
- Modify: `src/editor/useMobileEditMode.ts` (Done), `src/components/MobileShell.tsx` (`close-editor`)
- Test: `src/hooks/useQuickNote.test.tsx`

**Interfaces:**
- Consumes: `useCreateNote()` (`src/hooks/useCreateNote.ts`), `quickNoteTitle`, `isUntouchedQuickNote`, `useMobileEditStore`, `api.notes.delete(workspace, path)`.
- Produces: `useQuickNote(): () => Promise<void>` (creates, then `startEditing(meta.path)`); `discardIfUntouched(path: string): Promise<void>` exported from the same file. Track quick-note paths in a module-level `Set<string>` so only notes created by + are ever candidates for deletion.

- [ ] **Step 1: Write the failing tests** — creating calls `useCreateNote` with `quickNoteTitle(now)` and sets `editingPath` to the new path; two calls in the same tick create one note (Review Focus 4); `discardIfUntouched` deletes a quick note whose buffer content is just the heading, keeps one with text, deletes one typed-then-erased (Review Focus 3), and never deletes a path that was not created by +.
- [ ] **Step 2: Run** `npx vitest run src/hooks/useQuickNote.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Read the buffer's current content from `src/store/noteBuffers.ts` (call its flush first so a pending save lands before the decision), delete via `api.notes.delete`, and drop the note from `useNotesStore` using whatever remover that store already exposes. Call `discardIfUntouched` from Done and from `close-editor`.
- [ ] **Step 4: Run** the tests plus `npx vitest run src/store src/hooks`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): quick note that opens in edit mode and cleans up when untouched`.

### Task 7: + button, and Review moves to the More sheet

**Files:**
- Modify: `src/components/MobileShell.tsx`, `src/components/MobileTabBar.tsx`, `src/components/MoreSheet.tsx`, `src/components/Layout.tsx` (the `<MobileShell …/>` call near line 768), `src/index.css`
- Test: `src/components/MobileShell.test.tsx` (update + extend), `src/components/MoreSheet` assertions in the same file

**Interfaces:**
- Consumes: `useQuickNote` (Task 6).
- Produces: `MobileShell` gains `onNewNote: () => void`; `TabId` loses `'review'` (tabs: `'home' | 'notes' | 'search' | 'more'`); `MoreSheet` gains an `onReview: () => void` prop and a **Review** action.

- [ ] **Step 1: Write the failing tests** — the tab bar has no Review button; the More sheet's **Review** calls `onReviewOpen`; a **New note** button shows on Home and Notes (and not on Search, nor while the editor is open) and calls `onNewNote`; it is absent without a workspace. Remove the old "Review opens its overlay" assertion in `MobileShell.test.tsx`.
- [ ] **Step 2: Run** `npx vitest run src/components/MobileShell.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the changes; `Layout` passes `onNewNote={quickNote}` from `useQuickNote()`. Add `.mobile-fab` CSS (lower-right, above the tab bar and `var(--safe-bottom)`, 48px circle) and grep `index.css` for every other new className.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): new-note button; Review moves to the More sheet`.

### Task 8: Review-first Home

**Files:**
- Create: `src/lib/homeNextAction.ts`
- Modify: `src/components/HomeView.tsx`, `src/index.css`
- Test: `src/lib/homeNextAction.test.ts`, `src/components/HomeView.test.tsx` (extend)

**Interfaces:**
- Produces: `type HomeNextAction = { kind: 'review'; dueCount: number } | { kind: 'resume'; path: string; caughtUp: boolean } | null` and `homeNextAction(input: { dueCount: number; hasCards: boolean; lastEdited: { path: string } | null }): HomeNextAction`. `review` when `dueCount > 0`; else `resume` (with `caughtUp: hasCards`) when `lastEdited` exists; else `null`.

- [ ] **Step 1: Write the failing tests** — `homeNextAction` for each of the three states in the mockup (cards due; has cards, none due; no cards) plus the empty workspace (Review Focus 5 → `null`). `HomeView` on mobile: renders the hero as **N cards due** with a **Start review** button calling `onOpenReview`; renders **Pick up where you left off** with the last-edited note, plus **All caught up** only when the workspace has cards; omits that note from the Continue list; shows no review UI at all in a workspace with no flashcards; on desktop none of this changes.
- [ ] **Step 2: Run** `npx vitest run src/lib/homeNextAction.test.ts src/components/HomeView.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** `lastEdited` is the most recently `updatedAt` note. `hasCards` needs a total card count: find the cheapest existing call (`DeckView` already lists cards) rather than adding a Rust command. On mobile the hero replaces the Study section's due count and Start review; keep **Browse all cards** only when the workspace has cards. Hero styling reuses the existing `home-action-primary` look; add new classes to `index.css`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): review-first Home with a best-next-action card`.

### Task 9: Whole-slice verification

**Files:** none (plus `docs/specs/mobile-jot-and-review-design.md` if a decision changed).

- [ ] **Step 1: Run** `npm run typecheck && npm run lint && npm test`. Expected: all pass. Run `graphify update .`.
- [ ] **Step 2: Build** the Android debug APK and install it.
- [ ] **Step 3: Hand the maintainer this device checklist** (touch cannot be tested from here): open a note, scroll and tap text — no caret, no keyboard; tap Edit note — keyboard and toolbar appear, toolbar sits on the keyboard, caret stays visible; tap a checkbox in read mode; tap an ink block; Done; + on Home creates `Quick note …` in edit mode; Back with nothing typed deletes it; Home shows the three states.
- [ ] **Step 4: Fix** what the checklist finds, one commit per fix.
