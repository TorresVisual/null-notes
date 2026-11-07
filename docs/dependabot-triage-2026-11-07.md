# Dependabot triage — 2026-11-07

Closes #191. Re-triage by reachability, not severity: an alert only matters if the vulnerable code is in what we ship (the Windows installer: Rust backend + Vite bundle). The issue was filed against 30 open alerts; 15 were open when this ran.

Dispositions: **fix** (bumped), **dismissed — not used** (vulnerable code never ships or never runs here).

## Ships — fixed

| Alert | Package | Why it mattered | Action |
|---|---|---|---|
| 114 (critical), 115 (high), 116 (medium) | `zip` 4.6.1 | Direct dependency. All three are *read/extract-side* bugs (zip cloaking, symlink extraction, AES HMAC). We only *write* zips (`commands/export.rs`), so exploitability was nil — but 4.x has no patch and the old copy sat beside `tauri-plugin-updater`'s patched 9.x. | Bumped to `zip = "9"`; one lockfile copy now. `ZipFile::name()` returns a `Result` in 9.x, only the test helper needed a change. |
| 78, 79 (medium) | `@vitest/mocker` | Test runner only, but the fix was in-range. | `vitest`/`@vitest/ui`/`@vitest/coverage-v8` → `^4.1.12`. |

These close automatically once the commit reaches `main`.

## Dismissed — not used

| Alerts | Package | Reachability |
|---|---|---|
| 22 (medium) | `glib` 0.18.5 | Pulled by Tauri's `gtk` 0.18 (Linux webview only). Never compiled for Windows, the only shipped target (`cargo tree` on the host target shows no `glib`). Unfixable here: patched 0.20 needs a gtk-rs major Tauri has not adopted. Revisit if a Linux build is ever shipped. |
| 4, 7, 90 (serialize-javascript), 112 (glob), 118 (minimatch) | via `@wdio/mocha-framework`, `@wdio/cli` | E2E test tooling (`npm run test:e2e`). Not bundled by Vite, never runs against untrusted input. Fix needs a `@wdio/*` major bump (10.x). |
| 11, 18 (extract-zip), 42 (basic-ftp) | via `@wdio/cli` → `@puppeteer/browsers` | Same: browser-driver download helpers in the e2e toolchain. |
| 107 (deepmerge) | via `shadcn` | CLI codegen tool; `shadcn` is a devDependency and never imported by `src/`. Tracked by #181 (move/bump shadcn). |

Dismissed with reason `not_used` and a comment pointing here.

## Method (so the next audit does not redo it)

1. `gh api --paginate "repos/TorresVisual/null-notes/dependabot/alerts?state=open"` — note `dependency.scope` (`runtime`/`development`) and `manifest_path`.
2. `scope: development` is a hint, not proof: confirm with `npm ls <pkg> --all` that no `dependencies` entry reaches it.
3. Rust: `cargo tree -i <crate>@<ver> --target all`, then repeat *without* `--target all`. A crate present only under `--target all` is not in the Windows build.
4. Runtime hit → grep for the vulnerable API (`zip::ZipArchive`, extraction) before judging exploitability; bump anyway if cheap.
5. Dismiss with `gh api -X PATCH repos/TorresVisual/null-notes/dependabot/alerts/<n> -f state=dismissed -f dismissed_reason=not_used -f dismissed_comment="…"`.

Remaining `npm audit` findings (wdio major bump) are the same dismissed set; a `@wdio/*` 10.x upgrade would clear them if the e2e suite is ever migrated.
