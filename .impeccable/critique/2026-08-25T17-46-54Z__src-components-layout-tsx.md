---
target: main editor shell
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-25T17-46-54Z
slug: src-components-layout-tsx
---
## Design Health Score: 27/40 (Good)
| # | Heuristic | Score |
|---|---|---|
|1|Visibility of System Status|3|
|2|Match System/Real World|3|
|3|User Control and Freedom|3|
|4|Consistency and Standards|3|
|5|Error Prevention|3|
|6|Recognition Rather Than Recall|1|
|7|Flexibility and Efficiency|3|
|8|Aesthetic and Minimalist Design|3|
|9|Error Recovery|3|
|10|Help and Documentation|2|

## Design Specificity Verdict
Token layer genuinely applied (accent underline, mono for tags/code), but shell composition (sidebar tree, tab strip, outline rail) is generic Markdown-app structure — no per-note-type iconography for ink/PDF-imported notes despite that being the named differentiator. No live screenshot this pass (needs real note data); evaluated from source.

## Priority Issues
[P1] Graph View, Task View, Review, Terminal, Formula Sheet have no discoverable UI entry point — menu-only (WebView2-unreliable per the code's own comment) or memorized shortcuts. Command: onboard.
[P1] No close-tab/cycle-tab shortcut despite KEY_COMMANDS covering 14 other actions (Layout.tsx:246-262). Command: adapt.
[P2] Tab titles don't truncate (.tab button, index.css:272-280, white-space:nowrap, no max-width/ellipsis). Command: layout.
[P2] Outline rail (.outline-ticks) has no overflow handling for heading-heavy notes. Command: layout.
[P3] BacklinksPanel always mounts even at 0 results on a brand-new note.

## Strengths
useOverlayManager centralizes overlay state (prevents stacking by construction). Outline rail tracks cursor section via selectionchange, not scroll. Save/git status handling unusually complete for a solo project.

## Persona Red Flags
Alex: no mouse-free tab close/cycle; Formula Sheet has no keyboard entry at all.
Riley: long tab titles break layout; switching tabs silently resets raw-mode choice to WYSIWYG (Layout.tsx:283-285).
