# null-notes — Ink Draw Ribbon Design

**Date:** 2026-10-20
**Scope:** Sub-project 2 of 4 in the "make free drawing feel like OneNote" effort. Depends on `ink-fullscreen-editor-design.md` (the ribbon lives in `InkEditorOverlay`).

---

## Goal

A OneNote-style Draw tab for the full-screen ink editor: a pen gallery with thickness/colour flyouts, replacing the dense row of small icons.

## Non-Goals

- No add/delete/reorder-pen UI — only the existing presets are edited (`updateActivePen`).
- No changes to `useInkStore`, pen persistence (`ink/pens.ts`) or the SVG format.
- `InkToolGroup` is untouched: it still serves PDF-page ink and inline (flagged) canvas notes through the editor toolbar.

---

## Design

### `DrawRibbon` (new, `src/ink/DrawRibbon.tsx`)

The overlay's single top bar. Reads and writes the same `useInkStore` as `InkToolGroup`, so no store changes. Left to right:

1. **`PenGallery`** (new) — the pen presets as large swatches, each showing a short stroke sample in its own colour, width and opacity (a highlighter looks like a highlighter). Click selects. Clicking the already-active pen opens a flyout:
   - **Thickness** slider with a live stroke preview.
   - **Colour grid** — about 12 preset swatches plus a custom `input type="color"`.
   - Edits the active pen through `updateActivePen`.
2. **Eraser** — flyout with the existing point/stroke mode and size slider.
3. **Lasso**, **Text** (text gets a size flyout), **Ruler** (toggle).
4. **Shapes** — one gallery button whose flyout offers line / circle / rect / arrow and remembers the last choice.
5. Right side: **undo / redo**, a **zoom** control (`100%` button opening 75 / 100 / 150 / 200 and fit-width), and **Done**.

### Flyouts

Add the shadcn `Popover` as `src/components/ui/popover.tsx` (`radix-ui` is already a dependency). The existing `dropdown-menu` is for menus, not slider/colour panels.

### Keyboard

`P` pen, `E` eraser, `L` lasso, `T` text, `Ctrl+Z` / `Ctrl+Y`, `Esc` closes an open flyout then the overlay. Scoped to the overlay so they cannot collide with editor shortcuts.

### Styling

Ribbon chrome reuses the existing settings-panel / overlay classes; add only the CSS the swatches, flyouts and ribbon rows need. Per CLAUDE.md ("Dialog CSS gap", "UI spacing gaps"): grep `index.css` for every new className, and compare the first screenshot against a reference element rather than trusting that a rule exists.

## File Structure

| File | Change |
|---|---|
| `src/ink/DrawRibbon.tsx` | New |
| `src/ink/PenGallery.tsx` | New |
| `src/components/ui/popover.tsx` | New (shadcn) |
| `src/ink/InkEditorOverlay.tsx` | Render `DrawRibbon` instead of `InkToolGroup` |
| `src/index.css` | Ribbon, swatch and flyout rules |

## Testing

- `PenGallery`: selecting a pen; re-clicking opens the flyout; thickness and colour changes update the active pen.
- `DrawRibbon`: the shapes button remembers its last choice; tool buttons set the store's tool.
- e2e screenshot (`e2e-verify`) of the ribbon with a flyout open.
- `npm run typecheck`, `npm test`.
