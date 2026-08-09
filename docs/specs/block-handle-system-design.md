# null-notes — Block Handle System Design

**Date:** 2026-08-09
**Scope:** Adds a Notion-style block handle (hover grip, click-to-select, delete/duplicate menu, drag-to-reorder, multi-block range select) across all top-level editor blocks, and closes the block-math in-place-editing gap that `docs/specs/editor-feel-design.md` explicitly deferred as "a separate, larger project."

---

## Goals

1. **Block selection is discoverable.** Today, selecting a `Divider`, `Callout`, `BlockMath`, or any other atom/complex block requires knowing ProseMirror node-selection mechanics (click precisely on the atom, or backspace into it from adjacent text). A hover grip in the left gutter makes every top-level block selectable with one click, matching the interaction users already know from Notion.
2. **Delete and duplicate don't require a keyboard shortcut.** The grip opens a small menu with explicit Delete / Duplicate actions.
3. **Blocks can be reordered by dragging**, scoped to top-level siblings (no dropping into a callout or list item).
4. **Multiple adjacent blocks can be selected as a range** (shift-click or drag down the gutter) and deleted together in one transaction.
5. **Block math becomes editable in place.** `BlockMath` currently has no click handler at all — once inserted, its LaTeX can only be changed by deleting and reinserting the node, or hand-editing raw markdown in Source view. This brings it to parity with `InlineMath`, which already has full click-to-edit with a live KaTeX preview.

## Non-Goals

- **Dropping a block inside a container** (a callout, a list item, a table cell). Drag-to-reorder is top-level-siblings-only in this pass. Nested drag targets are a distinct, more edge-case-heavy feature (per `@tiptap/extension-drag-handle`'s own `nested` config) and are out of scope until there's a concrete need.
- **Duplicating a multi-block range.** The handle menu shows Duplicate only for a single selected block; a range selection's menu shows Delete only. Range-duplicate is easy to add later on top of the same infrastructure — no need to build it speculatively now.
- **Automated drag/drop interaction tests.** Pointer-event-driven drag sequences are brittle to simulate meaningfully in the current test setup (Vitest, no browser automation harness in CI). This is verified manually in `npm run tauri dev`, consistent with CLAUDE.md's guidance to test UI changes live rather than fake it with brittle simulated tests.
- **Keyboard-only block selection/reordering.** The grip is a pointer-driven affordance; existing keyboard paths (arrow keys into a node, Backspace to delete) are untouched and still work. A fully keyboard-accessible block-reorder flow is a separate accessibility pass.

---

## Architecture

Three official TipTap 3 extensions do the heavy lifting, all MIT-licensed and version-matched to the installed `3.27.4` line:

| Package | Role |
|---|---|
| `@tiptap/extension-drag-handle` | Core plugin: tracks cursor position against block DOM rects, exposes `onNodeChange`, provides the drag source and drop-target/insertion-line behavior. |
| `@tiptap/extension-drag-handle-react` | React wrapper (`<DragHandle>`) rendering the handle outside the ProseMirror DOM tree, as a sibling — no NodeView changes needed in `Callout`, `BlockMath`, `Divider`, etc. |
| `@tiptap/extension-node-range` | Multi-block range selection: shift-click extend (confirmed API); drag-down-the-gutter select is a stretch goal, see Architecture below. |

`DeleteNodeButton` / `DuplicateButton` are **not** installed as npm packages — TipTap ships these as copyable MIT source (`npx @tiptap/cli@latest add delete-node-button duplicate-button`), matching this codebase's existing convention of small, editable, single-purpose extension files rather than opaque dependencies. Their logic is adapted into the new handle menu component rather than used as prebuilt UI (their default styling doesn't match `.slash-menu`).

### New files

- **`src/editor/extensions/BlockHandle.tsx`** — wraps `<DragHandle>`. Renders the gutter grip icon (`GripVertical` from `lucide-react`, matching the icon set already used in `Callout.tsx` and `NoteEditor.tsx`), tracks hover/selection state via `onNodeChange`, and renders the Delete/Duplicate popover menu on click — reading whether the current selection is a range via `isNodeRangeSelection` to decide which menu to show. Registered once in `NoteEditor.tsx` as a sibling of `<EditorContent>` — **not** added to `coreExtensions` in `src/editor/extensions/index.ts`, because `DragHandle`'s React component pattern mounts outside the ProseMirror DOM rather than as a schema-level extension.

