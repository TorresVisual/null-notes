import { describe, it, expect } from 'vitest'
import {
  initialLayout,
  openIn,
  closeTabIn,
  splitActive,
  moveTab,
  closeGroup,
  toggleDirection,
  setRatio,
  setViewMode,
  setFocused,
  pinToggle,
  reorderIn,
  replacePrefixAll,
  removeUnder,
  openPaths,
  layoutFromSession,
  type EditorGroup,
  type GroupLayout,
} from './editorGroups'
import type { WorkspaceState } from '../types'

const A = '/ws/a.md'
const B = '/ws/b.md'
const C = '/ws/c.md'
const CANVAS = '/ws/board.canvas'
const BASE = '/ws/table.base'

function open(...paths: string[]): GroupLayout {
  return paths.reduce((l, p) => openIn(l, p), initialLayout())
}

function split(...paths: string[]): GroupLayout {
  return splitActive(open(...paths), 'right')
}

describe('initialLayout', () => {
  it('is one empty group, focused, in a row at 50%', () => {
    const l = initialLayout()
    expect(l.groups).toEqual([{ tabs: [], pinned: [], active: null, viewMode: 'wysiwyg' }])
    expect(l).toMatchObject({ focused: 0, direction: 'row', ratio: 0.5 })
  })
})

describe('openIn', () => {
  it('adds a tab, activates it and focuses its group', () => {
    const l = openIn(split(A), B, 0)
    expect(l.groups[0]).toMatchObject({ tabs: [A, B], active: B })
    expect(l.focused).toBe(0)
  })

  it('activates an existing tab without duplicating it', () => {
    const l = openIn(open(A, B), A)
    expect(l.groups[0]).toMatchObject({ tabs: [A, B], active: A })
  })

  it('opens in the focused group by default', () => {
    const l = openIn(split(A), B)
    expect(l.groups[1]).toMatchObject({ tabs: [A, B], active: B })
    expect(l.groups[0]?.tabs).toEqual([A])
  })

  it('forces canvas and base paths into group 0 and focuses it', () => {
    const two = split(A)
    expect(openIn(two, CANVAS, 1)).toMatchObject({ focused: 0 })
    expect(openIn(two, CANVAS, 1).groups[0]?.tabs).toEqual([A, CANVAS])
    expect(openIn(two, BASE).groups[1]?.tabs).toEqual([A])
  })
})

describe('closeTabIn', () => {
  it('activates the last remaining tab when the active one closes', () => {
    const l = closeTabIn(open(A, B, C), C, 0)
    expect(l.groups[0]).toMatchObject({ tabs: [A, B], active: B })
  })

  it('keeps the active tab when another one closes', () => {
    const l = closeTabIn(open(A, B, C), A, 0)
    expect(l.groups[0]).toMatchObject({ tabs: [B, C], active: C })
  })

  it('collapses to one group, focused 0, when the only tab of group 1 closes', () => {
    const l = closeTabIn(split(A), A, 1)
    expect(l.groups).toHaveLength(1)
    expect(l.focused).toBe(0)
    expect(l.groups[0]?.tabs).toEqual([A])
  })

  it('removes an emptied group 0 and the survivor becomes group 0', () => {
    const l = closeTabIn(openIn(split(A), B), A, 0)
    expect(l.groups).toHaveLength(1)
    expect(l.groups[0]?.tabs).toEqual([A, B])
    expect(l.focused).toBe(0)
  })

  it('leaves a single emptied group in place (Home)', () => {
    const l = closeTabIn(open(A), A, 0)
    expect(l.groups).toHaveLength(1)
    expect(l.groups[0]).toMatchObject({ tabs: [], active: null })
  })

  it('drops the pin of a closed tab', () => {
    const l = closeTabIn(pinToggle(open(A, B), A, 0), A, 0)
    expect(l.groups[0]?.pinned).toEqual([])
  })
})

