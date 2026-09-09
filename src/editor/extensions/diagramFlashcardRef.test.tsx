import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { useEffect } from 'react'
import { coreExtensions } from './index'
import { relativeToNoteDir } from './DiagramBlock'

vi.mock('../../lib/diagram', () => ({
  diagramApi: {
    ensureDir: () => Promise.resolve('/ws/N.diagrams'),
    read: () => Promise.resolve('<svg></svg>'),
    write: () => Promise.resolve(),
  },
}))

const writeText = vi.fn().mockResolvedValue(undefined)
Object.assign(navigator, { clipboard: { writeText } })

let editor: Editor | null = null

function TestEditor({ content }: { content: string }) {
  const instance = useEditor({ extensions: coreExtensions, content })
  useEffect(() => {
    if (instance) {
      instance.storage.noteContext.notePath = '/ws/N.md'
      editor = instance
    }
  }, [instance])
  return <EditorContent editor={instance} />
}

afterEach(() => {
  editor?.destroy()
  editor = null
  writeText.mockClear()
  cleanup()
})

describe('relativeToNoteDir', () => {
  it('strips the note directory, forward slash', () => {
    expect(relativeToNoteDir('/ws/N.md', '/ws/N.diagrams/d.svg')).toBe('N.diagrams/d.svg')
  })

  it('strips the note directory, Windows backslash', () => {
    expect(relativeToNoteDir('C:\\ws\\N.md', 'C:\\ws\\N.diagrams\\d.svg')).toBe('N.diagrams/d.svg')
  })

  it('returns null when the path is outside the note directory', () => {
    expect(relativeToNoteDir('/ws/N.md', '/other/N.diagrams/d.svg')).toBeNull()
  })
})

describe('copying a diagram as a flashcard reference', () => {
  it('copies a note-relative image marker for the svg', async () => {
    const fence =
      '```diagram\n{"jsonSrc":"/ws/N.diagrams/d.excalidraw","svgSrc":"/ws/N.diagrams/d.svg","width":700,"height":500}\n```'
    const { container } = render(<TestEditor content={fence} />)

    await waitFor(() => expect(container.querySelector('.diagram-block-copy')).not.toBeNull())
    fireEvent.click(container.querySelector('.diagram-block-copy')!)

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('![diagram](N.diagrams/d.svg)'))
  })
})
