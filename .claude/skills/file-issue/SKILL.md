---
name: file-issue
description: Turns a rough bug report, feature idea, or finding into a well-researched GitHub issue — detects the repo, checks for duplicates, investigates the code so the body names real files and functions, asks only the questions that block a good issue, drafts title/body/labels for approval, then files it with gh. Use whenever the user hands over a messy note, says "file/open/log/create an issue", "track this", "write this up as a ticket", or another skill or agent has a finding to record — even if they never say "issue".
---

# Filing a GitHub issue

**Why this skill exists.** Raw notes are terse or garbled ("search needs major improvements"). The session that eventually picks the issue up has no memory of this conversation, so everything it needs — what is wrong, where in the code, how to tell it's fixed — must already be in the issue. The job is enrichment and judgement, not transcription. Quality bar: a cold session could start work from the issue alone, without asking a question.

## Steps

### 0. Orient

Find out where and how this project tracks work before drafting anything:

```bash
gh repo view --json nameWithOwner,visibility,hasIssuesEnabled
gh label list --limit 100
```

- `gh repo view` fails or issues are disabled → ask the user which repo to use. If `CLAUDE.md`/`AGENTS.md`/`CONTRIBUTING.md` says work is tracked somewhere other than GitHub Issues, say so and stop — this skill only files to GitHub.
- Read the project's own guidance on issues: a "tracker" section in `CLAUDE.md`/`AGENTS.md`, `CONTRIBUTING.md`, `docs/agents/`. It overrides the defaults below (e.g. which repo gets which kind of issue, labels to use or avoid).
- `.github/ISSUE_TEMPLATE/` exists → follow its sections instead of the body shapes in step 5.
- Note `visibility`: the hygiene rules in step 5 matter most for public repos, but apply everywhere since repos get opened up later.

### 1. Split and classify

Read the note(s). One issue per independently fixable concern: split a note that mixes two, but don't shred one coherent change into tickets. Decide per item:

- **Type** — bug (behaves wrongly), enhancement (new or better behaviour), documentation (docs/agent files wrong or missing).
- **Repo** — if the project routes some work to a sibling repo (its docs will say), pick accordingly; otherwise the current repo.
- **Size** — a large goal ("redesign mobile UI") is still one issue, but its body should name the sub-areas rather than pretend it's a small task.

### 2. Check it isn't already tracked

Do this before investigating; it's cheap and avoids wasted work:

```bash
gh issue list --state all --search "<2-3 distinctive keywords>" --limit 15
```

Try a second search with different words (symptom vs. component name). Also search the project's decision records for rejections — roadmap/"not doing" lists, `docs/adr/`, `CONTEXT.md`, whatever the repo has.

- Open duplicate → don't file; tell the user the number. If the note adds new information, offer to comment on it (`gh issue comment`).
- Closed as fixed → possible regression; file new and link it (`Regression of #n`).
- Contradicts a documented decision or already shipped → surface it and ask; don't silently drop it.

### 3. Investigate the code

Put real anchors in the issue. If the project provides a code-navigation tool its instructions require (a knowledge graph, an index, an LSP), use it first, then read the files it points to. Otherwise grep and read directly.

- `path:line` or `path` + function name for where the behaviour lives (names survive refactors better than line numbers; include both when cheap).
- For bugs: trace to a cause. If you confirmed it by reading the code, state it as the **Cause**. If you only suspect it, say "Suspected cause" — a wrong confident cause sends the fixer down the wrong path.
- For features: what exists today that the feature extends or collides with, and any architectural constraints the project documents.
- Siblings: if the same defect shape exists elsewhere (other callers, other components), list them. One issue should cover the root cause, not just the reported instance.

Use only what's in front of you. Don't fabricate repro steps, versions, or behaviour you haven't seen. Don't fix anything.

### 4. Ask only what blocks the issue

Ask when the answer changes the issue and you can't get it from the code: a vague repro ("laggy on big notes" — how big?), unclear intent (bug or wanted behaviour?), or a real design fork. Put every question in **one** message, with your best-guess default for each so the user can just say "yes".

