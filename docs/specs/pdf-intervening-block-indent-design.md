# PDF intervening-block indent for nested lists

## Problem

`blocks_to_markdown` (`layout.rs:2829`) renders every non-`ListItem` block — `MathsDisplay`, `Table`, `Image`, `Code`, `Paragraph` — at zero indent, with no concept of which list item, if any, it logically belongs inside. `ListItem` is the only variant that carries a `depth` and gets indented (`"    ".repeat(depth)`, fixed in `docs/specs/pdf-lettered-list-markers-design.md`).

CommonMark requires a list item's own continuation content to be indented to at least its content column, or the list is considered closed. The common shape this pipeline needs to render — a numbered problem statement, a display equation, then lettered sub-parts (exactly `Analysis_2_Blatt12.pdf`'s exercise 6) — puts an unindented equation between the parent item and its (now correctly nested, per the prior spec) deeper sub-parts. The unindented equation closes the list. By the time the parser reaches the sub-parts' indentation, there is no open list left to attach to, and 4+ leading spaces with no open list context is CommonMark's own rule for an **indented code block** — confirmed by round-tripping the real markdown through the live TipTap editor (not just inspecting the generated string) and finding the sub-parts landed in a `codeBlock` node, matching the screenshot that prompted this investigation:

```json
{ "type": "blockMath", "attrs": { "latex": "..." } },
{ "type": "codeBlock", "content": [{ "text": "1. Bestimmen Sie alle...\n\n2. Linearisieren Sie..." }] }
```

## Design

### The indent-decision pass

A new function, `intervening_block_indent(blocks: &[Block]) -> Vec<usize>`, runs once in `blocks_to_markdown`, after every block's `depth` is already final (i.e. after `assign_list_numbers` has run inside `group_blocks`, since `blocks_to_markdown` receives its output). It returns one indent-level per block, `0` meaning "render as-is."

For every `Block::ListItem` at index `i` with depth `d`, find the maximal run of blocks starting at `i + 1` that are neither `ListItem` nor `Heading`. Look at whatever comes right after that run:

- **A deeper `ListItem`** (its depth `> d`): every block in the run gets that deeper depth as its indent level. This is the confirmed real shape — a problem statement, its equation, then lettered sub-parts.
- **A same-or-shallower `ListItem`, a `Heading`, or nothing** (end of document): the run's indent stays `0` — unchanged from today. This is the other confirmed real shape — an equation and follow-up prose between two same-depth exercises, which must stay flat or the second exercise would misnest under the first.

A `Heading` inside the search always stops it (no run crosses a topic boundary), matching `assign_list_numbers`'s own reset rule.

```rust
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
```

### Applying it

`blocks_to_markdown` already builds `parts: Vec<String>`, one rendered string per block — that per-block-type rendering is unchanged. A post-processing step, after `parts` is built, zips it with `intervening_block_indent(blocks)`: for every index whose block is *not* a `ListItem` (which already indents itself via its own `depth`) and whose indent level is `> 0`, every line of that block's already-rendered string gets prefixed with `"    ".repeat(level)`. Table rows, a maths block's `$`/latex/`$` lines, and any other multi-line block all need every line prefixed, not just the first.

### Testing

Added to `layout_tests.rs`:

- A digit item, a display equation, then lettered sub-parts at the same geometric depth as the digit item (exercise 6's real shape): the equation is indented to match the sub-parts' (bumped) depth, and the whole thing round-trips through the real `coreExtensions` editor (the same technique used to diagnose this) into a `blockMath` and nested `orderedList` genuinely inside the parent `listItem` — not a sibling, not a `codeBlock`.
- A digit item, a display equation, follow-up prose, then a same-depth digit item (exercise 3 → 4's real shape): the equation and prose stay unindented, and the second item renders as its own separate top-level list, matching current (correct) behavior.
- A `Heading` between a list item and a later, deeper list item: the intervening run is *not* indented, since the heading already ends the list.

## Out of scope

- A following item more than one depth level deeper than its predecessor in a single step — not observed in this corpus; the same formula (indent to the following item's own depth) handles it if it occurs, just without dedicated test coverage.
- Any editor-side fix to the `block_math` markdown-it rule's own state handling. The chosen fix keeps the markdown *output* CommonMark-correct instead, which is more robust — it doesn't depend on understanding or trusting every custom node's low-level markdown-it integration, present and future.
