# Outgoing-links panel (#160)

## Goal

A per-note panel answering three questions the backlinks panel cannot: what does this note link to, which of those links point nowhere, and which existing notes does it mention without linking.

## Intent

A growing workspace drifts: links break after renames, and notes that should be connected never are. The data is already in the editor and the notes store; the panel only has to surface it. Reference: Obsidian's Outgoing links.

## Scope

**In:** the active note's resolved links, unresolved links and possible links. Both link styles count: `[[Title]]` wiki-links and `[text](Note.md)` Markdown links.

**Out:** workspace-wide orphan/dead-end reports, graph filters, path-qualified wiki-links (#122), any Rust, schema or IPC change.

**Anti-goal:** typing latency. The analysis never runs on the keystroke path.

## Approach

Considered three ways to build it:

- **A. Pure frontend (chosen).** A pure `lib/outgoingLinks.ts` scans the note's Markdown against the notes store. Reuses `resolveNoteLink`. No new IPC or schema, unit-testable as a plain function.
- B. Rust command after reindex. Matches how backlinks work, but Markdown-link resolution lives only in TypeScript, so it would have to be ported and kept in sync.
- C. Hybrid (Rust counts, TypeScript resolves). Splits one feature across two languages and an IPC hop.

`note_links` stores distinct targets with no counts and no Markdown links, so it cannot answer this panel's questions regardless of approach; the note's own text is the source.

## Design

**Analysis.** `analyseOutgoingLinks(content, notePath, workspace, notes)` returns `{ links, unresolved, possible }`.

- Frontmatter, fenced code and inline code are skipped.
- Wiki-links: target is the part before `#`/`|`, resolved case-insensitively by title (same rule as `WikiLink.tsx`).
- Markdown links: non-external, non-image, path part ends in `.md`; resolved with `resolveNoteLink`.
- **Links:** one row per resolved note, count = wiki + Markdown references combined. Click opens it.
- **Unresolved:** one row per distinct missing target with its count.
  - A wiki target creates a note titled after it, via `useCreateNote` (same as the `[[` click).
  - A Markdown target creates the note at the link's resolved location (its folder, basename as title).
- **Possible links:** one row per other note whose title appears as a whole word, case-insensitive, outside code and existing links, and which this note does not already link to. Excludes the note's own title.
- **Collisions (#122):** a title shared by several notes shows one row listing every candidate with its folder; each candidate opens its own note. Possible-link rows with a shared title are marked ambiguous.

**Update path.** A `useOutgoingLinks` hook debounces the note content (~500 ms, the reindex cadence) and recomputes. A change to the notes store (create, rename, delete) recomputes immediately; it is rare and cheap.

**Convert to link.** Clicking a possible link sends a window event handled in `NoteEditor` (same pattern as the existing split-tasks listener). The handler finds the first plain-text occurrence in the document, outside links and code, and replaces it with a `wikiLink` node (`[[Title]]`), keeping the original text as the label when its casing differs. The editor's normal `onChange` then saves and reindexes. It converts one occurrence per click.

**UI.** A docked panel with three headed sections and counts, toggled like Outline: a `toggle-outgoing-links` action beside `toggle-outline` (keymap, menu, command palette), closed by default. Reuses the `backlinks-*` row styling; any new classNames get a matching rule in `index.css` before the work is called done.

## Decisions I made (please check)

- Closed by default, rather than open like Outline, because it is wider than Outline's rail.
- Possible links need titles of 3+ characters, so short titles like "DB" do not flood the list.
- Only `.md` Markdown links count as note links; links to PDFs or images are ignored.
- Converting a possible link in an ambiguous-title row writes the unqualified `[[Title]]`, because qualified syntax is #122. The row warns first.
- The analysis ignores code spans, whereas the Rust `extract_links` does not. The two can differ for `[[x]]` inside code; the panel's answer is the right one for a reader.

## Left to the builder

Panel placement and CSS, exact regexes, the folder label format in collision rows, the debounce's home (hook vs. existing reindex timer), and test layout.

## Verification

Vitest on `analyseOutgoingLinks` (both link styles, counts, code skipping, collisions, whole-word matching, own-title exclusion), a component test for the three sections and their click actions, and a `NoteEditor` test that the convert event produces a wiki-link node. An e2e pass through `e2e-verify` for the real convert-and-save round trip.
