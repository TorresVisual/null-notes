# Accessibility audit (issue #142)

**Method:** static code review. An NVDA pass over the running app has **not** been done yet. The
screen-reader section below lists what to verify, not what was observed.

## Done

- **Forced colors.** The focus ring is a `box-shadow` (`--focus-ring`, 27 uses), which Windows High
  Contrast removes, so keyboard focus was invisible. A single `@media (forced-colors: active)` block at
  the end of `src/index.css` gives every `:focus-visible` a `Highlight` outline and marks
  active/selected rows with an outline instead of a background.

## Live regions (prioritised)

Already announce: `SaveStatus`, `GitCommitStatus`, `ToastStack`, `ConflictBar`, git bars, `TrashDialog`,
`NoteList`, `PropertiesBlock`, `WorkspacePicker`, canvas/base panes.

Candidates (not yet verified against the components):

1. Search result count changes.
2. Export / import progress and completion.
3. PDF import progress and failure.
4. Code-block run start/finish (output appears silently).

## Prefers-contrast

Not handled. Low-priority: raise `--text-tertiary` and `--border` contrast under
`@media (prefers-contrast: more)`. `--text-tertiary` is already a known app-wide contrast gap.

## Editor screen-reader pass (to run with NVDA)

Check, in order: ink blocks (needs an accessible name/alt), block and inline math (read the LaTeX source
via `aria-label`?), callouts (type announced?), wiki-links (link role and target), mermaid, tags,
task-list checkboxes. Record findings here and file one issue per gap.
