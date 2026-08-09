# Block Handle System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Add a Notion-style block handle (hover grip, click-to-select, delete/duplicate menu, drag-to-reorder, multi-block range select) across all top-level editor blocks, and give `BlockMath` the same click-to-edit workflow `InlineMath` already has.

**Architecture:** Three official, MIT-licensed TipTap 3 extensions — `@tiptap/extension-drag-handle` (+ its React wrapper) and `@tiptap/extension-node-range` — do the hard ProseMirror-plugin work (cursor-to-node tracking, native HTML5 drag-and-drop, multi-node range selection). A new `BlockHandle.tsx` renders the grip and a small Delete/Duplicate menu on top of them, mounted once in `NoteEditor.tsx` as a sibling of `<EditorContent>`. `BlockMath.tsx`'s NodeView is separately rewritten to mirror `InlineMath.tsx`'s existing click-to-edit pattern.

**Tech Stack:** TipTap 3.27.4, React 19, `@tiptap/extension-drag-handle-react`, `@tiptap/extension-node-range`, KaTeX, Vitest + `@testing-library/react` + `@testing-library/user-event`.

## Global Constraints

- Pin all three new `@tiptap/*` packages to exactly `3.27.4`, matching the rest of the installed `@tiptap/*` set (confirmed available on the registry).
- `DragHandle` is configured `nested={false}` everywhere — dropping a block inside a container (callout, list item, table cell) is out of scope for this plan.
- The handle menu shows **Duplicate only for a single selected block**; a range selection's menu shows **Delete only** — no multi-block duplicate.
- No automated tests for pointer-driven drag/hover mechanics — `getBoundingClientRect` returns zeros in jsdom, so `@tiptap/extension-drag-handle`'s cursor-to-node tracking cannot run meaningfully in a test environment. These are verified manually in `npm run tauri dev`. (Verified during planning by reading the package's own source — this is a real environment limitation, not a shortcut.)
- Reuse existing design tokens only — `--accent`, `--accent-bg`, `--danger`, `--bg-raised`, `--border-strong`, `--space-*` — no new colors.
- Reuse ProseMirror's own selection classes (`ProseMirror-selectednode`, and `ProseMirror-selectednoderange` from `@tiptap/extension-node-range`) for the "selected block" visual treatment rather than inventing custom selection-tracking code — confirmed by reading both packages' compiled output that these classes are applied automatically.

---

## Part A: Block Math In-Place Editing

Independent of Part B — ships and is fully testable on its own. Closes the gap `docs/specs/editor-feel-design.md` left open ("no in-place editing for math nodes... a separate, larger project").

### Task A1: `BlockMathView` — click to edit, commit with Mod-Enter

**Files:**
- Modify: `src/editor/extensions/BlockMath.tsx`
- Test: `src/editor/extensions/BlockMath.test.tsx` (new)
- Modify: `src/index.css:320` (insert after `.block-math .katex { font-size: 1.4em; }`)

**Interfaces:**
- Produces: `BlockMathView` React component with local state `editing: boolean`, `draft: string`. DOM hooks for tests: `.block-math-render` (click target, idle state), `.block-math-editor-input` (the `<textarea>`, editing state).
- Consumes: `ReactNodeViewProps` from `@tiptap/react` (`node`, `editor`, `getPos`, `updateAttributes`, `deleteNode`, `selected`) — same shape `InlineMathView` already uses in `InlineMath.tsx:30`.

- [ ] **Step 1: Write the failing test**

