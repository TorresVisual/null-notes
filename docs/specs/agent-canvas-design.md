# null-notes — Agent Canvas Design

A `.canvas` file you create in any workspace, rendered as a pannable card canvas, that an AI agent running in an IDE can fill in brainstorm pass by brainstorm pass so a human can verify each pass by eye. The agent-side skill is a separate spec (the upcoming null-notes-skills spec); this one defines the file format and the viewer it will target.

## Why

The goal is to *see what the agent is thinking*, not to get a Miro clone. The agent runs in the user's IDE on a code project (or any other folder); null-notes is the place the user looks. Obsidian's Canvas (audit items CV-001..004) is the reference, but the reason to build it here is agent legibility: every pass is a visibly separate, labelled, checkable unit.

## Reverses a closed decision

`docs/ROADMAP.md` §1 closes "Freeform 2D canvas" as **Won't build** (2026-08-13), because x/y objects have no Markdown form (principle #1). This design reopens it narrowly:

- The canvas is a **separate sidecar-style file**, never embedded in a note. No `.md` file changes; principle #1 is intact.
- Cards reference notes and code by link; they do not replace them.

Recording this reversal in ROADMAP §1 (closed-questions table) is part of the work — CLAUDE.md requires it for new workspace state.

## Goals

- Create, open, pan/zoom, and edit a `.canvas` file in any workspace; it re-renders when the file changes on disk (agent writes).
- A brainstorm **pass** is a labelled group the user can verify at a glance: which question it answered, what it added, what it linked to.
- Cards can link to workspace notes and to files outside the canvas (e.g. `src/net/retry.ts:42`).
- Human and agent edits coexist.

## Non-goals

- No AI code inside null-notes. The agent runs externally and only writes the file.
- No skill in this spec: its content, path handling, layout rules and install location belong to the null-notes-skills spec.
- No live card-by-card streaming; a pass appears whole.
- No Bases/web/media cards, no embedding a canvas in a note, no JSON Canvas interop work beyond staying a valid superset.
- No auto-layout engine in v1 in the app; agents place their own cards.

## Storage boundary

`.canvas` lives **inside the workspace** wherever the user creates it (travels with the notes, merges across machines as JSON). No new app-data state. The file is pretty-printed JSON, one node/edge per block, so git merges are line-oriented.

## Format

Valid [JSON Canvas](https://jsoncanvas.org) (`nodes`, `edges`) plus extension fields other tools ignore:

- Top-level `"lastPass": <n>`: the highest pass number ever allocated. It only goes up, so deleting a pass never lets its number be reused.
- Every node/edge an agent writes carries `"pass": <n>` and `"author": "agent"`. User-created elements carry no `pass` and no `author`.
- `pass` is permanent identity: a user edit never strips it. Editing an agent card's text sets `"edited": true` (rendered as a small marker). Moving or resizing is not an edit.
- Each pass is one `group` node labelled `Pass <n> · <short topic>` containing its cards.
- Each pass has a first `text` card, the **question card**: the question this pass asked, in one or two sentences.
- Card types used: `text` (short), `file` (path relative to the workspace root, plus an optional extension field `"line": <n>`; Obsidian's `subpath` is left alone for interop), `link` not used in v1. `file` cards pointing at a `.md` note open that note; other files open in the user's configured editor via the existing editor-launch path, which already takes a line number.
- **File-card paths are untrusted input** (an agent or a git pull wrote them) and reach a process launch, so they inherit `src-tauri/src/commands/CLAUDE.md`'s rules: no shell, every component must be `Component::Normal` as written, and the target must exist or the card renders inert. Paths outside the workspace are therefore not openable; a canvas in a notes workspace cannot link to code elsewhere.
- Edges may be labelled and directed. Agent elements are coloured by the app per pass number, so the agent cannot mislead via colour; a `color` field on them is preserved on save but not rendered. User-created cards may set their own colour.
- No per-pass "reviewed" state: checkable means easy to verify by eye.

## Agent write protocol (the contract the future skill follows)

1. Re-read the canvas file immediately before writing.
2. Next pass number = `lastPass` + 1; write the new value back to `lastPass`.
3. Append the new group, question card, and cards/edges; **never modify or delete** existing nodes/edges, whether from earlier passes or created by the user.
4. Write the whole file in a single atomic write (temp file → rename).
5. Reply in chat with the pass number and a one-paragraph summary so the user knows what to look at.

If the file changed between read and write (mtime/hash mismatch), re-read and redo the append once; if it still conflicts, stop and tell the user.

## null-notes side

- **Renderer:** `@xyflow/react` (React Flow), a new dependency, chosen over a hand-built view (more code, same format) and over Excalidraw (not agent-writable). A thin mapping converts JSON Canvas ↔ React Flow nodes/edges, preserving unknown fields on round-trip so extension fields survive a user's save.
- **Pass presentation:** group border/tint by pass number; a pass legend/filter lets the user hide older passes or show only the latest; the latest pass is highlighted after a reload caused by an external write.
- **External change:** goes through the existing watcher path. Per the save-path rules: a dirty (user-edited, unsaved) canvas is never overwritten from disk. Because agent passes only append elements with new ids, appended elements are merged into the open buffer silently; the app prompts only when the same element changed on both sides. The app's own writes must not raise a false conflict.
- **User edits:** drag, resize, add text card, add file card, draw edge, delete any card, edge or whole pass (agent-written included). Saves go through `write_atomic`.
- **Create:** a "New canvas" action in the sidebar/folder context menu, in the folder chosen.
- **Opening:** `.canvas` files appear in the sidebar tree and open in a tab like notes.
- Frontend follows project conventions: canvas state in a hook, pure JSON Canvas parse/serialize in `src/lib/`, dialogs reuse `index.css` classes (grep for classNames before calling done), canvas chrome is plain CSS or Tailwind per the app-shell/editor split.

## Approaches considered

| | Approach | Outcome |
|---|---|---|
| A | JSON Canvas + React Flow | **Chosen** (user, recommended) |
| B | JSON Canvas + hand-built view | Rejected: bulk of work is pan/zoom/drag/edge code |
| C | Reuse Excalidraw | Rejected: not agent-writable, no pass concept |

## Left to the builder

- React Flow ↔ JSON Canvas mapping details, group containment mechanics, and edge routing.
- Exact colour palette per pass (must pass the design-token bridge; no hardcoded colours).
- Pass legend/filter UI form.
- How `.canvas` is registered in the workspace scan, tabs, and watcher.
- Test strategy (pure parse/serialize + pass-number logic are unit-testable; the React Flow surface is verified with `e2e-verify`/`ui-preview`).

## Open for later (not v1)

- Optional "diff since pass n" view.
- Dragging a note from the sidebar onto the canvas.
- Auto-layout.
