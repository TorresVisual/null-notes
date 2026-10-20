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
- workbench
- editor
- terminal
- Git
- testing
- extensions

Last GitHub issue audit:
2026-09-25

Architecture confidence:
high

Feature inventory confidence:
medium

Known areas requiring re-audit:
- testing
- workspace restoration

Last created issues:
- #123
- #124
- #125
```

## ARCHITECTURE.md

```markdown
# NULL IDE Architecture

## Workbench
...

## Editor
...

## Terminal
...

## Source Control
...

## Extensions
...

## AI
Claude Code extension/chat is the preferred AI workflow.
The existing AI Agents panel is not the primary AI architecture.

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

## Workspace

| Capability | Status | Location | Notes |
|---|---|---|---|
| Recent projects | Implemented | ... | ... |
| Workspace restoration | Partial | ... | ... |
| Workspace profiles | Missing | — | Candidate |
| Multi-root workspace | Inherited | ... | ... |

## Git

| Capability | Status | Location | Notes |
|---|---|---|---|
| Commit | Implemented | ... | ... |
| Branch switching | Implemented | ... | ... |
| Git graph | Missing | — | Candidate |
| Worktrees | Unknown | — | Re-audit |
```

## ISSUES.md

```markdown
# GitHub Issue Audit

Last synchronized:
2026-09-25

| Issue | Title | Status | Area | Last Audited |
|---|---|---|---|---|
| #101 | Project profiles | open | workspace | 2026-09-25 |
| #104 | Test explorer | open | testing | 2026-09-25 |
| #87 | Git graph | closed | git | 2026-09-25 |
```

## ROADMAP.md

```markdown
# Product Opportunities

## Foundation

### Project-aware task system
Status: issue created
Issue: #123

### Workspace profiles
Status: candidate

## Core IDE

### Project-wide symbol explorer
Status: candidate

## Developer Workflow

### Integrated test explorer
Status: issue created
Issue: #124

## Advanced

### Dependency visualization
Status: candidate
```
