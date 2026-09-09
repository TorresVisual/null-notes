#!/usr/bin/env node
// PostToolUse hook (matcher: Edit|Write): surfaces a reminder whenever an
// edit lands under src-tauri/src/pdf/. The P4-2e freeze on that directory
// was a deliberate pause to prioritize other feature work, not a permanent
// "don't touch" rule — but it's easy to forget the freeze's own re-entry
// condition mid-edit, so this nudges toward checking it deliberately rather
// than either blindly fixing or blindly avoiding.

let input = ''
process.stdin.on('data', (chunk) => {
  input += chunk
})
process.stdin.on('end', () => {
  let payload
  try {
    payload = JSON.parse(input)
  } catch {
    process.exit(0)
  }

  const filePath = String(payload?.tool_input?.file_path ?? '').replace(/\\/g, '/')
  if (!/(^|\/)src-tauri\/src\/pdf\//.test(filePath)) process.exit(0)

  process.stderr.write(
    [
      'PDF pipeline note: P4-2e froze this directory to prioritize other feature work, not',
      'permanently — that work (P5 through P14) is now done, so the freeze is worth re-checking,',
      'not assuming. Before treating this edit as routine, weigh it against the re-entry bar:',
      'whole-document loss (dropped prose, mid-word tearing) or a bug recurring across >=2 corpus',
      'documents in notes/exercise_sheets/. If it clears the bar, proceed. If not, it likely belongs',
      'in TODO.md\'s "Filed, not fixed" list instead of a fix here.',
      '',
    ].join('\n'),
  )
  process.exit(2)
})
