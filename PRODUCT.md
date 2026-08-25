# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The maintainer (solo developer), a CS student who writes math and code daily,
sketches diagrams by hand with a stylus, and wants a personal, offline,
daily-driver note app for coursework. Not currently aimed at public
distribution — but the maintainer has explicitly overruled treating that as
license to skip polish: "wanting the app to feel finished regardless of
audience size is a legitimate preference," not a call the roadmap gets to
make on the maintainer's behalf (`docs/ROADMAP.md` §1, P9.5 entry). Design
and craft work should hold a real-stranger-opening-it-cold bar even though
the maintainer is currently the only user.

## Product Purpose

A Markdown-first, WYSIWYG desktop note app for CS coursework: math, code,
hand-drawn diagrams with a stylus, and a PDF import pipeline for reference
material. Notes are plain `.md` files on disk — the source of truth, never
locked into a proprietary format.

## Positioning

"Notion's editor on Obsidian's storage model" (`docs/ROADMAP.md` §1) — a
WYSIWYG block editor with Notion-level editing feel, but files-on-disk
storage a neighboring product with a proprietary format or cloud lock-in
could not truthfully claim. The concretely rare differentiator: a PDF import
pipeline that reconstructs equations as real, editable LaTeX from the PDF's
own text layer (no OCR, no cropped images) — genuinely uncommon among
Markdown editors.

## Operating Context

- **Desktop-primary, Tauri + Windows.** Ships as a real desktop app, not a
  wrapped website — no responsive breakpoints, no touch/mobile target, a
  single fixed-window-class usage pattern.
- **Local-first and offline.** No accounts, no backend, no network
  dependency for core use.
- **Storage boundary is deliberate** (`CLAUDE.md`): inside the workspace
  folder (`.md` files, ink/PDF/asset sidecars, `.workspace.json`) travels
  with the notes and syncs via Git/Syncthing/etc.; the OS app-data dir
  (`index.db`, `settings.json`) stays machine-local and is fully rebuildable.
- **Frozen PDF pipeline** (`docs/ROADMAP.md` §Phase 4 completion criteria):
  ten exercise-sheet fixtures in `notes/exercise_sheets/` are the regression
  suite; new work there is a deliberate, high-bar decision, not routine.
  Applies to the pipeline's correctness, not its surrounding UI chrome.
  See `CLAUDE.md`'s "The PDF pipeline" section.
- **Solo-maintainer workflow.** Effort is sized S/M/L instead of dated;
  phases are ordered by dependency and value, not calendar.

## Capabilities and Constraints

- WYSIWYG Markdown editor (TipTap/ProseMirror): headings, code blocks with
  syntax highlighting, tables, task lists, callouts (theorem/proof/algorithm
  variants), collapsible sections, inline/block LaTeX math, cross-references,
  code deep-links, Mermaid diagrams.
- Inline ink/handwriting via Canvas + perfect-freehand, stylus-first.
- PDF import: text-layer extraction (no OCR), 2D layout reconstruction
  (matrices, cases, stacked fractions, ruled fractions, tables, operator
  limits), equations to LaTeX via face/geometry classification.
- Git integration: notes-only vs. code-repo mode detection, batched
  auto-commit, fast-forward-only auto-pull, push never automatic for a
  code-repo workspace.
- Spaced repetition (SM-2), inline-authored cards (`front :: back`, cloze).
- Full-text search with `folder:`/`tag:`/`type:` filters, tags, backlinks,
  workspace-wide task view, formula sheet generation, templates, PTY-backed
  terminal pane, workspace dashboard.
- No accounts, no cloud sync of its own (relies on the user's own
  Git/Syncthing/etc. syncing the workspace folder).
- pdfium (PDF rendering) is a required native dependency not vendored in the
  repo — gates the PDF import feature only; everything else works without it.

## Brand Commitments

**"Terminal Precision"** (`docs/brand-identity.md`, shipped P2 as design
tokens, formalized P9.5-1): near-black surfaces, one signal-green accent
(`--accent` `#7ee787`), monospace for anything code/math/symbol-adjacent,
sharp/geometric shapes over soft ones — a claim that the interface shouldn't
be softer than the exact material (CS coursework) it holds. Terminal supplies
the *precision* register (chrome: backgrounds, accents, iconography,
code/math typography); "academic notebook" supplies the *subject* (content
typography: sans-serif headings at weight 700, not monospace, because
monospace headings hurt scannability at real course volume).

App icon: a broken null-ring (Ø) pierced by a drawn pencil at 45° — one
gesture for both halves of the name ("null" = the ring/gap, "notes" = the
pencil/act of writing). Signal-green ring, neutral-gray pencil (materially
distinct, not forced into the accent color). Differentiates from sibling
product null-ide's plain Ø by silhouette, not color alone. Full account in
`docs/brand-identity.md`.

Full token catalogue (color, spacing, typography scale, surfaces,
interactive states, motion) is in `docs/design-tokens.md` — treat it, not
generic defaults, as incumbent design authority for any refinement work.

## Evidence on Hand

- `notes/exercise_sheets/`: ten real exercise-sheet PDFs, the PDF pipeline's
  regression suite. Real product content, not synthetic fixtures.
- `docs/ui-consistency-audit.md`: a per-screen, per-category hierarchy and
  consistency table already completed (P9.5-3) across 15 screens — read
  before re-deriving hierarchy judgments from scratch.
- `docs/design-tokens.md`: complete token reference including a named Motion
  section (one curve, two durations, `prefers-reduced-motion` guard).
- No user testimonials, benchmarks, or pricing exist or should be fabricated
  — solo-maintainer tool, not currently distributed.

## Product Principles

- Data integrity over convenience: the save path's invariants (atomic
  writes, no DB work on the keystroke path, never silently overwriting a
  dirty buffer) are load-bearing, not implementation detail.
- Files-on-disk, no lock-in: every design and storage decision preserves
  plain-`.md`-as-source-of-truth.
- Precision matches the subject matter: the interface should not be softer
  or vaguer than the CS coursework it holds (Terminal Precision).
- Enjoyment and learning are legitimate prioritization terms, not just
  daily-use-value ÷ effort — this is partly a learning exercise for the
  maintainer, and that is a named, budgeted goal, not scope creep.
- Ship a real bar even at an audience of one: craft and polish are pursued
  regardless of current distribution size, per the maintainer's explicit
  standing decision.