`NodeRange` itself (a standard `Extension`, not a component) is added to `coreExtensions` alongside `Divider` and the other structural extensions, configured with `key: 'Shift'` so shift-click extends a range selection — confirmed from its shipped type definitions (`NodeRangeOptions.key: 'Shift' | 'Control' | 'Alt' | 'Meta' | 'Mod'`). Shift-click-to-extend is therefore solid. Drag-down-the-gutter to build a range (rather than shift-click) is the one piece of this design whose exact wiring isn't confirmed from documentation — TipTap's docs don't show a worked example combining `DragHandle` and `NodeRange`. If gutter-drag-to-select doesn't compose for free during implementation, shift-click alone still satisfies the range-select goal, with gutter-drag as a nice-to-have follow-up rather than a blocking requirement.

### Modified files

- **`src/editor/extensions/BlockMath.tsx`** — `BlockMathView` gains the same edit-state shape as `InlineMathView` (`InlineMath.tsx:30-80`): click-to-edit, draft state, live preview, commit/cancel. Detailed below.
- **`src/editor/extensions/SlashCommands.tsx`** — "Block Math" entry drops `window.prompt` and inserts an empty `blockMath` node directly, matching how "Inline Equation" already works (`SlashCommands.tsx:129-139`).
- **`src/editor/NoteEditor.tsx`** — mounts `<BlockHandle editor={editor} />` alongside `<EditorContent>`.
- **`src/index.css`** — new styles for the gutter grip, handle menu, selected-range wash, and drag insertion line.
- **`package.json`** — adds `@tiptap/extension-drag-handle`, `@tiptap/extension-drag-handle-react`, `@tiptap/extension-node-range` (pin to `3.27.4` to match the rest of the `@tiptap/*` set, per the existing `overrides` convention for `@tiptap/core` and `@tiptap/pm`).

---

## Interaction Design

### Hover handle + click-to-select

`DragHandle`'s `onNodeChange` fires with the block under the cursor; `BlockHandle` positions a grip icon in the editor pane's existing 48px side padding, vertically aligned to that block. Opacity-transitions in on hover — no layout shift, no block ever resizes to make room.

Clicking the grip calls `editor.commands.setNodeSelection(pos)`. The selected block gets an `--accent-bg` background wash — the same treatment `.inline-math.selected` already uses (`index.css:333-334`), so this reads as an extension of an existing visual language rather than a new one.

With a block selected, Backspace/Delete removes it — this already works today via ProseMirror's default NodeSelection handling; the grip just makes reaching that state discoverable without knowing the mechanics.

### Handle menu (Delete / Duplicate)

Clicking the grip both selects the node and opens a popover directly below it, styled to match `.slash-menu` (`index.css`, `SlashCommands.tsx:221-243`) rather than TipTap's default theme:

- **Delete** — removes the node. Adapted from `DeleteNodeButton`'s selection-handling logic (moves the cursor to a sensible neighbor after removal) rather than a bare `deleteSelection` command.
- **Duplicate** — clones the node and inserts the copy immediately after the original, then moves the selection to the copy. Mirrors what pressing Enter does after a normal block, so it doesn't introduce a new mental model.

Only shown when a single block is selected (see Non-Goals for range behavior).

### Drag-to-reorder

The grip is the drag source. Dragging renders TipTap's default ghost-block-plus-insertion-line; the insertion line is restyled to `--accent` to match the app's signal color.

`DragHandle` is configured with `nested: false` (its default) — this scores and restricts targets to top-level siblings only, so a block cannot be dropped inside a `Callout`, list item, or table cell. Dropping over an invalid target shows a not-allowed cursor rather than silently no-opping.

A completed drag is a single delete-and-reinsert ProseMirror transaction — one undo step.

### Multi-block range select

`NodeRange` provides shift-click-to-extend range selection (confirmed via its `key` option). All blocks in the range get the same `--accent-bg` wash as a single selection, rendered via `getNodeRangeDecorations`.

- Delete removes the entire range in one transaction (one undo step).
- Dragging a range (grip-drag while a range is active) moves all selected blocks together. Confirmed by reading `@tiptap/extension-drag-handle`'s own compiled source (`helpers/nodeRangeDrop.ts`): it imports `isNodeRangeSelection`/`NodeRangeSelection` from `@tiptap/extension-node-range` directly and captures/restores the active drag range across the drop — no glue code needed in `BlockHandle.tsx`.
- The handle menu shows only Delete for a range (see Non-Goals).

### Block math edit workflow

`BlockMathView` (`BlockMath.tsx`) changes from a pure render to a stateful view, structurally mirroring `InlineMathView`:

