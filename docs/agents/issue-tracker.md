# Issue tracker: GitHub Issues

Bugs and features are tracked as GitHub Issues on `TorresVisual/null-notes`
(IDE-side items on `TorresVisual/null-ide`) — not in `TODO.md`. `TODO.md`
keeps the phased roadmap checklist and a historical log of closed items;
`docs/ROADMAP.md` holds the reasoning and Definitions of Done — if the two
disagree, the roadmap wins.

## When a skill says "publish to the issue tracker"

Use the `file-issue` skill (`.claude/skills/file-issue/SKILL.md`): it
investigates the codebase for context, asks the user to clarify anything
ambiguous, drafts title/body/labels for review, then files with
`gh issue create`. Don't file straight from a raw note without going through
it — a note filed as-is often can't be acted on by a session that starts
cold.

## When a skill says "fetch the relevant ticket"

`gh issue view <number> --repo TorresVisual/null-notes` (or `null-ide` for
IDE-side tickets).
