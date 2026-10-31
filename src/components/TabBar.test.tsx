import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { TabBar } from './TabBar'
import { useWorkspaceStore } from '../store/workspace'
import { useNotesStore } from '../store/notes'

afterEach(cleanup)
beforeEach(() => {
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
    const { getByText } = render(
      <TabBar
        viewMode="wysiwyg"
        onToggleView={noop}
        saveState="clean"
        saveError={null}
        onRetrySave={noop}
        onDismissSaveError={noop}
        gitCommitStatus="idle"
        gitCommitDetail={null}
        onSyncNow={noop}
        syncingNow={false}
      />,
    )
    const tab = getByText('b').closest('[role="tab"]') as HTMLElement
    const dataTransfer = fakeDataTransfer()

    fireEvent.dragStart(tab, { dataTransfer })

    expect(dataTransfer.getData('text/plain')).toBe('/ws/b.md')
  })
})

describe('TabBar context menu on a canvas tab', () => {
  it('offers canvas actions only, never the note-only ones', async () => {
    useWorkspaceStore.setState({ openTabs: ['/ws/map.canvas'], activeTab: '/ws/map.canvas' })
    const { getByRole, findByText, queryByText } = render(
      <TabBar
        viewMode="wysiwyg"
        onToggleView={noop}
        saveState="clean"
        saveError={null}
        onRetrySave={noop}
        onDismissSaveError={noop}
        gitCommitStatus="idle"
        gitCommitDetail={null}
        onSyncNow={noop}
        syncingNow={false}
      />,
    )

    fireEvent.contextMenu(getByRole('tab', { name: /map/ }))

    expect(await findByText('Rename')).toBeTruthy()
    for (const noteOnly of ['Duplicate', 'Move to…', 'Merge into…']) {
      expect(queryByText(noteOnly)).toBeNull()
    }
  })
})
