import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A fixed name, not a randomly generated temp dir: wdio.conf.ts gets
// evaluated in more than one Node process (the CLI launcher and each
// @wdio/local-runner worker), so a per-evaluation mkdtempSync() call would
// hand different processes different directories. A constant path lets every
// evaluation agree on the same location without any cross-process
// coordination. mkdirSync is idempotent — safe to call from every process
// that imports this module, and never wipes content a prior call wrote.
export const fixtureWorkspace = join(tmpdir(), 'null-notes-e2e-fixture')

mkdirSync(fixtureWorkspace, { recursive: true })