describe('splitActive', () => {
  it('right: copies the active tab into a new second group and focuses it', () => {
    const l = split(A, B)
    expect(l.groups).toHaveLength(2)
    expect(l.groups[0]).toMatchObject({ tabs: [A, B], active: B })
    expect(l.groups[1]).toMatchObject({ tabs: [B], active: B, pinned: [] })
    expect(l).toMatchObject({ focused: 1, direction: 'row', ratio: 0.5 })
  })

  it('left puts the new group at index 0 in a row', () => {
    const l = splitActive(open(A), 'left')
    expect(l.groups[0]?.tabs).toEqual([A])
    expect(l).toMatchObject({ focused: 0, direction: 'row' })
  })

  it('up and down use a column', () => {
    expect(splitActive(open(A), 'up')).toMatchObject({ focused: 0, direction: 'column' })
    expect(splitActive(open(A), 'down')).toMatchObject({ focused: 1, direction: 'column' })
  })

  it('splitting a named tab copies that tab and leaves the source group showing what it showed', () => {
    const l = splitActive(open(A, B), 'right', A)
    expect(l.groups[0]).toMatchObject({ tabs: [A, B], active: B })
    expect(l.groups[1]).toMatchObject({ tabs: [A], active: A })
  })

  it('ignores a named tab the source group does not have', () => {
    const l = open(A)
    expect(splitActive(l, 'right', B)).toBe(l)
  })

  it('copies the source group view mode', () => {
    const l = splitActive(setViewMode(open(A), 0, 'raw'), 'right')
    expect(l.groups[1]?.viewMode).toBe('raw')
  })

  it('is a no-op on a canvas, a base, with no active tab, or with two groups', () => {
    const canvas = open(CANVAS)
    const base = open(BASE)
    const empty = initialLayout()
    const two = split(A)
    expect(splitActive(canvas, 'right')).toBe(canvas)
    expect(splitActive(base, 'right')).toBe(base)
    expect(splitActive(empty, 'right')).toBe(empty)
    expect(splitActive(two, 'down')).toBe(two)
  })
})

describe('moveTab', () => {
  it('moves a tab to the other group and focuses it', () => {
    const l = moveTab(split(A, B), B, 0, 1, false)
    expect(l.groups[0]).toMatchObject({ tabs: [A], active: A })
    expect(l.groups[1]).toMatchObject({ tabs: [B], active: B })
    expect(l.focused).toBe(1)
  })

  it('copies instead of moving when asked', () => {
    const l = moveTab(split(A, B), A, 0, 1, true)
    expect(l.groups[0]?.tabs).toEqual([A, B])
    expect(l.groups[1]?.tabs).toEqual([B, A])
    expect(l.groups[1]?.active).toBe(A)
  })

  it('closes the source group when its last tab leaves', () => {
    const l = moveTab(closeTabIn(split(A), A, 1), A, 0, 1, false)
    expect(l.groups).toHaveLength(1)

    const two = openIn(split(A), B)
    const moved = moveTab(moveTab(two, A, 1, 0, false), B, 1, 0, false)
    expect(moved.groups).toHaveLength(1)
    expect(moved.groups[0]?.tabs).toEqual([A, B])
    expect(moved.focused).toBe(0)
  })

  it('refuses canvas and base tabs into group 1', () => {
    const l = openIn(split(A), CANVAS)
    expect(moveTab(l, CANVAS, 0, 1, false)).toBe(l)
    const b = openIn(split(A), BASE)
    expect(moveTab(b, BASE, 0, 1, true)).toBe(b)
  })

  it('does not carry the pin across', () => {
    const l = moveTab(pinToggle(split(A, B), A, 0), A, 0, 1, true)
    expect(l.groups[1]?.pinned).toEqual([])
    expect(l.groups[0]?.pinned).toEqual([A])
  })

  it('is a no-op within one group or with a single group', () => {
    const one = open(A)
    expect(moveTab(one, A, 0, 0, false)).toBe(one)
    expect(moveTab(one, A, 0, 1, false)).toBe(one)
  })
})

describe('closeGroup', () => {
  it('reports only paths that are no longer open in any group', () => {
    const two = openIn(split(A, B), C)
    const { layout, dropped } = closeGroup(two, 1)
    expect(layout.groups).toHaveLength(1)
    expect(layout.groups[0]?.tabs).toEqual([A, B])
    expect(dropped).toEqual([C])
    expect(layout.focused).toBe(0)
  })

  it('closing group 0 leaves group 1 as the only group', () => {
    const { layout, dropped } = closeGroup(openIn(split(A), B, 0), 0)
    expect(layout.groups[0]?.tabs).toEqual([A])
    expect(dropped).toEqual([B])
  })

  it('does nothing with a single group', () => {
    const one = open(A)
    expect(closeGroup(one, 0)).toEqual({ layout: one, dropped: [] })
  })
})

