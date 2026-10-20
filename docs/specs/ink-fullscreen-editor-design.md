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

`InkCanvas` registers itself as the active canvas on pointer-down, so `InkToolGroup` in the editor toolbar works unchanged — but the overlay covers the toolbar, so the overlay must render the ink tool group itself (reuse `InkToolGroup` inside the overlay header).

### `InkBlock` view (`src/editor/extensions/InkBlock.ts`)

- `inline` attr (default `false`). When true, render `InkCanvas` exactly as today.
- Otherwise render a static preview: read the sidecar SVG, pass it through `sanitizeNoteHtml` (same trust boundary as `DiagramBlock` — a synced workspace file), show an Edit button; clicking the preview or Edit opens `InkEditorOverlay`. On close, re-read the preview.
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
| `src/editor/extensions/InkBlock.ts` | `inline` attr; preview vs inline view; auto-open listener; fence parse/serialize |
| `src/editor/toolbar/insertInk.ts` | Dispatch `ink:auto-open` after insert |
| `src/lib/canvasNote.ts` | Write `inline: true` in the fence |
| `src/index.css` | Full-window overlay variant, preview/Edit styles |

## Testing

- Mount test for `InkBlock` (preview, inline, auto-open, Esc/Done close), modelled on `diagramBlockMount.test.tsx`.
- Fence round-trip: `inline` absent → false → not written; `inline: true` survives parse → serialize.
- `canvasNote.test.ts` updated for the flag.
- e2e (`e2e-verify` skill): insert canvas → overlay opens → draw → Done → preview shows the stroke; canvas note stays inline.
- `npm run typecheck`, `npm test`.
