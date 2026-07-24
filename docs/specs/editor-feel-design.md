# null-notes — Editor Feel Design

**Date:** 2026-07-24
**Scope:** Third of four planned polish passes (visual design system → ink toolbar & canvas polish → **editor feel** → navigation). Closes three "unreachable from the UI" gaps found in the slash menu.

---

## Goals

Add slash-menu entries for block types that currently have no way to be created from the WYSIWYG editor at all:

1. **Block Math** — `BlockMath` is loaded as an extension and round-trips correctly through markdown, but nothing in the editor UI creates one. Unlike `InlineMath` (which auto-converts on `$latex$` via an input rule), `BlockMath` has neither an input rule nor a slash command — the only way to create one today is hand-editing raw markdown in Source view.
2. **Table** — the `Table`/`TableRow`/`TableCell`/`TableHeader` extensions are loaded but nothing inserts one.
3. **Missing callout types** — `Callout` supports six types (`note`, `tip`, `warning`, `danger`, `info`, `important`), but the slash menu only exposes four (`note`, `warning`, `tip`, `danger`). `info` and `important` are unreachable.

## Non-Goals

- No slash-menu visual/UX polish (icons, keyboard hints, layout) — scoped out; this pass is reachability only.
- No changes to `ExerciseBlock` — it's tightly coupled to the PDF-import pipeline's `Exercise` data structure (title + parsed content blocks) with no sensible "blank" state a slash command could insert. It's a PDF-pipeline concern, not general editor feel.
- No in-place editing for math nodes. `BlockMath` (like the already-shipped `InlineMath`) is an atom node with no editable content area — once inserted, changing its LaTeX requires deleting and reinserting, or hand-editing in Source view. This is the existing convention for math nodes in this codebase; redesigning it into an in-place-editable node is a separate, larger project.

---

## Block Math

New `COMMANDS` entry in `src/editor/extensions/SlashCommands.tsx`:

```
title: 'Block Math'
description: 'LaTeX block equation'
run: prompts window.prompt('LaTeX:') for the equation source, then:
  - if the user provides non-empty text: editor.chain().focus().deleteRange(range)
    .insertContent({ type: 'blockMath', attrs: { latex } }).run()
  - if the user cancels or leaves it blank: do nothing — leaves the typed "/block math"
    text in place, untouched (matches the existing Ink Block command's cancel behavior,
    which does the same when notePath is unavailable)
```

This mirrors the existing `prompt()` pattern already used for note/folder creation in `src/components/Sidebar.tsx` — not a new UI pattern for this codebase.

## Table

New `COMMANDS` entry:

```
title: 'Table'
description: '3×3 table with header row'
run: editor.chain().focus().deleteRange(range)
  .insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
```

`insertTable` is TipTap's built-in Table command, already available since the `Table` extension is loaded in `coreExtensions`.

## Missing Callout Types

Two new `COMMANDS` entries, structurally identical to the existing `note`/`warning`/`tip`/`danger` entries:

```
title: 'Info', description: 'Info callout', calloutType: 'info'
title: 'Important', description: 'Important callout', calloutType: 'important'
```

---

## File Structure

| File | Change |
|---|---|
| `src/editor/extensions/SlashCommands.tsx` | Add 4 new `COMMANDS` entries (Block Math, Table, Info, Important) |

No files are created or deleted.

---

## Testing

`SlashCommands.tsx` has no existing test file, and its `COMMANDS` entries aren't unit-tested today (they're thin wrappers around TipTap chain commands, exercised only through the live editor) — this pass follows that existing precedent rather than introducing new test infrastructure for one file.

- `npm run typecheck` after the change.
- Manual QA in `npm run tauri dev`: type `/block math`, provide LaTeX at the prompt, confirm it renders; type `/block math` and cancel the prompt, confirm the typed text is left untouched; type `/table`, confirm a 3×3 table with a header row appears; type `/info` and `/important`, confirm both callout types render with their respective colors (per the visual design system pass: info uses the note/info blue, important uses purple).

---

## Sequencing Note

This is project 3 of 4 in the "make the app awesome" polish effort. Projects 1 (visual design system) and 2 (ink toolbar & canvas polish) are complete and merged. Project 4 (navigation & organization) gets its own brainstorming → spec → plan cycle once this one ships.
