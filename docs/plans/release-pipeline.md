# Release Pipeline Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** A local `npm run release -- patch|minor|major` command that bumps the version everywhere it's duplicated, tags, and pushes; a tag push then triggers a GitHub Actions workflow that reruns CI and, if it passes, builds and publishes the Windows installer to a GitHub Release.

**Architecture:** A pure-function core (`updateTauriConf`, `updateCargoToml`) handles the two non-npm version rewrites and is unit tested with vitest; a thin CLI wrapper in the same file shells out to `npm version`, `git`, orchestrating the bump/commit/tag/push. `ci.yml`'s existing `check` job gains a `workflow_call` trigger so a new `release.yml` can reuse it as a gate before building with `tauri-action`.

**Tech Stack:** Node (ESM, matches `package.json`'s `"type": "module"`), vitest (already a dependency, default include pattern already picks up `*.test.ts` anywhere in the repo), GitHub Actions, `tauri-apps/tauri-action@v0`.

**Spec:** [docs/specs/release-pipeline-design.md](../specs/release-pipeline-design.md)

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [x] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [x] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- Version lives in three places today, all at `0.1.0`: `package.json`, `src-tauri/tauri.conf.json` (`version` top-level key), `src-tauri/Cargo.toml` (`[package] version = "..."` on its own line — the only line in that file matching `^version = ".*"$`).
- No TOML parser dependency exists in this repo — `Cargo.toml`'s version is rewritten with a regex, not a parser.
- `Cargo.lock`'s own-package version entry is left untouched by the bump script; cargo rewrites it silently on the next build and no CI step passes `--locked`.
- `ci.yml`'s existing `pull_request`/`workflow_dispatch` triggers and steps must not change behavior — only a `workflow_call` trigger is added.
- The release workflow only targets Windows (`runs-on: windows-latest`), matching `ci.yml` and `tauri.conf.json`'s Windows-specific bundle resources (NSIS hooks, MSIX resource, context-menu DLL).
- New GitHub Release is published directly (not draft) — the bump command itself is the human confirmation step.

---

### Task 1: Pure version-sync functions + tests

**Files:**
- Create: `scripts/release.mjs`
- Test: `scripts/release.test.ts`

**Interfaces:**
- Produces: `updateTauriConf(content: string, version: string): string` — parses `content` as JSON, sets `.version`, returns `JSON.stringify(json, null, 2) + '\n'`.
- Produces: `updateCargoToml(content: string, version: string): string` — replaces the line matching `/^version = ".*"$/m` with `version = "${version}"`, returns the full file content.
- Both are named exports from `scripts/release.mjs` so Task 2's CLI code and the test file both import them.

- [ ] **Step 1: Write the failing tests**

```ts
// scripts/release.test.ts
import { describe, it, expect } from 'vitest'
import { updateTauriConf, updateCargoToml } from './release.mjs'

describe('updateTauriConf', () => {
  it('replaces the version field and preserves formatting', () => {
    const input = JSON.stringify({ productName: 'null-notes', version: '0.1.0', app: {} }, null, 2) + '\n'
    const output = updateTauriConf(input, '0.2.0')
    expect(JSON.parse(output).version).toBe('0.2.0')
    expect(output).toBe(JSON.stringify({ productName: 'null-notes', version: '0.2.0', app: {} }, null, 2) + '\n')
  })
})

describe('updateCargoToml', () => {
  it('replaces only the top-level package version line', () => {
    const input = [
      '[package]',
      'name = "null-notes"',
      'version = "0.1.0"',
      'edition = "2021"',
      '',
      '[dependencies]',
      'serde = { version = "1.0", features = ["derive"] }',
      '',
    ].join('\n')
    const output = updateCargoToml(input, '0.2.0')
    expect(output).toContain('\nversion = "0.2.0"\n')
    expect(output).toContain('serde = { version = "1.0", features = ["derive"] }')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/release.test.ts`
Expected: FAIL — `scripts/release.mjs` does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

```js
// scripts/release.mjs
export function updateTauriConf(content, version) {
  const json = JSON.parse(content)
  json.version = version
  return JSON.stringify(json, null, 2) + '\n'
}

export function updateCargoToml(content, version) {
  return content.replace(/^version = ".*"$/m, `version = "${version}"`)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/release.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/release.mjs scripts/release.test.ts
git commit -m "feat(release): add version-sync functions for tauri.conf.json and Cargo.toml"
```

---

### Task 2: CLI orchestration (bump, commit, tag, push)

**Files:**
- Modify: `scripts/release.mjs` (append CLI entry point below the exports from Task 1)
- Modify: `package.json` (add `"release"` script)

**Interfaces:**
- Consumes: `updateTauriConf`, `updateCargoToml` from Task 1 (same file, no import needed).
- Produces: `npm run release -- patch|minor|major` as the command a developer runs. No other task depends on this CLI's internals.

- [ ] **Step 1: Append the CLI orchestration to `scripts/release.mjs`**

```js
// --- CLI entry point (below the Task 1 exports) ---
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' })
}

function main() {
  const bump = process.argv[2]
  if (!['patch', 'minor', 'major'].includes(bump)) {
    console.error('Usage: npm run release -- patch|minor|major')
    process.exit(1)
  }

  // Bumps package.json only — no commit/tag, this script controls that.
  run(`npm version ${bump} --no-git-tag-version`)

  const { version } = JSON.parse(readFileSync('package.json', 'utf8'))

  writeFileSync(
    'src-tauri/tauri.conf.json',
    updateTauriConf(readFileSync('src-tauri/tauri.conf.json', 'utf8'), version),
  )
  writeFileSync(
    'src-tauri/Cargo.toml',
    updateCargoToml(readFileSync('src-tauri/Cargo.toml', 'utf8'), version),
  )

  run('git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml')
  run(`git commit -m "chore: release v${version}"`)
  run(`git tag v${version}`)
  run('git push --follow-tags')

  console.log(`Released v${version}`)
}

main()
```

- [ ] **Step 2: Add the npm script**

Edit `package.json`'s `"scripts"` block (after `"test:e2e"`):

```json
    "test:e2e": "wdio run e2e/wdio.conf.ts",
    "release": "node scripts/release.mjs"
```

- [ ] **Step 3: Verify the existing unit tests still pass**

Run: `npx vitest run scripts/release.test.ts`
Expected: PASS (2 tests) — confirms the new `import`/CLI code at the bottom of the file didn't break the Task 1 exports (ESM top-level `import` statements are hoisted, so ordering in the file doesn't matter, but this catches a syntax error before it reaches a real release).

