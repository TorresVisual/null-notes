---
target: settings panel
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-08-25T17-46-54Z
slug: src-components-settingspanel-tsx
---
## Design Health Score: 21/40 (Acceptable)
| # | Heuristic | Score |
|---|---|---|
|1|Visibility of System Status|2|
|2|Match System/Real World|3|
|3|User Control and Freedom|1|
|4|Consistency and Standards|3|
|5|Error Prevention|1|
|6|Recognition Rather Than Recall|4|
|7|Flexibility and Efficiency|2|
|8|Aesthetic and Minimalist Design|2|
|9|Error Recovery|1|
|10|Help and Documentation|2|

## Design Specificity Verdict
Copy is genuinely product-specific; composition is a generic label-left/control-right template stretched across 1040px at ~40% content fill. Accent color never appears in the static render.

## Priority Issues
[P0] Reset to defaults (SettingsPanel.tsx:334) has zero confirmation, unlike the Git push toggle's two confirm() dialogs. Command: harden.
[P1] min/max on numeric inputs are decorative, never enforced in JS; .is-error (index.css:2202) defined, zero consumers. Command: harden.
[P1, a11y] Unchecked checkbox: --bg-sunken on --bg-raised, ~1px border only, very low contrast at 16px. Command: harden.
[P2] ~700px dead gutter per row, panel sized for the Git section's prose. Command: layout.

## Persona Red Flags
Sam: invisible checkbox relies on color alone; failed save has no aria-live.
Alex: Reset can nuke a hand-configured Editor command/Terminal shell with one misclick.
