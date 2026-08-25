# Home Narrative Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (default) or superpowers:subagent-driven-development if explicitly requested.

**Goal:** Give the Home dashboard one line of synthesis above its five sections — "2 tasks open, 1 card due, 3 unpushed." — instead of five independent headers with no relationship drawn between them, using only data `HomeView` already computes.

**Architecture:** A pure function, `buildHomeSummary` (`src/lib/homeSummary.ts`), takes the counts `HomeView` already has (`tasks.length`, `dueCards.length`, the derived `gitStatus` string) and returns one sentence. `HomeView.tsx` renders its output in a new `<p className="home-summary">` above the section grid. Since `.home-view` is currently *itself* the CSS grid container, the sections move into a new inner `.home-view-grid` wrapper so the summary line can sit above the grid rather than becoming a grid cell.

**Tech Stack:** React 19 + TypeScript (strict), Vitest + React Testing Library.

**Spec:** `docs/specs/product-completion-pass-design.md` (§ WS4 — Home narrative)

## Global Constraints

- No new store field, database column, or Tauri command — `buildHomeSummary` consumes only data `HomeView.tsx` already fetches (matches `docs/specs/workspace-dashboard-design.md`'s original constraint for this screen).
- `gitStatus === null` (not a Git repo) and `gitStatus === 'Up to date'` (clean repo) are two distinct empty-summary sentences, not one — conflating them would claim "everything's up to date" about a workspace that isn't version-controlled at all.

---

### Task 1: `buildHomeSummary`

**Files:**
- Create: `src/lib/homeSummary.ts`
- Test: `src/lib/homeSummary.test.ts`

**Interfaces:**
- Produces: `buildHomeSummary(input: { taskCount: number; dueCount: number; gitStatus: string | null }): string` — consumed by Task 2.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/homeSummary.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildHomeSummary } from './homeSummary'

