# PDF lettered/roman sub-list markers

## Problem

`list_marker()` (`layout.rs:1775`) recognizes bullets (`•`/`*`/...), digit markers (`1.`/`1)`), and parenthesized alphanumeric markers (`(a)`/`(iv)`). It does **not** recognize the same convention without the wrapping parens (`a)`/`b)`/`iv)`), which several exercise sheets use for sub-parts.

Worse, even the form it does recognize is broken downstream. `Marker.number` is `None` for every alphanumeric marker (parenthesized or not) — there is no letter-to-number mapping — and `blocks_to_markdown` (`layout.rs:2849`) renders any ordered item with no number as the literal string `"1."`. Confirmed against a real document (`Analysis_2_Blatt12.pdf`, via `dump_markdown`): exercise 6's `(a)` and `(b)` sub-parts both come out as `1.`:

```
6. Gegeben ist das nichtlineare System:
  1. Bestimmen Sie alle (drei) Fixpunkte (Ruhelagen) dieses Systems.
  1. Linearisieren Sie das System in den Fixpunkten...
```

The same document also shows that these sub-parts sit at the **same x-indent** as their parent `6.` in the source PDF — no extra geometric indent. Since this pipeline's nesting depth (`LIST_INDENT_EMS`, `layout.rs:1972`) is purely geometric, correcting only the numbering still leaves `(a)`/`(b)` flat and indistinguishable from the sheet's own top-level `1.`–`6.` list.

## Design

### 1. Recognize bare letter/roman markers

`list_marker()` gains a branch alongside the existing `(a)` one, matched when the first non-whitespace character is ASCII-alphabetic (mutually exclusive with the digit and bullet branches, which already claim their own first characters):

```rust
// "a)" / "iv)" — the same sub-part convention as "(a)", without the
// parens some sheets omit.
if first.is_ascii_alphabetic() {
    let letters = rest.iter().take_while(|c| c.is_ascii_alphabetic()).count();
    if letters > 0
        && letters <= 4
        && rest.get(letters) == Some(&')')
        && rest.get(letters + 1).is_some_and(|c| c.is_whitespace())
    {
        return Some(Marker { ordered: true, number: None, len: leading + letters + 2 });
    }
}
```

Same length cap (4) and trailing-whitespace requirement as the parenthesized form, for the same reason: a bare word directly followed by `)` at the very start of a line is, in practice, always this convention rather than prose — prose that closes a paren opened earlier in the sentence never starts the line with the word right after the open.

Digit-only bare markers (`12)`) are already handled by the existing digit branch, so this one only ever fires for alphabetic runs — no overlap.

### 2. Auto-number markerless ordered items, with forced nesting after a digit item

A new pass, `assign_list_numbers(blocks: &mut [Block])`, runs at the end of `group_blocks` (`layout.rs:1979`) — the single place both public entry points (`chars_to_markdown`, `chars_and_images_to_markdown`) and every direct test caller already go through — right before it returns.

It walks the finished blocks in document order, tracking two small maps keyed by nesting depth:

- `counters: BTreeMap<usize, u32>` — the next number to auto-assign at that depth.
- `last_was_digit: BTreeMap<usize, bool>` — whether the most recent ordered item *seen* at that depth carried its own explicit source number (`true`) or was itself a letter marker (`false`).

For each `Block::ListItem { ordered: true, number, depth, .. }`, in order:

1. **Decide whether to force-nest.** If `number` is `None` (a letter marker) and `last_was_digit.get(depth) == Some(&true)`, bump this item's effective depth by one — a lettered marker immediately continuing a digit-numbered item's list is that item's sub-list, even with no extra geometric indent. Otherwise the effective depth is the item's own geometric depth.
2. **Drop stale deeper state.** Discard `counters`/`last_was_digit` entries for depths greater than the effective depth — a new item at this depth ends whatever was nested under whatever came before it at a deeper level.
3. **Assign.** If the item already carries a source number (digit marker), keep it as-is, record `last_was_digit[effective_depth] = true`, and seed `counters[effective_depth] = number + 1` so a later markerless item at the same depth continues from it. If it has no number (letter marker, parenthesized or bare), pull the next value from `counters[effective_depth]` (defaulting to 1), write it into `number`, increment the counter, and record `last_was_digit[effective_depth] = false`.
4. Write the possibly-bumped depth back into the block.

Unordered (bullet) items are left untouched by this pass entirely — they already get correct geometric depth, and there's no evidence in any real document of a bullet needing to interrupt a running ordered count.

**Reset boundary:** both maps are cleared whenever a `Block::Heading` is encountered. Two unrelated lettered lists separated by a heading each restart at 1 rather than the second silently continuing the first's count; a maths-display or paragraph block in between (the common case — an exercise's own problem statement between its number and its lettered sub-parts) does **not** reset, since that's exactly the shape real documents use.

No new fields on `Marker` or `Block::ListItem` — this reuses `ordered`, `number`, and `depth` exactly as they exist today. `blocks_to_markdown`'s existing `(true, None) => "1."` fallback is untouched (kept as the same defensive default described in CLAUDE.md — every ordered item has a `Some` number after this pass runs, but nothing here should panic if that invariant is ever violated).

### Known limitation (accepted, not fixed)

If an unrelated bullet item sits between a digit item and a later, geometrically-unrelated lettered list at the same depth, the lettered list will still be force-nested under the earlier digit item (bullets don't reset `last_was_digit`). No real document in this corpus does this; not worth the added state to guard against speculatively.

### Testing

Added to `layout_tests.rs`, following the file's existing `chars_to_markdown`/`group_blocks`-driven synthetic-fixture pattern:

- A bare `a) / b) / c)` sequence becomes an ordered list numbered `1. / 2. / 3.`.
- The existing `a_sub_part_label_becomes_a_list_item` test (currently asserts the bug — both items render `1.`) is corrected to assert `1.` then `2.`.
- A digit item (`1. Aufgabe`) followed by `(a)` / `(b)` sub-parts at the *same* geometric x as the digit item: the sub-parts render nested (one indent level deeper) and numbered `1. / 2.` independently of the parent's own number.
- Two digit items, each with its own `(a)`/`(b)` sub-parts: each sub-list independently restarts at `1.` (proves the depth-scoped counter reset on returning to a shallower item).
- A `Heading` between two unrelated bare-letter lists: the second list restarts at `1.` rather than continuing the first's count.

## Out of scope

- Preserving the literal letter/roman text in the rendered output (e.g. emitting `a.`/`b.` markers) — GFM ordered-list syntax is digits-only; a non-numeric marker would either fail to parse as a list at all or (if indented) risk being read as a code block. Per the answered design question, auto-numbering is the intended behavior.
- Resetting on a bullet item, or on any boundary other than `Heading` — see Known limitation above.