Create `src/editor/extensions/BlockMath.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { useEffect } from 'react'
import { coreExtensions } from './index'

let editor: Editor | null = null

function TestEditor({ content, onReady }: { content: string; onReady: (editor: Editor) => void }) {
  const instance = useEditor({ extensions: coreExtensions, content })
  useEffect(() => {
    if (instance) onReady(instance)
  }, [instance])
  return <EditorContent editor={instance} />
}

function mount(content: string) {
  return render(<TestEditor content={content} onReady={(e) => { editor = e }} />)
}

function getRender(container: HTMLElement): HTMLElement {
  const el = container.querySelector('.block-math-render')
  if (!el) throw new Error('block-math-render not found')
  return el as HTMLElement
}

function getTextarea(container: HTMLElement): HTMLTextAreaElement | null {
  return container.querySelector<HTMLTextAreaElement>('.block-math-editor-input')
}

function mathNodes(instance: Editor): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = []
  instance.state.doc.descendants((node) => {
    if (node.type.name === 'blockMath') found.push(node.attrs)
    return true
  })
  return found
}

describe('block math editing', () => {
  it('opens the in-place editor on click, seeded with the committed latex', async () => {
    const user = userEvent.setup()
    const { container } = mount('$\n\ne^{i\\pi} + 1 = 0\n\n$')
    await waitFor(() => expect(getRender(container)).toBeInTheDocument())
    await user.click(getRender(container))
    await waitFor(() => expect(getTextarea(container)).toBeInTheDocument())
    expect(getTextarea(container)!.value).toBe('e^{i\\pi} + 1 = 0')
  })

  it('commits the draft on Mod-Enter and closes the editor', async () => {
    const user = userEvent.setup()
    const { container } = mount('$\n\ne^{i\\pi} + 1 = 0\n\n$')
    await waitFor(() => expect(getRender(container)).toBeInTheDocument())
    await user.click(getRender(container))
    const textarea = await waitFor(() => {
      const el = getTextarea(container)
      if (!el) throw new Error('editor not open yet')
      return el
    })
    await user.clear(textarea)
    await user.type(textarea, 'b^3{Control>}{Enter}{/Control}')
    await waitFor(() => expect(getTextarea(container)).toBeNull())
    expect(mathNodes(editor!)).toEqual([{ latex: 'b^3' }])
  })
})

afterEach(() => {
  editor?.destroy()
  editor = null
})
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npm test -- BlockMath.test.tsx`
Expected: FAIL — `.block-math-render` is never found (the current `BlockMathView` has no click target, no editing state, no textarea).

- [ ] **Step 3: Rewrite `BlockMathView` to add click-to-edit and Mod-Enter commit**

Replace the top of `src/editor/extensions/BlockMath.tsx` (everything from the imports through the end of `BlockMathView`, i.e. lines 1-18 of the current file) with:

```tsx
import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { ReactNodeViewProps } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import katex from 'katex'

interface BlockMathAttrs {
  latex: string
}

interface Rendered {
  html: string
  error: string | null
}

function render(latex: string): Rendered {
  try {
    return { html: katex.renderToString(latex, { throwOnError: true, displayMode: true }), error: null }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return {
      html: katex.renderToString(latex, { throwOnError: false, displayMode: true }),
      error: message.replace(/^KaTeX parse error: /, ''),
    }
  }
}

function BlockMathView({ node, editor, getPos, updateAttributes, deleteNode, selected }: ReactNodeViewProps) {
  const { latex } = node.attrs as unknown as BlockMathAttrs
  const [editing, setEditing] = useState(() => editor.isEditable && latex === '')
  const [draft, setDraft] = useState(latex)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) textareaRef.current?.focus()
  }, [editing])

  function open() {
    if (!editor.isEditable) return
    setDraft(latex)
    setEditing(true)
  }

  function close(refocus: boolean) {
    setEditing(false)
    if (!refocus) return
    const pos = getPos()
    if (pos === undefined) editor.commands.focus()
    else editor.commands.focus(pos + node.nodeSize)
  }

  function commit(refocus: boolean) {
    const next = draft.trim()
    if (!next) {
      setEditing(false)
      deleteNode()
      if (refocus) editor.commands.focus()
      return
    }
    updateAttributes({ latex: next })
    close(refocus)
  }

  function cancel() {
    if (!latex) {
      setEditing(false)
      deleteNode()
      editor.commands.focus()
      return
    }
    setDraft(latex)
    close(true)
  }

  const display = render(latex)
  const preview = render(draft)

  return (
    <NodeViewWrapper
      className={`block-math${selected ? ' selected' : ''}${editing ? ' editing' : ''}`}
      spellCheck={false}
    >
      {!editing && (
        <div className="block-math-render" onClick={open} dangerouslySetInnerHTML={{ __html: display.html }} />
      )}
      {editing && (
        <div className="block-math-editor" contentEditable={false} onMouseDown={(e) => e.stopPropagation()}>
          <textarea
            ref={textareaRef}
            className="block-math-editor-input"
            value={draft}
            spellCheck={false}
            placeholder="e^{i\pi} + 1 = 0  (Mod-Enter to apply, Escape to cancel)"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(false)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                commit(true)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancel()
              }
            }}
          />
          <div className="block-math-editor-preview" dangerouslySetInnerHTML={{ __html: preview.html }} />
          {preview.error && <div className="block-math-editor-error">{preview.error}</div>}
        </div>
      )}
    </NodeViewWrapper>
  )
}
```

