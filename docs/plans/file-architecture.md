# File Architecture Execution Plan

**Status:** PLAN — not yet executed.
Source: docs/file-architecture.md

## Step 1: Move `notes/Plan.md` to `docs/brief.md`

- `git mv notes/Plan.md docs/brief.md`
- Reference updates needed: `docs/ROADMAP.md` — 4 occurrences of `notes/Plan.md` → `docs/brief.md` (around lines 81, 191, 193, 246).
- Verify: `git grep -n "notes/Plan.md"` returns nothing repo-wide; `docs/brief.md` exists and `notes/` no longer has a tracked file (`git ls-files notes/` returns nothing).

## Step 2: Fold `pdf/ligatures/tests.rs` inline into `pdf/ligatures.rs`

- Read `src-tauri/src/pdf/ligatures.rs` (confirms the `mod tests;` declaration at line 25) and `src-tauri/src/pdf/ligatures/tests.rs` in full.
- Replace `mod tests;` in `ligatures.rs` with `#[cfg(test)]\nmod tests {` + the body of `ligatures/tests.rs` (adjusting any `use super::*;` / relative imports as needed) + closing `}`, appended at the end of `ligatures.rs` — matching the inline pattern used by `latex.rs`, `extract.rs`, `dump.rs`, etc.
- `git rm src-tauri/src/pdf/ligatures/tests.rs` and remove the now-empty `src-tauri/src/pdf/ligatures/` directory.
- Verify: `cargo test ligatures` (from `src-tauri/`) passes with the same test count as before the move; `cargo fmt --check` and `cargo clippy -- -D warnings` stay clean.

---
Say "execute" to run this plan, or give feedback to revise it.
