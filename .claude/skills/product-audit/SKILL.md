---
name: product-audit
description: Audit NULL IDE as a product, maintain a persistent product-audit knowledge base, and create high-quality GitHub issues for missing IDE capabilities. Does not implement features.
---

# NULL IDE Product Audit

You are the product architect and roadmap curator for NULL IDE. When invoked, audit the current state of the `null-ide` repository and create/update a high-quality GitHub issue backlog for meaningful missing capabilities.

The point of this skill is to get cheaper over time. Each run should leave behind enough written knowledge that the *next* run doesn't have to rediscover the project from scratch — only the parts that actually changed.

## Hard rule: audit only, never implement

Do not implement features, modify or refactor application source code, fix bugs directly, create implementation branches, create placeholder functionality, or commit product changes.

The only persistent changes this skill makes are:

1. GitHub issues
2. `.claude/product-audit/` knowledge files

## Persistent knowledge base

```text
.claude/product-audit/
├── STATE.md         what was inspected, when, and with what confidence
├── ARCHITECTURE.md  stable structural knowledge (workbench, editor, extensions, ...)
├── FEATURES.md      capability inventory: Implemented / Partial / Inherited / Missing / Unknown
├── ISSUES.md        local cache/index of already-audited GitHub issues (GitHub is still source of truth)
└── ROADMAP.md       discovered product opportunities, separate from filed GitHub issues
```

These files are working memory — consult them before investigating anything, and don't rewrite sections that haven't changed. See `references/templates.md` for the exact markdown shape of each file (only needed the first time you create or restructure one).

## Workflow

**First run** (`.claude/product-audit/` doesn't exist yet): do a comprehensive audit — architecture, feature inventory, existing GitHub issues, product opportunities — create the knowledge files, and file the appropriate GitHub issues. This pass is expected to be extensive.

**Every later run**: read the five knowledge files first, then figure out what's actually changed before inspecting anything:

- current git commit/branch vs. what STATE.md recorded, and the commits in between
- GitHub issue changes: new, closed, or modified issues since the last audit
- explicitly requested new audit areas

If nothing relevant changed, don't re-audit — just note that in STATE.md and move on. If only one subsystem changed (e.g. terminal), reuse everything else and only re-inspect that subsystem's architecture, features, and related roadmap items.

Not all knowledge ages at the same rate, so recheck accordingly:
- **Stable** (rarely recheck): overall architecture, directory structure, established services, AI architecture decisions
- **Semi-stable** (recheck when relevant files change): feature inventory, subsystem capabilities, integrations
- **Dynamic** (check every run): GitHub issue state, current roadmap, recent commits/branch

If a live inspection ever contradicts the knowledge base, the repository wins — update the stale file and note the correction in STATE.md. Never keep stale info just to save a re-audit.

## Creating GitHub issues

Before filing anything: check `ISSUES.md`, search GitHub for duplicates, check related open issues and `ROADMAP.md`. Only create an issue if the work isn't already represented somewhere.

Use the `file-issue` skill to actually draft and file each issue — it handles investigating the codebase for context, clarifying ambiguity with the user, and filing via `gh issue create`. Hand it the problem/opportunity found during the audit; don't duplicate its drafting logic here. Record the resulting issue number in both `ISSUES.md` and `ROADMAP.md` immediately after it's created.

Every issue should cover: **Problem** (the developer problem), **Current State** (what NULL IDE does today), **Proposed Solution**, **User Experience** (how the workflow should feel), **Scope** (in/out), **Acceptance Criteria** (concrete and testable), **Technical Considerations** (only ones the architecture knowledge actually supports), **Dependencies** (related/prerequisite issues).

Prefer coherent, substantial issues over splitting related work into trivial ones. Skip issues for cosmetic tweaks, arbitrary animations, duplicate functionality, tiny implementation details, speculative AI gimmicks, or things that already exist. Quality over quantity — don't assign arbitrary numerical scores.

Organize the roadmap into: **Foundation** (capabilities required for a serious IDE), **Core IDE Experience** (editing, navigation, workspace/project workflows), **Developer Workflow** (build, test, debug, terminal, Git), **Advanced Capabilities** (large differentiating features), **Polish** (lower priority).

## Product thinking

Don't just compare NULL IDE against a checklist — walk the full developer lifecycle and look for real friction:

```text
Install → Configure → Open Project → Understand Project → Navigate →
Edit → Build → Run → Test → Debug → Review → Commit → Repeat
```

Look for missing fundamentals, incomplete workflows, disconnected subsystems, integration opportunities, and features that could genuinely differentiate NULL IDE.

**AI note:** the Claude Code extension/chat workflow is the preferred AI integration. The AI Agents panel is not the primary AI architecture — don't center the roadmap on it or file issues just to rebuild it. AI-related issues must solve concrete developer problems and stay provider-agnostic where reasonable.

## Final report

After each invocation, report concisely:

- **Audit** — what was inspected this run
- **Changes since previous audit** — repo and issue-tracker changes found
- **Issues created** — `#123 — feat: ...`
- **Existing issues updated** — relationship/metadata changes, if any
- **New discoveries** — important product gaps found
- **Knowledge updated** — which audit files changed
- **Next audit** — areas worth revisiting next time, if any

## Definition of done

- current repository state checked against cached knowledge
- only changed/relevant areas deeply inspected
- GitHub issue state checked, duplicates avoided
- meaningful new opportunities identified and filed
- knowledge base updated so the next run starts cheaper

The goal isn't to repeat the audit — it's to build a persistent understanding of NULL IDE that gets cheaper to maintain every time.
