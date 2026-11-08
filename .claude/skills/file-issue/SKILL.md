---
name: file-issue
description: Turns a rough bug report, feature idea, or finding into a well-researched GitHub issue on TorresVisual/null-notes (or null-ide) — checks for duplicates, investigates the code so the body names real files and functions, asks only the questions that block a good issue, drafts title/body/labels for approval, then files it with gh. Use whenever the user hands over a messy note, says "file/open/log/create an issue", "track this", "write this up as a ticket", or another skill (capture-findings, bug-hunter, product-audit, feature-brainstorm) has a finding to record — even if they never say "issue".
---

# Filing a GitHub issue

GitHub Issues are the only tracker: `TorresVisual/null-notes` for the app, `TorresVisual/null-ide` for IDE-side work (`docs/agents/issue-tracker.md`). `TODO.md` is not a tracker — never add to it.

**Why this skill exists.** Raw notes are terse or garbled ("search needs major improvements"). The session that eventually picks the issue up has no memory of this conversation, so everything it needs — what is wrong, where in the code, how to tell it's fixed — must already be in the issue. The job is enrichment and judgement, not transcription. Quality bar: a cold session could start work from the issue alone, without asking a question.

## Steps

### 1. Split and classify

Read the note(s). One issue per independently fixable concern: split a note that mixes two, but don't shred one coherent change into tickets. Decide per item:

- **Type** — bug (behaves wrongly), enhancement (new or better behaviour), documentation (docs/agent files wrong or missing).
- **Repo** — `null-ide` only if it's IDE-side; everything else `null-notes`.
- **Size** — a large goal ("redesign mobile UI") is still one issue, but its body should name the sub-areas rather than pretend it's a small task.

### 2. Check it isn't already tracked

Do this before investigating, it's cheap and avoids wasted work:

```bash
gh issue list --repo TorresVisual/null-notes --state all --search "<2-3 distinctive keywords>" --limit 15
```

Try a second search with different words (symptom vs. component name). Also grep `docs/ROADMAP.md` — it records decisions inline, including a "Not doing" table of options rejected on inspection.

- Open duplicate → don't file; tell the user the number. If the note adds new information, offer to comment on it (`gh issue comment`).
- Closed as fixed → possible regression; file new and link it (`Regression of #n`).
- Contradicts a documented decision or already shipped → surface it and ask; don't silently drop it.

### 3. Investigate the code

Project rule: run `graphify query "<question>"` first, then read the files it points to. Goal is to put real anchors in the issue:

- `path:line` or `path` + function name for where the behaviour lives (names survive refactors better than line numbers; include both when cheap).
- For bugs: trace to a cause. If you confirmed it by reading the code, state it as the **Cause**. If you only suspect it, say "Suspected cause" — a wrong confident cause sends the fixer down the wrong path.
- For features: what exists today that the feature extends or collides with, and the architectural constraints that apply (e.g. the save-path rules, the storage boundary — workspace vs. app-data — in `CLAUDE.md`).
- Siblings: if the same defect shape exists elsewhere (other callers, other node types), list them. One issue should cover the root cause, not just the reported instance.

Use only what's in front of you. Don't fabricate repro steps, versions, or behaviour you haven't seen. Don't fix anything.

### 4. Ask only what blocks the issue

Ask when the answer changes the issue and you can't get it from the code: a vague repro ("laggy on big notes" — how big?), unclear intent (bug or wanted behaviour?), or a real design fork. Put every question in **one** message, with your best-guess default for each so the user can just say "yes".

Don't ask about things you can look up, or about style. When another skill invoked you (capture-findings, bug-hunter, product-audit), answer from the context it handed you and only relay what you truly can't answer.

### 5. Draft

**Title** — a plain sentence naming the problem or the capability, specific enough to recognise in a list of 200. No `bug:`/`feat:` prefix (labels carry type). Bugs describe the symptom ("Autosave silently overwrites an external edit while the conflict prompt is showing"); enhancements describe the outcome ("Add 'Crop to content' to the ink editor").

**Body** — lead with substance, no greeting, no restating the title, no "this issue tracks". Use the shape that fits; drop sections that would be empty rather than filling them with filler.

Bug:

```markdown
**Symptom:** what the user sees, and the impact (data lost? crash? cosmetic?).

**Repro:** numbered steps, or "not reproduced — found by reading code".

**Cause:** where and why, with `path` / function names. ("Suspected cause:" if unverified.)

**Fix:** direction, if one is clear — which layer owns it and what must not break (e.g. "stay off the keystroke path").

**Related:** #n …
```

Enhancement:

```markdown
Why this matters / the problem, in one or two sentences.

**Today:** what exists, with `path` anchors — and the specific gaps.

**Proposal:** the behaviour wanted. Concrete enough to build; leave real design forks as explicit questions.

**Acceptance:** observable conditions that mean it's done.

**Related:** #n …
```

Docs issues: say which statement is wrong or missing, where, and what's true instead.

Body hygiene: the repo may go public (#232), so no absolute local paths (use repo-relative), no tokens, no contents of the user's private notes, no stack traces with home directories. Wrap code identifiers in backticks; reference issues as `#n`.

**Labels** — reuse the existing set; check `gh label list` if unsure, never invent one.

| Label | Use |
|---|---|
| `bug` / `enhancement` / `documentation` | exactly one, by type |
| `high` | data loss or corruption, crash, app won't start, silent overwrite |
| `medium` | wrong behaviour with a workaround, or meaningful hardening |
| `low` | cosmetic, rare edge case, nice-to-have |
| `security` | touches a trust boundary (process spawning, the CLI pipe — see `src-tauri/src/commands/CLAUDE.md`, file paths, untrusted input); add alongside a severity |

Severity goes on every issue, not just bugs — judge by real impact, not by how interesting it is.

### 6. Review before filing

Show all drafts together: repo, title, labels, full body. Say in one line anything you couldn't verify. **Do not run `gh issue create` until the user approves** — filing is outward-facing and issue numbers can't be reused. Fold edits in and re-show only what changed. Items you had to ask about go in a follow-up batch once answered; don't hold the clear ones back.

### 7. File

Write each body to a temp file and pass `--body-file` — backticks, `$`, and quotes in an inline `--body` get mangled by the shell:

```bash
gh issue create --repo TorresVisual/null-notes --title "…" --body-file "$TMPDIR/issue.md" --label bug --label high
```

Remove the temp file afterwards. Filing several related issues: file the parent/root first so the others can reference its number.

### 8. Report

Reply with each issue's number, title and URL, nothing more. If `gh` fails (auth, network), say so and show the draft so it isn't lost — don't fall back to writing it into `TODO.md` or another file. To confirm labels landed: `gh issue view <n> --repo TorresVisual/null-notes --json labels`.
