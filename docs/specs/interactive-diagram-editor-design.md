# null-notes — Interactive Diagram Editor Design

**Date:** 2026-08-28
**Scope:** A new diagram block backed by Excalidraw — boxes, arrows, and connectors that stay attached, resizable/alignable shapes — as a third diagramming option alongside Mermaid (P14) and the ink canvas (P13). Reverses roadmap decision P14-3.

---

## Why this reverses P14-3

P14-3 ("Memory / CPU-register / network diagrams") decided not to build a structured diagram primitive, reasoning that ink's `rect`/`line`/`arrow` shapes plus P13-3's text labels already amount to a box-and-arrow tool. That reasoning doesn't hold up under actual use: ink shapes are independent freehand-drawn objects. Moving a box doesn't drag its arrows with it, there's no resize handle, no snapping, no alignment guide, and no way to reflow a diagram once drawn. Mermaid's guided templates (P14) solve a different problem — diagram-as-text for shapes a grammar can express — and explicitly can't cover memory layouts, register diagrams, or network topologies at all.

This is not a replacement for either. Mermaid stays for people who want to type a diagram as code; ink stays for freehand sketching. This adds the missing third option: an interactive, structured canvas for diagrams that need real connectors and layout, maintainer-confirmed to be worth building despite P14-3's original call.

---

## Goals

- A `DiagramBlock` TipTap node, insertable via `/diagram` and a toolbar button, that opens a full Excalidraw editor and shows a static rendered preview inline in the note otherwise.
- Diagrams are workspace content: stored as sidecar files next to the note, travel with it exactly like ink and PDF sidecars do.
- Fully offline — no CDN dependency for fonts or the editor itself.

## Non-Goals

- No `.drawio`/mxGraph XML import or export, no postMessage bridge to a real draw.io instance.
- No live multi-cursor collaboration.
- No always-on inline canvas — editing is click-to-open, matching ink's click-to-draw-then-view model rather than Mermaid's always-rendered one, to keep long notes scrollable and avoid mounting N interactive canvases at once.
- No attempt to make Mermaid or ink "better" as part of this work; both are untouched.

---

## Storage

Follows `ink.rs`'s existing sidecar convention exactly, one directory per kind, named after the note:

```
Lecture 7.md
Lecture 7.diagrams/
  diagram-1730000000000.excalidraw   <- JSON scene, the editable source of truth
  diagram-1730000000000.svg          <- cached render, what the note actually displays
```

Two files instead of ink's one, because an Excalidraw scene carries editing-only state (selection, grouping, bound-element ids) that has no equivalent in a static SVG — unlike ink, where the SVG *is* the full round-trippable format. The `.svg` is regenerated only at the moment the editor closes and saves; there is exactly one writer, so the preview can never go stale relative to the source.

`src-tauri/src/commands/diagrams.rs` mirrors `ink.rs` one-for-one:

```rust
fn diagrams_dir_for(note_path: &str) -> String   // "<stem>.diagrams" sibling dir
ensure_diagrams_dir(note_path: String) -> Result<String, String>
read_diagram(path: String) -> Result<String, String>   // returns the .excalidraw JSON
write_diagram(json_path: String, json: String, svg_path: String, svg: String) -> Result<(), String>
```

`write_diagram` takes both paths/contents in one call so a save is one round trip, not two — avoids a window where the JSON is written but the app crashes before the SVG follows (or vice versa), which would otherwise need reconciliation logic on next load.

---

## Frontend

### `src/lib/diagram.ts` — IPC wrapper

Mirrors `src/lib/ink.ts`:

```ts
export const diagramApi = {
  ensureDir: (notePath: string) => invoke<string>('ensure_diagrams_dir', { notePath }),
  read: (jsonPath: string) => invoke<string>('read_diagram', { path: jsonPath }), // raw JSON string
  write: (jsonPath: string, json: string, svgPath: string, svg: string) =>
    invoke<void>('write_diagram', { jsonPath, json, svgPath, svg }),
}
```

Kept as raw JSON string in/out (unlike `inkApi`, which converts to/from `InkData`) — the scene shape is Excalidraw's own `ExcalidrawElement[]`/`AppState`, owned entirely by the library; this app has no reason to model it.

### `src/editor/extensions/DiagramBlock.tsx`

