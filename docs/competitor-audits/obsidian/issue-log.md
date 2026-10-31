# Issue log

Tracks issue generation for the Obsidian audit (2026-10-31). Repository: TorresVisual/null-notes. Convention source: `.claude/skills/file-issue/SKILL.md` (drafts are shown to the user for approval before `gh issue create`), labels `bug`/`enhancement` plus `low|medium|high` only for bugs; priorities live in the body because the repo has no priority labels for enhancements.

Duplicate search: `gh issue list --repo TorresVisual/null-notes --state all --search "<term>"` for each term below, over all 148 issues (open and closed), plus a read of `docs/ROADMAP.md` §4/§7/§8 and `docs/competitive-gap-analysis-2026-10-26.md`.

## New issues

| Draft | Issue | Features | Title | Labels | Priority | Duplicate-search terms | Search result |
|---|---|---|---|---|---|---|---|
| [D01](issue-drafts/D01.md) | [#149](https://github.com/TorresVisual/null-notes/issues/149) | TG-005 | Notes with YAML frontmatter are rewritten and corrupted when edited | bug,medium | P1 | frontmatter, YAML | No duplicate. #32 is unrelated (TODO.md backslash corruption) |
| [D02](issue-drafts/D02.md) | [#150](https://github.com/TorresVisual/null-notes/issues/150) | SR-003, SR-004, SR-005, SR-006 | Search: support exact phrases, OR, exclusion and grouping | enhancement | P2 | phrase, boolean OR, exclude, search operators | No duplicate. #55 covers only `task:`; #107 only nested tags |
| [D03](issue-drafts/D03.md) | [#151](https://github.com/TorresVisual/null-notes/issues/151) | SR-014 | Search shows at most 20 results and offers no sort order | enhancement | P2 | search operators (limit/sort not found) | No duplicate. none |
| [D04](issue-drafts/D04.md) | [#152](https://github.com/TorresVisual/null-notes/issues/152) | LK-003, LK-004 | Wiki-links can't carry display text or point at a heading | enhancement | P2 | heading link, alias | No duplicate. #71 (closed) shipped `[[` autocomplete only; #122 collisions |
| [D05](issue-drafts/D05.md) | [#153](https://github.com/TorresVisual/null-notes/issues/153) | LK-011 | Embed a note or heading inside another note | enhancement | P3 | embed note, transclusion | No duplicate. none (ROADMAP §4 lists embeds nowhere; query blocks challenged) |
| [D06](issue-drafts/D06.md) | [#154](https://github.com/TorresVisual/null-notes/issues/154) | ED-017, ED-018 | Callouts: foldable ([!type]+/-) and the remaining Obsidian callout types | enhancement | P3 | callout | No duplicate. #102 (callout to flashcard) is a different topic |
| [D07](issue-drafts/D07.md) | [#155](https://github.com/TorresVisual/null-notes/issues/155) | UI-003, UI-004 | Tabs: pin a tab and jump to a tab by number | enhancement | P3 | pin tab | No duplicate. none |
| [D08](issue-drafts/D08.md) | [#156](https://github.com/TorresVisual/null-notes/issues/156) | FL-011, FL-012, FL-013, FL-014 | Notes have no context menu: duplicate, show in Explorer, copy path, move to... | enhancement | P2 | context menu, reveal, duplicate | No duplicate. #124 (multi-select) and #25 (Explorer shell) are different; #121 trash shipped |
| [D09](issue-drafts/D09.md) | [#157](https://github.com/TorresVisual/null-notes/issues/157) | UI-015 | Let users rebind keyboard shortcuts | enhancement | P3 | shortcut, hotkey | No duplicate. #136 (palette) is related, not the same |
| [D10](issue-drafts/D10.md) | [#158](https://github.com/TorresVisual/null-notes/issues/158) | PL-009 | One command to open or create today's dated note | enhancement | P3 | daily | No duplicate. none |
| [D11](issue-drafts/D11.md) | [#159](https://github.com/TorresVisual/null-notes/issues/159) | PL-008 | Bookmarks: pin notes, headings and saved searches in the sidebar | enhancement | P2 | bookmark, pinned, saved search | No duplicate. none; saved searches were recommended in docs/competitive-gap-analysis-2026-10-26.md but never filed |
| [D12](issue-drafts/D12.md) | [#160](https://github.com/TorresVisual/null-notes/issues/160) | PL-003 | Outgoing-links panel: resolved, unresolved and potential links | enhancement | P3 | unresolved, orphan, outgoing | No duplicate. #48 (unlinked mentions of the note itself) is the reverse direction |
| [D13](issue-drafts/D13.md) | [#161](https://github.com/TorresVisual/null-notes/issues/161) | PL-013 | Extract selected text into a new note, and merge two notes | enhancement | P3 | extract, merge notes | No duplicate. none |
| [D14](issue-drafts/D14.md) | [#162](https://github.com/TorresVisual/null-notes/issues/162) | ED-026 | Fold headings and lists in long notes | enhancement | P3 | fold, collapse heading | No duplicate. none |

## Existing issues reused (no new issue)

| Issue | State | Features | Note |
|---|---|---|---|
| #55 | OPEN | SR-011 | Covers the gap |
| #58 | OPEN | LK-017 | Covers the gap |
| #107 | OPEN | TG-002, SR-008 | Covers the gap |
| #121 | OPEN | FL-010 | Trash is committed (f471075); issue still open. Needs closing. |
| #123 | OPEN | FL-016 | Covers the gap |
| #124 | OPEN | FL-017 | Covers the gap |
| #135 | OPEN | FL-015 | Covers the gap |
| #136 | OPEN | UI-013 | Feature is already committed (bb0a94a); the issue is still open. Needs closing, not a new issue. |
| #138 | OPEN | UI-020 | Covers the gap |
| #139 | OPEN | UI-021 | Covers the gap |
| #140 | OPEN | IM-018 | Covers the gap |
| #141 | OPEN | UI-024 | Docs mismatch; auto-update ships. |
| #142 | OPEN | ON-003 | Covers the gap |
| #143 | OPEN | UI-019 | Covers the gap |
| #144 | OPEN | ON-001 | Covers the gap |

## Totals

| Measure | Count |
|---|---|
| New issues drafted | 14 |
| New issues created on GitHub | 14 (#149-#162) |
| Existing issues reused | 15 |
| Unresolved / blocked | 0 blocked; 9 features unverified (no issue, need checking) |

Drafts were not filed because the repository's `file-issue` workflow requires showing the full batch for approval before `gh issue create`. After approval, record the issue numbers here and in `feature-inventory.json` (`issue_status` -> `filed`).

## Observations for the maintainer

- #136 (action palette) and #121 (recoverable delete) are open but implemented in committed code (bb0a94a, f471075).
- `.claude/product-audit/` (the repo's knowledge base) still lists "Delete with recoverability" as Missing; it predates f471075.
