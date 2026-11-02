import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { useEffect } from 'react'
import { coreExtensions } from './index'
import { api } from '../../lib/tauri'

vi.mock('../../lib/tauri', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/tauri')>()
  return { ...original, api: { ...original.api, assets: { ...original.api.assets, read: vi.fn() } } }
})

vi.mock('../../lib/diagram', () => ({
  diagramApi: {
    ensureDir: () => Promise.resolve('/ws/N.diagrams'),
    read: () => Promise.resolve('<svg></svg>'),
    write: () => Promise.resolve(),
  },
}))

const BOX = { left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200, x: 0, y: 0 }

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

function markdownOf(e: Editor): string {
  return (e.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()
}

function draw(surface: HTMLElement, from: [number, number], to: [number, number]) {
  const event = (type: string, [clientX, clientY]: [number, number]) =>
    new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true })
  fireEvent(surface, event('pointerdown', from))
  fireEvent(surface, event('pointermove', to))
  fireEvent(surface, event('pointerup', to))
}

beforeEach(() => {
  vi.mocked(api.assets.read).mockResolvedValue('YmFzZTY0')
  HTMLElement.prototype.setPointerCapture = vi.fn()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ ...BOX, toJSON: () => BOX })
})

afterEach(() => {
  editor?.destroy()
  editor = null
  cleanup()
  vi.restoreAllMocks()
})

describe('authoring occlusion cards from the editor', () => {
  it('turns a NoteImage into one card line per region, right after its paragraph', async () => {
    render(<TestEditor content={'![Pipeline](Lecture%207.assets/p.png)\n\nAfter.'} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Occlusion cards' }))
    draw(await screen.findByTestId('occlusion-surface'), [40, 20], [120, 60])
    draw(screen.getByTestId('occlusion-surface'), [200, 100], [300, 180])
    fireEvent.click(await screen.findByRole('button', { name: 'Create 2 cards' }))

    await waitFor(() => expect(screen.queryByTestId('occlusion-surface')).toBeNull())
    expect(markdownOf(editor!).split('\n').filter(Boolean)).toEqual([
      '![Pipeline](Lecture%207.assets/p.png)',
      '![Pipeline](Lecture%207.assets/p.png "occlude=0.1,0.1,0.2,0.2")',
      '![Pipeline](Lecture%207.assets/p.png "occlude=0.5,0.5,0.25,0.4")',
      'After.',
    ])
  })

  it('does not offer to author from an image that is already a card', async () => {
    render(<TestEditor content={'![a](x.png "occlude=0.1,0.1,0.2,0.2")'} />)
    await waitFor(() => expect(screen.getByTestId('occlusion-occlude')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Occlusion cards' })).toBeNull()
  })

  it('turns a DiagramBlock into card lines that point at its exported svg', async () => {
    const fence =
      '```diagram\n{"jsonSrc":"/ws/N.diagrams/d.excalidraw","svgSrc":"/ws/N.diagrams/d.svg","width":700,"height":500}\n```'
    render(<TestEditor content={fence} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Occlusion cards' }))
    draw(await screen.findByTestId('occlusion-surface'), [40, 20], [120, 60])
    fireEvent.click(await screen.findByRole('button', { name: 'Create 1 card' }))

    await waitFor(() => expect(markdownOf(editor!)).toContain('occlude='))
    expect(api.assets.read).toHaveBeenCalledWith('/ws/N.md', 'N.diagrams/d.svg')
    const lines = markdownOf(editor!).split('\n').filter(Boolean)
    expect(lines[0]).toBe('```diagram')
    expect(lines.at(-1)).toBe('![diagram](N.diagrams/d.svg "occlude=0.1,0.1,0.2,0.2")')
  })
})
