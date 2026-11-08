import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { TabBar } from './TabBar'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'
import { initialLayout } from '../lib/editorGroups'

afterEach(cleanup)
beforeEach(() => {
  useWorkspaceStore.setState({ layout: initialLayout() })
  useWorkspaceStore.setState({ openTabs: ['/ws/a.md', '/ws/b.md'], activeTab: '/ws/a.md', flashTabPath: null })
  useNotesStore.setState({
    notes: [
      { id: '1', path: '/ws/a.md', title: 'a', workspace: '/ws', updatedAt: 0 },
      { id: '2', path: '/ws/b.md', title: 'b', workspace: '/ws', updatedAt: 0 },
    ],
    folders: [],
    tags: [],
  })
})

const noop = () => {}
const STATUS = {
  saveState: 'clean' as const,
  saveError: null,
  onRetrySave: noop,
  onDismissSaveError: noop,
  gitCommitStatus: 'idle' as const,
  gitCommitDetail: null,
  onSyncNow: noop,
  syncingNow: false,
}

// jsdom has no DataTransfer constructor, so build the minimal shape
// TabBar's onDragStart actually reads/writes (same approach as
// CodeBlockEditor.test.ts's vscodePaste helper).
function fakeDataTransfer(): DataTransfer {
  const store = new Map<string, string>()
  return {
    setData: (format: string, data: string) => store.set(format, data),
    getData: (format: string) => store.get(format) ?? '',
  } as unknown as DataTransfer
}

describe('TabBar drag payload', () => {
  it('sets the note path as plain-text drag data on dragstart, for drop targets outside the tab strip', () => {
    const { getByText } = render(<TabBar group={0} status={STATUS} />)
    const tab = getByText('b').closest('[role="tab"]') as HTMLElement
    const dataTransfer = fakeDataTransfer()

    fireEvent.dragStart(tab, { dataTransfer })

    expect(dataTransfer.getData('text/plain')).toBe('/ws/b.md')
  })
})

describe('TabBar keyboard', () => {
  it('is a tablist with one tab stop; arrow keys move focus and activate, wrapping at the ends', () => {
    const { getByRole, getAllByRole } = render(<TabBar group={0} status={STATUS} />)
    const [a, b] = getAllByRole('tab') as HTMLElement[]
    expect(getByRole('tablist', { name: 'Open notes' })).toBeTruthy()
    expect([a!.tabIndex, b!.tabIndex]).toEqual([0, -1])

    fireEvent.keyDown(a!, { key: 'ArrowRight' })
    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/b.md')
    expect(document.activeElement).toBe(b)

    fireEvent.keyDown(b!, { key: 'ArrowRight' })
    expect(useWorkspaceStore.getState().activeTab).toBe('/ws/a.md')
  })
})

describe('TabBar context menu on a canvas tab', () => {
  it('offers canvas actions only, never the note-only ones', async () => {
    useWorkspaceStore.setState({ openTabs: ['/ws/map.canvas'], activeTab: '/ws/map.canvas' })
    const { getByRole, findByText, queryByText } = render(<TabBar group={0} status={STATUS} />)

    fireEvent.contextMenu(getByRole('tab', { name: /map/ }))

    expect(await findByText('Rename')).toBeTruthy()
    for (const noteOnly of ['Duplicate', 'Move to…', 'Merge into…']) {
      expect(queryByText(noteOnly)).toBeNull()
    }
  })
})

describe('TabBar split items', () => {
  const splitLabels = ['Split Right', 'Split Left', 'Split Up', 'Split Down']

  it('offers the four splits on a note tab and splits that tab when chosen', async () => {
    const { getByRole, findByText } = render(<TabBar group={0} status={STATUS} />)
    fireEvent.contextMenu(getByRole('tab', { name: 'b' }))

    for (const label of splitLabels) expect(await findByText(label)).toBeTruthy()
    fireEvent.click(await findByText('Split Left'))

    const { layout } = useWorkspaceStore.getState()
    expect(layout.groups).toHaveLength(2)
    expect(layout.groups[0]?.tabs).toEqual(['/ws/b.md'])
    expect(layout.direction).toBe('row')
  })

  it('disables the splits once two groups exist', async () => {
    useWorkspaceStore.getState().splitEditor('right')
    const { getByRole, findByText } = render(<TabBar group={0} status={STATUS} />)
    fireEvent.contextMenu(getByRole('tab', { name: 'a' }))

    for (const label of splitLabels) {
      expect((await findByText(label)).closest('[role="menuitem"]')).toHaveAttribute('data-disabled')
    }
  })

  it('disables them on a canvas tab', async () => {
    useWorkspaceStore.setState({ openTabs: ['/ws/map.canvas'], activeTab: '/ws/map.canvas' })
    const { getByRole, findByText } = render(<TabBar group={0} status={STATUS} />)
    fireEvent.contextMenu(getByRole('tab', { name: /map/ }))

    expect((await findByText('Split Right')).closest('[role="menuitem"]')).toHaveAttribute('data-disabled')
  })
})
