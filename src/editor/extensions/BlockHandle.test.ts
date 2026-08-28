import { describe, it, expect, afterEach } from 'vitest'
import { moveSelectedNode, currentConvertTarget, isConvertibleNode, convertSelectedNode } from './BlockHandle'

const { Editor } = await import('@tiptap/core')
const { NodeSelection } = await import('@tiptap/pm/state')
const { coreExtensions } = await import('./index')

let editor: InstanceType<typeof Editor> | null = null

function mount(content: string) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  editor = new Editor({ element, extensions: coreExtensions, content })
  return editor
}

function selectBlockContaining(e: InstanceType<typeof Editor>, needle: string): void {
  let pos: number | null = null
  e.state.doc.descendants((node, nodePos) => {
    if (pos !== null) return false
    if (!node.isText) return true
    if ((node.text ?? '').includes(needle)) {
      const $pos = e.state.doc.resolve(nodePos)
      pos = $pos.before($pos.depth)
    }
    return true
  })
  if (pos === null) throw new Error(`no node containing "${needle}"`)
  e.commands.setNodeSelection(pos)
}

function paragraphTexts(e: InstanceType<typeof Editor>): string[] {
  const texts: string[] = []
  e.state.doc.forEach((node) => {
    texts.push(node.textContent)
  })
  return texts
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('moveSelectedNode', () => {
  it('moves a block up, swapping with its previous sibling', () => {
    const e = mount('<p>alpha</p><p>beta</p><p>gamma</p>')
    selectBlockContaining(e, 'beta')

    expect(moveSelectedNode(e, 'up')).toBe(true)

    expect(paragraphTexts(e)).toEqual(['beta', 'alpha', 'gamma'])
  })

  it('moves a block down, swapping with its next sibling', () => {
    const e = mount('<p>alpha</p><p>beta</p><p>gamma</p>')
    selectBlockContaining(e, 'beta')

    expect(moveSelectedNode(e, 'down')).toBe(true)

    expect(paragraphTexts(e)).toEqual(['alpha', 'gamma', 'beta'])
  })

  it('keeps the moved block selected afterward', () => {
    const e = mount('<p>alpha</p><p>beta</p><p>gamma</p>')
    selectBlockContaining(e, 'beta')

    moveSelectedNode(e, 'up')

    const { selection } = e.state
    expect(selection).toBeInstanceOf(NodeSelection)
    expect((selection as InstanceType<typeof NodeSelection>).node.textContent).toBe('beta')
  })

  it('does nothing at the top boundary', () => {
    const e = mount('<p>alpha</p><p>beta</p>')
    selectBlockContaining(e, 'alpha')

    expect(moveSelectedNode(e, 'up')).toBe(false)
    expect(paragraphTexts(e)).toEqual(['alpha', 'beta'])
  })

  it('does nothing at the bottom boundary', () => {
    const e = mount('<p>alpha</p><p>beta</p>')
    selectBlockContaining(e, 'beta')

    expect(moveSelectedNode(e, 'down')).toBe(false)
    expect(paragraphTexts(e)).toEqual(['alpha', 'beta'])
  })

  it('does nothing when the selection is not a NodeSelection', () => {
    const e = mount('<p>alpha</p><p>beta</p>')
    e.commands.setTextSelection(2)

    expect(moveSelectedNode(e, 'up')).toBe(false)
  })
})

function selectedNode(e: InstanceType<typeof Editor>) {
  const { selection } = e.state
  if (!(selection instanceof NodeSelection)) throw new Error('selection is not a NodeSelection')
  return selection.node
}

describe('currentConvertTarget / isConvertibleNode', () => {
  it('identifies a paragraph as convertible, target "paragraph"', () => {
    const e = mount('<p>alpha</p>')
    selectBlockContaining(e, 'alpha')
    const node = selectedNode(e)
    expect(isConvertibleNode(node)).toBe(true)
    expect(currentConvertTarget(node)).toBe('paragraph')
  })

  it('identifies a heading level in its target', () => {
    const e = mount('<h2>alpha</h2>')
    selectBlockContaining(e, 'alpha')
    expect(currentConvertTarget(selectedNode(e))).toBe('heading2')
  })

  it('reports a code block as not convertible', () => {
    const e = mount('<pre><code>let x = 1;</code></pre>')
    selectBlockContaining(e, 'x')
    const node = selectedNode(e)
    expect(isConvertibleNode(node)).toBe(false)
    expect(currentConvertTarget(node)).toBeNull()
  })
})

describe('convertSelectedNode', () => {
  it('converts a paragraph into a heading', () => {
    const e = mount('<p>alpha</p>')
    selectBlockContaining(e, 'alpha')

    expect(convertSelectedNode(e, 'heading1')).toBe(true)

    expect(e.state.doc.firstChild?.type.name).toBe('heading')
    expect(e.state.doc.firstChild?.attrs['level']).toBe(1)
    expect(e.getText()).toContain('alpha')
  })

  it('converts a heading back into a paragraph', () => {
    const e = mount('<h1>alpha</h1>')
    selectBlockContaining(e, 'alpha')

    expect(convertSelectedNode(e, 'paragraph')).toBe(true)

    expect(e.state.doc.firstChild?.type.name).toBe('paragraph')
  })

  it('converts a paragraph into a bullet list', () => {
    const e = mount('<p>alpha</p>')
    selectBlockContaining(e, 'alpha')

    expect(convertSelectedNode(e, 'bulletList')).toBe(true)

    expect(e.state.doc.firstChild?.type.name).toBe('bulletList')
    expect(e.getText()).toContain('alpha')
  })

  it('does nothing when the selection is not a NodeSelection', () => {
    const e = mount('<p>alpha</p>')
    e.commands.setTextSelection(2)

    expect(convertSelectedNode(e, 'heading1')).toBe(false)
  })
})
