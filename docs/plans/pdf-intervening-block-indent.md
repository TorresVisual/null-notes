# PDF Intervening-Block Indent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Fix nested lettered sub-lists rendering as a `codeBlock` in the editor whenever a non-list block (a display equation, at minimum) sits between the parent list item and its deeper children, by indenting that intervening block to match — while leaving a same-depth interruption (e.g. an equation between two ordinary exercises) unindented, exactly as today.

**Architecture:** One new pure function in `src-tauri/src/pdf/layout.rs`, `intervening_block_indent`, computes an indent level per block from the already-finalized `Vec<Block>` (depths included). `blocks_to_markdown` applies it as a post-processing pass over the strings it already builds — no change to any individual block's own rendering logic. A TypeScript regression test proves the fix against the real editor, not just the generated markdown string.

**Tech Stack:** Rust (`cargo test`), TypeScript/Vitest (`npx vitest run`) for the editor round-trip.

## Global Constraints

- `layout.rs` must stay pdfium-free — plain `CharBox`/`Block` input only (CLAUDE.md, "The PDF pipeline").
- No `.unwrap()`/`.expect()` outside tests; propagate with `?` (CLAUDE.md, "Rust Guidelines"). Nothing in this plan can fail at runtime, so this is mostly a reminder not to introduce one while editing nearby.
- `cargo clippy -- -D warnings` must stay clean before any commit in this plan.
- No comments unless the WHY is non-obvious — match the file's existing voice.
- Full design rationale: `docs/specs/pdf-intervening-block-indent-design.md`.

---

## Task 1: Compute and apply the intervening-block indent

**Files:**
- Modify: `src-tauri/src/pdf/layout.rs` — new `intervening_block_indent` function and `blocks_to_markdown` (~line 2900-2975)
- Test: `src-tauri/src/pdf/layout_tests.rs` — new tests

**Interfaces:**
- Consumes: the existing `Block` enum (`layout.rs:196-217`), specifically `Block::ListItem { depth: usize, .. }` and `Block::Heading { .. }`, unchanged.
- Produces: a private `fn intervening_block_indent(blocks: &[Block]) -> Vec<usize>`, one indent level per block (`0` = unchanged), consumed only by `blocks_to_markdown`. No new public API.

- [ ] **Step 1: Write the failing tests**

In `src-tauri/src/pdf/layout_tests.rs`, add (near the other list-nesting tests, e.g. after `a_heading_resets_running_list_numbering`):

