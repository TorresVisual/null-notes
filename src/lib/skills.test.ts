import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { KNOWN_NAMES } from '@/lib/baseFunctions'

const ROOT = `${process.cwd().replaceAll('\\', '/')}/`

function skillText(skill: string, file = 'SKILL.md'): string {
  return readFileSync(`${ROOT}skills/${skill}/${file}`, 'utf8')
}

function frontmatterField(text: string, key: string): string | undefined {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ''
  return new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(block)?.[1]?.trim()
}

describe('skill structure', () => {
  it('every skill dir has a SKILL.md whose frontmatter name equals the dir and has a description', () => {
    const dirs = readdirSync(`${ROOT}skills`, { withFileTypes: true }).filter((d) => d.isDirectory())
    expect(dirs.length).toBeGreaterThan(0)
    for (const dir of dirs) {
      const text = skillText(dir.name)
      expect(frontmatterField(text, 'name'), dir.name).toBe(dir.name)
      expect(frontmatterField(text, 'description'), dir.name).toBeTruthy()
    }
  })
})

describe('nullnotes-cli', () => {
  it('lists every command row of docs/cli.md', () => {
    const cli = readFileSync(`${ROOT}docs/cli.md`, 'utf8')
    const section = /^## Commands\r?\n([\s\S]*?)(?=^## )/m.exec(cli)?.[1] ?? ''
    const rows = section
      .split(/\r?\n/)
      .filter((l) => l.startsWith('|'))
      .slice(2)
      .map((l) => l.split('|')[2]?.trim() ?? '')
    expect(rows.length).toBe(5)
    const text = skillText('nullnotes-cli')
    for (const row of rows) expect(text, row).toContain(row)
  })

  it('documents exit codes 0 to 7', () => {
    const text = skillText('nullnotes-cli')
    for (let n = 0; n <= 7; n++) {
      expect(text.includes(`\`${n}\``) || text.includes(`| ${n} |`), `exit ${n}`).toBe(true)
    }
  })

  it('pins its agent rules', () => {
    const text = skillText('nullnotes-cli')
    expect(text).toMatch(/exit 5/i)
    expect(text).toMatch(/wait|write somewhere else/i)
    expect(text).toMatch(/read .* first/i)
    expect(text).toMatch(/frontmatter/i)
    expect(text).toMatch(/property set/)
    expect(text).toMatch(/data, (never|not) .*instruction/i)
    expect(text).toMatch(/--content -/)
  })
})

describe('null-notes-markdown', () => {
  it('pins path encoding, not-supported list and tags rule', () => {
    const text = skillText('null-notes-markdown')
    expect(text).toMatch(/URL-encod/i)
    expect(text).toMatch(/%20/)
    const notSupported = text.split(/^## Not supported/m)[1] ?? ''
    for (const gap of ['%%', '^block-id', '![[img|300]]', '#page=', 'aliases']) {
      expect(notSupported, gap).toContain(gap)
    }
    expect(text).toMatch(/frontmatter.*tags/i)
    expect(text).toMatch(/property set/)
    expect(text).toMatch(/data, (never|not) .*instruction/i)
    expect(text).toMatch(/nullnotes-cli/)
  })
})

describe('brainstorm-canvas', () => {
  it('pins the append-only protocol', () => {
    const text = skillText('brainstorm-canvas')
    const description = frontmatterField(text, 'description') ?? ''
    expect(description).toContain('visual brainstorming')
    expect(description).toContain('.canvas')
    expect(text).toMatch(/never (modify|delete)/i)
    expect(text).toMatch(/max.*pass.*\+ ?1|pass.*max.*\+ ?1/i)
    expect(text).toMatch(/atomic|temp file.*rename/i)
    expect(text).toMatch(/summary/i)
    expect(text).toMatch(/does not exist/i)
    expect(text).toMatch(/ask/i)
    expect(text).toContain('docs/brainstorm/')
    const format = skillText('brainstorm-canvas', 'references/format.md')
    expect(format).toContain('"pass"')
    expect(format).toContain('"author"')
    expect(format).toContain('Pass <n> ·')
  })
})

describe('null-notes-bases', () => {
  it('names every evaluator function', () => {
    const text = skillText('null-notes-bases')
    for (const name of KNOWN_NAMES) expect(text, name).toContain(`\`${name}\``)
  })

  it('pins the workflow', () => {
    const text = skillText('null-notes-bases')
    expect(text).toMatch(/unsupported/i)
    expect(text).toMatch(/re-read/i)
    expect(text).toMatch(/table.*list.*cards.*kanban.*map/is)
    expect(text).toMatch(/validate/i)
    expect(text).toMatch(/exactly one key/i)
    expect(text).toMatch(/\.base/)
  })
})

describe('plugin manifests', () => {
  const read = (file: string): Record<string, unknown> =>
    JSON.parse(readFileSync(`${ROOT}.claude-plugin/${file}`, 'utf8')) as Record<string, unknown>

  it('are valid and license-free', () => {
    const plugin = read('plugin.json')
    expect(plugin.name).toBe('null-notes')
    expect(plugin.version).toBe('0.1.0')
    expect((plugin.author as { name: string }).name).toBe('TorresVisual')
    expect(plugin).not.toHaveProperty('license')

    const marketplace = read('marketplace.json')
    const plugins = marketplace.plugins as { name: string; source: string }[]
    expect(plugins).toHaveLength(1)
    expect(plugins[0]?.name).toBe('null-notes')
    expect(plugins[0]?.source).toBe('./')
    expect(marketplace).not.toHaveProperty('license')
  })
})