describe('layout settings', () => {
  it('toggleDirection swaps row and column and keeps order', () => {
    const l = toggleDirection(split(A))
    expect(l.direction).toBe('column')
    expect(toggleDirection(l).direction).toBe('row')
    expect(l.groups).toEqual(split(A).groups)
  })

  it('setRatio ignores a ratio that is not a number', () => {
    expect(setRatio(initialLayout(), NaN).ratio).toBe(0.5)
    expect(setRatio(initialLayout(), Infinity).ratio).toBe(0.5)
  })

  it('setRatio clamps to 0.2..0.8', () => {
    expect(setRatio(initialLayout(), 0.05).ratio).toBe(0.2)
    expect(setRatio(initialLayout(), 0.95).ratio).toBe(0.8)
    expect(setRatio(initialLayout(), 0.6).ratio).toBe(0.6)
  })

  it('setViewMode only changes the named group', () => {
    const l = setViewMode(split(A), 1, 'raw')
    expect(l.groups.map((g) => g.viewMode)).toEqual(['wysiwyg', 'raw'])
  })

  it('setFocused ignores an out-of-range group', () => {
    const one = open(A)
    expect(setFocused(one, 1)).toBe(one)
    expect(setFocused(split(A), 0).focused).toBe(0)
  })
})

describe('pinning and order', () => {
  it('pinning moves the tab to the pinned prefix', () => {
    const l = pinToggle(open(A, B, C), C, 0)
    expect(l.groups[0]).toMatchObject({ tabs: [C, A, B], pinned: [C] })
    expect(pinToggle(l, C, 0).groups[0]?.pinned).toEqual([])
  })

  it('reorderIn moves a tab before another within its group', () => {
    const l = reorderIn(open(A, B, C), C, A, 0)
    expect(l.groups[0]?.tabs).toEqual([C, A, B])
  })

  it('reorderIn refuses to cross the pinned boundary', () => {
    const l = pinToggle(open(A, B, C), A, 0)
    expect(reorderIn(l, C, A, 0)).toBe(l)
  })
})

describe('path rewrites across groups', () => {
  it('replacePrefixAll rewrites tabs, pinned and active in both groups', () => {
    const l = pinToggle(openIn(split('/ws/dir/a.md', '/ws/dir/b.md'), '/ws/dir/a.md'), '/ws/dir/a.md', 1)
    const r = replacePrefixAll(l, '/ws/dir', '/ws/new')
    expect(r.groups[0]).toMatchObject({ tabs: ['/ws/new/a.md', '/ws/new/b.md'], active: '/ws/new/b.md' })
    expect(r.groups[1]).toMatchObject({ tabs: ['/ws/new/a.md', '/ws/new/b.md'], pinned: ['/ws/new/a.md'] })
  })

  it('removeUnder closes notes in both groups and keeps a valid focus', () => {
    const l = openIn(split('/ws/dir/a.md', '/ws/keep.md'), '/ws/dir/b.md')
    const r = removeUnder(l, '/ws/dir')
    expect(r.groups).toHaveLength(2)
    expect(r.groups[0]?.tabs).toEqual(['/ws/keep.md'])
    expect(r.groups[1]?.tabs).toEqual(['/ws/keep.md'])
    expect(r.groups[1]?.active).toBe('/ws/keep.md')
    expect(r.focused).toBeLessThan(r.groups.length)
  })

  it('removeUnder collapses a group that empties and refocuses the survivor', () => {
    const l = moveTab(openIn(split('/ws/keep.md'), '/ws/dir/a.md', 1), '/ws/keep.md', 1, 0, false)
    expect(l.groups[1]?.tabs).toEqual(['/ws/dir/a.md'])
    const r = removeUnder(setFocused(l, 1), '/ws/dir')
    expect(r.groups).toHaveLength(1)
    expect(r.focused).toBe(0)
    expect(r.groups[0]?.tabs).toEqual(['/ws/keep.md'])
  })

  it('removeUnder leaves one empty group when everything goes', () => {
    const r = removeUnder(split('/ws/dir/a.md'), '/ws/dir')
    expect(r.groups).toHaveLength(1)
    expect(r.groups[0]).toMatchObject({ tabs: [], active: null })
    expect(r.focused).toBe(0)
  })
})

describe('openPaths', () => {
  it('lists each open path once across groups', () => {
    expect(openPaths(openIn(split(A, B), C, 0)).sort()).toEqual([A, B, C])
  })
})

const GIT = {
  prompted: false,
  autoCommit: false,
  idleMinutes: 10,
  skipHooks: false,
  autoPush: true,
  allowCodeRepoPush: false,
}
const session = (over: Partial<WorkspaceState>): WorkspaceState => ({
  openTabs: [],
  activeTab: null,
  expandedFolders: [],
  recentSearches: [],
  git: GIT,
  ...over,
})
const everything = () => true

