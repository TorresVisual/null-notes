---
name: file-issue
description: Turns a rough, badly-worded bug report or feature idea into a proper GitHub issue on TorresVisual/null-notes — investigates the codebase for context, asks the user for clarification on anything ambiguous, drafts title/body/labels for review, then files it with gh issue create. Use when the user hands you a rough note to turn into a trackable issue, or to migrate an item out of TODO.md's "TODO's" section.
---

# Filing a GitHub issue from a rough note

## Why this exists

GitHub Issues on `TorresVisual/null-notes` are the source of truth for bugs
and features — `TODO.md` is no longer the tracker (see
`docs/agents/issue-tracker.md`). The user's raw notes arrive terse, garbled,
or half-finished ("search needs major improvements", a sentence that trails
into an unrelated stack trace). Filed as-is, a future session with no memory
of this conversation has nothing to act on. This skill does the enrichment
and the asking before anything gets created.

## Steps

1. **Read the raw note(s).** Source is either a `TODO.md` line or text the
   user typed inline.
2. **Flag ambiguity before drafting anything.** If the note has a vague
   repro ("editing large notes is laggy" with no size/steps), unclear scope
   (bug vs. feature vs. already-shipped), or contradicts a documented
   decision (e.g. `docs/ROADMAP.md`'s "Not doing" table), ask the user
   directly in plain text. Don't guess a fix, don't fabricate repro steps,
   don't silently drop an item that looks stale — surface it and ask.
3. **Investigate before drafting.** Grep/read the relevant code path
   (extension, command, store) so the issue body names actual
   files/functions/line numbers, not just the symptom. This is what makes
   it fixable by a session that starts cold. Check `docs/ROADMAP.md` for
   whether the phase this touches is already done, already cut, or still
   open — a note can describe something that shipped since it was written.
4. **Draft, per item:**
   - Title: short and specific, no `bug:`/`feature:` prefix (labels carry
     that).
   - Body: symptom, relevant `file:line` pointers, suspected cause if
     found, and enough context (design doc links, related issues) that no
     prior conversation is assumed.
   - Labels: `bug` or `enhancement` at minimum; add `low`/`medium`/`high`
     for bugs by real impact (data loss/crash = high); add `security` if it
     touches a trust boundary (see `src-tauri/src/commands/CLAUDE.md`).
     Reuse the repo's existing label set (`gh label list`) — don't invent
     new ones.
5. **Show the full batch of drafts to the user. Wait for approval or edits
   — never call `gh issue create` before this.** Group the unambiguous
   drafts into one review pass; handle the flagged ones after the user
   answers, in a follow-up batch.
6. **On approval**, file each: `gh issue create --repo TorresVisual/null-notes --title "..." --body "..." --label bug,medium`.
7. **If the source was a `TODO.md` line**, remove that line once the issue
   is confirmed filed — the issue number replaces it as the tracker. Leave
   the phased roadmap sections and the "Not doing" table alone; those
   aren't issues.

## Verifying

`gh issue list --repo TorresVisual/null-notes --limit 5` — confirm the new
issue(s) appear with the labels drafted in step 4.