- **Idle state:** renders KaTeX as today, but the render wrapper gets an `onClick` that opens edit mode (only when `editor.isEditable`).
- **Editing state:** swaps to a `<textarea>` (not `<input>` — block equations are more likely to be multi-line LaTeX, e.g. `\begin{aligned}...\end{aligned}` bodies within a single displaystyle block) plus a live KaTeX preview below it, spanning the block's full width. Placeholder text notes the commit key since it differs from InlineMath: `Mod-Enter to apply` (plain `Enter` inserts a newline in a textarea).
- **Commit:** `Mod-Enter` or blur calls `updateAttributes({ latex: draft.trim() })` and closes. Empty draft on commit deletes the node (same rule as `InlineMath`'s `commit()`).
- **Cancel:** `Escape` reverts to the last-committed `latex` and closes; if `latex` was empty (a freshly-inserted node), cancelling deletes it instead — same as `InlineMath`'s `cancel()`.
- **Auto-open on insert:** a node inserted with `latex === ''` opens directly into edit mode, matching `InlineMath`'s existing rule (`InlineMath.tsx:34`).

`SlashCommands.tsx`'s "Block Math" entry (currently `SlashCommands.tsx:141-148`) drops `window.prompt('LaTeX:')` and instead does:

```
insertContent({ type: 'blockMath', attrs: { latex: '' } })
```

— identical in shape to the existing "Inline Equation" entry, so no native browser dialog is ever shown for either math type.

---

## Error Handling & Edge Cases

- **Deleting the last block in the document.** ProseMirror/StarterKit's existing behavior already guarantees a trailing empty paragraph is placeable; this system doesn't change that contract, but it's the first feature to make "delete the only block" reachable via a menu click rather than only via Backspace-until-empty, so it gets explicit manual verification during implementation.
- **Tables.** `nested: false` means `DragHandle` treats a whole `<table>` as one top-level block, not per-row — consistent with "top-level only" scope. No per-row handles in this pass.
- **Code blocks, Mermaid, Ink, PDF page blocks.** No special-casing — they're ordinary top-level nodes to `DragHandle`/`NodeRange`, same as a paragraph or callout.
- **BlockMath mid-edit + block-level delete.** If the grip's Delete is used while a `BlockMath` node is in its local `editing` state, the node (and its uncommitted draft) is simply removed — no draft-recovery mechanism, consistent with how `InlineMath` already handles this (deleting the node is deleting the node; there is no autosave for an uncommitted equation draft anywhere else in the editor).

---

## File Structure

| File | Change |
|---|---|
| `src/editor/extensions/BlockHandle.tsx` | New — gutter grip, hover tracking, handle menu (Delete/Duplicate), wraps `DragHandle`, reads `NodeRange` selection state |
| `src/editor/extensions/BlockMath.tsx` | Rewritten `BlockMathView` — click-to-edit, textarea + live preview, commit/cancel |
| `src/editor/extensions/SlashCommands.tsx` | "Block Math" entry: drop `window.prompt`, insert empty node like "Inline Equation" |
| `src/editor/extensions/index.ts` | Add `NodeRange` to `coreExtensions` |
| `src/editor/NoteEditor.tsx` | Mount `<BlockHandle editor={editor} />` alongside `<EditorContent>` |
| `src/index.css` | Gutter grip, handle menu, range-selection wash, drag insertion line styles |
| `package.json` | Add `@tiptap/extension-drag-handle`, `@tiptap/extension-drag-handle-react`, `@tiptap/extension-node-range` at `3.27.4` |

---

## Testing

- **`src/editor/extensions/BlockMath.test.ts`** (new) — covers the edit-state transitions (open on click, commit, cancel, empty-draft-deletes, auto-open-when-empty), mirroring the existing coverage pattern for `InlineMath` in `inlineMath.test.ts`.
- **`npm run typecheck`** after all changes.
- **Manual QA in `npm run tauri dev`** (drag/drop and hover-handle interactions, per CLAUDE.md's guidance and this project's own Non-Goals on automated drag tests):
  - Hover over a paragraph, heading, divider, callout, code block, table, and block-math node — confirm the grip appears for each without shifting content.
  - Click the grip on a `Divider` — confirm it selects and the menu offers Delete/Duplicate; confirm Delete removes it cleanly.
  - Drag a block up/down among top-level siblings — confirm reorder and a single undo step; confirm dragging toward a callout's interior shows not-allowed rather than dropping inside it.
  - Shift-click across three adjacent blocks — confirm all three highlight and Delete removes all three in one undo step.
  - Insert a Block Math node via `/block math` — confirm it opens directly into edit mode (no native prompt), `Mod-Enter` commits, `Escape` on a fresh empty node deletes it, and clicking a previously-committed equation reopens it for editing.

---

## Sequencing Note

This closes the gap `docs/specs/editor-feel-design.md` explicitly deferred: *"No in-place editing for math nodes... redesigning it into an in-place-editable node is a separate, larger project."* That project is this one, generalized to all block types rather than just math.