describe('layoutFromSession', () => {
  it('builds one group from a file that only has openTabs, activeTab and pinnedTabs', () => {
    const l = layoutFromSession(session({ openTabs: [A, B], activeTab: A, pinnedTabs: [B] }), everything)
    expect(l.groups).toEqual([{ tabs: [B, A], pinned: [B], active: A, viewMode: 'wysiwyg' }])
    expect(l).toMatchObject({ focused: 0, direction: 'row', ratio: 0.5 })
  })

  it('turns a legacy secondaryTab into a second group, side by side at the old ratio', () => {
    const l = layoutFromSession(
      session({ openTabs: [A, B], activeTab: A, secondaryTab: B, splitRatio: 0.4 }),
      everything,
    )
    expect(l.groups).toHaveLength(2)
    expect(l.groups[0]).toMatchObject({ tabs: [A, B], active: A })
    expect(l.groups[1]).toMatchObject({ tabs: [B], active: B })
    expect(l).toMatchObject({ focused: 0, direction: 'row', ratio: 0.4 })
  })

  it('prefers the saved layout over the legacy fields', () => {
    const saved = setViewMode(split(A, B), 1, 'raw')
    const l = layoutFromSession(
      session({ openTabs: [C], activeTab: C, secondaryTab: C, layout: saved }),
      everything,
    )
    expect(l).toEqual(saved)
  })

  it('round-trips a split layout with pins, modes, direction and ratio', () => {
    const saved = setRatio(toggleDirection(pinToggle(setViewMode(split(A, B), 0, 'raw'), A, 0)), 0.3)
    expect(layoutFromSession(session({ layout: saved }), everything)).toEqual(saved)
  })

  it('drops notes that no longer exist and collapses a group that empties', () => {
    const group = (tabs: string[], active: string): EditorGroup => ({ tabs, pinned: [], active, viewMode: 'wysiwyg' })
    const saved = (second: EditorGroup): GroupLayout => ({
      groups: [group([A, 'gone-1'], 'gone-1'), second],
      focused: 1,
      direction: 'row',
      ratio: 0.5,
    })
    const exists = (p: string) => !p.startsWith('gone')

    const kept = layoutFromSession(session({ layout: saved(group([B, 'gone-2'], 'gone-2')) }), exists)
    expect(kept.groups.map((g) => [g.tabs, g.active])).toEqual([[[A], A], [[B], B]])

    const collapsed = layoutFromSession(session({ layout: saved(group(['gone-2'], 'gone-2')) }), exists)
    expect(collapsed.groups).toHaveLength(1)
    expect(collapsed.focused).toBe(0)
  })

  it('never lets a canvas or base into group 1', () => {
    const saved: GroupLayout = {
      groups: [
        { tabs: [A], pinned: [], active: A, viewMode: 'wysiwyg' },
        { tabs: [CANVAS, BASE], pinned: [], active: CANVAS, viewMode: 'wysiwyg' },
      ],
      focused: 1,
      direction: 'row',
      ratio: 0.5,
    }
    const l = layoutFromSession(session({ layout: saved }), everything)
    expect(l.groups).toHaveLength(1)
    expect(l.focused).toBe(0)
    expect(l.groups[0]?.tabs).toEqual([A])
  })

  it('repairs values a hand-edited file could hold', () => {
    const l = layoutFromSession(
      session({
        layout: {
          groups: [
            { tabs: [A], pinned: [B], active: C, viewMode: 'bogus' as never },
            { tabs: [B], pinned: [], active: B, viewMode: 'wysiwyg' },
            { tabs: [C], pinned: [], active: C, viewMode: 'wysiwyg' },
          ],
          focused: 9,
          direction: 'diagonal' as never,
          ratio: 7,
        },
      }),
      everything,
    )
    expect(l.groups).toHaveLength(2)
    expect(l.groups[0]).toMatchObject({ tabs: [A], pinned: [], active: A, viewMode: 'wysiwyg' })
    expect(l).toMatchObject({ focused: 0, direction: 'row', ratio: 0.8 })
  })

  it('keeps a group on Home when it was saved with tabs but no active one', () => {
    const l = layoutFromSession(session({ openTabs: [A], activeTab: null }), everything)
    expect(l.groups[0]).toMatchObject({ tabs: [A], active: null })
  })
})