Don't ask about things you can look up, or about style. When another skill or agent invoked you, answer from the context it handed you and only relay what you truly can't answer.

### 5. Draft

**Title** — a plain sentence naming the problem or the capability, specific enough to recognise in a list of 200. No `bug:`/`feat:` prefix (labels carry type). Bugs describe the symptom ("Autosave silently overwrites an external edit while the conflict prompt is showing"); enhancements describe the outcome ("Add 'Crop to content' to the ink editor").

**Body** — lead with substance: no greeting, no restating the title, no "this issue tracks". Use the shape that fits; drop sections that would be empty rather than filling them with filler.

Bug:

```markdown
**Symptom:** what the user sees, and the impact (data lost? crash? cosmetic?).

**Repro:** numbered steps, or "not reproduced — found by reading code".

**Cause:** where and why, with `path` / function names. ("Suspected cause:" if unverified.)

**Fix:** direction, if one is clear — which layer owns it and what must not break.

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

Body hygiene: no absolute local paths (use repo-relative), no tokens or secrets, no contents of the user's private files, no stack traces that include home directories. Wrap code identifiers in backticks; reference issues as `#n`.

**Labels** — use the list from step 0 and reuse what fits. Exactly one type label, by type: `bug`, `enhancement`, `documentation` (GitHub's defaults; use the repo's equivalents if it renamed them). Skip bot-owned labels (`dependencies`, ecosystem labels like `rust`, `github_actions`) — dependency tooling applies those.

If the repo has severity/priority labels (e.g. `low`/`medium`/`high`, `P0`–`P3`), put one on every issue, not just bugs, judged by real impact rather than how interesting the work is. Default rubric — map onto the repo's scale:

| Level | Meaning |
|---|---|
| highest | data loss or corruption, crash, app won't start/build, silent overwrite, security hole |
| middle | wrong behaviour with a workaround, or meaningful hardening |
| lowest | cosmetic, rare edge case, nice-to-have |

Add a `security` label (if the repo has one) when the issue touches a trust boundary — process spawning, auth, untrusted input, file paths from outside, secrets — alongside a severity.

**New labels** — create one only when an *area or theme* recurs and nothing existing covers it (e.g. `pdf`, `mobile`, `ci`), so filtering by it would actually help. A one-off doesn't earn a label; put it in the body. Never add a second type or severity label, and don't create near-duplicates of existing ones (check for synonyms, including GitHub's `good first issue` / `help wanted` / `question`). Use short lowercase names matching the repo's naming style. List each proposed label in the draft with its description and colour so the user approves it along with the issue. Create it before filing, since `gh issue create` fails on a label that doesn't exist:

```bash
gh label create "pdf" --description "PDF import pipeline" --color 5319E7
```

Pick a colour not already used for a different meaning in the list (6-digit hex, no `#`). Use plain `create`, not `--force`, so an existing label's description isn't overwritten by accident.

### 6. Review before filing

Show all drafts together: repo, title, labels (flagging any that don't exist yet, with description and colour), full body. Say in one line anything you couldn't verify. **Do not run `gh issue create` until the user approves** — filing is outward-facing, and on a public repo it may be indexed or cached even if later deleted. Fold edits in and re-show only what changed. Items you had to ask about go in a follow-up batch once answered; don't hold the clear ones back.

### 7. File

Create any approved new labels first. Then write each body to a temp file and pass `--body-file` — backticks, `$`, and quotes in an inline `--body` get mangled by the shell:

```bash
gh issue create --title "…" --body-file "$TMPDIR/issue.md" --label bug --label high
```

Add `--repo OWNER/NAME` when filing to a repo other than the current one. Remove the temp file afterwards. Filing several related issues: file the parent/root first so the others can reference its number.

### 8. Report

Reply with each issue's number, title and URL, nothing more. If `gh` fails (auth, network), say so and show the draft so it isn't lost — don't fall back to writing it into a file in the repo. To confirm labels landed: `gh issue view <n> --json labels`.
