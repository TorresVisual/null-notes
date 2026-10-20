# null-notes — Full-Screen Ink Editor Design

**Date:** 2026-10-20
**Scope:** Sub-project 1 of 4 in the "make free drawing feel like OneNote" effort. The others each get their own spec → plan cycle:

2. **Draw-tab toolbar** — pen gallery with colour/thickness flyouts (needs the room this project creates).
3. **Infinite page** — surface grows in every direction; changes the stored ink bounds, so it needs a format-migration decision.
4. **Pen feel** — smoothing, latency, pressure tuning (independent).

---

## Goal

Adding a canvas to a note opens a full-window drawing surface. In the note, an ink block is a static preview that re-opens the editor. All drawing happens full-screen.

## Non-Goals

- No freeform 2D canvas — `docs/ROADMAP.md` §1 closed that ("Won't build"). The ink block stays one block in the Markdown flow, so principle #1 is unaffected.
- No toolbar redesign, infinite page or pen-feel changes (sub-projects 2–4).
- No change to `PdfPageBlock`'s ink overlay, which keeps using `InkCanvas` inline.
- No storage change: the `NoteName.ink/*.svg` sidecar stays inside the workspace (see CLAUDE.md "The storage boundary").

---

## Design

### `InkEditorOverlay` (new, `src/ink/InkEditorOverlay.tsx`)

A `createPortal` to `document.body` that fills the viewport. Wraps the existing `InkCanvas` (width/height from the block, `autoGrow`, zoom state owned by the overlay), with a Done button and Esc to close. `InkCanvas` already writes the sidecar as strokes are committed, so closing saves nothing — it only reports back so the block can refresh its preview. Follows `DiagramEditorOverlay` (portal, lazy-loaded not needed — `InkCanvas` is already in the main bundle).

The page keeps its stored width/height, anchored top-left (with a fixed padding gutter) on a neutral background inside an overlay-owned scroll container — not centred, so the infinite-page scroll compensation in `ink-infinite-page-design.md` is exactly `growth × zoom`; the overlay never resizes the stored page (that is sub-project 3's format decision). `InkCanvas`'s `scrollAncestors` finds the nearest scrolling ancestor (overlay body or `.editor-scroll`) instead of hard-coding `.editor-scroll`, so one-finger touch pan works in the portal.

`InkCanvas` registers itself as the active canvas on pointer-down, so `InkToolGroup` in the editor toolbar works unchanged — but the overlay covers the toolbar, so the overlay must render its own tools. Sub-project 1 ships by reusing `InkToolGroup` in the overlay header; `ink-draw-ribbon-design.md` then supersedes that with `DrawRibbon`.

**Keyboard.** The note editor stays mounted behind the overlay, so the overlay takes focus on open, handles Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y itself via the active canvas's `undo`/`redo`, and stops its keydown events reaching the editor (otherwise undo would silently edit the note behind it). Esc closes only if the key wasn't already handled by the canvas's text editor (`defaultPrevented`, bubble phase). Android Back is out of scope; Done works there.

**Session state.** Closing unmounts the canvas, so undo history and zoom reset on every open; only strokes persist.

### `InkBlock` view (`src/editor/extensions/InkBlock.ts`)

- `inline` attr (default `false`). When true, render `InkCanvas` exactly as today.
- Otherwise render a static preview: read the sidecar SVG, pass it through `sanitizeNoteHtml` (same trust boundary as `DiagramBlock` — a synced workspace file), show an Edit button; clicking the preview or Edit opens `InkEditorOverlay`.
- Preview scales the whole page to fit a max height (~320px), uncropped. An empty drawing shows a placeholder ("Empty drawing — click to draw"); closing without drawing keeps the block and its sidecar.
- Edit button and click-to-open only work when `editor.isEditable`; otherwise the preview is inert.
- `InkCanvas` writes are fire-and-forget, so re-reading "on close" could lag the last stroke. `InkCanvas`/`useInkCanvas` take an optional `onSaved` callback fired when a write resolves; the block re-reads the preview on each call (and once on close).
- `insertInk` dispatches `ink:auto-open` with the new `src` (mirrors `diagram:auto-open`); the matching block opens the overlay immediately.

### Canvas notes

A canvas note is an ordinary note whose body starts with an ink block, so staying inline needs a marker: an optional `inline: true` field in the ```` ```ink ```` fence JSON.

- `useCreateCanvasNote` / `canvasNoteBody` write it.
- Parser defaults it to `false`; serializer writes it only when `true`, so ordinary blocks keep their current fence.
- **Existing canvas notes** have no flag and become previews. One-time change, accepted; a "first block after the heading" heuristic would be implicit.
- Solution-ink blocks (`solutionInk.ts`) and `splitIntoTasks` blocks are unflagged → previews.

### Styling

Reuse the `.diagram-editor-*` shell classes with a full-window variant (no inset padding). Grep `index.css` for every new className before calling it done (see CLAUDE.md "Dialog CSS gap"); register the overlay in the `surface-in` keyframe list if applicable.

---

## File Structure

| File | Change |
|---|---|
| `src/ink/InkEditorOverlay.tsx` | New |
| `src/ink/InkCanvas.tsx`, `src/ink/useInkCanvas.ts` | `onSaved` callback; `scrollAncestors` finds nearest scrolling ancestor |
| `src/editor/extensions/InkBlock.ts` | `inline` attr; preview vs inline view; auto-open listener; fence parse/serialize |
| `src/editor/toolbar/insertInk.ts` | Dispatch `ink:auto-open` after insert |
| `src/lib/canvasNote.ts` | Write `inline: true` in the fence |
| `src/index.css` | Full-window overlay variant, preview/Edit styles |

## Testing

- Mount test for `InkBlock` (preview, empty placeholder, inline, auto-open, Esc/Done close, Esc ignored while text editing, inert when not editable, preview refreshes on `onSaved`)
- Overlay keyboard: Ctrl+Z/Y undo/redo the canvas and don't reach the editor, modelled on `diagramBlockMount.test.tsx`.
- Fence round-trip: `inline` absent → false → not written; `inline: true` survives parse → serialize.
- `canvasNote.test.ts` updated for the flag.
- e2e (`e2e-verify` skill): insert canvas → overlay opens → draw → Done → preview shows the stroke; canvas note stays inline.
- `npm run typecheck`, `npm test`.
