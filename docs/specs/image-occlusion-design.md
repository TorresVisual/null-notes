# Image occlusion cards (#64)

## Problem

A card could show one whole image on each side, so it could not test recall of one labelled part of a diagram. Image occlusion hides one region of an image on the front and shows it on the back; marking six labels should give six independently scheduled cards.

## Identity: one region, one line

A card's identity is its line plus the `<!-- sr … -->` comment under it. The schedule is stored *with* the line, so it follows the line through edits, reordering and saving. Putting several cards behind one source line would need a second identity scheme (a sub-card index or an id) and a place to keep each sub-card's schedule. Instead each region is its own line:

```
![Pipeline](Lecture%207.assets/p.png "occlude=0.1,0.2,0.3,0.1")
<!-- sr due=2026-08-21 ease=2.50 interval=6 reps=2 -->
![Pipeline](Lecture%207.assets/p.png "occlude=0.5,0.5,0.25,0.25")
```

- The title is `occlude=x,y,w,h`: left, top, width, height as fractions of the image, so a region survives the image being shown at any size.
- Every region of one diagram carries the same `src`; that is the only association between them, and it needs no extra storage.
- `extract_cards` recognises the whole line (`parse_occlusion_line`, `commands/notes.rs`) before the Q::A and cloze checks, because alt text is free text. A rectangle that is not a real region (outside 0–1, zero-sized, not four numbers) is not a card, so a mangled title is just an image.
- Kind `occlusion`. `review_cards.kind` is free text, so there is no schema change, and `grade_card_line` / `set_card_suspended_line` work unchanged because they go through `classify_card_line`.
- The back is the same image with `reveal=` instead of `occlude=`: the region is outlined rather than hidden. Both are derived from the line at extraction time, never stored.

Existing cards, their `sr` comments and their review history are untouched.

## Authoring

An "Occlusion cards" button on a `NoteImage` (hover) and a `DiagramBlock` opens `OcclusionDialog`: drag to draw any number of regions, click one to remove it, confirm to insert one paragraph per region after the source block (`insertOcclusionCards`). A diagram is addressed by its exported `.svg` sidecar, the same note-relative path "Copy for card" already uses.

In the note each card is a thumbnail of the image with its region marked, so cards are visible and can be deleted like any other image. They are not sources for further cards.

## Rendering

`CardText` parses the image title and draws `OcclusionBox` over the image, so the review session and deck view get it for free. The review session drops the front once an occlusion card is revealed, because the back is the same image and would otherwise appear twice. `useResolvedAssetSrc` now gives `.svg` files the `image/svg+xml` type; a bare `image` type is only sniffed for raster formats.

## Limitations

- Regions are rectangles, and cannot be edited after creation: delete the line and draw it again. A card's schedule goes with its line.
- Mermaid blocks have no image file, so they cannot be a source. Export or screenshot into an image first.
- `position` is still a line index, so a note edited on disk between building the review queue and grading is subject to the same staleness check every other card has.