Leave everything from `export const BlockMath = Node.create({` onward **unchanged** — the schema, `parseHTML`, `renderHTML`, `addNodeView`, and `addStorage` (markdown serialize/parse) are not affected by this rewrite.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npm test -- BlockMath.test.tsx`
Expected: PASS (both tests)

- [ ] **Step 5: Add the CSS**

In `src/index.css`, after line 320 (`.block-math .katex { font-size: 1.4em; }`), insert:

```css

.block-math-render { cursor: pointer; border-radius: 4px; display: inline-block; padding: 2px 6px; }
.block-math-render:hover { background: var(--accent-bg); }

.block-math-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-sm);
  background: var(--bg-raised);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  text-align: left;
  user-select: text;
}

.block-math-editor-input {
  width: 100%;
  min-height: 4.5em;
  padding: var(--space-sm);
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-sunken);
  border: 1px solid var(--border);
  border-radius: 5px;
  outline: none;
  resize: vertical;
}

.block-math-editor-input:focus { border-color: var(--accent); }

.block-math-editor-preview {
  display: block;
  min-height: 1.6em;
  padding: var(--space-xs) 2px;
  overflow-x: auto;
  text-align: center;
  color: var(--text-primary);
}

.block-math-editor-preview .katex { font-size: 1.4em; }

.block-math-editor-error {
  font-size: 12px;
  line-height: 1.35;
  color: var(--danger);
}
```

- [ ] **Step 6: Run `npm run typecheck`**

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/editor/extensions/BlockMath.tsx src/editor/extensions/BlockMath.test.tsx src/index.css
git commit -m "$(cat <<'EOF'
feat(editor): click-to-edit for block math equations

BlockMathView now mirrors InlineMathView's edit workflow: click the
rendered equation to open a textarea with a live KaTeX preview,
Mod-Enter to commit, matching the pattern already shipped for inline
math.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task A2: `BlockMathView` — Escape cancels, empty draft deletes the node, auto-open on insert

**Files:**
- Modify: `src/editor/extensions/BlockMath.tsx` (no changes needed — Escape/cancel/auto-open logic was already written in Task A1's `cancel()`/`commit()`/`useState` initializer; this task is pure test coverage for behavior that already exists)
- Test: `src/editor/extensions/BlockMath.test.tsx`

**Interfaces:**
- Consumes: `mount`, `getRender`, `getTextarea`, `mathNodes` helpers defined in Task A1's test file.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('block math editing', ...)` block in `src/editor/extensions/BlockMath.test.tsx`, before the closing `})`:

```tsx
  it('reverts to the committed latex and closes on Escape', async () => {
    const user = userEvent.setup()
    const { container } = mount('$\n\ne^{i\\pi} + 1 = 0\n\n$')
    await waitFor(() => expect(getRender(container)).toBeInTheDocument())
    await user.click(getRender(container))
    const textarea = await waitFor(() => {
      const el = getTextarea(container)
      if (!el) throw new Error('editor not open yet')
      return el
    })
    await user.clear(textarea)
    await user.type(textarea, 'garbage{Escape}')
    await waitFor(() => expect(getTextarea(container)).toBeNull())
    expect(mathNodes(editor!)).toEqual([{ latex: 'e^{i\\pi} + 1 = 0' }])
  })

  it('deletes the node when committing an empty draft', async () => {
    const user = userEvent.setup()
    const { container } = mount('$\n\ne^{i\\pi} + 1 = 0\n\n$')
    await waitFor(() => expect(getRender(container)).toBeInTheDocument())
    await user.click(getRender(container))
    const textarea = await waitFor(() => {
      const el = getTextarea(container)
      if (!el) throw new Error('editor not open yet')
      return el
    })
    await user.clear(textarea)
    await user.type(textarea, '{Control>}{Enter}{/Control}')
    await waitFor(() => expect(mathNodes(editor!)).toHaveLength(0))
  })

  it('opens directly into edit mode for a freshly inserted empty node, and Escape deletes it', async () => {
    const { container } = mount('<p></p>')
    editor!.commands.insertContent({ type: 'blockMath', attrs: { latex: '' } })
    await waitFor(() => expect(getTextarea(container)).toBeInTheDocument())
    const user = userEvent.setup()
    await user.type(getTextarea(container)!, '{Escape}')
    await waitFor(() => expect(mathNodes(editor!)).toHaveLength(0))
  })
```

