# The universal editor toolbar

## Problem

Every ink canvas renders its own toolbar. On a converted exercise sheet that is now one canvas per solution, so a six-exercise sheet carries **six identical toolbars** down the note — each with seven tools, a ruler, three pens, a colour picker, a size slider, undo/redo and four zoom levels.

They are identical in the strict sense, not merely the visual one. Pens, the active pen, eraser mode and eraser size are already persisted in `localStorage` by `ink/pens.ts` and shared by every canvas in the app. The state was always global; only the rendering was duplicated.

The second half of the problem is that the app has nowhere to put an editor control. `NoteEditor` has a small `editor-toolbar` holding an "Ink" button and a code-language select, and that is the whole surface. Text formatting, block insertion and the exercise-sheet commands are reachable only by keyboard, by Markdown syntax, or by knowing the slash menu exists.

One bar solves both.

## What goes in it

Four new groups, plus the code-language select the toolbar already carries:

| Group | Contents | Shown when |
|---|---|---|
| **Ink** | pen, eraser, lasso, line, circle, rectangle, arrow; ruler; delete selection; pens; colour; size; eraser mode; undo/redo; zoom | a canvas is active — and then it is the only group shown |
| **Text** | bold, italic, headings, lists | no canvas active, cursor not in a code block |
| **Insert** | ink, equation, table, code, callout | no canvas active |
| **Sheet** | Split Into Tasks, Add Next Task | no canvas active |
| *Language* *(exists today)* | code-language select | cursor in a code block — in place of the Text group |

The ink group takes the bar alone. It is far too wide to share, and while a pen is in your hand nothing else in the bar is what you want.

## Design

### The state split

Ownership follows what is already true rather than introducing a new arrangement:

| State | Owner | Why |
|---|---|---|
| tool, pens, active pen, colour, size, eraser mode, eraser size, ruler | **`src/store/ink.ts`** (new) | Already global — persisted in `localStorage`, identical across canvases. The store makes that explicit; `ink/pens.ts` stays the load/save layer, unchanged. |
| strokes, shapes, undo history, selection, zoom | **`useInkCanvas`**, per canvas | Genuinely per-block. Zoom is already documented as per-block and deliberately not persisted. |

This is the whole reason the refactor is small: the half that has to become shared **is** shared, and moving it changes no behaviour.

### The active canvas

A toolbar outside the canvas still needs a target for undo, redo, zoom and delete-selection. The active canvas registers a handle:

```ts
interface CanvasHandle {
  undo(): void
  redo(): void
  canUndo: boolean
  canRedo: boolean
  deleteSelected(): void
  hasSelection: boolean
  zoom: number
  setZoom(zoom: number): void
}
```

- **Registered** on pointerdown inside a canvas, and re-registered when its reactive values change while it is the active one (so `canUndo` in the bar tracks the stroke you just drew).
- **Cleared** when the ProseMirror selection moves to a text position, when the open note changes, and when the active canvas unmounts.
- **Never cleared by the toolbar itself.** Toolbar buttons call `preventDefault` on mousedown so focus and selection do not move.

That last rule is load-bearing and easy to lose. Without it, reaching for undo clears the very canvas undo is meant to act on, and the button either does nothing or acts on the wrong block. It gets its own test.

There is no focus machinery on the canvas today — no `tabIndex`, no `onFocus`, and no `Ctrl+Z` binding anywhere in `src/ink/`. Ink undo is reachable *only* through the toolbar buttons. Nothing here changes that; it means the active-canvas registration has to land in the same change that removes the per-canvas toolbar, or ink undo becomes unreachable in between.

### Components

`EditorToolbar.tsx` is the sticky bar and does nothing but decide which groups to render. Each group is a file with one purpose, one set of dependencies, and no knowledge of the others:

- `InkToolGroup` — ink store, active canvas handle
- `TextFormatGroup` — the editor
- `InsertGroup` — the editor, plus the note path for ink
- `SheetGroup` — the editor

`InkCanvas` loses its toolbar entirely and becomes the drawing surface: roughly a hundred lines out of a four-hundred-line component, and the removal of every control it does not own.

### Placement

Sticky at the top of the editor pane, replacing the existing `editor-toolbar` in place. The tab bar, conflict bar and status bar are untouched.

Sticky rather than static because the sheet this exists for is long: drawing in solution six must not mean scrolling back to solution one to change pen. Inside the editor pane rather than above the tab bar because the bar acts on the note you are looking at, and an app-level bar implies otherwise the moment two tabs are open.

### Overflow

The ink group will not fit an 800px pane in one row. It scrolls horizontally on a single row rather than wrapping: a bar that changes height when you switch tools shifts the note underneath mid-stroke, which is worse than a bar you have to scroll.

If it is still tight on the real pane, the zoom levels move behind a `⌄` popover — they are the least-used control in the group. Recorded as the fallback, not built up front.

## Error handling and edge cases

- **Canvas unmounts while active** (note switched, block deleted): the handle is cleared and the bar falls back to the text groups. The bar never holds a handle to a canvas that is gone.
- **Two canvases in one note**: pointerdown in the second re-registers; the first canvas keeps its own history untouched, and returning to it restores its own undo state.
- **Ink group with no handle**: cannot happen — the group renders only when a handle exists, rather than rendering disabled controls.
- **A note with no canvases**: the ink group never appears; the bar is text, insert and sheet actions.

## Testing

| What | Why it earns a test |
|---|---|
| Store persists tool/pen/colour exactly as `pens.ts` does today | The refactor must not change what is written to `localStorage` |
| Pointerdown registers the active canvas | The whole mechanism rests on it |
| Clicking prose clears it | Otherwise the ink group is shown while typing |
| **Clicking the toolbar does not clear it** | The load-bearing rule above |
| Ink group renders only with an active canvas | The contextual contract |
| Undo in the bar undoes the active canvas, not the other one | The failure would be silent and destructive |

The existing ink tests (`useInkCanvas.test.ts`, `pens.test.ts`, `hitTest`, `lasso`, `pointEraser`, `ruler`, `shapePreview`, `zoom`) are the regression baseline and should not need to change — if they do, the split has moved something it should not have.

## Sequencing

1. **Ink store + canvas handle**, toolbar still rendered inside each canvas. Pure refactor: no visible change, tests stay green.
2. **`EditorToolbar` with the ink group**; delete the per-canvas toolbar. The visible change lands here, and only here.
3. **Text format group.**
4. **Insert group.**
5. **Sheet actions group.**

Steps 3–5 are independent of each other and each small once the bar exists. Step 1 is the one that can be reviewed on its own merits, because it is behaviour-preserving by construction.

## Out of scope

- **Keyboard shortcuts for ink tools.** There are none today and adding them is a separate question about the app's shortcut layer (P2-2), not about where the buttons live.
- **A `Ctrl+Z` that routes between ink and text.** Ink has no key binding at all today; giving it one means deciding what undo means when a canvas is active, which is its own design.
- **Per-canvas pen settings.** The opposite of this design. Pens are global today and stay global.
- **A mobile or narrow-window layout.** Desktop-primary, per the stack.
