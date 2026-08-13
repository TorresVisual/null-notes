# Roadmap revision — design

**Date:** 2026-08-13
**Status:** agreed, pending application to `ROADMAP.md` and `TODO.md`
**Supersedes:** the execution order in `ROADMAP.md` §6, not the phases themselves

---

## Why this revision exists

`ROADMAP.md` says *"Next: P4-3, which closes M4."* The git log says otherwise.

Since 2026-07-30, when P4-1 and P4-2 were declared done, roughly 120 commits over two weeks
have gone almost entirely into PDF pipeline refinement — P4-2b, P4-2c, P4-2d, then matrices,
`\cases` blocks, ligature disambiguation, page furniture, compact fractions, and now ruled
fractions. P4-3 is still unticked. P5 through P9 have not started.

Every individual fix in that run is well-reasoned and real; several were whole-document bugs
that would have made the feature worthless. The problem is not any one of them. The problem is
that the aggregate has no boundary, and nothing in the roadmap supplies one.

Three facts explain the run, and all three are absent from the roadmap:

1. **The prioritization formula has no input.** §3 prioritizes by
   `daily-use value × friction ÷ effort`. The maintainer has been building, not using — so the
   daily-use term is being estimated rather than observed. Every priority call below M4 is a
   guess.
2. **The PDF pipeline is the only subsystem with a tight feedback loop that does not require
   using the app.** Convert a real document, read the output against the source, find a bug,
   fix it. It is the most rewarding thing on the board to work on and it will never run out of
   edge cases.
3. **Enjoyment and learning are real goals that the roadmap does not admit to.** The formula
   silently classifies interesting-but-low-ROI work as a mistake, which is not the actual goal
   function. Naming them makes them boundable.

---

## 1. Vision decisions

The roadmap's §1 states a vision but omits what the app is actually modelled on.

**Identity.** null-notes is **Notion's editor on Obsidian's storage model**, plus the features
the maintainer needs for CS coursework, built partly as a learning exercise. "OneNote" in the
original framing meant *handwriting inside notes*, which exists and is done — not a spatial
surface.

This matters because it makes the block editor a first-class pillar rather than an
implementation detail. It currently has no phase of its own despite being the fastest-moving
part of the app (see §4).

**Enjoyment and learning are legitimate terms in the formula**, stated explicitly so they can be
budgeted rather than spent undeclared.

### Closed questions

Recorded so they are not silently reopened.

| Question | Verdict | Date |
|---|---|---|
| Freeform 2D canvas (true OneNote) | **Won't build.** Ink-in-flow is the answer; Principle #1 stands unamended. | 2026-08-13 |
| Does the maintainer currently supply the daily-use signal? | **No.** This is the argument for the dogfood slice in §3. | 2026-08-13 |

**A note on the canvas decision, because it connects to §2.** A freeform canvas — objects placed
at x/y — has no Markdown representation, which is why Principle #1 blocks it. That is the *same
problem* the PDF pipeline has been grinding against for two weeks: matrices, `\cases`, stacked
fractions and multi-column layout are all "2D layout has no linear representation." One problem,
two places. Closing the canvas half without closing the PDF half would be inconsistent.

---

## 2. PDF pipeline completion criteria

The pipeline is the only subsystem on this roadmap with no natural end. There is always another
real document with another 2D-layout bug. It needs a boundary written as a rule rather than as a
next task.

**Ruled fractions (in flight as of `c72a24e`) is the last 2D shape.** The freeze takes effect on
its completion. A rule adopted with a carve-out for work already underway is still a real rule,
provided the carve-out is named and finite — this one is exactly one task, and abandoning a
half-built feature costs more than finishing it.

Once it lands:

- **The corpus is frozen** at the documents already in it. It is the regression suite. Adding a
  document to it is a deliberate decision, not a reflex.
- **The bar is M4's own DoD — "faster than transcribing by hand" — not "correct."** A converted
  sheet needing three manual fixes still saved forty minutes. Correctness beyond that bar is not
  what this feature is for.
- **A new bug earns work only if it is either whole-document** (prose loss, mid-word tearing —
  the P4-2b class, where the output is silently wrong rather than visibly incomplete) **or
  recurs across two or more corpus documents.** Single-document, single-instance cosmetic bugs
  are recorded in `TODO.md` and left.
- **2D-layout reconstruction is closed.** Matrices, `\cases`, stacked fractions, operator limits,
  tables and ruled fractions are the complete set. No new shapes. A shape outside that set
  renders as glyph-order text, and `throwOnError: false` on both maths nodes contains the failure
  to the one equation.
- **Re-entry condition:** the pipeline reopens when *real coursework use* produces a document
  that fails the by-hand bar. Not before, and not from a diagnostic sweep.

The third rule is the load-bearing one — it is the rule that would have ended most of the last
fortnight, and it is the one that will feel wrong to apply in the moment.

---

## 3. Execution order

**Phase numbers are identity, not order.** They are referenced across commit messages and 18
design specs; renumbering would churn all of it for no gain. Only the execution order changes,
and `ROADMAP.md` §6 gets an explicit note to that effect.