- [ ] **Step 2: Run the tests, confirm the outcome**

Run: `npm test -- BlockMath.test.tsx`
Expected: PASS — Task A1's `BlockMathView` already implements `cancel()` (Escape reverts non-empty latex, deletes empty-latex nodes), `commit()` (empty draft deletes the node), and the `useState(() => editor.isEditable && latex === '')` auto-open initializer. If any of these three fail, the bug is in Task A1's implementation, not a missing feature — fix `BlockMathView` directly rather than adding new code.

- [ ] **Step 3: Commit**

```bash
git add src/editor/extensions/BlockMath.test.tsx
git commit -m "$(cat <<'EOF'
test(editor): cover block math cancel, empty-delete, and auto-open

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task A3: Drop `window.prompt` from the "Block Math" slash command

**Files:**
- Modify: `src/editor/extensions/SlashCommands.tsx:141-148`

**Interfaces:**
- No new interfaces — matches the existing `Cmd` shape used by every other entry in `COMMANDS`.

- [ ] **Step 1: Replace the command**

`SlashCommands.tsx` has no test file today (confirmed: `editor-feel-design.md` explicitly followed this same precedent for its own new `COMMANDS` entries), so this task is implementation + manual verification, not TDD.

Replace:

```tsx
  {
    title: 'Block Math',
    description: 'LaTeX block equation',
    run: ({ editor, range }) => {
      const latex = window.prompt('LaTeX:')
      if (!latex) return
      editor.chain().focus().deleteRange(range).insertContent({ type: 'blockMath', attrs: { latex } }).run()
    },
  },
```

with:

```tsx
  {
    title: 'Block Math',
    description: 'LaTeX block equation',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).insertContent({ type: 'blockMath', attrs: { latex: '' } }).run(),
  },
```

This is structurally identical to the existing "Inline Equation" entry two blocks above it (`SlashCommands.tsx:129-139`).

- [ ] **Step 2: Run `npm run typecheck`**

Expected: no errors.

- [ ] **Step 3: Manual verification**

Run `npm run tauri dev`. Type `/block math` in a note and select it. Confirm: no native browser prompt appears; the block math node inserts and immediately opens into edit mode (per Task A1/A2's auto-open behavior); typing LaTeX and pressing Mod-Enter commits and renders it.

- [ ] **Step 4: Commit**

```bash
git add src/editor/extensions/SlashCommands.tsx
git commit -m "$(cat <<'EOF'
fix(editor): drop native prompt from the Block Math slash command

Matches how Inline Equation already works: insert an empty node that
opens straight into the in-place editor, instead of a window.prompt
dialog with no way to edit the equation afterward.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Part B: Block Handle System

Depends on Part A being on `main` (or at least in the working tree) only in the sense that both touch the editor — there is no code dependency between them. Part B can be built independently, but is sequenced after Part A in this plan since Part A is smaller and fully self-contained.

### Task B1: Install and pin the TipTap drag-handle / node-range packages

**Files:**
- Modify: `package.json`

**Interfaces:** None — pure dependency installation.

- [ ] **Step 1: Add the dependencies**

In `package.json`, in the `"dependencies"` object, insert these three lines immediately after `"@tiptap/extension-code-block-lowlight": "3.27.4",` (keeping the rest of the block unchanged):