```rust
// The real shape on Analysis_2_Blatt12.pdf's exercise 6: a digit item, a
// display equation, then lettered sub-parts at the same geometric x as the
// digit item (so they get force-nested one level deeper). Confirmed via a
// live editor round-trip (mathBetweenListItems.test.ts) that an unindented
// equation here closes the list and the sub-parts land in a codeBlock
// instead of nesting — this is the fix.
#[test]
fn an_equation_between_a_digit_item_and_its_deeper_sub_parts_is_indented_to_match() {
    let mut chars = page(&["Answer the following."]);
    chars.extend(set("6. Solve the system:", 72.0, 660.0, Style::default()));
    chars.extend(set("y = 1", 200.0, 636.0, maths()));
    chars.extend(set("(a) find the fixed points", 72.0, 612.0, Style::default()));
    chars.extend(set("(b) classify each one", 72.0, 600.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("    $\n    y = 1\n    $"), "got: {markdown}");
    assert!(markdown.contains("    1. find the fixed points"), "got: {markdown}");
    assert!(markdown.contains("    2. classify each one"), "got: {markdown}");
}

// The other real shape on the same sheet: an equation and follow-up prose
// between two ordinary, same-depth exercises. Must stay flat, or the second
// exercise would misnest under the first.
#[test]
fn an_equation_between_two_same_depth_digit_items_is_not_indented() {
    let mut chars = page(&["Two problems in a row."]);
    chars.extend(set("3. First problem:", 72.0, 660.0, Style::default()));
    chars.extend(set("y = 1", 200.0, 636.0, maths()));
    chars.extend(set("Some follow-up prose.", 72.0, 612.0, Style::default()));
    chars.extend(set("4. Second problem", 72.0, 588.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("$\ny = 1\n$"), "got: {markdown}");
    assert!(!markdown.contains("    $\n    y = 1\n    $"), "got: {markdown}");
    assert!(markdown.contains("Some follow-up prose."), "got: {markdown}");
    assert!(!markdown.contains("    Some follow-up prose."), "got: {markdown}");
}

// A heading always ends a list (assign_list_numbers's own reset rule) — but
// depth itself is computed geometrically, independent of that reset, so a
// genuinely indented item after a heading can still read as deeper than
// whatever list item preceded the heading. The intervening equation must
// not be indented across that heading either.
#[test]
fn a_heading_between_a_list_item_and_a_deeper_item_prevents_indenting() {
    let mut chars = page(&["Two unrelated sections."]);
    chars.extend(set("• outer bullet", 72.0, 660.0, Style::default()));
    chars.extend(set("y = 1", 200.0, 636.0, maths()));
    chars.extend(set("Unrelated Heading", 72.0, 612.0, Style { size: 15.0, ..Style::default() }));
    chars.extend(set("• inner bullet", 72.0 + 2.0 * BODY, 588.0, Style::default()));

    let markdown = chars_to_markdown(&chars);

    assert!(markdown.contains("$\ny = 1\n$"), "got: {markdown}");
    assert!(!markdown.contains("    $\n    y = 1\n    $"), "got: {markdown}");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `src-tauri/`): `cargo test --lib pdf::layout_tests -- --nocapture 2>&1 | grep -E "an_equation_between|a_heading_between_a_list_item|test result"`

Expected: `an_equation_between_a_digit_item_and_its_deeper_sub_parts_is_indented_to_match` FAILs (the equation renders unindented today). The other two already pass today (nothing indents them yet) — they're here to stay green through Step 4, not to go red now.

- [ ] **Step 3: Add `intervening_block_indent` and wire it into `blocks_to_markdown`**

In `src-tauri/src/pdf/layout.rs`, find the doc comment and signature immediately before `blocks_to_markdown`:

```rust
/// Renders blocks to Markdown, equations included: `$…$` inline, and a
/// display equation as its own block delimited by a lone `$` on its own
/// line before and after — not the more common `$$…$$` — because that is
/// the markdown dialect the editor's own `BlockMath` TipTap extension
/// actually parses (see `src/editor/extensions/BlockMath.tsx`'s markdown-it
/// rule). `$$…$$` isn't recognized as a block there at all: it falls
/// through to `InlineMath`'s regex instead, which pairs the first two
/// (adjacent) `$` as an empty match and renders the equation as small
/// inline math with stray `$` characters left over.
pub fn blocks_to_markdown(blocks: &[Block]) -> String {
```

Replace with:

```rust
/// Which indent level, if any, a non-`ListItem` block needs so it stays
/// inside the list it visually sits between. CommonMark closes a list at
/// the first unindented line, so a display equation (or any other block)
/// sitting unindented between a digit item and its deeper lettered
/// sub-parts — the shape a problem statement followed by its equation then
/// takes — closes the list before the sub-parts' own indent ever gets a
/// chance to nest under it; downstream, that stray indent reads as an
/// indented code block instead. Indenting the run of blocks between two
/// list items to the *later* item's depth only when that depth actually
/// increased keeps the common same-depth case (an equation and follow-up
/// prose between two ordinary exercises) untouched — see
/// docs/specs/pdf-intervening-block-indent-design.md.
fn intervening_block_indent(blocks: &[Block]) -> Vec<usize> {
    let mut indent = vec![0usize; blocks.len()];
    let mut i = 0;
    while i < blocks.len() {
        let Block::ListItem { depth, .. } = &blocks[i] else {
            i += 1;
            continue;
        };
        let mut j = i + 1;
        while j < blocks.len() && !matches!(blocks[j], Block::ListItem { .. } | Block::Heading { .. }) {
            j += 1;
        }
        if let Some(Block::ListItem { depth: next_depth, .. }) = blocks.get(j) {
            if next_depth > depth {
                for slot in indent.iter_mut().take(j).skip(i + 1) {
                    *slot = *next_depth;
                }
            }
        }
        i = j;
    }
    indent
}

/// Renders blocks to Markdown, equations included: `$…$` inline, and a
/// display equation as its own block delimited by a lone `$` on its own
/// line before and after — not the more common `$$…$$` — because that is
/// the markdown dialect the editor's own `BlockMath` TipTap extension
/// actually parses (see `src/editor/extensions/BlockMath.tsx`'s markdown-it
/// rule). `$$…$$` isn't recognized as a block there at all: it falls
/// through to `InlineMath`'s regex instead, which pairs the first two
/// (adjacent) `$` as an empty match and renders the equation as small
/// inline math with stray `$` characters left over.
pub fn blocks_to_markdown(blocks: &[Block]) -> String {
```

Then find the end of `blocks_to_markdown`:

```rust
            // The placeholder travels through verbatim — it isn't a real
            // path yet (see `Inline::ImageRef`), so there is nothing here
            // that needs the escaping a table cell's content does.
            Block::Image { placeholder, alt } => {
                parts.push(format!("![{alt}]({placeholder})"));
            }
        }
    }
    let mut out = parts.join("\n\n");
    if !out.is_empty() {
        out.push('\n');
    }
    out
