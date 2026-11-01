# Learnings

## Harness
- Fixture workspace is shared (`os.tmpdir()/null-notes-e2e-fixture`); hunt specs must clean up their own files.

## Techniques that found bugs

## Dead ends

## Flaky (not bugs)

## Harness (added 2026-11-01)
- Orphaned `null-notes.exe` (debug, fixture workspace) / `tauri-driver` / `msedgedriver` left by an aborted run make later runs fail every command with "web view not found / target window already closed". Kill them by exact PID only — the user's installed `Null Notes\null-notes.exe` runs concurrently and must never be killed (no `taskkill /IM`).
- Use `TaskStop` on a background e2e run, not process kills; then check `tasklist` for leftovers.
- `npx wdio run e2e/wdio.conf.ts --spec <file>` skips the ~1 min rebuild when the binary is current.

## Harness (round-trip)
- Sidebar tree labels are the note's **H1 title**, not the filename; open notes by H1 and give every case a unique H1. New external files appear in ~1 s; the first tree load takes up to ~10 s.
- Round-trip probe shape: write `.md` to fixture → click tree row → Ctrl+End → type `!` after a final `tail` paragraph → compare disk. Print original/disk with `console.log` and parse `/tmp`-style logs offline; one `it` per case so all diffs come from one run.

## Dead ends (intended normalizations, not bugs)
- Saved file has no trailing newline; CRLF → LF; blank line after frontmatter dropped; `$$` block maths is saved as a lone `$` fence (deliberate, BlockMath.tsx); `***` → `---`; `| - |` → `| --- |`; `__b__` → `**b**`; `<url>` → `[url](url)`; bullet markers `*`/`+` → `-` with extra blank lines; empty callout gains `> `.

## Techniques that found bugs
- Round-trip diffs against hand-written nasty `.md` files (one file per node type) found 5 serializer bugs in one 90 s run. Fastest regression guard is a vitest `new Editor({extensions: coreExtensions, content})` + `storage.markdown.getMarkdown()` (see `src/editor/extensions/markdownRoundTrip.test.ts`); no e2e needed to fix them.
- tiptap-markdown merges a node's `storage.markdown` over its stock spec shallowly, so overriding only `serialize` keeps the stock `parse`.

## Ideas not yet probed
- `SrState.tsx` regex captures `lapses=` (group 7) but never stores or writes it back: check whether a card's lapse count is lost on save.
- A suspicious-but-stable normalization can hide a real bug one save later: round-trip each output **twice** (`rt(rt(x))`). `<div>raw</div>` → `<div>
raw

</div>` looked cosmetic; the second pass escaped markdown inside it. Check other raw-HTML container nodes (Callout, Details, Mermaid, HTMLBlock) the same way.
- #171 needed two fixes (load: `wiki_link` core rule ran after markdown-it's `text_join`, so escaped brackets were already a link; save: `PlainText` strips bracket escapes). Two wrong guesses cost time: dump `editor.getJSON()` + tokens to a file in a scratch vitest before choosing the layer.

## Harness (tooling)
- Bash heredocs and Python-in-heredocs collapse backslash levels (`\[` became `\[`), so tests written that way pass vacuously. Write/Edit backslash-heavy test strings with the Edit/Write tools, then `grep | cat -A` to confirm what landed.

## Harness (vitest probes)
- `console.log` is swallowed by vitest here; write probe output with `appendFileSync` (a `/tmp/x` path lands in `D:\tmp\x`). Idempotent (`rt^3` stable) does not mean lossless: also eyeball src vs one-pass output and `getJSON()` before/after.
- Probe pattern: scratch `src/editor/extensions/hunt*.test.ts` with `CASES` map; delete at session end.