```json
    "@tiptap/extension-drag-handle": "3.27.4",
    "@tiptap/extension-drag-handle-react": "3.27.4",
    "@tiptap/extension-node-range": "3.27.4",
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: `package-lock.json` updates; no version conflicts (these three packages are confirmed published at exactly `3.27.4`, matching the rest of the installed `@tiptap/*` set).

- [ ] **Step 3: Verify nothing broke**

Run: `npm run typecheck`
Run: `npm test`
Expected: both pass unchanged — the new packages aren't referenced by any code yet, so this only confirms the install itself is sound.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
build: add TipTap drag-handle and node-range extensions

MIT-licensed, pinned to 3.27.4 to match the rest of the @tiptap/*
set. Not wired into the editor yet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task B2: Register `NodeRange` in `coreExtensions`

**Files:**
- Modify: `src/editor/extensions/index.ts`
- Test: `src/editor/extensions/nodeRange.test.ts` (new)

**Interfaces:**
- Produces: `coreExtensions` now includes `NodeRange` configured with `key: 'Shift'`.
- Consumes: `NodeRangeSelection`, `isNodeRangeSelection` from `@tiptap/extension-node-range` (both are plain exports, usable independent of whether the extension is registered — see note in Step 1 below on why this task's test isn't a strict TDD fail-first test).

- [ ] **Step 1: Register the extension**

In `src/editor/extensions/index.ts`, add the import alongside the other extension imports (near `import { Divider } from './Divider'` at the top):

```ts
import { NodeRange } from '@tiptap/extension-node-range'
```

In the `coreExtensions` array, add it immediately after `Divider,`:

```ts
  Divider,
  NodeRange.configure({ key: 'Shift' }),
```

- [ ] **Step 2: Write the regression test**

Create `src/editor/extensions/nodeRange.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { NodeRangeSelection, isNodeRangeSelection } from '@tiptap/extension-node-range'
import { coreExtensions } from './index'

let editor: Editor | null = null

function mount(content: string): Editor {
  editor = new Editor({ element: document.createElement('div'), extensions: coreExtensions, content })
  return editor
}

// NodeRangeSelection can be constructed and dispatched independent of whether
// the NodeRange extension is registered — the extension's own job is mouse
// handling and decorations (both DOM/view concerns, out of scope for jsdom
// per this plan's Global Constraints). This test is a regression/integration
// check — confirming NodeRangeSelection composes correctly with the full
// coreExtensions set (no plugin conflicts with Divider's custom commands,
// CodeBlockEditor's key handling, etc.) — not a fail-first TDD test.
describe('multi-block range selection', () => {
  it('selects a run of top-level blocks as a NodeRangeSelection', () => {
    const e = mount('<p>one</p><p>two</p><p>three</p>')
    const selection = NodeRangeSelection.create(e.state.doc, 0, e.state.doc.content.size)
    e.view.dispatch(e.state.tr.setSelection(selection))
    expect(isNodeRangeSelection(e.state.selection)).toBe(true)
  })

  it('deletes every block in the range with one command', () => {
    const e = mount('<p>one</p><p>two</p><p>three</p>')
    const selection = NodeRangeSelection.create(e.state.doc, 0, e.state.doc.content.size)
    e.view.dispatch(e.state.tr.setSelection(selection))
    e.commands.deleteSelection()
    expect(e.state.doc.textContent).toBe('')
  })
})

afterEach(() => {
  editor?.destroy()
  editor = null
})
```

- [ ] **Step 3: Run the test**

Run: `npm test -- nodeRange.test.ts`
Expected: PASS. If `deleteSelection` does not remove all three paragraphs (e.g. it only removes one), that means `NodeRangeSelection`'s default `Selection` base-class `replace()` behavior doesn't do what the range implies — investigate via `superpowers:systematic-debugging` rather than working around it, since the whole point of Part B's range-select feature depends on this working.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Run: `npm run typecheck`
Expected: all pass — confirms `NodeRange` doesn't conflict with any existing extension (`Divider`'s custom `insertDivider` command, `CodeBlockEditor`'s key handling, etc.)

- [ ] **Step 5: Commit**

```bash
git add src/editor/extensions/index.ts src/editor/extensions/nodeRange.test.ts
git commit -m "$(cat <<'EOF'
feat(editor): register NodeRange for multi-block selection

Shift-click extends a NodeRangeSelection across top-level blocks.
Not yet wired into any UI — BlockHandle.tsx will read this in a
later task.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task B3: `BlockHandle.tsx` — hover grip, click-to-select, drag-to-reorder

**Files:**
- Create: `src/editor/extensions/BlockHandle.tsx`
- Modify: `src/index.css` (append at end of file)

**Interfaces:**
- Produces: `BlockHandle({ editor: Editor })` React component — a default-exportable named export, mounted directly (not via `coreExtensions`, per the spec: `DragHandle`'s React pattern renders outside the ProseMirror DOM as a sibling of `<EditorContent>`).
- Consumes: `DragHandle` (default export) from `@tiptap/extension-drag-handle-react`; `GripVertical` from `lucide-react` (already a project dependency, used in `Callout.tsx`).

No automated test for this task — see Global Constraints on why pointer/hover mechanics can't run meaningfully in jsdom (`getBoundingClientRect` returns zeros, and `@tiptap/extension-drag-handle`'s cursor-to-node matching depends on real layout).

- [ ] **Step 1: Write `BlockHandle.tsx`**

```tsx
import { useCallback, useState } from 'react'
import type { Editor } from '@tiptap/react'
import DragHandle from '@tiptap/extension-drag-handle-react'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { GripVertical } from 'lucide-react'

interface BlockHandleProps {
  editor: Editor
}

export function BlockHandle({ editor }: BlockHandleProps) {
  const [hoveredPos, setHoveredPos] = useState<number | null>(null)

  const handleNodeChange = useCallback(
    ({ pos, node }: { pos: number; node: ProseMirrorNode | null; editor: Editor }) => {
      setHoveredPos(node ? pos : null)
    },
    [],
  )

  function selectHovered() {
    if (hoveredPos === null) return
    editor.commands.setNodeSelection(hoveredPos)
  }

  return (
    <DragHandle editor={editor} onNodeChange={handleNodeChange} nested={false}>
      <button type="button" className="block-handle-grip" aria-label="Block actions" onClick={selectHovered}>
        <GripVertical size={14} />
      </button>
    </DragHandle>
  )
}
```

- [ ] **Step 2: Add the CSS**

Append to the end of `src/index.css`:

```css

/* ── Block Handle ──────────────────────────────────────────────── */
.block-handle-grip {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  cursor: grab;
}

