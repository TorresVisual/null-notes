#!/usr/bin/env node
// Converts every PDF in notes/exercise_sheets/ via the pdf::dump::tests::dump_markdown
// diagnostic (see src-tauri/src/pdf/dump.rs) and writes the resulting Markdown next to
// the corpus's existing hand-made "(Notion).md" references, so the two can be read
// side by side. This mirrors the manual workflow described in TODO.md's P4-2b-through-d
// entries (convert a real document, diff against a hand-made reference) instead of
// inventing a new comparison mechanism.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..', '..', '..')
const corpusDir = path.join(repoRoot, 'notes', 'exercise_sheets')
const tauriDir = path.join(repoRoot, 'src-tauri')
const outDir = path.join(corpusDir, '.pdf-corpus-check')

if (!existsSync(corpusDir)) {
  console.log(
    `No corpus at ${corpusDir} — this is the maintainer's real coursework material ` +
      '(notes/ is gitignored, so a fresh clone starts without it). Nothing to check.'
  )
  process.exit(0)
}

const pdfs = readdirSync(corpusDir)
  .filter((f) => f.toLowerCase().endsWith('.pdf'))
  .sort()

if (pdfs.length === 0) {
  console.log(`No .pdf files found in ${corpusDir}.`)
  process.exit(0)
}

mkdirSync(outDir, { recursive: true })

/** Trims cargo test's own harness lines, keeping just what dump_markdown printed. */
function extractCapturedOutput(raw) {
  const startMarker = 'running 1 test'
  const start = raw.indexOf(startMarker)
  if (start === -1) return raw
  const afterHeader = raw.indexOf('\n', start) + 1
  const end = raw.indexOf('\ntest pdf::dump::tests::dump_markdown', afterHeader)
  return end === -1 ? raw.slice(afterHeader) : raw.slice(afterHeader, end)
}

const results = []

for (const pdf of pdfs) {
  const pdfPath = path.join(corpusDir, pdf)
  const baseName = pdf.replace(/\.pdf$/i, '')
  const referencePath = path.join(corpusDir, `${baseName} (Notion).md`)
  const outPath = path.join(outDir, `${baseName}.out.md`)

  process.stdout.write(`Converting ${pdf} ... `)

  const proc = spawnSync(
    'cargo',
    ['test', 'dump_markdown', '--', '--ignored', '--nocapture'],
    {
      cwd: tauriDir,
      env: { ...process.env, NULL_NOTES_PDF: pdfPath },
      encoding: 'utf8',
      timeout: 120_000,
    }
  )

  if (proc.error || proc.status !== 0) {
    console.log('FAILED')
    console.log(proc.stderr || proc.error?.message || `exit code ${proc.status}`)
    results.push({ pdf, outPath: null, referencePath, ok: false })
    continue
  }

  const markdown = extractCapturedOutput(proc.stdout)
  writeFileSync(outPath, markdown, 'utf8')
  console.log('done')
  results.push({ pdf, outPath, referencePath, ok: true })
}

console.log('\n--- Summary ---')
for (const r of results) {
  if (!r.ok) {
    console.log(`✗ ${r.pdf} — conversion failed, see output above`)
    continue
  }
  const hasReference = existsSync(r.referencePath)
  console.log(
    `✓ ${r.pdf} -> ${path.relative(repoRoot, r.outPath)}` +
      (hasReference
        ? ` (compare against ${path.relative(repoRoot, r.referencePath)})`
        : ' (no hand-made reference to compare against)')
  )
}
