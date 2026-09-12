import { Node } from '@tiptap/core'

interface SrStateAttrs {
  due: string
  ease: string
  interval: string
  reps: string
  grade: string
  streak: string
  suspended: string
}

// A card's SM-2 schedule (P9-3), stored in the note as a plain
// `<!-- sr due=... ease=... interval=... reps=... -->` comment so it reads
// as ordinary Markdown in any other editor. Verified directly: TipTap's
// markdown pipeline renders raw markdown to an HTML string via markdown-it,
// then builds the ProseMirror doc from that HTML via `DOMParser` — which
// walks Element and Text nodes only and silently skips Comment nodes
// (nodeType 8). Left alone, a note's entire review history would vanish the
// moment it was opened and saved in this editor.
//
// Fix, the same trick `Callout.tsx` already uses for its own marker line:
// `parse.updateDOM` runs on the parsed-but-not-yet-schema'd DOM, before
// ProseMirror's own parser ever sees it. It rewrites each matching Comment
// node into a real (invisible) element that a normal `parseHTML` tag rule
// can then claim.
export const SrState = Node.create({
  name: 'srState',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      due: { default: '' },
      ease: { default: '' },
      interval: { default: '' },
      reps: { default: '' },
      grade: { default: '' },
      streak: { default: '' },
      suspended: { default: '' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="sr-state"]',
        getAttrs: (el) => ({
          due: (el as HTMLElement).getAttribute('data-due') ?? '',
          ease: (el as HTMLElement).getAttribute('data-ease') ?? '',
          interval: (el as HTMLElement).getAttribute('data-interval') ?? '',
          reps: (el as HTMLElement).getAttribute('data-reps') ?? '',
          grade: (el as HTMLElement).getAttribute('data-grade') ?? '',
          streak: (el as HTMLElement).getAttribute('data-streak') ?? '',
          suspended: (el as HTMLElement).getAttribute('data-suspended') ?? '',
        }),
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = HTMLAttributes as SrStateAttrs
    return [
      'div',
      {
        'data-type': 'sr-state',
        'data-due': attrs.due,
        'data-ease': attrs.ease,
        'data-interval': attrs.interval,
        'data-reps': attrs.reps,
        'data-grade': attrs.grade,
        'data-streak': attrs.streak,
        'data-suspended': attrs.suspended,
        style: 'display:none',
        contenteditable: 'false',
      },
    ]
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write: (s: string) => void; ensureNewLine: () => void; closeBlock: (n: unknown) => void },
          node: { attrs: SrStateAttrs },
        ) {
          const { due, ease, interval, reps, grade, streak, suspended } = node.attrs
          state.ensureNewLine()
          const gradePart = grade ? ` grade=${grade}` : ''
          const streakPart = streak ? ` streak=${streak}` : ''
          const suspendedPart = suspended === 'true' ? ' suspended=true' : ''
          state.write(`<!-- sr due=${due} ease=${ease} interval=${interval} reps=${reps}${gradePart}${streakPart}${suspendedPart} -->`)
          state.closeBlock(node)
        },
        parse: {
          updateDOM(element: HTMLElement) {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_COMMENT)
            const toReplace: Comment[] = []
            let n = walker.nextNode()
            while (n) {
              toReplace.push(n as Comment)
              n = walker.nextNode()
            }
            const pattern = /^sr\s+due=(\S+)\s+ease=(\S+)\s+interval=(\S+)\s+reps=(\S+)(?:\s+grade=(\S+))?(?:\s+streak=(\S+))?(?:\s+lapses=(\S+))?(?:\s+suspended=(\S+))?$/
            for (const comment of toReplace) {
              const match = pattern.exec(comment.data.trim())
              if (!match) continue
              const div = document.createElement('div')
              div.setAttribute('data-type', 'sr-state')
              div.setAttribute('data-due', match[1]!)
              div.setAttribute('data-ease', match[2]!)
              div.setAttribute('data-interval', match[3]!)
              div.setAttribute('data-reps', match[4]!)
              div.setAttribute('data-grade', match[5] ?? '')
              div.setAttribute('data-streak', match[6] ?? '')
              div.setAttribute('data-suspended', match[8] ?? '')
              comment.replaceWith(div)
            }
          },
        },
      },
    }
  },
})