.block-handle-grip:hover { background: var(--bg-hover); color: var(--text-primary); }
.block-handle-grip:active { cursor: grabbing; }
```

- [ ] **Step 3: Run `npm run typecheck`**

Expected: no errors. (`BlockHandle.tsx` isn't imported anywhere yet, so this only confirms the file itself is well-typed — Task B5 wires it in.)

- [ ] **Step 4: Commit**

```bash
git add src/editor/extensions/BlockHandle.tsx src/index.css
git commit -m "$(cat <<'EOF'
feat(editor): add BlockHandle grip component

Wraps @tiptap/extension-drag-handle-react: hover shows a grip in the
gutter, click selects the hovered block, drag reorders it among
top-level siblings (nested: false). Not mounted yet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task B4: Handle menu — Delete / Duplicate, range-aware

**Files:**
- Modify: `src/editor/extensions/BlockHandle.tsx`
- Modify: `src/index.css` (append)

**Interfaces:**
- Consumes: `NodeSelection` from `@tiptap/pm/state` (same import source `Divider.ts` already uses for `Selection`/`Transaction`); `isNodeRangeSelection` from `@tiptap/extension-node-range` (registered in Task B2).
- Produces: menu shows **Duplicate + Delete** for a single-block `NodeSelection`, **Delete only** for a `NodeRangeSelection` — per this plan's Global Constraints.

No automated test — the menu's open/close is driven by real click positioning relative to the grip (`getBoundingClientRect`), the same jsdom limitation as Task B3.

- [ ] **Step 1: Rewrite `BlockHandle.tsx`**

Replace the full contents of `src/editor/extensions/BlockHandle.tsx` with:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import DragHandle from '@tiptap/extension-drag-handle-react'
import { NodeSelection } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { isNodeRangeSelection } from '@tiptap/extension-node-range'
import { GripVertical, Trash2, Copy } from 'lucide-react'

interface BlockHandleProps {
  editor: Editor
}

function duplicateSelectedNode(editor: Editor): boolean {
  const { selection } = editor.state
  if (!(selection instanceof NodeSelection)) return false
  const json = selection.node.toJSON()
  const insertPos = selection.to
  return editor.chain().focus().insertContentAt(insertPos, json).setNodeSelection(insertPos).run()
}

