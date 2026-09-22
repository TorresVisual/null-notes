import type { HLJSApi, Language, LanguageFn } from 'highlight.js'

// A hljs/lowlight grammar for the informal pseudocode CS coursework uses —
// no single standard exists, so this covers the CLRS/textbook keyword set
// (control flow, I/O, common types) rather than any one language's grammar.
const KEYWORDS = [
  'algorithm', 'begin', 'end', 'if', 'then', 'else', 'elseif', 'endif',
  'while', 'do', 'endwhile', 'for', 'to', 'downto', 'step', 'endfor',
  'repeat', 'until', 'function', 'procedure', 'return', 'input', 'output',
  'print', 'read', 'write', 'break', 'continue', 'case', 'switch',
  'endswitch', 'call', 'and', 'or', 'not', 'in', 'is',
]

const LITERALS = ['true', 'false', 'null', 'none', 'nil']

const TYPES = ['array', 'integer', 'string', 'boolean', 'real', 'float', 'char', 'list', 'set', 'map']

function pseudocode(hljs: HLJSApi): Language {
  return {
    name: 'Pseudocode',
    case_insensitive: true,
    keywords: {
      keyword: KEYWORDS,
      literal: LITERALS,
      type: TYPES,
    },
    contains: [
      hljs.COMMENT('//', '$'),
      hljs.COMMENT('#', '$'),
      hljs.QUOTE_STRING_MODE,
      hljs.APOS_STRING_MODE,
      hljs.C_NUMBER_MODE,
      {
        className: 'title.function.invoke',
        begin: /[A-Za-z_][\w-]*(?=\s*\()/,
      },
    ],
  }
}

export const pseudocodeLanguage: LanguageFn = pseudocode
