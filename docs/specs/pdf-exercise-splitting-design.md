# Exercise splitting and the solution scaffold (P4-3)

## Problem

A converted sheet is one flat document. The brief calls the exercise workflow "a flagship feature" worth "hours every semester," and the missing half is that there is nowhere to *write* — you convert the sheet, then hand-build a heading and a gap under every exercise before you can start solving. P4-3 closes M4 by making that one command, and by making "I need room for one more" another — both run when you ask, never on their own (see *When it runs*).

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

**The numbers cannot be trusted, and this is the single most important fact in this section.** `12. Übungsblatt` and the `1.` beneath it are *one* CommonMark list — a list item's written number is ignored after the first — so the editor's own Markdown round-trip renumbers the first exercise to `13.`, and every following one in turn. Saving the note writes that back to the file, so it is not recoverable by reading from disk either. A block between two items (a display equation, say) breaks the list and the next item restarts, which is why a real sheet shows a mixture like `12, 13, 2, 3, 4` rather than any clean sequence.

This was not theoretical: requiring a run starting at 1 made **Split Into Tasks silently do nothing** on a real converted sheet. The original measurement went through the Rust pipeline only — `dump_markdown` — and never through the editor, which is precisely where the numbering changes.

So there are two paths:

1. **Intact numbering** — the longest run of consecutive integers starting at 1, at top level. On a freshly converted sheet that is exactly `1.` … `6.`, and `11. Übungsblatt` is excluded because it neither starts at 1 nor continues a run — no keyword list of title words ("Übungsblatt", "Assignment", "Sheet") is needed, and none is added, because such a list is a guess about the next document rather than a fact about this one.

2. **Renumbered** — every top-level ordered item, once the run above finds fewer than two. Being an ordered item at top level is the one property that survives the round trip, so it is what the fallback rests on. The sheet-number line is then dropped only when it is *leading and label-like*: at most two words, where the shortest real exercise opener in the corpus is four (`Berechnen Sie das Kurvenintegral`). An exercise is an instruction and runs to a sentence; `12. Übungsblatt` is a label. That is a heuristic, and it is confined to the path where the precise rule has already failed — the alternative there is not splitting at all, which is strictly worse than one spurious task the reader can delete.

Indented items are never candidates in either path: `layout.rs` already decides depth, and a sub-part is a sub-part.

### The output

Each exercise becomes:

```markdown
## Task 1

<the exercise's own converted content, verbatim>

### Solution

```

The exercise number comes from the source (`Beispiel 9.2` → `## Task 9.2`), not from a counter, so a sheet whose exercises start at 3 or skip a number still reads against the paper on the desk. Anything before the first exercise — the sheet title, the header, the date — stays where it is, above the first `## Task`.

### The solution is a handwriting canvas

**This is the point of the feature, not a detail of it.** Solutions to a maths exercise sheet are written by hand — that is what the ink subsystem exists for — so a scaffold that leaves an empty `### Solution` heading has done the easy half and left the part that matters: inserting a canvas by hand, once per exercise, six times a sheet.

Each empty `### Solution` therefore gets a blank ink block, backed by its own SVG in the note's existing `NoteName.ink/` sidecar. The sidecars are written *before* the document is rewritten, so a failure leaves the note untouched rather than holding blocks pointing at files that were never created.

The canvas starts **400px, not a full page**. `useInkCanvas` already grows a canvas by a page whenever a stroke approaches its bottom, so a two-line answer stays two lines tall and a long derivation still has room — where six full-page canvases in one note would make the sheet unscrollable before a single stroke was drawn.

A solution that already holds something — typed text, or a canvas from an earlier run — is left exactly as it is. Running the command twice must never bury the first run's handwriting under a second blank canvas.

No text placeholder is added. A placeholder line is text to delete before writing, every single time.

### Add next task

An editor command appending `## Task N+1` / `### Solution` — **with its own blank canvas**, so a sheet stays the same shape however it grew — at the end of the note, where `N` is the last task number already present. On a note with no tasks it appends `## Task 1`. This is the brief's explicit ask: space per task is never something to plan in advance.

### Failure is plain conversion

If neither pattern wins, the note converts exactly as it does today — one unsplit document. A miss costs the scaffold, never a line of content. The transform only ever *inserts* headings and blank lines between blocks that already exist; there is no path on which it drops or rewrites the exercise text itself, and that is the property the tests assert.

## When it runs — never on its own

**Splitting is always an explicit request, never part of an import.** The first implementation ran it unconditionally inside `pages_to_markdown`, and that was wrong: turning a document into an exercise sheet asserts *what the document is*, and a lecture script, a paper, or a problem set already written up would all be rewritten just as readily. Only the reader can make that claim, so only the reader triggers it.

Concretely: a Markdown import produces plain Markdown, exactly as it did before P4-3. **Split Into Tasks** — in the slash menu and the File menu — rewrites the note in front of you, on demand. Deciding after conversion is also the better moment, because you can see what you actually got. A note with no exercise structure says so and changes nothing, rather than silently rewriting or silently doing nothing.

Nothing is remembered. A remembered "always split" setting would be the automatic behaviour again, wearing a checkbox.

`pdf/extract.rs` carries a test asserting that an import of a numbered document produces no `## Task` headings — the regression guard for exactly this.

## Where it lives

`src/exercises.rs` — a top-level module, deliberately **not** under `pdf/`, because the PDF pipeline does not call it and a hand-written note is as valid an input as a converted sheet. It is pdfium-free for the reason `layout.rs`, `columns.rs` and `rules.rs` are: that is what lets the corpus be a regression suite on a machine with no native library.

The Tauri command takes and returns Markdown rather than a note path: the caller is the open editor, whose buffer may hold edits that have not reached disk, and rewriting the file underneath it would fight the save path.

**Neither this nor P4-3 reopens the frozen pipeline.** The P4-2e freeze closes 2D-layout reconstruction and bounds bug-chasing against the corpus; nothing here touches geometry — it reads structure `layout.rs` has already decided.

The "add next task" half is a TipTap command in the editor, not Rust: it operates on the open document, and a note the user has since edited by hand is the only thing it can sensibly count tasks from.

## Out of scope

- **Detecting where a solution ends.** The scaffold is created once, when you run the command. Nothing re-parses or re-numbers a note afterwards; a note that rewrites itself behind the user is exactly what the plain-`.md` principle exists to prevent.
- **Split-pane editing (sheet | solution).** A separate, still-owed decision — recorded in `TODO.md` — and not a dependency of anything above.
- **Sub-part scaffolding.** A `### Solution` per lettered sub-part is plausible and unrequested; three similar things is not a pattern yet.
