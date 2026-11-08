import { isBasePath, isCanvasPath } from './canvasPath'
import { isUnderPath, replacePathPrefix } from './pathPrefix'
import type { WorkspaceState } from '../types'

export type ViewMode = 'wysiwyg' | 'raw'
export type SplitSide = 'left' | 'right' | 'up' | 'down'

export interface EditorGroup {
  tabs: string[]
  pinned: string[]
  active: string | null
  viewMode: ViewMode
}

export interface GroupLayout {
  groups: EditorGroup[]
  focused: number
  direction: 'row' | 'column'
  ratio: number
}

export const MIN_RATIO = 0.2
export const MAX_RATIO = 0.8

const emptyGroup = (viewMode: ViewMode = 'wysiwyg'): EditorGroup => ({
  tabs: [],
  pinned: [],
  active: null,
  viewMode,
})

const splittable = (path: string) => !isCanvasPath(path) && !isBasePath(path)

const pinnedFirst = (tabs: string[], pinned: string[]) => [
  ...tabs.filter((p) => pinned.includes(p)),
  ...tabs.filter((p) => !pinned.includes(p)),
]

const without = (g: EditorGroup, keep: (path: string) => boolean): EditorGroup => {
  const tabs = g.tabs.filter(keep)
  const active = g.active === null || keep(g.active) ? g.active : (tabs[tabs.length - 1] ?? null)
  return { ...g, tabs, pinned: g.pinned.filter(keep), active }
}

// Groups other than a lone one never stay empty; `focus` is the group that
// should hold focus afterwards, matched by identity because indexes shift.
function settle(l: GroupLayout, groups: EditorGroup[], focus: EditorGroup | undefined): GroupLayout {
  const kept = groups.length > 1 ? groups.filter((g) => g.tabs.length > 0) : groups
  const survivors = kept.length > 0 ? kept : groups.slice(0, 1)
  const focused = focus ? survivors.indexOf(focus) : -1
  return { ...l, groups: survivors, focused: Math.max(focused, 0) }
}

const replaceAt = (groups: EditorGroup[], index: number, g: EditorGroup) =>
  groups.map((old, i) => (i === index ? g : old))

export function initialLayout(): GroupLayout {
  return { groups: [emptyGroup()], focused: 0, direction: 'row', ratio: 0.5 }
}

export function openIn(l: GroupLayout, path: string, group = l.focused): GroupLayout {
  const target = splittable(path) ? Math.min(Math.max(group, 0), l.groups.length - 1) : 0
  const g = l.groups[target]
  if (!g) return l
  const next: EditorGroup = {
    ...g,
    tabs: g.tabs.includes(path) ? g.tabs : [...g.tabs, path],
    active: path,
  }
  return { ...l, groups: replaceAt(l.groups, target, next), focused: target }
}

export function closeTabIn(l: GroupLayout, path: string, group: number): GroupLayout {
  const g = l.groups[group]
  if (!g || !g.tabs.includes(path)) return l
  const next = without(g, (p) => p !== path)
  const groups = replaceAt(l.groups, group, next)
  return settle(l, groups, l.focused === group ? next : l.groups[l.focused])
}

export function splitActive(l: GroupLayout, side: SplitSide): GroupLayout {
  const source = l.groups[l.focused]
  const path = source?.active
  if (!source || !path || l.groups.length > 1 || !splittable(path)) return l
  const created: EditorGroup = { tabs: [path], pinned: [], active: path, viewMode: source.viewMode }
  const first = side === 'left' || side === 'up'
  return {
    groups: first ? [created, source] : [source, created],
    focused: first ? 0 : 1,
    direction: side === 'left' || side === 'right' ? 'row' : 'column',
    ratio: 0.5,
  }
}

export function moveTab(l: GroupLayout, path: string, from: number, to: number, copy: boolean): GroupLayout {
  const source = l.groups[from]
  const dest = l.groups[to]
  if (from === to || !source || !dest || !source.tabs.includes(path)) return l
  if (to !== 0 && !splittable(path)) return l
  const nextDest: EditorGroup = {
    ...dest,
    tabs: dest.tabs.includes(path) ? dest.tabs : [...dest.tabs, path],
    active: path,
  }
  const nextSource = copy ? source : without(source, (p) => p !== path)
  const groups = l.groups.map((g, i) => (i === to ? nextDest : i === from ? nextSource : g))
  return settle(l, groups, nextDest)
}