describe('buildHomeSummary', () => {
  it('reports nothing outstanding when not a Git repo and nothing else pending', () => {
    expect(buildHomeSummary({ taskCount: 0, dueCount: 0, gitStatus: null })).toBe(
      'Nothing outstanding right now.',
    )
  })

  it('reports everything up to date when it is a clean Git repo', () => {
    expect(buildHomeSummary({ taskCount: 0, dueCount: 0, gitStatus: 'Up to date' })).toBe(
      "Nothing outstanding — everything's up to date.",
    )
  })

  it('reports a single open task in the singular', () => {
    expect(buildHomeSummary({ taskCount: 1, dueCount: 0, gitStatus: null })).toBe('1 task open.')
  })

  it('reports multiple open tasks in the plural', () => {
    expect(buildHomeSummary({ taskCount: 3, dueCount: 0, gitStatus: null })).toBe('3 tasks open.')
  })

  it('reports a single due card in the singular, alongside tasks', () => {
    expect(buildHomeSummary({ taskCount: 2, dueCount: 1, gitStatus: null })).toBe(
      '2 tasks open, 1 card due.',
    )
  })

  it('includes a non-clean Git status as its own clause', () => {
    expect(buildHomeSummary({ taskCount: 0, dueCount: 0, gitStatus: '3 unpushed' })).toBe('3 unpushed.')
  })

  it('omits a clean Git status even when other counts are non-zero', () => {
    expect(buildHomeSummary({ taskCount: 1, dueCount: 0, gitStatus: 'Up to date' })).toBe('1 task open.')
  })

  it('joins all three clauses when everything has something to report', () => {
    expect(buildHomeSummary({ taskCount: 2, dueCount: 1, gitStatus: '1 ahead, 3 behind' })).toBe(
      '2 tasks open, 1 card due, 1 ahead, 3 behind.',
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/homeSummary.test.ts`
Expected: FAIL — `Cannot find module './homeSummary'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/homeSummary.ts`:

```ts
export interface HomeSummaryInput {
  taskCount: number
  dueCount: number
  gitStatus: string | null
}

// Every count HomeView already computes, synthesized into one sentence —
// no new data, just an argument for why the five sections below it belong
// together. gitStatus === null (not a repo) and gitStatus === 'Up to date'
// (clean repo) are kept as two distinct empty-summary sentences: the second
// would be a false claim about Git for a workspace that isn't one.
export function buildHomeSummary({ taskCount, dueCount, gitStatus }: HomeSummaryInput): string {
  const clauses: string[] = []
  if (taskCount > 0) clauses.push(`${taskCount} task${taskCount === 1 ? '' : 's'} open`)
  if (dueCount > 0) clauses.push(`${dueCount} card${dueCount === 1 ? '' : 's'} due`)
  if (gitStatus !== null && gitStatus !== 'Up to date') clauses.push(gitStatus)

  if (clauses.length === 0) {
    return gitStatus === null
      ? 'Nothing outstanding right now.'
      : "Nothing outstanding — everything's up to date."
  }
  return `${clauses.join(', ')}.`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/homeSummary.test.ts`
Expected: PASS, all eight cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/homeSummary.ts src/lib/homeSummary.test.ts
git commit -m "feat: add buildHomeSummary, a one-line synthesis of Home's sections"
```

---

### Task 2: Render the summary above Home's section grid

**Files:**
- Modify: `src/components/HomeView.tsx`
- Modify: `src/index.css:2708-2713` (splits `.home-view` into `.home-view` + `.home-view-grid`)
- Test: `src/components/HomeView.test.tsx` (extend)

**Interfaces:**
- Consumes: `buildHomeSummary` from Task 1.

- [ ] **Step 1: Write the failing test**

Add to `src/components/HomeView.test.tsx`, inside the existing `describe('HomeView', ...)` block (it already imports `screen` and has the `listOpenTasks`/`listDueCards` mocks this test reuses):

```tsx
  it('renders a one-line summary above the sections, combining tasks, due cards, and Git status', async () => {
    listOpenTasks.mockResolvedValue([
      { notePath: '/ws/a.md', noteTitle: 'A', text: 'Finish proof', position: 0 },
    ])
    listDueCards.mockResolvedValue([
      { notePath: '/ws/a.md', noteTitle: 'A', kind: 'qa', front: 'Q', back: 'A', position: 0 },
    ])
    useWorkspaceStore.setState({ repoMode: 'notesOnly', gitDiverged: null, gitPendingPaths: [] })

    render(<HomeView onOpenTaskView={() => {}} onOpenReview={() => {}} onOpenSettings={() => {}} />)

    expect(await screen.findByText('1 task open, 1 card due.')).toBeInTheDocument()
  })

  it('renders the clean-repo summary when nothing is outstanding', async () => {
    useWorkspaceStore.setState({ repoMode: 'notesOnly', gitDiverged: null, gitPendingPaths: [] })

    render(<HomeView onOpenTaskView={() => {}} onOpenReview={() => {}} onOpenSettings={() => {}} />)

    expect(await screen.findByText("Nothing outstanding — everything's up to date.")).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/components/HomeView.test.tsx`
Expected: FAIL — no element with that text exists yet.

- [ ] **Step 3: Wire the summary into `HomeView.tsx`**

Add the import:

```ts
import { buildHomeSummary } from '../lib/homeSummary'
```

Change the component's return statement from:

```tsx
  return (
    <div className="home-view">
      <section className="home-section">
```

to:

```tsx
  return (
    <div className="home-view">
      <p className="home-summary">
        {buildHomeSummary({ taskCount: tasks.length, dueCount: dueCards.length, gitStatus })}
      </p>
      <div className="home-view-grid">
      <section className="home-section">
```

and close the new wrapper right before the outer closing tag — change the final:

```tsx
      </section>
    </div>
  )
}
```

to:

```tsx
      </section>
      </div>
    </div>
  )
}
```

(This only wraps the five existing `<section className="home-section...">` blocks in a new `<div className="home-view-grid">` — none of their own JSX changes.)

- [ ] **Step 4: Split the CSS**

In `src/index.css`, replace the `.home-view` rule (lines 2708-2713):

```css
.home-view {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--space-lg);
  padding: var(--space-xl) 0;
}
```

with:

```css
.home-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
  padding: var(--space-xl) 0;
}

.home-summary {
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary);
}

.home-view-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--space-lg);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/components/HomeView.test.tsx`
Expected: PASS, all cases including the two new ones — the file's existing `.closest('section')` assertions are unaffected, since a `<section>`'s nearest `section` ancestor is unchanged by the new wrapping `<div>` between it and `.home-view`.

- [ ] **Step 6: Run the full test suite and typecheck**

Run: `npm test -- --run`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/HomeView.tsx src/components/HomeView.test.tsx src/index.css
git commit -m "feat: synthesize Home's sections into a one-line summary"
```
