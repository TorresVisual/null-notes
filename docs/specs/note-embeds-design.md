# Note embeds (`![[Note]]`, `![[Note#Heading]]`) — design

Issue #153 (Obsidian audit LK-011). Size: small–medium change; short design.

## Intent

A student reuses a definition or worked example across notes without copy-paste drift. `![[Note]]` / `![[Note#Heading]]` renders the target's current content inline, read-only, with a header linking to the source. Edits happen in the source note.

## ADR: accept `![[ ]]` syntax

**Decision: accepted.** `![[ ]]` is non-standard and will not render on GitHub (#113); the raw text shows as-is, exactly as `[[wiki-links]]` do today. There is no portable alternative: Markdown has no transclusion, and `![](Note.md)` only produces an image or a plain link. Disk keeps the `![[…]]` text, so a note stays readable anywhere.

## Goals / non-goals

- Goals: the five acceptance criteria in #153 (render + live update, cycle placeholder, unresolved placeholder, lossless round-trip, backlinks count embeds).
- Non-goals (tracked separately): block refs / `^id`, non-note file types, live `query` blocks, in-place editing.
- Anti-goal: an embed that can silently corrupt the host note or loop the UI.

## Approaches

1. **Nested read-only TipTap editor using `extensionsFor(path)` — chosen.** Math, callouts, code, tables and ink render exactly as in the source. Cost: one editor instance per embed.
2. markdown-it → static HTML. Lighter, but cannot draw the custom nodes that revision sheets consist of. Rejected.
3. Copy target nodes into the host document. Not read-only, not lossless. Rejected.

## Design

- **Node:** new `NoteEmbed` extension (block atom) in `src/editor/extensions/`, attrs `title`, `heading`. Markdown `serialize` writes `![[title#heading]]`; `parse` is a markdown-it core rule that runs *before* the wiki-link rule and claims the `!` (today `![[X]]` renders as a stray `!` plus a wiki-link). Reuses `parseWikiLink` / `formatWikiLink`. `spellcheck="false"` on the wrapper.
- **Syntax:** an embed is only recognised when `![[…]]` is the whole paragraph; inline `![[…]]` mid-sentence stays as today.
- **Resolution:** same title lookup as `WikiLink` (case-insensitive, `useNotesStore`). Unresolved → muted placeholder styled like `.wiki-link-missing`.
- **Heading slice:** from the matching heading (via `parseHeadings`' fence-aware logic) to the next heading of the same or higher level; heading missing → placeholder.
- **Rendering:** read-only nested editor over the fetched markdown. Header row shows the title (› heading) and opens the source (and scrolls to the heading, as `WikiLink` does).
- **Cycles:** a visited-path chain passed to nested embeds (React context); if the target is already in the chain, or the depth exceeds a small cap, render a "circular embed" placeholder.
- **Live update:** refetch on `workspace-changed` for the target path and on in-app saves of it; ignore our own-write echo as the save path already does.
- **Backlinks / rename:** `extract_links` and the rename rewrite already match `[[…]]` after a `!`; add tests rather than code.
- **Storage boundary:** no new state, nothing new on disk.

## Left to the builder

CSS (reuse existing classes; grep `index.css` for every new className before calling it done), exact depth cap, how the nested editor is torn down, placeholder wording, and whether the in-app save refetch uses an existing store event or a new one.

## Tests

Round-trip (`![[A]]`, `![[A#H]]`), cycle A→B→A, unresolved, missing heading, section slicing, backlink counting an embed (Rust), rename preserving `!`.