| # | Work | Size | Why here |
|---|---|---|---|
| 0 | Finish ruled fractions | — | In flight (`c72a24e`). Named carve-out per §2. |
| 1 | Freeze the pipeline under §2 | S | Docs, not code. The next 2D shape is the rule's first real application. |
| 2 | Bug triage — the three "Issues Discovered" | S | Reported defects in the daily-use path, owned by no phase, sitting above a 371-line plan. |
| 3 | **P4-3** — exercise split, solution scaffold, add-next-task | M | Closes M4. Converts the PDF work from an open hunt into a shut phase. |
| 4 | **Dogfood slice** — see below | M/L | Makes the maintainer a user. Repairs the missing input in §Why, fact 1. |
| 5 | Re-derive P5, P6, P9 from real use | — | Their current priorities are guesses. Do not plan them further until 4 has run for two weeks. |

### The dogfood slice

Folded into P7 rather than given a new number. **Milestone: this project's own `docs/` lives in
null-notes and gets edited there.**

The unlock is smaller than the roadmap assumes. A workspace is just a folder scanned for `.md`,
so "open a code repo as a workspace" (P7-3, scheduled **M**) *already works* — except
`is_excluded_dir` at `src-tauri/src/commands/notes.rs:113` only skips `.ink` and dot-directories,
so the scan would walk `node_modules/` and `src-tauri/target/` and drown. The change that makes
the maintainer a daily user of their own app is an **ignore list**: hours of work, currently
parked behind roughly two months of roadmap.

Contents, in order:

- **Scan ignore list** — **S**. `node_modules`, `target`, `dist`, `build`, `.git` (already
  covered by the dot rule). New; belongs to P7-3 but is not currently written anywhere.
- **P7-3** project awareness — mostly falls out once the scan behaves.
- **P7-4** editor command setting — **S**. Lands *with* P7-1, not after; a hardcoded editor path
  would be an immediate rewrite.
- **P7-1** code deep links — **M**. Including the shell-metacharacter test; this is the first
  feature to launch an external process using text taken from note content.
- **P8-1** terminal pane — **M/L**.

Rationale for the whole slice: it is the only item on the board that changes what *future*
planning is based on. Everything else produces a feature; this produces evidence.

---

## 4. Reconciliation findings

`ROADMAP.md` is stale in both directions. Two findings, both verified against the code.

**Collapsible sections are built but do not meet their own DoD.**
`src/editor/extensions/Details.tsx` is a real node with `summary` and `open` attributes — half of
P6-1. But:

- It is **absent from the slash menu** (`SlashCommands.tsx` has no entry for it), so P6-1's *"each
  block type inserts from `/`"* is not met. It is built and unreachable.
- It **serializes collapse state into the file** — `<details open>` — while P6-1's DoD states that
  *"collapse state is presentation-only — it never changes the `.md` content."*

The second is a genuine open decision, not a bug to fix silently. `<details open>` is standard,
portable HTML that renders correctly in GitHub and every other Markdown viewer, which is an
argument for keeping it. Against it: collapsing a section then dirties the buffer and triggers a
write, and under P5 it would produce an auto-commit — the exact churn the DoD was written to
prevent. **Decide before ticking P6-1.**

**A stream of editor work has no roadmap representation at all.**
`BlockHandle`, `Divider`, `TextAlignment`, `Highlight`, `Kbd`, `HTMLBlock`, `HTMLInline`,
`SpanStyle`, `Superscript`/`Subscript` and `NoteImage` all exist in `src/editor/extensions/` and
correspond to no phase or task. The Notion half of the app — the part §1 now names as a pillar —
is being built off-book.

This is not an argument to stop. It is an argument that P6's scope is wrong: it was written as
"STEM authoring" when the actual work is "Notion parity," and the two overlap only partly. **P6
should be rescoped at step 5**, informed by what dogfooding shows is missing, rather than
re-planned now from the current guesses.

Not built, contrary to nothing but worth stating plainly: proof/theorem blocks (P6-1's other
half), algorithm blocks (P6-2), templates (P6-3), equation snippets (P6-4), search refinement
(P6-5), outline panel (P6-6).

---

## 5. Changes to apply

**`docs/ROADMAP.md`**
- §1 — add the identity statement and the closed-questions table from §1 above.
- Phase 4 — add the completion criteria from §2 as a subsection between P4-2 and P4-3.
- P7-3 — add the scan ignore list as an explicit bullet with its own DoD.
- §6 — rewrite the suggested execution order per §3; add the "numbers are identity, not order"
  note.
- Header — update the "Last updated" line to describe this revision.

**`TODO.md`**
- Promote "Issues Discovered" from a floating list into an owned section with a position in the
  order (step 2) — and mark all three as **reported, unverified**; triage begins by reproducing
  them.
- Add the ruled-fraction task as in-flight, and the freeze as the task that follows it.
- Add the dogfood slice under P7 with the ignore list as its first box.
- Record the two §4 findings against P6-1 rather than ticking it.
- Update the "Now:" line, which currently says P4-3 is next.

**No code changes.** This revision is a planning artifact; step 0 of §3 is already underway
independently.

---

## Open decisions carried forward

| Decision | Owed before | Note |
|---|---|---|
| `<details open>` — collapse state in the file, or presentation-only? | Ticking P6-1 | §4. Both defensible; the P5 auto-commit churn is the real cost. |
| Split-pane editing (sheet \| solution) | P4-3 | Pre-existing; unchanged by this revision. |
| Spaced-repetition storage | Any P9-3 code | Pre-existing; recommendation (Option A) unchanged. |
| P6 rescope — "STEM authoring" vs "Notion parity" | Step 5 | §4. Do not re-plan P6 before the dogfood slice has run. |
