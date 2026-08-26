import { describe, it, expect, afterEach } from 'vitest'

const { Editor } = await import('@tiptap/core')
const { coreExtensions } = await import('./index')

let editor: InstanceType<typeof Editor> | null = null

function mount(content: string) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  editor = new Editor({ element, extensions: coreExtensions, content })
  return editor
}

function findCodeBlockPos(e: InstanceType<typeof Editor>): number {
  let found = -1
  e.state.doc.descendants((node, pos) => {
    if (found !== -1) return false
    if (node.type.name === 'codeBlock') found = pos
    return found === -1
  })
  if (found === -1) throw new Error('no codeBlock node found')
  return found
}

// Real `doPaste` in prosemirror-view tags its own transaction with
// `uiEvent: 'paste'` — chaining a `.command()` step onto the same tiptap
// chain reproduces that on one combined transaction, exactly like a real
// paste event's insertion and its meta tag landing together.
function pasteInto(e: InstanceType<typeof Editor>, pos: number, text: string) {
  e.chain()
    .setTextSelection(pos + 1)
    .insertContent(text)
    .command(({ tr }) => {
      tr.setMeta('uiEvent', 'paste')
      return true
    })
    .run()
}

function typeInto(e: InstanceType<typeof Editor>, pos: number, text: string) {
  e.chain().setTextSelection(pos + 1).insertContent(text).run()
}

// Confirmed against lowlight directly: relevance 16 for this snippet,
// comfortably over MIN_CONFIDENT_RELEVANCE (10).
const BASH_SNIPPET = '#!/bin/bash\nfor f in *.txt; do\n  echo "Processing $f"\n  cat "$f" >> combined.txt\ndone\n'

// Confirmed against lowlight directly: scores relevance 3 (as "css") —
// exactly the kind of low-confidence noise MIN_CONFIDENT_RELEVANCE exists
// to reject, since real academic prose regularly scores in this range too.
const PLAIN_PROSE = 'this is just some plain text notes, not code at all'

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('code block language auto-detect (P11-2)', () => {
  it('sets the language when a confident paste lands in an empty, undecided block', () => {
    const e = mount('<pre><code></code></pre>')
    pasteInto(e, findCodeBlockPos(e), BASH_SNIPPET)
    expect(e.getAttributes('codeBlock')['language']).toBe('bash')
  })

  it('leaves the language unset for plain prose pasted into a code block', () => {
    const e = mount('<pre><code></code></pre>')
    pasteInto(e, findCodeBlockPos(e), PLAIN_PROSE)
    expect(e.getAttributes('codeBlock')['language']).toBeFalsy()
  })

  it('never fires on ordinary typing, only on a real paste', () => {
    const e = mount('<pre><code></code></pre>')
    typeInto(e, findCodeBlockPos(e), BASH_SNIPPET)
    expect(e.getAttributes('codeBlock')['language']).toBeFalsy()
  })

  it('never overrides a language chosen by hand', () => {
    const e = mount('<pre><code></code></pre>')
    const pos = findCodeBlockPos(e)
    e.chain().setTextSelection(pos + 1).updateAttributes('codeBlock', { language: 'python' }).run()

    pasteInto(e, pos, BASH_SNIPPET)

    expect(e.getAttributes('codeBlock')['language']).toBe('python')
  })

  it("never overrides a block a prior inconclusive detection already resolved to 'plain text'", () => {
    const e = mount('<pre><code></code></pre>')
    const pos = findCodeBlockPos(e)
    // An explicit "Plain text" pick from the toolbar sets language to '',
    // a decision distinct from `null` ("never touched") — both must stick.
    e.chain().setTextSelection(pos + 1).updateAttributes('codeBlock', { language: '' }).run()

    pasteInto(e, pos, BASH_SNIPPET)

    expect(e.getAttributes('codeBlock')['language']).toBe('')
  })

  it('detects the language of a brand-new code block created by the same paste', () => {
    const e = mount('<p></p>')
    e.chain()
      .insertContentAt(0, {
        type: 'codeBlock',
        attrs: { language: null },
        content: [{ type: 'text', text: BASH_SNIPPET }],
      })
      .command(({ tr }) => {
        tr.setMeta('uiEvent', 'paste')
        return true
      })
      .run()

    expect(e.getAttributes('codeBlock')['language']).toBe('bash')
  })
})