export function closeGroup(l: GroupLayout, group: number): { layout: GroupLayout; dropped: string[] } {
  const removed = l.groups[group]
  if (l.groups.length < 2 || !removed) return { layout: l, dropped: [] }
  const groups = l.groups.filter((_, i) => i !== group)
  const stillOpen = groups.flatMap((g) => g.tabs)
  return {
    layout: { ...l, groups, focused: 0 },
    dropped: removed.tabs.filter((p) => !stillOpen.includes(p)),
  }
}

export const toggleDirection = (l: GroupLayout): GroupLayout => ({
  ...l,
  direction: l.direction === 'row' ? 'column' : 'row',
})

export const setRatio = (l: GroupLayout, ratio: number): GroupLayout => ({
  ...l,
  ratio: Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio)),
})

export function setViewMode(l: GroupLayout, group: number, viewMode: ViewMode): GroupLayout {
  const g = l.groups[group]
  return g ? { ...l, groups: replaceAt(l.groups, group, { ...g, viewMode }) } : l
}

export const setFocused = (l: GroupLayout, group: number): GroupLayout =>
  l.groups[group] ? { ...l, focused: group } : l

export function pinToggle(l: GroupLayout, path: string, group: number): GroupLayout {
  const g = l.groups[group]
  if (!g || !g.tabs.includes(path)) return l
  const pinned = g.pinned.includes(path) ? g.pinned.filter((p) => p !== path) : [...g.pinned, path]
  return { ...l, groups: replaceAt(l.groups, group, { ...g, pinned, tabs: pinnedFirst(g.tabs, pinned) }) }
}

export function reorderIn(l: GroupLayout, from: string, to: string, group: number): GroupLayout {
  const g = l.groups[group]
  if (!g || from === to || !g.tabs.includes(from) || !g.tabs.includes(to)) return l
  if (g.pinned.includes(from) !== g.pinned.includes(to)) return l
  const tabs = g.tabs.filter((p) => p !== from)
  tabs.splice(tabs.indexOf(to), 0, from)
  return { ...l, groups: replaceAt(l.groups, group, { ...g, tabs }) }
}

export function replacePrefixAll(l: GroupLayout, oldPrefix: string, newPrefix: string): GroupLayout {
  const rewrite = (p: string) => replacePathPrefix(p, oldPrefix, newPrefix)
  return {
    ...l,
    groups: l.groups.map((g) => ({
      ...g,
      tabs: g.tabs.map(rewrite),
      pinned: g.pinned.map(rewrite),
      active: g.active === null ? null : rewrite(g.active),
    })),
  }
}

export function removeUnder(l: GroupLayout, prefix: string): GroupLayout {
  const groups = l.groups.map((g) => without(g, (p) => !isUnderPath(p, prefix)))
  return settle(l, groups, groups[l.focused])
}

export const openPaths = (l: GroupLayout): string[] => [...new Set(l.groups.flatMap((g) => g.tabs))]

// Group 0 doubles as the flat tab fields so a build that predates groups still
// opens the file with something sensible.
export function sessionTabs(l: GroupLayout) {
  const g = l.groups[0] ?? emptyGroup()
  return { openTabs: g.tabs, activeTab: g.active, pinnedTabs: g.pinned, layout: l }
}

// Reads a layout back from .workspace.json. The file is user-editable and may
// be older than this feature, so nothing in it is trusted: legacy fields become
// the equivalent layout, and anything that can't be shown is dropped.
export function layoutFromSession(s: WorkspaceState, existing: (path: string) => boolean): GroupLayout {
  const saved = s.layout?.groups?.length ? s.layout : null
  const raw: Partial<EditorGroup>[] = saved
    ? saved.groups.slice(0, 2)
    : [
        { tabs: s.openTabs, pinned: s.pinnedTabs, active: s.activeTab },
        ...(s.secondaryTab ? [{ tabs: [s.secondaryTab], active: s.secondaryTab }] : []),
      ]
  const groups = raw.map((g, i): EditorGroup => {
    const tabs = [...new Set(g.tabs ?? [])].filter((p) => existing(p) && (i === 0 || splittable(p)))
    const pinned = (g.pinned ?? []).filter((p) => tabs.includes(p))
    const active = g.active == null ? null : tabs.includes(g.active) ? g.active : (tabs[tabs.length - 1] ?? null)
    return { tabs: pinnedFirst(tabs, pinned), pinned, active, viewMode: g.viewMode === 'raw' ? 'raw' : 'wysiwyg' }
  })
  const ratio = saved ? saved.ratio : s.splitRatio
  const base: GroupLayout = {
    groups,
    focused: 0,
    direction: saved?.direction === 'column' ? 'column' : 'row',
    ratio: 0.5,
  }
  const settled = settle(base, groups, groups[saved?.focused ?? 0])
  return setRatio(settled, Number.isFinite(ratio) ? (ratio as number) : 0.5)
}
