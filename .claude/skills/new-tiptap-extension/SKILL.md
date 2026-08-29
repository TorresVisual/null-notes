---
name: new-tiptap-extension
description: Scaffold a new TipTap node extension under src/editor/extensions/ pre-filled with the markdown serialize/parse pair and spellcheck="false", the two requirements CLAUDE.md flags as silent failure modes when a node ships without them.
---

# Creating a new TipTap node extension

## Why this exists

CLAUDE.md's TipTap section states two failure modes plainly:

- "Markdown conversion has no central serializer... A node without one
  serializes as escaped plain text." Silent data loss on save→reload,
  easy to miss because the editor still *looks* right until the note is
  closed and reopened.
- "A new node that renders non-prose text needs [`spellcheck="false"`],
  or it gets underlined."

Both are structural, not code-review nitpicks — this skill bakes them
into the starting file instead of relying on catching their absence
later.

## Steps

1. Copy `templates/BlockNodeTemplate.tsx` (fenced-code-block markdown
   pattern, modeled on `DiagramBlock.tsx`) to
   `src/editor/extensions/<NodeName>.tsx`. If the node holds free-form
   editable prose rather than fixed attributes, use
   `FootnoteDefinition.tsx`'s `NodeViewContent`-based pattern instead —
   the template is a starting point, not the only valid shape.
2. Replace every `__NodeName__` / `__nodeName__` / `__node-name__` /
   `__fence-lang__` placeholder consistently (PascalCase / camelCase /
   kebab-case / the markdown fence language tag).
3. Fill in the real attributes (`addAttributes`, `__NodeName__Attrs`,
   `parseHTML`/`renderHTML`'s attribute mapping) and the real node view.
4. **Do not delete the two `TODO` comments in the template until done**:
   the `addStorage().markdown.serialize`/`parse` pair, and
   `spellCheck={false}` on the node view (only if it's non-prose —
   remove the prop if the node genuinely holds editable text).
5. Register it in `src/editor/extensions/index.ts`: import the export
   and add it to the `coreExtensions` array (see how `DiagramBlock` is
   wired in as the reference).
6. If it should be reachable from the `/` slash menu, add an entry in
   `SlashCommands.tsx` (see existing entries for the insertion pattern).
7. If the node renders anything that shouldn't appear in a printed/PDF
   export (editing affordances like an "Edit" button, a dropdown), add
   its class to the hidden-elements list in `src/index.css`'s
   `@media print` block; if its content can visually break awkwardly
   across a page (a table, a diagram, an equation), add it to that same
   block's `break-inside: avoid` list.
8. Add a test — see an existing extension's `.test.tsx` for the
   pattern (mount, type/insert, assert the markdown round-trips through
   save→reload).

## Verifying

    npm run typecheck
    npm test -- <NodeName>

Then actually type into the new node in `npm run tauri dev` and reload
the note — the one check that catches "looks right on screen, silently
wrong in the saved file," which typecheck and unit tests alone won't.
