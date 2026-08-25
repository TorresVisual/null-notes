---
target: workspace picker (first-run screen)
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 1
timestamp: 2026-08-25T17-46-53Z
slug: src-components-workspacepicker-tsx
---
## Design Health Score: 25/40 (Acceptable)
| # | Heuristic | Score |
|---|---|---|
|1|Visibility of System Status|3|
|2|Match System/Real World|3|
|3|User Control and Freedom|3|
|4|Consistency and Standards|4|
|5|Error Prevention|1|
|6|Recognition Rather Than Recall|3|
|7|Flexibility and Efficiency|2|
|8|Aesthetic and Minimalist Design|4|
|9|Error Recovery|1|
|10|Help and Documentation|1|

## Design Specificity Verdict
Category-interchangeable below the logo mark. `.workspace-picker-tagline` exists in index.css (cites P9.5-7) but is never rendered in WorkspacePicker.tsx — confirmed via git history: added in 5394c02, deleted in b2f23cf three days later while the icon mark was added.

## Priority Issues
[P0] Differentiator copy styled but not rendered — restore tagline naming plain-.md ownership / PDF-to-LaTeX pipeline. Command: clarify.
[P1] No error state for a failed workspace open (moved/deleted/permission-denied folder). Command: harden.
[P2] No keyboard path or drag-and-drop on primary CTA. Command: adapt.

## Persona Red Flags
Jordan: no reassurance notes stay as normal owned files.
Alex: no shortcut on primary CTA; recents paths need hover to read.