Structurally identical to `InkBlock.ts`: an atom node with `jsonSrc`, `svgSrc`, `width`, `height` attributes, parsed/serialized to a ```` ```diagram ```` fence carrying that JSON (same shape as `ink`'s fence). The node view renders the cached SVG as an `<img>` (not `dangerouslySetInnerHTML` — the SVG is a static file on disk, not editor-generated markup) with an edit affordance overlaid on hover, matching how other atom blocks in this app signal "click to act."

Clicking opens `DiagramEditorOverlay` — a full-viewport modal (same chrome family as `.search-modal`/`.settings-panel` per the design-tokens bridge) mounting `<Excalidraw>` with `initialData` loaded from the `.excalidraw` JSON. Closing calls `exportToSvg` (via `@excalidraw/excalidraw`'s exported utility, headless — no second mount) on the current scene, writes both files through `diagramApi.write`, and swaps the block back to its static preview with the new SVG.

### Insertion

`src/editor/toolbar/insertDiagram.ts`, mirroring `insertInk.ts`'s shared-helper comment exactly (both the slash command and the toolbar button call it, so the sidecar-then-node sequence has one copy):

```ts
export async function insertDiagram(editor: Editor, notePath: string): Promise<void> {
  const dir = await diagramApi.ensureDir(notePath)
  const id = Date.now()
  const jsonPath = `${dir}/diagram-${id}.excalidraw`
  const svgPath = `${dir}/diagram-${id}.svg`
  await diagramApi.write(jsonPath, EMPTY_SCENE_JSON, svgPath, EMPTY_SVG)
  editor.commands.insertContent({ type: 'diagramBlock', attrs: { jsonSrc: jsonPath, svgSrc: svgPath, width: DIAGRAM_WIDTH, height: DIAGRAM_HEIGHT } })
}
```

Inserting immediately opens the editor overlay (unlike ink, which drops an empty canvas inline) — an empty diagram block with nothing drawn yet has no useful static preview to show, so there's no reason to land back in the note first.

`SlashCommands.tsx` gets one new entry, `"Diagram"` / *"Interactive boxes, arrows and connectors"* — distinct wording from the existing Mermaid entries (`Flowchart`, `Class Diagram`, etc.) so the two families read as different tools, not two ways to make the same flowchart. `InsertGroup.tsx`/`EditorToolbar.tsx` get a matching toolbar button next to the existing ink button.

### Offline fonts

Excalidraw fetches its fonts (Virgil, Cascadia, etc.) from a CDN by default, which this app cannot depend on. `node_modules/@excalidraw/excalidraw/dist/prod/fonts` is copied to `public/excalidraw-fonts/` (checked into the repo, not gitignored — same treatment as any other bundled static asset) and `index.html` sets `window.EXCALIDRAW_ASSET_PATH = '/excalidraw-fonts/'` before the app script loads.

---

## File Structure

| File | Change |
|---|---|
| `src-tauri/src/commands/diagrams.rs` | New — `ensure_diagrams_dir`/`read_diagram`/`write_diagram`, registered in `lib.rs`'s invoke handler |
| `src/lib/diagram.ts` | New — IPC wrapper |
| `src/editor/extensions/DiagramBlock.tsx` | New — TipTap atom node, markdown fence serialize/parse, static preview + edit overlay |
| `src/editor/toolbar/insertDiagram.ts` | New — shared insertion helper |
| `src/editor/extensions/SlashCommands.tsx` | New `"Diagram"` entry |
| `src/editor/toolbar/InsertGroup.tsx`, `EditorToolbar.tsx` | New toolbar button |
| `public/excalidraw-fonts/` | New — vendored font files |
| `index.html` | Set `window.EXCALIDRAW_ASSET_PATH` |
| `src/index.css` | New `.diagram-block`/`.diagram-editor-overlay` rules, reusing the existing dialog-chrome tokens |
| `package.json` | Add `@excalidraw/excalidraw` |

No existing files are deleted or behaviourally changed — Mermaid and ink are untouched.

---

## Testing

- `src/editor/extensions/DiagramBlock.tsx`: markdown fence round-trip (serialize → parse → same attrs), mirroring `inkBlockMount.test.tsx`'s coverage.
- `src/editor/toolbar/insertDiagram.ts`: unit test with a mocked `diagramApi`, asserting the ensureDir → write → insertContent sequence and the node's attrs.
- `src-tauri/src/commands/diagrams.rs`: same shape as `ink.rs`'s existing tests — dir naming, write-then-read round trip, using `tempdir()`.
- No test drives the real `<Excalidraw>` component or a real `exportToSvg` call — jsdom has no canvas/SVG layout engine, the same trade-off already recorded throughout ink and Mermaid coverage. The overlay's open/close/save wiring is verified manually in `npm run tauri dev`: insert a diagram, draw a few connected shapes, close, confirm the preview matches, reopen, confirm the scene (not just the picture) is intact, move a box and confirm its arrow follows.
- Not attempted as an e2e (`npm run test:e2e`) spec initially — every diagram-adjacent e2e attempt this session (ink text tool, Mermaid templates) hit the same slash-menu driver-timing flake; revisit once that's independently fixed rather than adding a fourth flaky spec on top of it.

---

## Roadmap follow-up

Once shipped, `docs/ROADMAP.md`'s P14-3 entry and its §4 "Won't build" row get a **Reversed** annotation (same treatment already given to the brand-identity/onboarding/micro-interactions reversals in §4), pointing at this spec and recording that the maintainer's own daily use of Mermaid templates is what triggered the reversal — not a new decision process, an overridden one.