```

Replace with:

```rust
            // The placeholder travels through verbatim — it isn't a real
            // path yet (see `Inline::ImageRef`), so there is nothing here
            // that needs the escaping a table cell's content does.
            Block::Image { placeholder, alt } => {
                parts.push(format!("![{alt}]({placeholder})"));
            }
        }
    }

    // ListItem already indents itself via its own `depth`; every other
    // block type renders at column 0 and needs this pass to stay inside
    // whatever list it sits between.
    for (idx, level) in intervening_block_indent(blocks).into_iter().enumerate() {
        if level == 0 || matches!(blocks[idx], Block::ListItem { .. }) {
            continue;
        }
        let indent = "    ".repeat(level);
        parts[idx] = parts[idx]
            .lines()
            .map(|line| format!("{indent}{line}"))
            .collect::<Vec<_>>()
            .join("\n");
    }

    let mut out = parts.join("\n\n");
    if !out.is_empty() {
        out.push('\n');
    }
    out
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --lib pdf::layout_tests -- --nocapture 2>&1 | grep -E "an_equation_between|a_heading_between_a_list_item|test result"`

Expected: all three `PASS`.

- [ ] **Step 5: Run the full `pdf` test suite and clippy**

Run: `cargo test --lib pdf::`
Run: `cargo clippy -- -D warnings`

Expected: all tests pass (in particular every existing `ListItem`-only test — `a_lettered_sub_part_nests_under_its_digit_numbered_parent`, `an_indented_item_nests_under_the_one_above`, etc. — since two consecutive `ListItem` blocks with nothing between them produce an empty indent-run and are untouched by this pass), no clippy warnings.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/pdf/layout.rs src-tauri/src/pdf/layout_tests.rs
git commit -m "fix(pdf): indent intervening blocks so nested lists stay open in CommonMark"
```

---

## Task 2: Prove the fix against the real editor

**Files:**
- Create: `src/editor/extensions/mathBetweenListItems.test.ts`
- Verify only (no source changes): `src-tauri/src/pdf/layout.rs` via the real PDF

**Interfaces:**
- Consumes: `coreExtensions` from `src/editor/extensions/index.ts` and `@tiptap/core`'s `Editor`, the same headless-mount pattern `dividerNestedList.test.ts` already uses.
- Produces: nothing new — this task only adds regression coverage and a manual verification step.

- [ ] **Step 1: Write the editor round-trip regression test**

