---
name: pdf-corpus-check
description: Convert every PDF in notes/exercise_sheets/ through the pdf::dump::tests::dump_markdown diagnostic and compare the output against the corpus's existing hand-made reference notes, to catch regressions before or after touching src-tauri/src/pdf/.
disable-model-invocation: true
---

# PDF corpus check

## Why this exists

Every real fix to the PDF→Markdown pipeline (see TODO.md's P4-2b through
P4-2d) was found the same way: convert a real document, read the output
against a note the maintainer wrote by hand, and look for what's
actually wrong — not by unit tests alone, which CLAUDE.md says outright
("Judging this pipeline means looking at real output"). This skill
automates the conversion half of that loop; the comparison still needs a
human or Claude actually reading both files, since the hand-made
references are "close enough by hand," not exact-match fixtures.

## Running it

    node .claude/skills/pdf-corpus-check/scripts/run.mjs

This drives `src-tauri/src/pdf/dump.rs`'s `dump_markdown` test (normally
`#[ignore]`d, invoked per-file via `NULL_NOTES_PDF`) once for every
`*.pdf` in `notes/exercise_sheets/`, and writes each result to
`notes/exercise_sheets/.pdf-corpus-check/<name>.out.md` (gitignored,
alongside the source PDFs — `notes/` as a whole is already excluded from
git as the maintainer's real coursework material).

If `notes/exercise_sheets/` doesn't exist (a fresh clone won't have it),
the script says so and exits cleanly — there's nothing to check without
the maintainer's own corpus.

## Reading the results

Most PDFs in the corpus have a matching `<name> (Notion).md` — the
hand-made reference the maintainer wrote by transcribing the sheet
themselves. After running the script, `Read` a `.out.md` next to its
`(Notion).md` and look for genuine content problems, the same class of
bug every past corpus pass actually found:

- Dropped or garbled prose (whole sentences or words missing)
- Equations that didn't reconstruct (glyph-order text instead of LaTeX,
  or a `\frac`/matrix/`\cases` that should have formed but didn't)
- Mid-word tearing or misplaced accents
- Page furniture (page numbers, headers) leaking into the body

**Don't flag stylistic differences** — heading depth choices, whether a
list uses `-` or `*`, or phrasing differences from how the maintainer
chose to write their own notes. The reference is a comparison aid, not a
byte-exact fixture.

## What a real finding earns

Per CLAUDE.md's pipeline-freeze policy (P4-2e — a deliberate pause to
ship other features, not a permanent rule, and worth rechecking against
current state): a bug earns fix work only if it's **whole-document**
(significant prose loss, mid-word tearing throughout) or **recurs across
≥2 corpus documents**. A single-document cosmetic miss belongs in
`TODO.md`'s "Filed, not fixed" section instead of a fix.
