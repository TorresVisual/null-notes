---
name: ci-local
description: Run locally the checks CI runs (frontend build/typecheck/lint/tests, cargo fmt/clippy/test, audits). Use before pushing to main or when asked "will CI pass" / "run the checks". This repo commits straight to main and CI only runs on pull_request or manual dispatch, so a bad push is not caught automatically.
---

Mirror of `.github/workflows/ci.yml` (`check` job). Run from the repo root unless stated. Run steps in order, stop at the first failure, show its output, and fix it. Never report "CI would pass" for a step you did not run; list skipped steps.

## Scope

Look at `git diff --name-only origin/main...HEAD` plus the working tree. If nothing under `src-tauri/` changed, skip the Rust steps; if nothing outside `src-tauri/` changed, skip the frontend steps. Say which you skipped.

## Frontend

```bash
npm run build
npm run typecheck
npm run lint
npm run test:coverage
npm audit --omit=dev --audit-level=high   # CI marks this non-blocking; report, don't fail on it
```

## Rust (from `src-tauri/`)

```bash
cargo fmt -- --check          # on failure run `cargo fmt`, then re-check
cargo clippy -- -D warnings
cargo test
cargo audit                   # CI ignores specific RUSTSEC ids with documented reasons; use the exact --ignore list in ci.yml
```

CI also builds `src-tauri/cli` and `src-tauri/context-menu-handler` with `cargo build --release`, and `cargo deny check` runs per manifest (`src-tauri/Cargo.toml`, `src-tauri/cli/Cargo.toml`, `src-tauri/context-menu-handler/Cargo.toml`). If a diff touches those crates or any `Cargo.toml`/`Cargo.lock`, run those too, from each crate's directory.

## Not reproducible here

CI also runs `gitleaks` over full history, and prepares a signing cert, the `.msix` and `pdfium.dll` (`scripts/windows/*.ps1`, `scripts/download-pdfium.ps1`). State these as unrun. Do not claim a clean secrets scan.

## Report

One line per step: pass, fail or skipped, with the first error for any failure.
