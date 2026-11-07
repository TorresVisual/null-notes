import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { roundTrip } from './roundTripHarness'

const CORPUS_DIR = process.env.NULL_NOTES_MD_CORPUS

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return markdownFiles(path)
    return entry.name.endsWith('.md') ? [path] : []
  })
}

function firstDifference(a: string, b: string): string {
  const left = a.split('\n')
  const right = b.split('\n')
  const line = left.findIndex((text, i) => text !== right[i])
  const at = line === -1 ? left.length : line
  return `first difference at line ${at + 1}:\n- ${left[at] ?? '<end>'}\n+ ${right[at] ?? '<end>'}`
}

function expectStable(source: string): void {
  const once = roundTrip(source)
  const twice = roundTrip(once)
  expect(twice, firstDifference(once, twice)).toBe(once)
}

describe.skipIf(!CORPUS_DIR)('corpus idempotence (NULL_NOTES_MD_CORPUS)', () => {
  const files = CORPUS_DIR ? markdownFiles(CORPUS_DIR) : []
  it.each(files)('%s is stable after one save', (file) => {
    expectStable(readFileSync(file, 'utf-8'))
  })
})

const word = fc.stringMatching(/^[a-z][a-z0-9 ]{0,10}[a-z0-9]$/)

const listItems = (depth: number): fc.Arbitrary<string[]> =>
  fc.array(
    fc.tuple(word, depth > 0 ? fc.option(listItems(depth - 1), { nil: undefined }) : fc.constant(undefined)),
    { minLength: 1, maxLength: 3 },
  ).map((items) =>
    items.flatMap(([text, children]) => [
      `- ${text}`,
      ...(children ?? []).map((line) => `  ${line}`),
    ]),
  )

const list = listItems(2).map((lines) => lines.join('\n'))

const table = fc
  .tuple(fc.array(word, { minLength: 1, maxLength: 3 }), fc.nat({ max: 3 }))
  .chain(([header, rowCount]) =>
    fc.array(fc.array(word, { minLength: header.length, maxLength: header.length }), {
      minLength: rowCount,
      maxLength: rowCount,
    }).map((rows) =>
      [header, header.map(() => '---'), ...rows].map((cells) => `| ${cells.join(' | ')} |`).join('\n'),
    ),
  )

const fence = fc
  .tuple(fc.constantFrom('', 'js', 'py'), fc.array(fc.stringMatching(/^[ -~]{0,20}$/), { minLength: 1, maxLength: 4 }))
  .map(([lang, lines]) => {
    const longestRun = Math.max(2, ...lines.flatMap((line) => (line.match(/`+/g) ?? []).map((run) => run.length)))
    const ticks = '`'.repeat(longestRun + 1)
    return `${ticks}${lang}\n${lines.join('\n')}\n${ticks}`
  })

const callout = fc
  .tuple(fc.constantFrom('note', 'warning', 'tip'), fc.constantFrom('', '+', '-'), fc.option(word, { nil: undefined }), word)
  .map(([kind, fold, title, body]) => `> [!${kind}]${fold}${title ? ` ${title}` : ''}\n> ${body}`)

const document = fc
  .array(fc.oneof(word, list, table, fence, callout), { minLength: 1, maxLength: 5 })
  .map((blocks) => blocks.join('\n\n'))

describe('generated documents', () => {
  it('parse → serialize is stable after one save', () => {
    fc.assert(fc.property(document, expectStable), { numRuns: 50 })
  }, 60_000)
})
