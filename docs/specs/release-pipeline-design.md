# null-notes — Release Pipeline Design

**Date:** 2026-09-13
**Scope:** closes #84

---

## Problem

Version is hardcoded at `0.1.0` independently in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` — never bumped, no single source of truth. No git tags exist, no GitHub Releases have been published. `npm run tauri build` produces an installer locally but nothing bumps the version or ships it anywhere.

---

## Design

### 1. Version bump script

`scripts/release.mjs`, run as `npm run release -- patch|minor|major`.

1. `npm version <bump> --no-git-tag-version` bumps `package.json` only (explicitly no commit, no tag — the script controls that step).
2. Read the resulting version back out of `package.json`.
3. Write that version into `src-tauri/tauri.conf.json`'s top-level `version` field (JSON parse/stringify — the file is already read as JSON elsewhere in the codebase, e.g. by Tauri itself).
4. Write that version into `src-tauri/Cargo.toml`'s `[package] version = "..."` line via a regex replace (no TOML parser dependency exists in this repo; the line has a fixed, simple shape).
5. `git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml`, commit `chore: release vX.Y.Z`.
6. `git tag vX.Y.Z`.
7. `git push --follow-tags`.

`Cargo.lock`'s own-package version entry is left untouched. Cargo rewrites it silently on the next `cargo build`/`cargo check`, and no CI step passes `--locked`, so a momentarily stale lock entry has no effect.

This is the one manual step a developer runs to cut a release. It is a local Node script (`tsx`/plain Node, matching the repo's existing `tsx` devDependency), not a GitHub Actions workflow — the trigger for CI is the tag it pushes, not the script itself.

### 2. `ci.yml` becomes reusable

Add `workflow_call:` alongside the existing `pull_request:` / `workflow_dispatch:` triggers on `check`. No behavior change to the existing triggers or steps — this only adds a third way to invoke the same job.

### 3. New `release.yml`

Trigger: `on: push: tags: ['v*']`.

**Job `checks`:** `uses: ./.github/workflows/ci.yml`. Reruns the existing gate (typecheck, lint, vitest, cargo fmt --check, cargo clippy -D warnings, cargo test, cargo audit) against the tagged commit. Necessary because this repo commits straight to `main` with no required PR check — a tag could otherwise point at an unverified commit.

**Job `release`:** `needs: checks`, `runs-on: windows-latest`, `permissions: contents: write`.

Steps: checkout, Rust toolchain + `Swatinem/rust-cache` (mirrors `ci.yml`), Node setup + `npm ci`, then `tauri-apps/tauri-action@v0` with `tagName: ${{ github.ref_name }}` and `releaseName: 'null-notes ${{ github.ref_name }}'`. The action runs `npm run tauri build`, collects the Windows bundle(s) per `tauri.conf.json`'s `bundle.targets: "all"`, and attaches them to a new GitHub Release published (not draft) on the pushed tag.

---

## Data Flow

```
developer:
  npm run release -- patch
    → bump package.json, tauri.conf.json, Cargo.toml
    → commit + tag vX.Y.Z + push --follow-tags

GitHub Actions (on tag push):
  release.yml
    → checks: ci.yml (workflow_call) — typecheck/lint/test/clippy/fmt/audit
    → release (needs: checks): tauri-action
        → npm run tauri build
        → upload installer(s) to GitHub Release vX.Y.Z
```

---

## Error Handling

- If `checks` fails, `release` never runs — no partial/broken release is published. The pushed tag stays, pointing at a commit that failed CI; re-tagging after a fix means bumping again (acceptable — this mirrors the existing manual-recovery pattern in `format.yml`).
- The bump script does not attempt to undo a partial bump (e.g. `package.json` bumped but `git push` rejected) — normal `git status`/`git reset` recovery applies, matching how the rest of this repo handles local script failures (no rollback machinery elsewhere).

---

## What Is Explicitly Out of Scope

- macOS/Linux builds — `bundle.targets: "all"` already resolves to Windows-only artifacts (NSIS installer, MSIX resource, context-menu DLL are Windows-specific), and CI itself only runs `windows-latest`.
- Changelog generation — release body is `tauri-action`'s default (tag name), not auto-generated notes.
- Draft-and-review before publish — the release is published directly; the bump command is itself the human confirmation step.
- A rollback/yank command for a bad release — not requested, no existing pattern to extend.
