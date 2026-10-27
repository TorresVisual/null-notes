# Table improvements — design

## Intent

Tables are the weakest-looking, least capable block in the editor. The look (full grid, accent-tinted header, zebra rows) doesn't match the rest of the app, and the controls cover only insert, delete and align. Notion's tables are the reference for what editing should feel like. Everything must keep saving as plain GFM that GitHub renders, because notes are portable `.md` files.

## Goals

- New look, chosen from mockups: **soft grid** — rounded outer border, faint inner lines, sunken header, row highlight on hover. Uses existing tokens only; works in light theme and print preview.
- Row and column operations that need no new saved state:
  - Reorder rows and columns by dragging the grip.
  - Move row up/down and column left/right from the grip menu (keyboard-reachable alternative to drag).
  - Duplicate row, duplicate column.
  - Sort by column, ascending/descending. The header row never moves.
- Fix: a `|` inside inline math splits the cell on save and reload.
- Verify pasting a block from Excel/Sheets/HTML tables produces a table, and fix if not.

## Non-goals

- Column widths, cell/row/column colours, merged cells, header-column, headerless tables, formulas, multi-block cells. GFM cannot hold them. A follow-up (**not scaffolded here**) may store widths and colours in a trailing `<!-- table: ... -->` comment; that needs its own design and a `docs/ROADMAP.md` §1 entry first.
- Header-row toggle. GFM requires a header row, so there is no off state to save.
- Tab-at-last-cell adds a row. Already provided by TipTap's table extension.

## Anti-goals

- Any change that makes a saved table render differently or break on GitHub.
- A rewrite of the controls (e.g. as a React node view). The existing DOM overlay in `TableControls.tsx` stays.
- Regressing the existing math-in-table round trip or the alignment round trip.

## Constraints

- Storage is GFM via `TableMarkdown.ts`; each cell holds one paragraph. No new saved state.
- Shell/editor split: table styles are plain CSS in `src/index.css`, not Tailwind.
- Tests: `TableControls.test.tsx` (94 table matches) and `TableMarkdown.test.ts` must keep passing; new behaviour gets tests alongside.
- The sole-inline-math cell bug (empty-`textContent` check) is already fixed in 76ba923.

## Approaches considered

1. **Restyle plus GFM-safe interactions, no new saved state.** Chosen.
2. Same plus widths/colours in a trailing HTML comment. Deferred as a follow-up on top of 1.
3. Rewrite controls as a React node view. Rejected: touches every table test, nothing visible gained.

## Decisions (made with the maintainer)

- Look: soft grid. Scope: approach 1 only.

## Calls made by the author (not yet confirmed)

- **Pipes in math:** on save, write `|` inside a cell's math as `\vert`, which renders identically and needs no unescaping on read. Rejected `\|` because the inline-math parser reads raw source before escape handling, so `\|` would come back as a double bar `‖`.
- **Sort:** stable; compares numerically when every non-empty cell in the column parses as a number, otherwise case-insensitive text compare. Empty cells sort last in both directions. One transaction, so a single undo restores order.
- **Drag:** pointer events on the existing grip, with a drop-line indicator; menu "Move" items are the fallback. Reordering is one transaction.
- **Alignment travels with the column** when columns are moved or duplicated, since alignment is stored on cells.
- **Duplicate** inserts the copy directly after the original, content included.

## Left to the builder

Exact grip and menu layout inside the existing `.table-controls` strips, hover/drag animation timings, icon choices, and how to split `TableControls.tsx` if it grows past comfortable size (it is ~440 lines now).
