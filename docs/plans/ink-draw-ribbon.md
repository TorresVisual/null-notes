# Ink Draw Ribbon Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Replace the dense `InkToolGroup` row in the full-screen ink editor with a OneNote-style Draw ribbon: a pen gallery with thickness/colour flyouts, plus eraser / lasso / text / ruler / shapes / zoom controls.

**Architecture:** A new `DrawRibbon` reads and writes the existing `useInkStore` (no store changes) and replaces `InkToolGroup` inside `InkEditorOverlay` only. Flyouts are shadcn `Popover`s behind one small `ToolFlyout` wrapper that implements the "first click activates, second click opens" rule once. Letter shortcuts are a pure function the overlay's existing `onKeyDown` calls.

**Tech Stack:** React 19 + TypeScript (strict), Zustand (`useInkStore`), `radix-ui` Popover (already a dependency), Vitest + Testing Library, WebdriverIO (e2e).

**Spec:** `docs/specs/ink-draw-ribbon-design.md`

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [x] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [x] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- No changes to `src/store/ink.ts`, `src/ink/pens.ts`, the SVG format, or `src/editor/toolbar/InkToolGroup.tsx` (it still serves PDF-page ink and inline canvas notes).
- No add/delete/reorder-pen UI. Opacity is not editable (it is part of a preset's identity).
- No fit-width zoom — `CanvasHandle` has no such operation.
- No separate mobile layout; narrow screens scroll the ribbon horizontally with undo/redo/zoom/Done pinned right.
- Shortcuts: `P` pen, `E` eraser, `L` lasso, `T` text, `Ctrl+Z` / `Ctrl+Y`, `Esc` closes an open flyout first, then the overlay. Letter shortcuts ignore events from `input` / `textarea` / `contenteditable`, events already `defaultPrevented`, and events with Ctrl, Meta or Alt held.
- Ribbon chrome is plain CSS in `src/index.css`, not Tailwind utilities (project rule for app-shell dialogs; the unlayered `* { padding: 0 }` reset beats Tailwind padding). Every new className must have a matching rule — grep `index.css` before calling a task done.
- Label strings use American spelling ("color") to match existing `aria-label`s.
- `npm run lint` does not exist — verify with `npm run typecheck` and `npm test`.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Do not push.

## Review Focus

Failure modes the spec implies but its Testing section does not list; each has a test in the named task.

1. **Esc with a flyout open must close only the flyout**, not the whole overlay (and so not discard the page). Radix's escape handler `preventDefault`s, which the overlay's existing `!e.defaultPrevented` check relies on — Task 4.
2. **Typing in a flyout slider or the canvas text label must not switch tools** (`t` in "start", `e` in "text") — Tasks 2 and 4.
3. **Ribbon with no registered canvas** (before the canvas effect runs, or after another canvas steals the slot) must still render; undo/redo disabled, no crash — Task 3.
4. **Shape tool set from outside the ribbon** (store `tool: 'arrow'` while the ribbon's remembered choice is `line`): the Shapes button must read active and show the arrow, not the stale choice — Task 3.
5. **A pen whose stored colour is not `#rrggbb`** (hand-edited localStorage, e.g. `tomato`): the flyout must render without throwing and mark no swatch as selected — Task 1.

---

## File Structure

The spec lists five files; this plan adds four small ones so each file holds one component or one pure function (CLAUDE.md: one component per file, ~150-line cap).

| File | Change |
|---|---|
| `src/components/ui/popover.tsx` | Create — shadcn Popover wrapper |
| `src/ink/ToolFlyout.tsx` | Create — button + popover; first click activates, second opens |
| `src/ink/PenSample.tsx` | Create — SVG stroke sample in a pen's colour/width/opacity |
| `src/ink/PenFlyout.tsx` | Create — thickness slider + colour grid for the active pen |
| `src/ink/PenGallery.tsx` | Create — the pen presets as swatch cards |
| `src/ink/ribbonShortcuts.ts` | Create — pure `toolForShortcut` |
| `src/ink/DrawRibbon.tsx` | Create — the single top bar |
| `src/ink/InkEditorOverlay.tsx` | Modify — render `DrawRibbon`; call `toolForShortcut` |
| `src/index.css` | Modify — ribbon, card, swatch, flyout rules |
| `e2e/specs/ink-fullscreen-editor.e2e.ts` | Modify — new selector, flyout screenshot |
| Tests: `PenGallery.test.tsx`, `ribbonShortcuts.test.ts`, `DrawRibbon.test.tsx` (new), `inkEditorOverlay.test.tsx` (modify) | |

---

### Task 1: Pen gallery with thickness/colour flyout

**Files:**
- Create: `src/components/ui/popover.tsx`, `src/ink/ToolFlyout.tsx`, `src/ink/PenSample.tsx`, `src/ink/PenFlyout.tsx`, `src/ink/PenGallery.tsx`
- Modify: `src/index.css` (insert after the `.toolbar-ink button:disabled` rule, currently line 3163)
- Test: `src/ink/PenGallery.test.tsx`

**Interfaces:**
- Consumes: `useInkStore` / `activePenOf` from `src/store/ink.ts` (`pens`, `activePenId`, `tool`, `selectPen(id)`, `updateActivePen(changes)`); `Pen` from `src/ink/types.ts`.
- Produces:
  - `Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverClose` from `@/components/ui/popover`.
  - `ToolFlyout({ active, onActivate, label, title?, className, icon, children })` — Task 3 uses it for eraser, text and shapes.
  - `PenGallery()` — no props; Task 3 renders it.

- [ ] **Step 1: Write the failing test**

Create `src/ink/PenGallery.test.tsx`:

```tsx
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { PenGallery } from './PenGallery'
import { useInkStore, activePenOf } from '../store/ink'
import { DEFAULT_PENS } from './pens'
import type { Pen } from './types'

function reset(pens: Pen[] = DEFAULT_PENS, tool: 'pen' | 'eraser' = 'pen') {
  useInkStore.setState({ tool, pens, activePenId: pens[0]?.id ?? '' })
}

beforeEach(() => reset())
afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('PenGallery', () => {
  it('shows one card per preset', () => {
    render(<PenGallery />)

    for (const pen of DEFAULT_PENS) expect(screen.getByRole('button', { name: pen.label })).toBeInTheDocument()
  })

  it('draws each sample in its own colour and opacity', () => {
    render(<PenGallery />)

    const path = screen.getByRole('button', { name: 'Yellow highlighter' }).querySelector('path')
    expect(path?.getAttribute('stroke')).toBe('#e3b341')
    expect(path?.getAttribute('stroke-opacity')).toBe('0.3')
  })

  it('selects a pen on the first click without opening a flyout', () => {
    render(<PenGallery />)

    fireEvent.click(screen.getByRole('button', { name: 'Red' }))

    expect(useInkStore.getState().activePenId).toBe('red')
    expect(screen.queryByLabelText('Pen thickness')).toBeNull()
  })

  it('only switches back to the pen when another tool is active', () => {
    reset(DEFAULT_PENS, 'eraser')
    render(<PenGallery />)

    fireEvent.click(screen.getByRole('button', { name: 'Fine' }))

    expect(useInkStore.getState().tool).toBe('pen')
    expect(screen.queryByLabelText('Pen thickness')).toBeNull()
  })

  it('opens the flyout when the active pen is clicked again', () => {
    render(<PenGallery />)

    fireEvent.click(screen.getByRole('button', { name: 'Fine' }))

    expect(screen.getByLabelText('Pen thickness')).toBeInTheDocument()
  })

  it('edits the active pen from the flyout', () => {
    render(<PenGallery />)
    fireEvent.click(screen.getByRole('button', { name: 'Fine' }))

    fireEvent.change(screen.getByLabelText('Pen thickness'), { target: { value: '8' } })
    expect(activePenOf(useInkStore.getState()).size).toBe(8)

    fireEvent.click(screen.getByRole('button', { name: '#ff7b72' }))
    expect(activePenOf(useInkStore.getState()).color).toBe('#ff7b72')

    fireEvent.change(screen.getByLabelText('Custom color'), { target: { value: '#123456' } })
    expect(activePenOf(useInkStore.getState()).color).toBe('#123456')
  })

  it('leaves opacity alone when editing', () => {
    reset([{ id: 'hl', label: 'Highlighter', color: '#e3b341', size: 20, opacity: 0.3 }])
    render(<PenGallery />)
    fireEvent.click(screen.getByRole('button', { name: 'Highlighter' }))

    fireEvent.click(screen.getByRole('button', { name: '#ff7b72' }))

    expect(activePenOf(useInkStore.getState()).opacity).toBe(0.3)
  })

  // Hand-edited storage can hold any string; the colour input would otherwise
  // be the only thing standing between that and a crash.
  it('renders a pen whose colour is not #rrggbb and marks no swatch selected', () => {
    reset([{ id: 'odd', label: 'Odd', color: 'tomato', size: 2, opacity: 1 }])
    render(<PenGallery />)

    fireEvent.click(screen.getByRole('button', { name: 'Odd' }))

    expect(screen.getByLabelText('Pen thickness')).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { pressed: true, name: /^#/ })).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ink/PenGallery.test.tsx`
Expected: FAIL — cannot resolve `./PenGallery`.

- [ ] **Step 3: Write the implementation**

`src/components/ui/popover.tsx`:

```tsx
import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverClose({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Close>) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn("outline-none", className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverTrigger, PopoverClose, PopoverContent }
```

`src/ink/ToolFlyout.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface ToolFlyoutProps {
  active: boolean
  onActivate: () => void
  label: string
  title?: string
  className: string
  icon: ReactNode
  children: ReactNode
}

// The first click on an idle tool only selects it; the flyout is for a tool
// already in hand. preventDefault stops Radix's own toggle from also firing.
export function ToolFlyout({ active, onActivate, label, title, className, icon, children }: ToolFlyoutProps) {
  return (
    <Popover>
      <PopoverTrigger
        asChild
        onClick={(e) => {
          if (active) return
          e.preventDefault()
          onActivate()
        }}
      >
        <button
          type="button"
          className={`${className}${active ? ' active' : ''}`}
          aria-pressed={active}
          aria-label={label}
          title={title ?? label}
        >
          {icon}
        </button>
      </PopoverTrigger>
      <PopoverContent className="ink-flyout" align="start" sideOffset={6}>
        {children}
      </PopoverContent>
    </Popover>
  )
}
```

`src/ink/PenSample.tsx`:

```tsx
interface PenSampleProps {
  color: string
  size: number
  opacity: number
  large?: boolean
}

// Width is compressed, not mapped 1:1: a 20px highlighter would swallow its
// card and a 1.5px pencil would vanish. non-scaling-stroke keeps the px width
// the same whether the sample is card-sized or flyout-sized.
export function PenSample({ color, size, opacity, large = false }: PenSampleProps) {
  return (
    <svg className={`ink-pen-sample${large ? ' large' : ''}`} viewBox="0 0 48 20" aria-hidden>
      <path
        d="M4 14C14 0 22 20 32 8S42 6 44 6"
        fill="none"
        stroke={color}
        strokeOpacity={opacity}
        strokeWidth={Math.min(12, 1.5 + size * 0.5)}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
```

`src/ink/PenFlyout.tsx`:

```tsx
import { useInkStore, activePenOf } from '../store/ink'
import { PenSample } from './PenSample'

const PEN_COLORS = [
  '#e6edf3', '#9da7b3', '#ff7b72', '#ffa657', '#e3b341', '#7ee787',
  '#56d4dd', '#79c0ff', '#a5a5ff', '#d2a8ff', '#ff9bce', '#c9a27e',
]

export function PenFlyout() {
  const pens = useInkStore((s) => s.pens)
  const activePenId = useInkStore((s) => s.activePenId)
  const updateActivePen = useInkStore((s) => s.updateActivePen)
  const pen = activePenOf({ pens, activePenId })

  return (
    <div className="ink-flyout-body">
      <PenSample color={pen.color} size={pen.size} opacity={pen.opacity} large />
      <label className="ink-flyout-row">
        <span>Thickness</span>
        <input
          type="range"
          min={1}
          max={24}
          step={0.5}
          value={pen.size}
          onChange={(e) => updateActivePen({ size: Number(e.target.value) })}
          aria-label="Pen thickness"
        />
      </label>
      <div className="ink-color-grid" role="group" aria-label="Pen color">
        {PEN_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={`ink-color-swatch${color === pen.color ? ' active' : ''}`}
            style={{ background: color }}
            onClick={() => updateActivePen({ color })}
            aria-pressed={color === pen.color}
            aria-label={color}
          />
        ))}
        <input
          type="color"
          value={pen.color}
          onChange={(e) => updateActivePen({ color: e.target.value })}
          aria-label="Custom color"
        />
      </div>
    </div>
  )
}
```

`src/ink/PenGallery.tsx`:

```tsx
import { useInkStore } from '../store/ink'
import { PenFlyout } from './PenFlyout'
import { PenSample } from './PenSample'
import { ToolFlyout } from './ToolFlyout'

export function PenGallery() {
  const pens = useInkStore((s) => s.pens)
  const activePenId = useInkStore((s) => s.activePenId)
  const tool = useInkStore((s) => s.tool)
  const selectPen = useInkStore((s) => s.selectPen)

  return (
    <div className="ink-pen-gallery" role="group" aria-label="Pens">
      {pens.map((pen) => (
        <ToolFlyout
          key={pen.id}
          className="ink-pen-card"
          active={tool === 'pen' && pen.id === activePenId}
          onActivate={() => selectPen(pen.id)}
          label={pen.label}
          icon={<PenSample color={pen.color} size={pen.size} opacity={pen.opacity} />}
        >
          <PenFlyout />
        </ToolFlyout>
      ))}
    </div>
  )
}
```

Append to `src/index.css` after the `.toolbar-ink button:disabled` rule:

```css
/* OneNote-style Draw ribbon. Rules for the bar itself live with the overlay
   header further down; these are the pieces it is built from. */
.ink-pen-gallery { display: flex; gap: 4px; }

.ink-pen-card {
  width: 56px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-hover);
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
}
.ink-pen-card:hover { background: var(--border-strong); }
.ink-pen-card.active { border-color: var(--accent); background: var(--bg-base); }

.ink-pen-sample { width: 40px; height: 18px; overflow: visible; }
.ink-pen-sample.large { width: 160px; height: 48px; }

.ink-flyout {
  z-index: 110;
  min-width: 200px;
  padding: var(--space-md);
  background: var(--bg-raised);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  color: var(--text-primary);
}
.ink-flyout-body { display: flex; flex-direction: column; gap: var(--space-sm); align-items: stretch; }
.ink-flyout-row { display: flex; align-items: center; gap: var(--space-sm); font-size: 12px; color: var(--text-secondary); }
.ink-flyout input[type="range"] { flex: 1; min-width: 120px; accent-color: var(--accent); }
.ink-flyout .ink-pen-sample.large { align-self: center; }

.ink-color-grid { display: grid; grid-template-columns: repeat(6, 24px); gap: 6px; }
.ink-color-swatch {
  width: 24px;
  height: 24px;
  border: 2px solid transparent;
  border-radius: 50%;
  cursor: pointer;
}
.ink-color-swatch.active { border-color: var(--accent); }
.ink-flyout input[type="color"] {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  background: var(--bg-hover);
  cursor: pointer;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ink/PenGallery.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 5: Typecheck and grep for unstyled classNames**

Run: `npm run typecheck`
Expected: no errors.
Then grep `src/index.css` for each new className: `ink-pen-gallery`, `ink-pen-card`, `ink-pen-sample`, `ink-flyout`, `ink-flyout-body`, `ink-flyout-row`, `ink-color-grid`, `ink-color-swatch`. Each must match a rule.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/popover.tsx src/ink/ToolFlyout.tsx src/ink/PenSample.tsx src/ink/PenFlyout.tsx src/ink/PenGallery.tsx src/ink/PenGallery.test.tsx src/index.css
git commit -m "feat(ink): pen gallery with thickness and colour flyout" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Letter-shortcut resolver

**Files:**
- Create: `src/ink/ribbonShortcuts.ts`
- Test: `src/ink/ribbonShortcuts.test.ts`

**Interfaces:**
- Consumes: `Tool` from `src/ink/types.ts`.
- Produces: `toolForShortcut(e: ShortcutEvent): Tool | null`, where `ShortcutEvent` is `{ key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; defaultPrevented: boolean; target: EventTarget | null }` (a React `KeyboardEvent` satisfies it). Task 4 calls it from the overlay.

- [ ] **Step 1: Write the failing test**

Create `src/ink/ribbonShortcuts.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { toolForShortcut } from './ribbonShortcuts'

function press(key: string, extra: Partial<Parameters<typeof toolForShortcut>[0]> = {}) {
  return toolForShortcut({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    defaultPrevented: false,
    target: document.body,
    ...extra,
  })
}

describe('toolForShortcut', () => {
  it('maps P, E, L and T, either case', () => {
    expect(press('p')).toBe('pen')
    expect(press('E')).toBe('eraser')
    expect(press('l')).toBe('lasso')
    expect(press('T')).toBe('text')
  })

  it('ignores other keys', () => {
    expect(press('x')).toBeNull()
    expect(press('Escape')).toBeNull()
  })

  it('ignores chords with Ctrl, Meta or Alt', () => {
    expect(press('e', { ctrlKey: true })).toBeNull()
    expect(press('e', { metaKey: true })).toBeNull()
    expect(press('e', { altKey: true })).toBeNull()
  })

  it('ignores events already handled', () => {
    expect(press('e', { defaultPrevented: true })).toBeNull()
  })

  it('ignores typing into inputs, textareas and contenteditable', () => {
    const input = document.createElement('input')
    const area = document.createElement('textarea')
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    const inner = document.createElement('span')
    editable.append(inner)

    expect(press('e', { target: input })).toBeNull()
    expect(press('e', { target: area })).toBeNull()
    expect(press('e', { target: inner })).toBeNull()
  })

  it('still fires from a focused button', () => {
    expect(press('e', { target: document.createElement('button') })).toBe('eraser')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ink/ribbonShortcuts.test.ts`
Expected: FAIL — cannot resolve `./ribbonShortcuts`.

- [ ] **Step 3: Write the implementation**

`src/ink/ribbonShortcuts.ts`:

```ts
import type { Tool } from './types'

const TOOL_KEYS: Record<string, Tool> = { p: 'pen', e: 'eraser', l: 'lasso', t: 'text' }

const TEXT_ENTRY = 'input, textarea, [contenteditable]:not([contenteditable="false"])'

interface ShortcutEvent {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  defaultPrevented: boolean
  target: EventTarget | null
}

// Plain letters must never win over text entry: the canvas text tool, a flyout
// slider and the note behind all take letters as input.
export function toolForShortcut(e: ShortcutEvent): Tool | null {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return null
  if (e.target instanceof Element && e.target.closest(TEXT_ENTRY)) return null
  return TOOL_KEYS[e.key.toLowerCase()] ?? null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ink/ribbonShortcuts.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ink/ribbonShortcuts.ts src/ink/ribbonShortcuts.test.ts
git commit -m "feat(ink): letter-shortcut resolver for the draw ribbon" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `DrawRibbon`

**Files:**
- Create: `src/ink/DrawRibbon.tsx`
- Modify: `src/index.css` (add ribbon-row rules directly after the Task 1 block)
- Test: `src/ink/DrawRibbon.test.tsx`

**Interfaces:**
- Consumes: `PenGallery`, `ToolFlyout`, `Popover*` (Task 1); `useInkStore` and `CanvasHandle` from `src/store/ink.ts`; `Tool`, `EraserMode` from `src/ink/types.ts`.
- Produces: `DrawRibbon({ onDone }: { onDone: () => void })`. Renders `.draw-ribbon` containing a scrolling `role="toolbar"` tools region and a pinned undo / redo / zoom / Done region. The Done button keeps the classes `dialog-action-primary ink-editor-done`.

- [ ] **Step 1: Write the failing test**

Create `src/ink/DrawRibbon.test.tsx`:

```tsx
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { DrawRibbon } from './DrawRibbon'
import { useInkStore } from '../store/ink'
import type { CanvasHandle } from '../store/ink'
import { DEFAULT_PENS } from './pens'
import type { Tool } from './types'

function handle(overrides: Partial<CanvasHandle> = {}): CanvasHandle {
  return {
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: true,
    canRedo: true,
    deleteSelected: vi.fn(),
    hasSelection: false,
    toggleRuler: vi.fn(),
    rulerOn: false,
    zoom: 1,
    setZoom: vi.fn(),
    ...overrides,
  }
}

function setup(tool: Tool = 'pen', canvas: CanvasHandle | null = handle()) {
  useInkStore.setState({
    tool,
    pens: DEFAULT_PENS,
    activePenId: DEFAULT_PENS[0].id,
    eraserMode: 'point',
    eraserSize: 12,
    textSize: 18,
    activeCanvas: canvas,
    activeCanvasId: canvas ? 'c' : null,
  })
  const onDone = vi.fn()
  render(<DrawRibbon onDone={onDone} />)
  return { onDone, canvas }
}

const tool = () => useInkStore.getState().tool

afterEach(() => {
  cleanup()
  localStorage.clear()
})
beforeEach(() => localStorage.clear())

describe('DrawRibbon tools', () => {
  it('selects lasso on click', () => {
    setup()

    fireEvent.click(screen.getByRole('button', { name: 'Lasso select' }))

    expect(tool()).toBe('lasso')
  })

  it('activates the eraser first, then opens its flyout on the second click', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Eraser' }))
    expect(tool()).toBe('eraser')
    expect(screen.queryByLabelText('Eraser size')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Eraser' }))

    expect(screen.getByLabelText('Eraser size')).toBeInTheDocument()
  })

  it('changes eraser mode and size from the flyout', () => {
    setup('eraser')
    fireEvent.click(screen.getByRole('button', { name: 'Eraser' }))

    fireEvent.click(screen.getByRole('button', { name: /Stroke eraser/ }))
    fireEvent.change(screen.getByLabelText('Eraser size'), { target: { value: '40' } })

    expect(useInkStore.getState().eraserMode).toBe('stroke')
    expect(useInkStore.getState().eraserSize).toBe(40)
  })

  it('sets text size from the text flyout', () => {
    setup('text')
    fireEvent.click(screen.getByRole('button', { name: 'Text' }))

    fireEvent.change(screen.getByLabelText('Text size'), { target: { value: '30' } })

    expect(useInkStore.getState().textSize).toBe(30)
  })

  it('toggles the ruler', () => {
    const { canvas } = setup()

    fireEvent.click(screen.getByRole('button', { name: 'Ruler' }))

    expect(canvas?.toggleRuler).toHaveBeenCalledTimes(1)
  })

  it('shows Delete only while something is selected', () => {
    cleanup()
    setup('lasso', handle({ hasSelection: false }))
    expect(screen.queryByRole('button', { name: 'Delete selection' })).toBeNull()
    cleanup()

    const { canvas } = setup('lasso', handle({ hasSelection: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete selection' }))

    expect(canvas?.deleteSelected).toHaveBeenCalledTimes(1)
  })
})

describe('DrawRibbon shapes', () => {
  it('starts on line, then remembers the last choice', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Shapes' }))
    expect(tool()).toBe('line')

    fireEvent.click(screen.getByRole('button', { name: 'Shapes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Circle' }))
    expect(tool()).toBe('circle')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Circle' })).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Lasso select' }))
    fireEvent.click(screen.getByRole('button', { name: 'Shapes' }))

    expect(tool()).toBe('circle')
  })

  it('reads as active for any shape tool, including one set from outside the ribbon', () => {
    setup('arrow')

    const button = screen.getByRole('button', { name: 'Shapes' })

    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toHaveAttribute('title', expect.stringContaining('Arrow'))
  })

  it('is not active for a non-shape tool', () => {
    setup('pen')

    expect(screen.getByRole('button', { name: 'Shapes' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('DrawRibbon right side', () => {
  it('undoes, redoes and finishes', () => {
    const { canvas, onDone } = setup()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(canvas?.undo).toHaveBeenCalledTimes(1)
    expect(canvas?.redo).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('shows the current zoom and sets a new one from the flyout', () => {
    const { canvas } = setup('pen', handle({ zoom: 1 }))
    expect(screen.getByRole('button', { name: 'Zoom' })).toHaveTextContent('100%')

    fireEvent.click(screen.getByRole('button', { name: 'Zoom' }))
    fireEvent.click(screen.getByRole('button', { name: '150%' }))

    expect(canvas?.setZoom).toHaveBeenCalledWith(1.5)
  })

  it('has no fit-width control', () => {
    setup()

    expect(screen.queryByRole('button', { name: /fit/i })).toBeNull()
  })

  // The overlay registers its canvas on mount, but the ribbon renders first,
  // and another canvas can take the slot.
  it('renders with no registered canvas, with undo and redo disabled', () => {
    const { onDone } = setup('pen', null)

    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Zoom' })).toHaveTextContent('100%')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ink/DrawRibbon.test.tsx`
Expected: FAIL — cannot resolve `./DrawRibbon`.

- [ ] **Step 3: Write the implementation**

`src/ink/DrawRibbon.tsx`:

```tsx
import { useState } from 'react'
import {
  Eraser,
  Lasso,
  Type,
  Ruler as RulerIcon,
  Trash2,
  Undo2,
  Redo2,
  Minus,
  Circle,
  Square,
  MoveUpRight,
} from 'lucide-react'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useInkStore } from '../store/ink'
import type { EraserMode, Tool } from './types'
import { PenGallery } from './PenGallery'
import { ToolFlyout } from './ToolFlyout'

type ShapeTool = Extract<Tool, 'line' | 'circle' | 'rect' | 'arrow'>

const SHAPES: Record<ShapeTool, { label: string; Icon: typeof Minus }> = {
  line: { label: 'Line', Icon: Minus },
  circle: { label: 'Circle', Icon: Circle },
  rect: { label: 'Rectangle', Icon: Square },
  arrow: { label: 'Arrow', Icon: MoveUpRight },
}
const SHAPE_IDS: ShapeTool[] = ['line', 'circle', 'rect', 'arrow']

function isShapeTool(tool: Tool): tool is ShapeTool {
  return tool in SHAPES
}

const ERASER_MODES: { id: EraserMode; label: string; hint: string }[] = [
  { id: 'point', label: 'Point', hint: 'Point eraser — rubs out only what it passes over' },
  { id: 'stroke', label: 'Stroke', hint: 'Stroke eraser — removes a whole stroke on contact' },
]

const ZOOM_LEVELS = [0.75, 1, 1.5, 2]
const ICON_SIZE = 16

interface DrawRibbonProps {
  onDone: () => void
}

export function DrawRibbon({ onDone }: DrawRibbonProps) {
  const active = useInkStore((s) => s.activeCanvas)
  const tool = useInkStore((s) => s.tool)
  const eraserMode = useInkStore((s) => s.eraserMode)
  const eraserSize = useInkStore((s) => s.eraserSize)
  const textSize = useInkStore((s) => s.textSize)
  const setTool = useInkStore((s) => s.setTool)
  const setEraserMode = useInkStore((s) => s.setEraserMode)
  const setEraserSize = useInkStore((s) => s.setEraserSize)
  const setTextSize = useInkStore((s) => s.setTextSize)
  const [lastShape, setLastShape] = useState<ShapeTool>('line')

  const shownShape = isShapeTool(tool) ? tool : lastShape
  const { label: shapeLabel, Icon: ShapeIcon } = SHAPES[shownShape]
  const zoom = active?.zoom ?? 1

  return (
    <div className="draw-ribbon">
      <div className="draw-ribbon-tools" role="toolbar" aria-label="Drawing tools">
        <PenGallery />
        <span className="ink-sep" aria-hidden />
        <ToolFlyout
          className="ink-tool"
          active={tool === 'eraser'}
          onActivate={() => setTool('eraser')}
          label="Eraser"
          title="Eraser (E)"
          icon={<Eraser size={ICON_SIZE} />}
        >
          <div className="ink-flyout-body">
            <div className="ink-flyout-row" role="group" aria-label="Eraser mode">
              {ERASER_MODES.map(({ id, label, hint }) => (
                <button
                  key={id}
                  type="button"
                  className={`ink-tool ink-mode${eraserMode === id ? ' active' : ''}`}
                  onClick={() => setEraserMode(id)}
                  aria-pressed={eraserMode === id}
                  aria-label={hint}
                  title={hint}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="ink-flyout-row">
              <span>Size</span>
              <input
                type="range"
                min={4}
                max={80}
                value={eraserSize}
                onChange={(e) => setEraserSize(Number(e.target.value))}
                aria-label="Eraser size"
              />
            </label>
          </div>
        </ToolFlyout>
        <button
          type="button"
          className={`ink-tool${tool === 'lasso' ? ' active' : ''}`}
          onClick={() => setTool('lasso')}
          aria-pressed={tool === 'lasso'}
          aria-label="Lasso select"
          title="Lasso select (L)"
        >
          <Lasso size={ICON_SIZE} />
        </button>
        {active?.hasSelection && (
          <button
            type="button"
            className="ink-tool ink-delete"
            onClick={active.deleteSelected}
            aria-label="Delete selection"
            title="Delete selection (Del)"
          >
            <Trash2 size={ICON_SIZE} />
          </button>
        )}
        <ToolFlyout
          className="ink-tool"
          active={tool === 'text'}
          onActivate={() => setTool('text')}
          label="Text"
          title="Text (T)"
          icon={<Type size={ICON_SIZE} />}
        >
          {/* Independent of pen size: a comfortable stroke width and a legible
              font size are different scales. */}
          <label className="ink-flyout-row">
            <span>Size</span>
            <input
              type="range"
              min={8}
              max={72}
              value={textSize}
              onChange={(e) => setTextSize(Number(e.target.value))}
              aria-label="Text size"
            />
          </label>
        </ToolFlyout>
        <button
          type="button"
          className={`ink-tool${active?.rulerOn ? ' active' : ''}`}
          onClick={active?.toggleRuler}
          aria-pressed={active?.rulerOn ?? false}
          aria-label="Ruler"
          title="Ruler — draw along its edge; drag the middle to slide it, an end to swing it"
        >
          <RulerIcon size={ICON_SIZE} />
        </button>
        <ToolFlyout
          className="ink-tool"
          active={isShapeTool(tool)}
          onActivate={() => setTool(lastShape)}
          label="Shapes"
          title={`Shapes — ${shapeLabel}`}
          icon={<ShapeIcon size={ICON_SIZE} />}
        >
          <div className="ink-flyout-row" role="group" aria-label="Shape">
            {SHAPE_IDS.map((id) => {
              const { label, Icon } = SHAPES[id]
              return (
                <PopoverClose key={id} asChild>
                  <button
                    type="button"
                    className={`ink-tool${tool === id ? ' active' : ''}`}
                    onClick={() => {
                      setLastShape(id)
                      setTool(id)
                    }}
                    aria-pressed={tool === id}
                    aria-label={label}
                    title={label}
                  >
                    <Icon size={ICON_SIZE} />
                  </button>
                </PopoverClose>
              )
            })}
          </div>
        </ToolFlyout>
      </div>
      <div className="draw-ribbon-pinned">
        <button type="button" className="ink-tool" onClick={active?.undo} disabled={!active?.canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
          <Undo2 size={ICON_SIZE} />
        </button>
        <button type="button" className="ink-tool" onClick={active?.redo} disabled={!active?.canRedo} aria-label="Redo" title="Redo (Ctrl+Y)">
          <Redo2 size={ICON_SIZE} />
        </button>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="ink-tool ink-zoom-btn" aria-label="Zoom" title="Zoom">
              {Math.round(zoom * 100)}%
            </button>
          </PopoverTrigger>
          <PopoverContent className="ink-flyout" align="end" sideOffset={6}>
            <div className="ink-flyout-body">
              {ZOOM_LEVELS.map((level) => (
                <PopoverClose key={level} asChild>
                  <button
                    type="button"
                    className={`ink-tool ink-mode${zoom === level ? ' active' : ''}`}
                    onClick={() => active?.setZoom(level)}
                    aria-pressed={zoom === level}
                  >
                    {Math.round(level * 100)}%
                  </button>
                </PopoverClose>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <button type="button" className="dialog-action-primary ink-editor-done" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  )
}
```

In `src/index.css`, replace the `.ink-editor-header .toolbar-ink { ... }` rule (currently ~line 5043) with:

```css
/* Tools scroll sideways on a narrow window; undo/redo/zoom/Done stay put. */
.draw-ribbon {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.draw-ribbon-tools {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
}
.draw-ribbon-tools > * { flex: none; }

.draw-ribbon-pinned {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
}

.draw-ribbon .ink-tool { width: 32px; height: 32px; }
.draw-ribbon .ink-tool.ink-mode,
.draw-ribbon .ink-tool.ink-zoom-btn { width: auto; padding: 0 10px; font-size: 12px; }
.draw-ribbon button:disabled { opacity: 0.35; cursor: not-allowed; }
.ink-flyout .ink-tool { width: 32px; height: 32px; }
.ink-flyout .ink-tool.ink-mode { width: auto; }
```

(`.ink-flyout .ink-tool` is needed because flyout content is portaled to `body`, outside `.draw-ribbon`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ink/DrawRibbon.test.tsx`
Expected: PASS (14 tests).

- [ ] **Step 5: Typecheck and grep for unstyled classNames**

Run: `npm run typecheck`
Expected: no errors.
Grep `src/index.css` for `draw-ribbon`, `draw-ribbon-tools`, `draw-ribbon-pinned`, `ink-zoom-btn`, `ink-mode`, `ink-delete`. Each must match a rule.

- [ ] **Step 6: Commit**

```bash
git add src/ink/DrawRibbon.tsx src/ink/DrawRibbon.test.tsx src/index.css
git commit -m "feat(ink): DrawRibbon with eraser, text, shapes and zoom flyouts" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Wire the ribbon into the overlay

**Files:**
- Modify: `src/ink/InkEditorOverlay.tsx`
- Modify: `src/ink/inkEditorOverlay.test.tsx`
- Modify: `e2e/specs/ink-fullscreen-editor.e2e.ts`

**Interfaces:**
- Consumes: `DrawRibbon` (Task 3), `toolForShortcut` (Task 2), `useInkStore().setTool`.
- Produces: nothing downstream.

- [ ] **Step 1: Update and extend the overlay tests**

In `src/ink/inkEditorOverlay.test.tsx`:

1. Replace the body of `'shows the drawing tools straight away'`:

```tsx
  it('shows the drawing tools straight away', async () => {
    mount()

    await screen.findByRole('button', { name: 'Fine' })
    expect(useInkStore.getState().activeCanvasId).toBe(SRC)
  })
```

2. Append this block at the end of the file:

```tsx
describe('draw ribbon in the overlay', () => {
  it('switches tools from the letter shortcuts', () => {
    const { overlay } = mount()

    fireEvent.keyDown(overlay, { key: 'e' })
    expect(useInkStore.getState().tool).toBe('eraser')
    fireEvent.keyDown(overlay, { key: 'L' })
    expect(useInkStore.getState().tool).toBe('lasso')
    fireEvent.keyDown(overlay, { key: 'p' })
    expect(useInkStore.getState().tool).toBe('pen')
    fireEvent.keyDown(overlay, { key: 't' })
    expect(useInkStore.getState().tool).toBe('text')
  })

  it('leaves the tool alone for chords', () => {
    const { overlay } = mount()

    fireEvent.keyDown(overlay, { key: 'e', ctrlKey: true })

    expect(useInkStore.getState().tool).toBe('text')
  })

  // `e` and `t` are in the word being typed.
  it('does not switch tools while a label is being typed', async () => {
    mount()
    const editor = await openLabel('start')

    fireEvent.keyDown(editor, { key: 'e' })

    expect(useInkStore.getState().tool).toBe('text')
  })

  it('does not switch tools while a flyout slider has focus', () => {
    useInkStore.setState({ tool: 'pen' })
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Fine' }))
    const slider = screen.getByLabelText('Pen thickness')

    fireEvent.keyDown(slider, { key: 'e' })

    expect(useInkStore.getState().tool).toBe('pen')
  })

  it('closes an open flyout on Escape without closing the overlay, then closes the overlay', () => {
    useInkStore.setState({ tool: 'pen' })
    const { overlay, onClose } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Fine' }))
    const slider = screen.getByLabelText('Pen thickness')

    fireEvent.keyDown(slider, { key: 'Escape' })

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Pen thickness')).toBeNull()

    fireEvent.keyDown(overlay, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ink/inkEditorOverlay.test.tsx`
Expected: FAIL — the overlay still renders `InkToolGroup` (no `Fine` button, shortcuts do nothing).

- [ ] **Step 3: Implement**

In `src/ink/InkEditorOverlay.tsx`:

Replace the `InkToolGroup` import with:

```tsx
import { DrawRibbon } from './DrawRibbon'
import { toolForShortcut } from './ribbonShortcuts'
```

In `handleKeyDown`, after the `if ((e.ctrlKey || e.metaKey) && ...) { ... }` block and before the Escape comment, insert:

```tsx
    const tool = toolForShortcut(e)
    if (tool) {
      e.preventDefault()
      e.stopPropagation()
      useInkStore.getState().setTool(tool)
      return
    }
```

Replace the header contents:

```tsx
      <div className="ink-editor-header">
        <DrawRibbon onDone={onClose} />
      </div>
```

Escape needs no new code: Radix's flyout handler calls `preventDefault()` before the event reaches this handler, and the existing `e.key === 'Escape' && !e.defaultPrevented` check already treats that as "handled". The Escape test above pins it. **If it fails** (flyout closed but `onClose` also called), Radix is not preventing default in this version: add `onKeyDown={(e) => { if (e.key === 'Escape') e.stopPropagation() }}` to the `PopoverPrimitive.Content` in `src/components/ui/popover.tsx`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/ink`
Expected: PASS, including the pre-existing overlay tests.

- [ ] **Step 5: Update the e2e spec**

In `e2e/specs/ink-fullscreen-editor.e2e.ts`, first test, replace the line

```ts
    await waitForSelector('.ink-editor-header .toolbar-ink', 'drawing tools missing in the overlay header')
    await screenshot('ink-fullscreen-open')
```

with

```ts
    await waitForSelector('.ink-editor-header .draw-ribbon', 'draw ribbon missing in the overlay header')
    await screenshot('ink-fullscreen-open')

    await clickInPage('.ink-pen-card.active')
    await waitForSelector('.ink-flyout', 'pen flyout never opened')
    await screenshot('ink-draw-ribbon-flyout')
    await browser.keys('Escape')
    await browser.waitUntil(
      async () => browser.execute(() => !document.querySelector('.ink-flyout')),
      { timeout: 5000, timeoutMsg: 'Escape did not close the flyout' },
    )
    expect(await browser.execute(() => !!document.querySelector('.ink-editor-overlay'))).toBe(true)
```

- [ ] **Step 6: Run the e2e and inspect the screenshot**

Run: `npm run test:e2e` (rebuilds via `tauri build --debug`; follow `.claude/skills/e2e-verify/SKILL.md`).
Expected: `ink-fullscreen-editor` specs pass.
Then open `e2e/.artifacts/ink-draw-ribbon-flyout.png` and `ink-fullscreen-open.png` and compare against a reference element (the editor toolbar's button height/padding in a note screenshot), not against "the CSS exists": card size, gaps between cards, flyout padding, swatch grid alignment, and that the flyout sits above the overlay (z-index 110 > 100). Fix spacing in `src/index.css` if off.
Manual (the WebDriver cannot drive native dialogs): in `npm run tauri dev`, open the flyout, click the custom colour input, pick a colour, and confirm the flyout stays open and the pen colour changes.

- [ ] **Step 7: Full verification**

Run: `npm run typecheck` then `npm test`
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add src/ink/InkEditorOverlay.tsx src/ink/inkEditorOverlay.test.tsx e2e/specs/ink-fullscreen-editor.e2e.ts src/index.css
git commit -m "feat(ink): draw ribbon replaces the tool row in the full-screen editor" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** PenGallery with live-sample swatches + flyout (thickness slider with live preview, 12-colour grid + custom input, `updateActivePen`, opacity untouched) → Task 1. Eraser flyout (mode + size), Lasso, Delete-on-selection, Text size flyout, Ruler toggle, Shapes with remembered choice, undo/redo, zoom 75/100/150/200, Done, no fit-width → Task 3. Flyout rule (first click activates, second opens; pen click while another tool is active only switches) → `ToolFlyout`, tested in Tasks 1 and 3. Narrow screens → `.draw-ribbon-tools` `overflow-x: auto` + pinned region. Popover component → Task 1. Keyboard (P/E/L/T, Ctrl+Z/Y, Esc order, ignore rules) → Tasks 2 and 4 (Ctrl+Z/Y already existed and its tests still run). Styling/grep/screenshot-vs-reference → Tasks 1, 3, 4. e2e screenshot with flyout → Task 4. Non-goals respected: `useInkStore`, `pens.ts`, `InkToolGroup` untouched.
- **Placeholder scan:** none; the one conditional (Escape fallback) names its concrete fix.
- **Type consistency:** `ToolFlyout` props (`active`, `onActivate`, `label`, `title`, `className`, `icon`, `children`) match between Tasks 1 and 3; `toolForShortcut` signature matches Tasks 2 and 4; `DrawRibbon({ onDone })` matches Task 4; flyout labels used in tests (`Pen thickness`, `Custom color`, `Eraser size`, `Text size`, `Shapes`, `Zoom`) match the components.
- **Review Focus:** items 1–5 map to tests in Tasks 4, 2/4, 3, 3, 1 respectively.
