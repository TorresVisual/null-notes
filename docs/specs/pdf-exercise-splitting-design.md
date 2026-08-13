# Exercise splitting and the solution scaffold (P4-3)

## Problem

A converted sheet is one flat document. The brief calls the exercise workflow "a flagship feature" worth "hours every semester," and the missing half is that there is nowhere to *write* — you convert the sheet, then hand-build a heading and a gap under every exercise before you can start solving. P4-3 closes M4 by doing that automatically, and by making "I need room for one more" a single command rather than a formatting job.

The whole feature is one question: **where does one exercise end and the next begin?** Everything else follows.

## What the corpus actually contains

Ten sheets, converted and read. There are two shapes, and they disagree about what a number means.

**Shape A — the Analysis sheets** (Blatt5, 7, 8, 9, 10, 11, 12). Exercises are top-level ordered list items, sub-parts are indented ordered items:

```
11. Übungsblatt

1. Berechnen Sie mithilfe des Residuensatzes …

    1. $C$ ist der Kreis mit Radius …
    2. $C$ ist der Kreis mit Radius …

2. Berechnen Sie mithilfe des Residuensatzes …
```

**Shape B — Ue9** (Discrete Maths). Exercises are keyword-and-number paragraphs, and its *sub-parts* are the top-level ordered items:

```
Beispiel 9.1. Bringen Sie die folgenden Formeln in pränexe Normalform …

1. $\neg\forall y \exists xP(x, y) \to …$
2. $\forall x \exists y\forall zR(x, y, z) \vee …$

Beispiel 9.2. Gegeben sind $a, b, c, k, n \in \mathbb{N}_0.$

3. Vor den Hörsälen A, B und C befinden sich …
4. In einer Lotterie …
```

The two shapes invert each other. Splitting Ue9 on `N.` would cut *inside* every exercise and produce nine fragments where there are five exercises — and its numbering restarts (1, 2, then 3, 4, then 1, 2 again under Beispiel 9.4), so even the numbers would be wrong. This is the central constraint: **the two patterns must never both fire on one document.**

### The sheet-number trap

Every Analysis sheet opens with its own number as a top-level ordered item:

| Sheet | First top-level item | Exercises |
|---|---|---|
| Analysis_2_Blatt11 | `11. Übungsblatt` | `1.` … `6.` |
| Analysis_2_Blatt12 | `12. Übungsblatt` | `1.` … `6.` |
| Analysis_2_Blatt5_2026 | `5. Übungsblatt` | `1.` … `4.` |

`11. Übungsblatt` is indistinguishable from an exercise by pattern alone — it is a digit, a dot, and some text. Taken as one, every sheet gains a phantom "Task 11" holding its own title, and the real exercises are numbered against the wrong start.

## Design

### Choosing the pattern, once per document

Two candidate splitters, resolved in this order:

1. **Keyword.** `Aufgabe`/`Beispiel`/`Exercise`/`Task`/`Problem`, followed by a number (`9.1`, `3`) at the start of a block. Wins outright **if it matches at least twice.** One match is a mention inside prose, not a structure.
2. **Top-level ordered items**, and only if the keyword pattern did not win.

A single scan decides for the whole document. Per-block decisions are what would produce a note split by `Beispiel` in one half and by `N.` in the other.

### Which ordered items are exercises

Only the **longest run of consecutive integers starting at 1**, at top level. On every Analysis sheet that is exactly `1.` … `6.`, and `11. Übungsblatt` is excluded because it neither starts at 1 nor continues a run — no keyword list of title words ("Übungsblatt", "Assignment", "Sheet") is needed, and none is added, because such a list is a guess about the next document rather than a fact about this one.

Indented items are never candidates: `layout.rs` already decides depth, and a sub-part is a sub-part.

### The output

Each exercise becomes:

```markdown
## Task 1

<the exercise's own converted content, verbatim>

### Solution

```

The exercise number comes from the source (`Beispiel 9.2` → `## Task 9.2`), not from a counter, so a sheet whose exercises start at 3 or skip a number still reads against the paper on the desk. Anything before the first exercise — the sheet title, the header, the date — stays where it is, above the first `## Task`.

The `### Solution` section is deliberately empty. A placeholder line is text the user has to delete before writing, every single time.

### Add next task

An editor command appending `## Task N+1` / `### Solution` at the end of the note, where `N` is the highest task number already present. On a note with no tasks it appends `## Task 1`. This is the brief's explicit ask: space per task is never something to plan in advance.

### Failure is plain conversion

If neither pattern wins, the note converts exactly as it does today — one unsplit document. A miss costs the scaffold, never a line of content. The transform only ever *inserts* headings and blank lines between blocks that already exist; there is no path on which it drops or rewrites the exercise text itself, and that is the property the tests assert.

## Where it lives

`pdf/exercises.rs`, a new pdfium-free module operating on the rendered block list, called from the same place `blocks_to_markdown` is. Pdfium-free for the reason `layout.rs`, `columns.rs` and `rules.rs` are: it is the only way the corpus can be a regression suite on a machine with no native library.

**This is not a reopening of the frozen pipeline.** The P4-2e freeze closes 2D-layout reconstruction and bounds bug-chasing against the corpus; P4-3 is the planned feature the same revision put immediately after it. Nothing here touches geometry — it reads structure `layout.rs` has already decided.

The "add next task" half is a TipTap command in the editor, not Rust: it operates on the open document, and a note the user has since edited by hand is the only thing it can sensibly count tasks from.

## Out of scope

- **Detecting where a solution ends.** The scaffold is created once, at import. Nothing re-parses or re-numbers a note afterwards; a note that rewrites itself behind the user is exactly what the plain-`.md` principle exists to prevent.
- **Split-pane editing (sheet | solution).** A separate, still-owed decision — recorded in `TODO.md` — and not a dependency of anything above.
- **Sub-part scaffolding.** A `### Solution` per lettered sub-part is plausible and unrequested; three similar things is not a pattern yet.