- [ ] **Step 4: Manual dry run (this part shells out to git/npm — no automated test covers the orchestration itself)**

On a scratch branch:

```bash
git checkout -b release-script-dry-run
npm run release -- patch
git log -1 --stat        # expect one commit touching all three version files
git tag -l "v*"          # expect the new tag
git checkout main
git branch -D release-script-dry-run
git tag -d <the tag just created>
```

Confirm the commit message is `chore: release vX.Y.Z`, all three files show the bumped version, and the tag matches. Do not push from this dry run.

- [ ] **Step 5: Commit**

```bash
git add scripts/release.mjs package.json
git commit -m "feat(release): add release CLI (bump, commit, tag, push)"
```

---

### Task 3: Make `ci.yml` reusable

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: the `check` job becomes callable via `uses: ./.github/workflows/ci.yml` from `release.yml` (Task 4).

- [ ] **Step 1: Add the `workflow_call` trigger**

In `.github/workflows/ci.yml`, change:

```yaml
on:
  pull_request:
  workflow_dispatch:
```

to:

```yaml
on:
  pull_request:
  workflow_dispatch:
  workflow_call:
```

No other change to this file — the `check` job's steps stay exactly as they are.

- [ ] **Step 2: Verify YAML is still valid**

Run: `npx yaml-lint .github/workflows/ci.yml 2>/dev/null || node -e "require('yaml').parse(require('fs').readFileSync('.github/workflows/ci.yml','utf8'))"`

If neither `yaml-lint` nor the `yaml` package is available locally, instead verify by eye that indentation matches the surrounding two keys exactly (3-space-aligned block under `on:`), since a push will otherwise silently fail to parse and both this workflow and the caller in Task 4 would stop triggering.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: make the check workflow callable via workflow_call"
```

---

### Task 4: `release.yml` — tag-triggered build and publish

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `.github/workflows/ci.yml`'s `check` job (Task 3) as a reusable workflow.

- [ ] **Step 1: Write the workflow**

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  checks:
    uses: ./.github/workflows/ci.yml

  release:
    needs: checks
    runs-on: windows-latest

    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4

      - uses: dtolnay/rust-toolchain@stable

      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'null-notes ${{ github.ref_name }}'
```

- [ ] **Step 2: Verify YAML is well-formed**

Same check as Task 3 Step 2, applied to `.github/workflows/release.yml`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add tag-triggered release workflow (build + publish via tauri-action)"
```

---

### Task 5: End-to-end verification against the real tag flow

**Files:** none (verification only)

- [ ] **Step 1: Push a real bump and watch the workflow**

```bash
npm run release -- patch
```

This pushes both the commit and the `vX.Y.Z` tag (from Task 2's `git push --follow-tags`).

- [ ] **Step 2: Confirm on GitHub**

```bash
gh run list --workflow=release.yml --limit 1
gh run watch
```

Expected: the `checks` job passes, then `release` runs `tauri-action` and completes.

- [ ] **Step 3: Confirm the Release was published**

```bash
gh release view v<version>
```

Expected: a published (non-draft) release on `TorresVisual/null-notes` with the Windows installer attached.

- [ ] **Step 4: Close the issue**

```bash
gh issue close 84 --comment "Released as v<version> via the new tag-triggered pipeline: $(gh release view v<version> --json url -q .url)"
```