export function BlockHandle({ editor }: BlockHandleProps) {
  const [hoveredPos, setHoveredPos] = useState<number | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const gripRef = useRef<HTMLButtonElement>(null)

  const handleNodeChange = useCallback(
    ({ pos, node }: { pos: number; node: ProseMirrorNode | null; editor: Editor }) => {
      setHoveredPos(node ? pos : null)
      setMenuOpen(false)
    },
    [],
  )

  function openMenu() {
    if (hoveredPos === null) return
    editor.commands.setNodeSelection(hoveredPos)
    setMenuOpen(true)
  }

  function closeMenu() {
    setMenuOpen(false)
  }

  function handleDelete() {
    editor.chain().focus().deleteSelection().run()
    closeMenu()
  }

  function handleDuplicate() {
    duplicateSelectedNode(editor)
    closeMenu()
  }

  const { selection } = editor.state
  const isRange = isNodeRangeSelection(selection)
  const isSingle = selection instanceof NodeSelection

  return (
    <DragHandle editor={editor} onNodeChange={handleNodeChange} nested={false}>
      <button
        ref={gripRef}
        type="button"
        className="block-handle-grip"
        aria-label="Block actions"
        onClick={openMenu}
      >
        <GripVertical size={14} />
      </button>
      {menuOpen && (isSingle || isRange) && (
        <BlockHandleMenu
          anchor={gripRef.current}
          showDuplicate={isSingle}
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onClose={closeMenu}
        />
      )}
    </DragHandle>
  )
}

interface BlockHandleMenuProps {
  anchor: HTMLElement | null
  showDuplicate: boolean
  onDelete: () => void
  onDuplicate: () => void
  onClose: () => void
}

function BlockHandleMenu({ anchor, showDuplicate, onDelete, onDuplicate, onClose }: BlockHandleMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (menuRef.current?.contains(target) || anchor?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [anchor, onClose])

  const rect = anchor?.getBoundingClientRect()

  return createPortal(
    <div
      ref={menuRef}
      className="block-handle-menu"
      style={{ position: 'fixed', top: (rect?.bottom ?? 0) + 6, left: rect?.left ?? 0 }}
    >
      {showDuplicate && (
        <button type="button" className="block-handle-menu-item" onClick={onDuplicate}>
          <Copy size={13} /> Duplicate
        </button>
      )}
      <button type="button" className="block-handle-menu-item danger" onClick={onDelete}>
        <Trash2 size={13} /> Delete
      </button>
    </div>,
    document.body,
  )
}
```

This mirrors `SlashCommands.tsx`'s own `createPortal` + fixed-position menu pattern (`SlashCommands.tsx:221-243`).

- [ ] **Step 2: Add the CSS**

Append to `src/index.css`, after the `.block-handle-grip` rules added in Task B3:

```css

.block-handle-menu {
  position: fixed;
  z-index: 50;
  min-width: 140px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--bg-raised);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  padding: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

.block-handle-menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  padding: 6px var(--space-sm);
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  text-align: left;
  border-radius: 4px;
  cursor: pointer;
}

.block-handle-menu-item:hover { background: var(--bg-hover); }
.block-handle-menu-item.danger { color: var(--danger); }
```

- [ ] **Step 3: Run `npm run typecheck`**

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/editor/extensions/BlockHandle.tsx src/index.css
git commit -m "$(cat <<'EOF'
feat(editor): add Delete/Duplicate menu to the block handle

Clicking the grip selects the block and opens a menu, styled to
match the slash-command menu. A NodeRangeSelection (multiple blocks)
shows Delete only; a single NodeSelection shows both.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task B5: Mount `BlockHandle`, style selected blocks, restyle the drop cursor

**Files:**
- Modify: `src/editor/NoteEditor.tsx`
- Modify: `src/editor/extensions/index.ts` (StarterKit `dropcursor` config)
- Modify: `src/index.css` (append)

**Interfaces:**
- Consumes: `BlockHandle` from `./extensions/BlockHandle` (Task B4).

- [ ] **Step 1: Mount `BlockHandle` in `NoteEditor.tsx`**

In `src/editor/NoteEditor.tsx`, add the import near the other extension-adjacent imports:

```tsx
import { BlockHandle } from './extensions/BlockHandle'
```

Then, in the returned JSX, add it as a sibling of `<EditorContent>`, matching the existing `{editor && <EditorStatusBar editor={editor} />}` conditional-render pattern at the bottom of the component:

```tsx
      <EditorContent
        editor={editor}
        role="textbox"
        aria-multiline="true"
        className="note-editor"
      />
      {editor && <BlockHandle editor={editor} />}
      {editor && <EditorStatusBar editor={editor} />}
