# Issue tracker: TODO.md (manual, local)

Issues are found manually by the maintainer, not filed through GitHub/GitLab or any ticket system. They're tracked as checkbox items directly in `TODO.md` at the repo root.

## Conventions

- Open items: `- [ ] <description>`, in the "TODO's" section near the top of the file, or nested under a phase (`P0`–`P15`) further down
- Closed items: `- [x] <description> — <one-line resolution, sometimes with multi-pass notes inline>`
- The file also carries a phased roadmap with milestones; `docs/ROADMAP.md` holds the reasoning and Definitions of Done — if the two disagree, the roadmap wins
- A "Filed, not fixed" subsection records bugs deliberately left unfixed because they don't clear the project's fix-worthiness bar (see `CLAUDE.md`'s PDF pipeline freeze rules)

## When a skill says "publish to the issue tracker"

Add a new `- [ ]` line to `TODO.md` — in the "TODO's" section unless it clearly belongs under an existing phase.

## When a skill says "fetch the relevant ticket"

Read the referenced line or section of `TODO.md` directly; there's no per-ticket file to look up.
