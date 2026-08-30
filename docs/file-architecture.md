# File Architecture Proposal

**Status:** PROPOSAL — not yet approved, nothing has been changed.

## Stack

Tauri 2 (Rust backend + React 19/TypeScript frontend), TipTap 3 editor, Tailwind v4 + shadcn/ui for the app shell. Conventions for this stack are already written down in `CLAUDE.md` — one Tauri command file per domain, one TipTap node extension per file, `src/lib` for pure utilities, `src/hooks` for stateful logic, `src/store` for Zustand state. This audit checked the tree against those stated conventions, not against a generic template.

## Current structure

```
src-tauri/src/
  commands/      14 files, one per IPC domain (assets, git, ink, notes, pdf, ...)
  db/            mod.rs, notes.rs, schema.rs
  pdf/           columns, extract, latex, layout, ligatures, maths, models,
                 renderer, rules — plus 3 test-file variants (see Finding 2)
  exercises.rs, sm2.rs, models.rs, lib.rs, main.rs

src/
  components/    ~35 flat, .test.tsx colocated, components/ui/ for shadcn primitives
  editor/
    extensions/  ~60 files, one per TipTap node — flat, per CLAUDE.md's explicit convention
    toolbar/     5 files
  hooks/ store/ ink/ lib/ pdf/   flat, colocated tests, consistent with documented layout

notes/           gitignored scratch QA workspace ("Scratch workspace used for
                 manual QA of the app") — except one tracked file, see Finding 1
docs/            ROADMAP.md, specs/, plans/, agents/ — already has its own
                 plan/spec convention, unrelated to this skill's docs/plans/
```

Overall this is a disciplined, convention-following tree — the flat `editor/extensions/` and `lib/` directories look large by file count, but that's the documented convention for this stack (CLAUDE.md: "each custom node type lives in its own file"), not drift. I did not find the kind of layering violations, dumping-ground `utils/`, or naming/casing inconsistency this skill usually flags. Two concrete, narrow issues turned up on closer inspection:

## Changes and why

### 1. Move `notes/Plan.md` out of the gitignored scratch directory

- **What:** `git mv notes/Plan.md docs/brief.md` (name open to bikeshedding — `docs/original-brief.md` also reads fine), and update the four references to `notes/Plan.md` in `docs/ROADMAP.md`.
- **Why:** `.gitignore` marks `/notes/` as a "scratch workspace used for manual QA of the app" — genuinely ephemeral, everything else in it is untracked. `Plan.md` is the opposite of ephemeral: it's the original product brief, force-added against that ignore rule, and `docs/ROADMAP.md` cites it four times as the document every phase is audited against ("Auditing `notes/Plan.md` line by line against the code...", "Every other phase traces to `notes/Plan.md`"). A permanent, load-bearing reference document living inside a directory whose own `.gitignore` comment calls it scratch space is a colocation smell — the path tells the next reader (or a future `rm -rf notes/` during QA cleanup, since everything else there is disposable) something false about the file's importance. `docs/` already holds the other durable planning documents (`ROADMAP.md`, `specs/`, `brand-identity.md`) and is the natural home.
- **Files affected:** `notes/Plan.md` → `docs/brief.md`; 4 reference updates in `docs/ROADMAP.md` (lines ~81, ~191, ~193, ~246).

### 2. Normalize the test-file split in `src-tauri/src/pdf/`

- **What:** Fold `pdf/ligatures/tests.rs` (69 lines) back into `pdf/ligatures.rs` (175 lines) as an inline `#[cfg(test)] mod tests { ... }`, and delete the now-empty `pdf/ligatures/` directory.
- **Why:** Every Rust module in this codebase (20 of 23 checked) keeps its tests inline via `#[cfg(test)] mod tests { ... }` at the bottom of the same file — `latex.rs` (1158 lines), `extract.rs` (696 lines), and `dump.rs` (555 lines) all do this despite being larger than `ligatures.rs`. Two files break from that — `columns.rs`/`columns_tests.rs` and `layout.rs`/`layout_tests.rs` — but both have a real reason: `layout.rs` is 3861 lines and `columns_tests.rs` alone is 390 lines, big enough that splitting the test module out and declaring it centrally in `pdf/mod.rs` is a reasonable, size-driven exception. `ligatures.rs` uses a *third*, different mechanism (a `ligatures/tests.rs` submodule directory, declared locally inside `ligatures.rs` rather than centrally in `mod.rs`) for a file that, combined with its tests, is only 244 lines — smaller than several files that stay inline. Three patterns for one purpose in one directory, and the smallest of the three files is the one that doesn't inline. This is a one-file mechanical fix, not a design change.
- **Files affected:** `pdf/ligatures.rs`, `pdf/ligatures/tests.rs` (deleted), no `mod.rs` change needed (it's declared locally, not centrally).

## Considered and deferred

- **Splitting `editor/extensions/` or `lib/` into subfolders by theme** (math/, code/, ink/, table/) — considered and rejected. CLAUDE.md states the convention explicitly ("Each custom node type lives in its own file under `src/editor/extensions/`") and the flat layout is consistent, colocated with tests, and not causing any observed confusion. Restructuring it would fight a convention the project already deliberately chose, not fix drift.
- **`exercises.rs` living at `src-tauri/src/` top level instead of under `pdf/`** — `CLAUDE.md` itself says `pdf/exercises.rs`, but the file lives at `src-tauri/src/exercises.rs`. This is a doc/code mismatch, not a structure problem: CLAUDE.md's own reasoning ("it works on the assembled Markdown rather than on `Block`s") argues the current top-level placement is *correct* — it operates on markdown strings and is called from `commands/notes.rs`, not from anything PDF-internal. Fixing the stale path in the doc is a `sync-agent-docs` task, not a file move — flagging it here so it isn't lost, but leaving it out of this plan.
- **`docs/roadmap-overview.html` sitting beside markdown in `docs/`** — checked; it's a recently-updated, self-contained rendered companion view of `ROADMAP.md`, not orphaned output. Left alone.

---
Review this proposal. Reply with feedback to revise it, or approve it to move to the execution plan.
