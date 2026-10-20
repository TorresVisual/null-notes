# Knowledge File Templates

Exact markdown shape for each file in `.claude/product-audit/`. Read this when creating a file for the first time or when unsure how to format an update — don't reread it on every invocation once you know the shape.

## STATE.md

```markdown
# Audit State

Last audit:
2026-09-25

Repository state:
<commit or branch information>

Last inspected areas:
- editor
- ink
- search
- Git
- PDF import (UI only)
- study

Last GitHub issue audit:
2026-09-25

Architecture confidence:
high

Feature inventory confidence:
medium

Known areas requiring re-audit:
- export
- multi-machine sync

Last created issues:
- #123
- #124
- #125
```

## ARCHITECTURE.md

```markdown
# null-notes Architecture

## Editor (TipTap extensions, markdown round-trip)
...

## Save path & storage boundary
...

## Search / index (SQLite)
...

## Ink & diagrams
...

## PDF pipeline (frozen)
...

## Git automation
...

## Terminal / code execution / IDE links
...

## Study (spaced repetition, tasks, formula sheet, dashboard)
...

## AI
Gated stretch (docs/ROADMAP.md P10-1); not a roadmap centre.

## Important Entry Points
...

## Important Services
...

## Known Architectural Constraints
...
```

## FEATURES.md

Statuses: `Implemented`, `Partial`, `Inherited`, `Missing`, `Unknown`.

```markdown
# Feature Inventory

## Editor

| Capability | Status | Location | Notes |
|---|---|---|---|
| Find/replace in note | Implemented | src/editor/extensions/FindReplace.ts | ... |
| Wiki-link rename | Implemented | ... | ... |
| Note version history | Missing | — | Candidate |
| Block drag-and-drop | Unknown | — | Re-audit |

## Study

| Capability | Status | Location | Notes |
|---|---|---|---|
| Spaced repetition | Implemented | ... | ... |
| Export to PDF | Partial | ... | via print |
| Anki export | Missing | — | Candidate |
```

## ISSUES.md

```markdown
# GitHub Issue Audit

Last synchronized:
2026-09-25

| Issue | Title | Status | Area | Last Audited |
|---|---|---|---|---|
| #101 | Note version history | open | editor | 2026-09-25 |
| #104 | Anki deck export | open | study | 2026-09-25 |
| #87 | Find/replace in note | closed | editor | 2026-09-25 |
```

## ROADMAP.md

```markdown
# Product Opportunities

## Foundation

### Note version history
Status: issue created
Issue: #101

## Core Editing

### Block drag-and-drop
Status: candidate

## Study Workflow

### Anki deck export
Status: issue created
Issue: #104

## Workspace & Sync

### Cross-machine conflict surfacing
Status: candidate

## Advanced

### Handwriting search
Status: candidate

## Polish

```