Create `src/editor/extensions/mathBetweenListItems.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { coreExtensions } from './index'

let editor: Editor | null = null

function mount(content: string): Editor {
  editor = new Editor({ element: document.createElement('div'), extensions: coreExtensions, content })
  return editor
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

// Analysis_2_Blatt12.pdf's exercise 6: a digit item, its equation, then
// lettered sub-parts that layout.rs force-nests one level deeper. The
// equation must be indented to that same depth (layout.rs's
// intervening_block_indent) for the whole thing to survive as one nested
// structure instead of the equation closing the list and the sub-parts
// landing in a codeBlock.
describe('a display equation sitting between a list item and its deeper sub-parts', () => {
  it('nests the equation and the sub-list inside the parent list item', () => {
    const md = [
      '6. Gegeben ist das nichtlineare System:',
      '',
      '    $',
      "    y'_1(t) = y_1(1 - y_1 - y_2), y'_2(t) = y_2(2 - y_1 - 2y_2).",
      '    $',
      '',
      '    1. Bestimmen Sie alle (drei) Fixpunkte (Ruhelagen) dieses Systems.',
      '',
      '    2. Linearisieren Sie das System in den Fixpunkten und bestimmen Sie jeweils.',
    ].join('\n')
    const e = mount(md)

    const doc = e.state.doc.toJSON() as { content: Array<Record<string, unknown>> }
    expect(doc.content).toHaveLength(1)
    const outerList = doc.content[0]
    expect(outerList['type']).toBe('orderedList')
    expect((outerList['attrs'] as Record<string, unknown>)['start']).toBe(6)

    const listItem = (outerList['content'] as Array<Record<string, unknown>>)[0]
    const itemContent = listItem['content'] as Array<Record<string, unknown>>
    const childTypes = itemContent.map((node) => node['type'])
    expect(childTypes).toEqual(['paragraph', 'blockMath', 'orderedList'])

    const innerList = itemContent[2] as Record<string, unknown>
    expect((innerList['attrs'] as Record<string, unknown>)['start']).toBe(1)
    expect((innerList['content'] as unknown[]).length).toBe(2)
  })

  it('does not nest when the equation sits between two same-depth exercises', () => {
    const md = [
      '3. Ein gedaempftes System:',
      '',
      '$',
      "y''(t) + 2y'(t) = 0.",
      '$',
      '',
      'Bestimmen Sie die Ausschlagung.',
      '',
      '4. Naechste Aufgabe',
    ].join('\n')
    const e = mount(md)

    const doc = e.state.doc.toJSON() as { content: Array<Record<string, unknown>> }
    const topLevelTypes = doc.content.map((node) => node['type'])
    expect(topLevelTypes).toEqual(['orderedList', 'blockMath', 'paragraph', 'orderedList'])

    const firstList = doc.content[0] as Record<string, unknown>
    const secondList = doc.content[3] as Record<string, unknown>
    expect((firstList['attrs'] as Record<string, unknown>)['start']).toBe(3)
    expect((secondList['attrs'] as Record<string, unknown>)['start']).toBe(4)
  })
})
```

- [ ] **Step 2: Run the new test**

Run: `npx vitest run src/editor/extensions/mathBetweenListItems.test.ts`

Expected: both tests `PASS` (the markdown fixtures already use the correct 4-space indent, since this test proves the editor's own parsing behavior, not `layout.rs`'s generation of it — that's Task 1).

- [ ] **Step 3: Run the full frontend test suite**

Run: `npx vitest run`

Expected: all tests pass, no regressions in `dividerNestedList.test.ts`, `BlockMath.test.tsx`, or any other editor test.

- [ ] **Step 4: Verify against the real document**

From `src-tauri/`, run:

```bash
NULL_NOTES_PDF="../notes/exercise_sheets/Analysis_2_Blatt12.pdf" cargo test --lib dump_markdown -- --ignored --nocapture
```

Expected: exercise 6's equation and its `1.`/`2.` sub-parts are all indented 4 spaces, and exercises 1–6 and the Bonusaufgaben stay unindented (no regression from Task 1 of the prior plan's median-based `left_margin` fix, already committed).

- [ ] **Step 5: Commit**

```bash
git add src/editor/extensions/mathBetweenListItems.test.ts
git commit -m "test(editor): prove intervening-block indent nests a real exercise-6 shape"
```