```

- [ ] **Step 2: Color the drop cursor to match the app's accent**

In `src/editor/extensions/index.ts`, find the `StarterKit.configure({...})` call:

```ts
  StarterKit.configure({ code: false, codeBlock: false, link: false, underline: false, horizontalRule: false }),
```

Replace it with:

```ts
  StarterKit.configure({
    code: false,
    codeBlock: false,
    link: false,
    underline: false,
    horizontalRule: false,
    dropcursor: { color: 'var(--accent)', width: 2 },
  }),
```

(`Dropcursor` is bundled into `StarterKit` by default and already active; this only recolors it. Confirmed by reading `@tiptap/starter-kit`'s and `@tiptap/extensions`' shipped type definitions — `dropcursor: Partial<DropcursorOptions> | false` accepts `{ color, width, class }`.)

- [ ] **Step 3: Style selected blocks and ranges**

Append to `src/index.css`:

```css

.note-editor .ProseMirror-selectednode,
.note-editor .ProseMirror-selectednoderange {
  background: var(--accent-bg);
  border-radius: 4px;
  outline: none;
}
```

(`ProseMirror-selectednode` is applied automatically by ProseMirror's core view to any selected node's DOM element; `ProseMirror-selectednoderange` is applied by `@tiptap/extension-node-range` per-node in a range. Neither requires wiring in `BlockHandle.tsx` — confirmed by reading both packages' compiled output.)

- [ ] **Step 4: Run `npm run typecheck` and the full test suite**

Run: `npm run typecheck`
Run: `npm test`
Expected: both pass.

- [ ] **Step 5: Manual QA in `npm run tauri dev`**

Work through the full checklist from `docs/specs/block-handle-system-design.md`'s Testing section:

- Hover over a paragraph, heading, divider, callout, code block, table, mermaid diagram, ink block, PDF page block, and block-math node — confirm the grip appears for each without shifting content (per the spec's Error Handling note that these get no special-casing).
- Click the grip on a `Divider` — confirm it selects (accent-colored highlight) and the menu offers Delete/Duplicate; confirm Delete removes it cleanly.
- Drag a block up/down among top-level siblings — confirm reorder and a single undo step (`Mod-Z` once); confirm dragging toward a callout's interior does not drop inside it (since `nested={false}`).
- Shift-click across three adjacent blocks — confirm all three highlight (accent wash) and Delete removes all three in one undo step.
- Insert a Block Math node via `/block math` — confirm it opens directly into edit mode (no native prompt), `Mod-Enter` commits, `Escape` on a fresh empty node deletes it, and clicking a previously-committed equation reopens it for editing.
- Drag a shift-click range of blocks — confirm all selected blocks move together (per the source-verified `nodeRangeDrop.ts` integration between the two packages).
- Open a block-math node into edit mode (click it), then use the handle's grip to select and Delete it while the textarea is still open — confirm it's removed cleanly with no stuck editor state (per the spec's Error Handling note on this exact case).
- Delete every block in a note down to the last one — confirm the editor still has a placeable cursor afterward (a trailing empty paragraph), reachable the same way Backspace-to-empty already guarantees today.

If any item fails, use `superpowers:systematic-debugging` to isolate whether the issue is in `BlockHandle.tsx`'s wiring or an assumption about the underlying TipTap packages' behavior before making changes.

- [ ] **Step 6: Commit**

```bash
git add src/editor/NoteEditor.tsx src/editor/extensions/index.ts src/index.css
git commit -m "$(cat <<'EOF'
feat(editor): mount the block handle system

Wires BlockHandle into NoteEditor, recolors the drop cursor to the
app's accent, and styles ProseMirror's own selected-node/range
classes. Completes the block handle system: hover grip,
click-to-select, delete/duplicate menu, drag-to-reorder, and
shift-click range select across all top-level blocks.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Post-Plan Note

This plan's investigation (reading the compiled source of `@tiptap/extension-drag-handle` and `@tiptap/extension-node-range` directly) confirmed something the design spec had hedged as an unverified stretch goal: dragging a multi-block `NodeRangeSelection` **does** compose for free with `@tiptap/extension-drag-handle` (see `nodeRangeDrop.ts`, which directly imports and handles `NodeRangeSelection`). No extra glue code was needed for Task B5's last manual-QA bullet — worth updating `docs/specs/block-handle-system-design.md`'s hedge language to reflect this once the plan ships, so the spec doesn't undersell a capability that's actually solid.
