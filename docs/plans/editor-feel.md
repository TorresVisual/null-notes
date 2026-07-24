# Editor Feel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Add slash-menu entries for Block Math, Table, and the missing Info/Important callout types — the three block types currently unreachable from the WYSIWYG editor UI — per `docs/specs/editor-feel-design.md`.

**Architecture:** Four new entries appended to the existing `COMMANDS` array in `src/editor/extensions/SlashCommands.tsx`, following the exact structure every other entry already uses.

**Tech Stack:** TipTap 3 (ProseMirror), React, TypeScript (strict).

## Global Constraints

- No slash-menu visual/UX changes — reachability only (spec Non-Goals).
- No changes to `ExerciseBlock` — out of scope (spec Non-Goals).
- No in-place editing for math nodes — `BlockMath` stays an atom node whose LaTeX is set once at insertion (spec Non-Goals).
- `npm run lint` does not exist in this repo (no script, no ESLint config) — use `npm run typecheck` only.
- `SlashCommands.tsx` has no existing test file and its `COMMANDS` entries aren't unit-tested today — this plan follows that precedent (spec Testing section).

---

## File Structure

| File | Change |
|---|---|
| `src/editor/extensions/SlashCommands.tsx` | Add 4 new `COMMANDS` entries: Block Math, Table, Info, Important |

No files are created or deleted.

---

### Task 1: Add Block Math, Table, Info, and Important slash commands

**Files:**
- Modify: `src/editor/extensions/SlashCommands.tsx`

**Interfaces:**
- Consumes: the existing `Cmd` interface (`{ title: string; description: string; run: (params: { editor: Editor; range: Range }) => void }`) already defined in this file — no changes to it.
- Produces: nothing consumed by other files — `COMMANDS` is only read internally by this file's `Suggestion` config.

- [ ] **Step 1: Add the four new entries to `COMMANDS`**

In `src/editor/extensions/SlashCommands.tsx`, the `COMMANDS` array currently ends with the `'Ink Block'` entry, immediately before the closing `]`:

```ts
  {
    title: 'Ink Block',
    description: 'Handwriting canvas',
    run: ({ editor, range }) => {
      const notePath = editor.storage.noteContext.notePath
      if (!notePath) return
      editor.chain().focus().deleteRange(range).run()
      void inkApi.ensureDir(notePath).then((dir) => {
        const sep = dir.includes('\\') ? '\\' : '/'
        const svgPath = `${dir}${sep}sketch-${Date.now()}.svg`
        return inkApi.write(svgPath, EMPTY_INK).then(() => {
          editor.commands.insertContent({ type: 'inkBlock', attrs: { src: svgPath, width: 800, height: 400 } })
        })
      })
    },
  },
]
```

Replace that closing `},\n]` with the four new entries followed by the closing bracket:

```ts
  {
    title: 'Ink Block',
    description: 'Handwriting canvas',
    run: ({ editor, range }) => {
      const notePath = editor.storage.noteContext.notePath
      if (!notePath) return
      editor.chain().focus().deleteRange(range).run()
      void inkApi.ensureDir(notePath).then((dir) => {
        const sep = dir.includes('\\') ? '\\' : '/'
        const svgPath = `${dir}${sep}sketch-${Date.now()}.svg`
        return inkApi.write(svgPath, EMPTY_INK).then(() => {
          editor.commands.insertContent({ type: 'inkBlock', attrs: { src: svgPath, width: 800, height: 400 } })
        })
      })
    },
  },
  {
    title: 'Block Math',
    description: 'LaTeX block equation',
    run: ({ editor, range }) => {
      const latex = window.prompt('LaTeX:')
      if (!latex) return
      editor.chain().focus().deleteRange(range).insertContent({ type: 'blockMath', attrs: { latex } }).run()
    },
  },
  {
    title: 'Table',
    description: '3×3 table with header row',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    title: 'Info',
    description: 'Info callout',
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'callout', attrs: { calloutType: 'info', title: '' }, content: [{ type: 'paragraph' }] })
        .run(),
  },
  {
    title: 'Important',
    description: 'Important callout',
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'callout', attrs: { calloutType: 'important', title: '' }, content: [{ type: 'paragraph' }] })
        .run(),
  },
]
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0. (`insertTable` is provided by the `Table` extension already loaded in `coreExtensions` — see `src/editor/extensions/index.ts:69` — so the chain method resolves without any import changes in this file.)

- [ ] **Step 3: Run the full test suite as a regression check**

Run: `npm run test`
Expected: PASS — this file has no existing tests, so this confirms the change doesn't break anything elsewhere (e.g. the `Cmd` type shape staying consistent).

- [ ] **Step 4: Manual QA**

Run: `npm run tauri dev`. Open a note and, on a blank line:
1. Type `/block math`, select it, enter `x^2 + y^2 = z^2` at the prompt — confirm the equation renders.
2. Type `/block math` again, select it, and cancel the prompt (Esc or Cancel button) — confirm the typed `/block math` text remains in the document, untouched.
3. Type `/table`, select it — confirm a 3-column × 3-row table with a bold header row appears.
4. Type `/info`, select it — confirm a callout renders in the note/info blue.
5. Type `/important`, select it — confirm a callout renders in purple.

Expected: all five behaviors match; no console errors in devtools.

- [ ] **Step 5: Commit**

```bash
git add src/editor/extensions/SlashCommands.tsx
git commit -m "feat: slash commands for block math, tables, and info/important callouts"
```

---

### Task 2: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck and test run**

Run: `npm run typecheck && npm run test`
Expected: both exit 0.

- [ ] **Step 2: Confirm Task 1's manual QA was completed**

If Task 1 Step 4 wasn't run yet (e.g. no stylus/interactive session was available at the time), run it now.

- [ ] **Step 3: Fix any issues found**

If manual QA surfaces a problem, fix it in `src/editor/extensions/SlashCommands.tsx`, re-run Step 1, and commit as `fix: <description>`.
