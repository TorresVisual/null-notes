# Engineering Audit — 2026-11-07

Commit audited: `63a221d` · Previous audit: none (first engineering audit)

## 1. Executive summary

null-notes is engineered well above what a solo student project usually is: documented data-integrity invariants, an atomic save path, a hardened process-execution surface, 1,242 Rust tests, 238 frontend test files and a real-binary e2e suite. The security audit of 2026-09-07 was worked through to the end (issues #1–#13 all closed). The weak point is not the code, it is the **safety net around it**: CI runs only on pull requests, release tags and manual dispatch, but all 1,241 of 1,247 commits go straight to `main`, so lint, tests and `cargo audit` effectively run once per release, after the tag already exists. 12 of the last 19 `Release` runs failed, the three failures inspected all at `npm run lint`, and lint fails on `main` right now. The second theme is **silent-corruption surface**: nine Markdown round-trip corruption bugs (#167–#175) were found one at a time, each fixed with one example test, and the regression corpus for the "frozen" PDF pipeline is untracked on one disk. Do first: run CI on push to `main` (F-01), then add a round-trip property/corpus test (F-03) and make the index database self-healing (F-05).

## 2. Inspection coverage

| Area | Status | What was read |
|---|---|---|
| CI/CD workflows | Inspected | all 7 files in `.github/workflows/`; run history via `gh run list` / `gh run view` (Release and CI runs, failed steps) |
| Release process | Inspected | `scripts/release.mjs`, `release.yml`, `publish-mirror.yml`, `tauri.conf.json`, `tauri.release.conf.json` |
| Testing | Partial | counted tests (`grep`), read `markdownRoundTrip.test.ts` head, `e2e/README.md`, `wdio.conf.ts`, `vitest.config.ts`. Did **not** run the Rust or e2e suites. |
| Lint / typecheck | Inspected | ran `npm run lint` (1 error, 21 warnings) and `npm run typecheck` (clean) |
| Dependencies | Inspected | `npm audit --omit=dev`, `package.json`, `Cargo.toml`, `ci.yml` audit ignore list. Did not run `cargo audit` locally. |
| Security | Partial | relied on the 2026-09-07 audit; re-checked CSP (`tauri.conf.json`), `commands/CLAUDE.md`, DOMPurify usage. Not re-audited end to end. |
| Data / save path | Inspected | `write_atomic` (`commands/notes.rs:1094`), `db/mod.rs`, `db/schema.rs`, `lib.rs` startup |
| Observability | Inspected | `commands/error_log.rs`, panic hook in `lib.rs`, `ErrorBoundary` |
| Performance | Partial | roadmap performance budget, issue #146. No profiling or benchmarks exist to read. |
| PDF pipeline | Partial | `pdf/CLAUDE.md`, `.gitignore`, `git ls-files`. Corpus contents not examined. |
| Mobile / web (iOS, Android, `build:web`) | Not inspected | only the manual iOS workflows were skimmed |
| Docs / process | Inspected | `CLAUDE.md` files, `ROADMAP.md` §1/§5/§7, `docs/` listing, repo-root file list, open issues |
| Installer / NSIS / MSIX scripts | Not inspected | `scripts/windows/*`, `windows/hooks.nsh` |

Prior audits relied on rather than redone: [security-audit-2026-09-07.md](security-audit-2026-09-07.md), [accessibility-audit.md](accessibility-audit.md), [ui-consistency-audit.md](ui-consistency-audit.md), [file-architecture.md](file-architecture.md).

## 3. Architecture overview

Tauri 2 shell; Rust backend with one file per command domain (`commands/`), a pdfium-free PDF layout module, and an SQLite index (`db/`); React 19 + TipTap 3 frontend. Two stores with different guarantees: **notes are the source of truth** (plain `.md` plus sidecar folders inside the workspace, synced by the user's Git/Syncthing) and **`index.db` is rebuildable** (in the OS app-data dir, never synced). The save path is deliberately split: `save_note` writes the file via `write_atomic` (temp file → `sync_all` → rename, `notes.rs:1107-1123`) and does no DB work; `reindex_note` updates FTS/tags/links later. A file watcher reports the app's own writes back, so conflict detection compares disk against both buffer and last-written content. A local named-pipe CLI (`cli_server/`) is a third entry point guarded by an allowlist `match`. Release goes: `npm run release` → bump + commit + tag + push → tag triggers `release.yml` (CI as a reusable workflow, then `tauri-action` builds a **draft** release) → `publish-mirror.yml` copies published assets to a public repo that the in-app updater reads.

## 4. Maturity matrix

| Discipline | Score 0–5 | Δ | Evidence |
|---|---|---|---|
| Architecture | 4 | n/a | Invariants written down and honoured (save path, storage boundary, process rules); oversized files already tracked in `file-architecture.md` |
| Code quality | 3 | n/a | strict TS, 3 `any` in non-test code, ~19 `unwrap/expect` in non-test Rust; but lint fails on `main` today and the no-`unwrap` rule is convention, not a clippy lint |
| Testing & QA | 2 | n/a | Large suites exist, but they run only at release; no coverage tracking, no property tests, PDF corpus untracked. Would be 3–4 if it ran on every push. |
| Security | 4 | n/a | CSP set, allowlisted CLI, no-shell launchers, DOMPurify sink; all prior findings closed. One open dependency bump (F-06). |
| CI/CD & release | 2 | n/a | Good release mechanics (draft release, signed updater, mirror) but gate runs late; 12/19 release runs failed |
| Observability & reliability | 2 | n/a | Local error log + panic hook + ErrorBoundary; log unbounded, no version/OS in output (#145), startup `expect` on DB |
| Developer experience | 3 | n/a | `npm run release`, e2e README, `CLAUDE.md` hierarchy, graph tooling; toolchains unpinned |
| Dependency & supply chain | 2 | n/a | `cargo audit` in CI with reasoned ignores (good); no `npm audit`, no Dependabot, actions on mutable tags |
| Workflow / process | 2 | n/a | Issues well used; direct-to-`main`, no required checks, no PR/issue templates |
| Performance | 2 | n/a | Budget stated ("sub-100 ms at a few hundred notes"), no benchmark; #146 open |
| Data management | 3 | n/a | Atomic writes, rebuildable index, trash, git automation; no schema versioning, no corrupt-index recovery |
| Documentation | 4 | n/a | Decision records, specs, per-area `CLAUDE.md`; two verified stale statements (F-11) |

## 5. Detailed findings

### F-01 · CI never runs on the branch all work lands on
- **Discipline / Status:** CI/CD · Weak
- **Current state:** `ci.yml` triggers are `pull_request`, `workflow_dispatch`, `workflow_call`. `release.yml` calls it on `v*` tags. The repo has 7 merge commits and 1,241 of 1,247 commits by one author, committed straight to `main`.
- **Evidence:** `.github/workflows/ci.yml:3-6`; `release.yml:9-14`; `gh run list --workflow Release` → 12 failure, 6 success, 1 cancelled; `gh run view` on the three most recent failures → failed step `Run npm run lint`; `npm run lint` today → `src/components/SettingsPanel.tsx:441 error react/no-unescaped-entities`.
- **Gap:** Lint, `cargo clippy`, `cargo fmt --check`, `cargo test`, `cargo audit` and the vitest suite are checked once per release, after `npm run release` has already committed, tagged and pushed. A red check blocks a release but also leaves a pushed tag and a version-bump commit that need `release retag`. `CLAUDE.md` knows this ("a bad push isn't caught automatically") and relies on remembering to run checks locally.
- **Why it matters here:** the top product principle is "the file on disk is always safe". The checks that guard it only run when you are trying to ship, which is the worst time to find a break, and a regression sits on `main` for days before anyone is told.
- **How mature teams approach it:** CI on every push to the trunk plus branch protection that requires it; for solo work, often a fast local pre-push hook as well.
- **Recommendation:** add `push: branches: [main]` to `ci.yml`. If Windows runner minutes are a worry, split a fast Ubuntu job (`lint`, `typecheck`, vitest) from the slow Windows job and run the slow one on push only when `src-tauri/**` changed (`paths:`). Fix the one lint error first so the first run is green. Optionally add a `pre-push` hook running `npm run lint && npm run typecheck`.
- **Priority / Effort / Learning value:** High · S · High

### F-02 · Release is "tag first, test second"
- **Discipline / Status:** CI/CD · Partial
- **Current state:** `scripts/release.mjs` does `npm version`, commit, tag, `git push --follow-tags`; only then does the tag-triggered workflow run checks. Failure recovery is `release retag`, which force-pushes the tag.
- **Evidence:** `scripts/release.mjs` (main(): commit → tag → push); `release.yml:13-15` (`checks` job); `retag()` uses `git push --force origin <tag>`. Mitigations that are good: `releaseDraft: true` (`release.yml:89`), and `assertRetaggable` refuses to retag a published release.
- **Gap:** with F-01 fixed this mostly disappears (the commit being tagged is already green). Remaining: nothing runs the built installer before publishing a draft, so the first launch of a release build is the maintainer's manual click (see F-04).
- **Why it matters here:** an auto-updater turns "published" into "installed on every machine within a day". There is no rollback; the only recovery for a bad release is fix-forward.
- **How mature teams approach it:** gate the tag on green `main`; smoke-test the produced artifact; staged rollout or channels when the audience justifies it.
- **Recommendation:** have `release.mjs` refuse to tag unless `gh run list --branch main --limit 1` for `HEAD` is green (S). Keep drafts, and write the "checklist before pressing Publish" (launch installer, open workspace, save a note, update-from-previous) into `docs/` (S).
- **Priority / Effort / Learning value:** Medium · S · Medium

### F-03 · Markdown round-trip is the corruption surface, tested one bug at a time
- **Discipline / Status:** Testing · Partial
- **Current state:** `markdownRoundTrip.test.ts` holds example-based tests, one `describe` per fixed issue (#167 code fences, #168 HTML comments, #169 escaped pipes, #170 footnotes, #171 escaped wiki-links, #172 flashcard comments, #173 entities…). Issues #167–#175 are nine round-trip bugs where saving silently rewrote the note.
- **Evidence:** `src/editor/extensions/markdownRoundTrip.test.ts:1-40`; `gh issue list` #167–#175 (all CLOSED); no `fast-check`/`proptest` in `package.json` or `Cargo.toml`.
- **Gap:** each bug was found by a user/agent noticing, then pinned. Nothing asserts the general property: *parse then serialize then parse then serialize is stable*, or *no text content is lost*. The next unusual-but-valid Markdown construct will corrupt a note the same way.
- **Why it matters here:** this is the one place where a plain "edit and save" can destroy user content, and it hits exactly the Markdown that arrives from outside (Git pull, Syncthing, Obsidian) which the app promises to preserve.
- **How mature teams approach it:** property-based tests over generated documents, plus a golden corpus of real files run through load → save and diffed.
- **Recommendation:** (1) a vitest that loads every `.md` in a corpus folder (your own notes, anonymised) through `roundTrip` twice and asserts idempotence (`rt(rt(x)) === rt(x)`), reporting a diff otherwise (S, immediately useful against real notes); (2) then `fast-check` generating nested lists/tables/fences/callouts (M). See concept block below.
- **Priority / Effort / Learning value:** High · M · High

### F-04 · The e2e suite and the built installer are never run by CI
- **Discipline / Status:** Testing · Missing (in CI)
- **Current state:** 35 e2e specs drive the real exe via WebdriverIO. `test:e2e` rebuilds with `tauri build --debug` and uses a locally installed `tauri-driver` and `msedgedriver`. No workflow mentions e2e.
- **Evidence:** `e2e/specs/` (35 files); `package.json` `pretest:e2e`; `grep e2e .github/workflows` → only `ci.yml` appears, as a path substring, not a step.
- **Gap:** the suite is a strong asset that depends on you remembering to run it. The release artifact itself (NSIS installer, MSIX identity registration, pdfium bundling, updater) is never started before publish.
- **Why it matters here:** most of the user-visible risk (shell integration, identity package, updater) lives in packaging, which unit tests cannot see.
- **Recommendation:** not "run all 35 on every push". Run a 3–5 spec **smoke subset** (create note, type, save, reopen; CSP check; CLI) on tag builds against the debug build, and treat the rest as local pre-release. (M; flaky-driver note in `wdio.conf.ts` means budget for retries.)
- **Priority / Effort / Learning value:** Medium · M · Medium

### F-05 · A bad `index.db` stops the app from starting; the schema has no version
- **Discipline / Status:** Data management · Weak
- **Current state:** startup does `block_on(db::init_db(...)).expect("failed to initialise database")`. Migrations are a run of `CREATE ... IF NOT EXISTS` plus `add_column_if_missing`, which treats any error text containing "duplicate column name" as success. No `PRAGMA user_version`, no integrity check, no fallback.
- **Evidence:** `src-tauri/src/lib.rs:181-182`; `src-tauri/src/db/schema.rs:7-14`; `grep user_version|integrity_check` in `src-tauri/src` → no hits. The panic hook (`lib.rs:176`) will log it, but the window never shows.
- **Gap:** the design promise "delete `index.db` and nothing is lost" is true, but a user (or you at 1 a.m.) has to know to do it. Any future change that is not purely additive (change the FTS tokenizer, change a column type, rename a table) has no versioned path, and the only upgrade test is idempotence on an already-migrated DB (`schema.rs:213`).
- **Why it matters here:** a crash-on-launch is the most trust-destroying failure for a note app, even when no note is harmed, and the rebuild path makes it nearly free to fix.
- **How mature teams approach it:** numbered migrations keyed by `PRAGMA user_version`; on open failure, move the file aside (`index.db.corrupt-<ts>`) and rebuild.
- **Recommendation:** (1) on `init_db` error or failed `PRAGMA quick_check`, rename the file and create a fresh one, log to the error log, and let the existing reindex-on-open repopulate it (S); (2) set `user_version` and add a `match version { 0 => …, 1 => … }` ladder before the next non-additive change (S).
- **Priority / Effort / Learning value:** High · S · High

### F-06 · npm advisories are not checked in CI; one real bump is pending
- **Discipline / Status:** Dependencies · Partial
- **Current state:** `cargo audit` runs in CI with six documented ignores (good practice). `npm audit` does not run. `npm audit --omit=dev` reports 34 advisories (2 critical, 20 high).
- **Evidence:** `ci.yml:69-80`; `npm audit` output. Most are transitive through `shadcn` (listed under `dependencies`, imported only for `@import "shadcn/tailwind.css"` in `src/index.css:3`), which drags in the MCP SDK, Express-family packages, `undici`, `systeminformation`. The critical `dompurify` entry is direct (`3.4.15`, latest `3.4.17`); the advisory concerns the `IN_PLACE` option and `grep IN_PLACE src` finds no use, so exposure is low but the fix is a one-line bump. `vite`'s advisory concerns `launch-editor` on Windows in the dev server.
- **Gap:** the shipped bundle contains little of this (shadcn is build-time CSS), but nothing distinguishes "shipped" from "dev tooling" in your reports, so real advisories will drown in noise, which is how the 2026-09-07 audit found 65.
- **Recommendation:** bump `dompurify`; move `shadcn` to `devDependencies` if the CSS import works from there (it is resolved at build); add `npm audit --omit=dev --audit-level=high` to CI as a non-blocking step first; add a minimal `.github/dependabot.yml` for `npm`, `cargo` and `github-actions` weekly.
- **Priority / Effort / Learning value:** Medium · S · Medium

### F-07 · Build inputs are not pinned
- **Discipline / Status:** Supply chain / reproducibility · Weak
- **Current state:** `dtolnay/rust-toolchain@stable` (6 uses), no `rust-toolchain.toml`; Node 22 in `ci.yml`/`release.yml`, Node 20 in iOS workflows, Node 24 on the dev machine; actions referenced by tag (`@v4`, `@v0`, `@cargo-audit`) not commit SHA; `tauri-apps/tauri-action@v0` receives the updater signing key.
- **Evidence:** `grep uses: .github/workflows` ; no `.nvmrc`, no `rust-toolchain*`.
- **Gap:** a new Rust stable release can turn `clippy -D warnings` red with no change in your code (this is exactly how it will surprise you on release day), and a compromised action tag runs with the signing key in env.
- **Recommendation:** add `rust-toolchain.toml` and `.nvmrc`; pin only the action that sees secrets (`tauri-action`) by SHA, let Dependabot (F-06) bump it. Skip SHA-pinning the rest for now.
- **Priority / Effort / Learning value:** Low · S · Medium

### F-08 · The PDF "regression suite" is not in the repository
- **Discipline / Status:** Testing · Weak
- **Current state:** `pdf/CLAUDE.md` and the roadmap say "the ten sheets in `notes/exercise_sheets/` are the regression suite". `.gitignore:42` ignores `/notes/`; `git ls-files notes` is empty; `git check-ignore -v notes/exercise_sheets` confirms it. Rendering tests that need pdfium are `#[ignore]`d; real-output diagnostics are driven by an env var (`NULL_NOTES_PDF`).
- **Evidence:** `.gitignore:42`; `src-tauri/src/pdf/CLAUDE.md` ("Judging this pipeline means looking at real output").
- **Gap:** the freeze policy is only enforceable on one machine. Disk loss, or a second contributor, makes it unenforceable, and no automated comparison exists between today's output and a known-good output. (The PDFs may be course material you cannot commit; that is a legitimate reason, but then the substitute is missing.)
- **Recommendation:** commit the *expected Markdown* ("golden files") for each sheet, which is yours, and a tiny test that, when `NULL_NOTES_PDF_DIR` is set, converts each PDF and diffs against the golden file. The PDFs stay local; the contract becomes versioned. Back up the corpus somewhere that is not the working tree.
- **Priority / Effort / Learning value:** Medium · M · High

### F-09 · Error log is append-only, unbounded, and lacks context
- **Discipline / Status:** Observability · Partial
- **Current state:** JSON-lines `errors.log` in app-data; panic hook writes there; `ErrorBoundary` exists; copy-out is a UI feature. No rotation or size cap; panic entries carry `info.to_string()` (message and location, no backtrace); version and OS are absent from the copied text (already filed as #145).
- **Evidence:** `commands/error_log.rs:5-20` (append only), `:34-39` (clear truncates); `lib.rs:176-179`.
- **Gap:** low severity today (single user, log is small), but a retry loop that logs on every tick would grow the file without bound, and a pasted log cannot tell you which build produced it.
- **Recommendation:** cap at ~1 MB (rotate to `errors.log.1` on open), include app version, OS and a captured `Backtrace::force_capture()` in panic entries, and finish #145. No remote crash reporting: it contradicts the local-first premise (see §10).
- **Priority / Effort / Learning value:** Low · S · Medium

### F-10 · Recovery from a bad overwrite depends on Git being enabled
- **Discipline / Status:** Data management · Partial (evidence limited)
- **Current state:** atomic writes prevent half-written files; the trash recovers deleted notes (machine-local); note history is `list_note_history`, which reads Git (`commands/git.rs:514`).
- **Evidence:** `commands/notes.rs:1094-1124`; `commands/git.rs:514`. I did not find a non-Git snapshot mechanism; I did not search every command for one.
- **Gap:** `write_atomic` protects against interrupted writes, not against *successful but wrong* writes (F-03-type serializer bugs, a bad bulk operation such as rename-with-link-rewrite). For a workspace without Git, the previous content is gone.
- **Recommendation:** a small per-workspace ring of the last N pre-save versions per note in app-data (e.g. 10 versions, only when content changes, written from the `reindex_note` path, not `save_note`). Needs a decision recorded in ROADMAP §1 as it is new state.
- **Priority / Effort / Learning value:** Medium · M · Medium

### F-11 · Documentation drift: two verified stale statements
- **Discipline / Status:** Documentation · Improvement
- **Evidence:** (a) `pdf/CLAUDE.md` says "Nothing in CI has the pdfium native library", but `ci.yml` runs `./scripts/download-pdfium.ps1`; whether `#[ignore]`d render tests are actually run is **unverified**. (b) `docs/ROADMAP.md` §5 "Clippy/typecheck gates" says "there is no `npm run lint` script — don't reference one"; `package.json` has `"lint": "eslint ."` and CI runs it.
- **Recommendation:** fix both; the `sync-agent-docs` skill is built for this. Add a line to the `release` checklist to re-read the "stated invariants" in CLAUDE.md.
- **Priority / Effort / Learning value:** Low · S · Low

### F-12 · Updater signing-key custody and the single point of failure
- **Discipline / Status:** Release · Unknown
- **Current state:** updates are verified against `plugins.updater.pubkey`; the private key and password are GitHub secrets (`TAURI_SIGNING_PRIVATE_KEY`); a `RELEASES_REPO_TOKEN` PAT feeds the mirror workflow.
- **Evidence:** `tauri.conf.json` `plugins.updater`; `release.yml:82-84`; `publish-mirror.yml:41`.
- **Gap:** I can't see whether the key exists anywhere except GitHub. If it is lost, every installed copy can no longer verify an update; users would have to reinstall by hand. Same for the PAT's expiry.
- **Recommendation:** store an encrypted copy of the key and its password outside GitHub (password manager), and note the PAT's expiry date in `docs/installing.md`. (Nothing to implement.)
- **Priority / Effort / Learning value:** Medium · S · Medium

### F-13 · Large workspaces are untested for performance
- **Discipline / Status:** Performance · Partial
- **Current state:** the roadmap states a budget; #146 ("opening a workspace reindexes every note one by one; no large-workspace benchmark") is open.
- **Evidence:** `docs/ROADMAP.md` §5 (performance budget); issue #146.
- **Gap:** no repeatable measurement, so regressions to "typing latency is sacred" are noticed by feel. 
- **Recommendation:** a `#[ignore]`d Rust test that generates 2,000 synthetic notes and prints reindex time and search latency; run it by hand before releases and record the numbers in the PR. Do not add CI thresholds (shared runners are too noisy).
- **Priority / Effort / Learning value:** Low · S · Medium

### F-14 · No-`unwrap` rule and coverage are convention only
- **Discipline / Status:** Code quality · Improvement
- **Evidence:** non-test `unwrap/expect` count is ~19 (strong), but there is no `clippy::unwrap_used` config; coverage script exists (`test:coverage`) and is not run anywhere.
- **Recommendation:** add `#![warn(clippy::unwrap_used, clippy::expect_used)]` at the crate root with `#[cfg_attr(test, allow(...))]`; clippy `-D warnings` then makes the rule machine-enforced (start by `allow`ing the ~19 existing sites). Leave coverage thresholds off, as `CLAUDE.md` decided.
- **Priority / Effort / Learning value:** Low · S · Medium

## 6. Quick wins

- F-01: add `push: branches: [main]` to `ci.yml` and fix the one lint error (`SettingsPanel.tsx:441`).
- F-06: bump `dompurify` to 3.4.17; add `.github/dependabot.yml`.
- F-05 (part 1): rename-and-recreate `index.db` when `init_db` fails.
- F-07: `rust-toolchain.toml` and `.nvmrc`.
- F-11: correct the two stale doc statements.
- F-12: put a copy of the signing key outside GitHub.

## 7. Long-term improvements

- F-03: corpus idempotence test (S) → property tests with `fast-check` (M). Depends on nothing; benefits F-10.
- F-05 (part 2): `user_version` migration ladder, before the next non-additive schema change.
- F-08: golden Markdown for the PDF corpus; depends on deciding where the PDFs live.
- F-04: smoke e2e on tag builds; depends on F-01 (a green base first).
- F-10: pre-save version ring; depends on F-03 knowledge of what a "bad overwrite" looks like, and needs a ROADMAP §1 decision.
- F-09, F-13, F-14: low-severity hygiene.

## 8. Concepts worth learning

**Property-based testing.** *What:* instead of hand-written examples, you state a rule that must hold for all inputs and a library generates hundreds of random inputs, then shrinks a failure to the smallest example. *Problem solved:* the unknown-unknown inputs nobody thought to write a test for. *How:* in `fast-check`, `fc.assert(fc.property(markdownArb, md => rt(rt(md)) === rt(md)))`. *Pays off:* once you have a serializer or parser, immediately. *Needed now?* Yes, the #167–#175 cluster is the textbook case. *Teaches:* thinking in invariants, generator design, shrinking. *Here:* the round-trip test file; the invariant is idempotence plus "no text node disappears".

**Golden-file (snapshot) testing.** *What:* store the known-good output next to the input, fail on any diff, update deliberately. *Problem solved:* "did this change alter output I cared about?" for large, hard-to-assert outputs. *How:* `convert(pdf) == read(expected.md)`. *Pays off:* when the output is big and judged by eye, like the PDF pipeline. *Needed now?* Yes for F-08, it also turns the "frozen pipeline" policy into something a machine can enforce. *Teaches:* review-by-diff workflow. *Here:* `notes/exercise_sheets/*.pdf` + the existing `(Notion).md` files sitting beside them look like exactly the expected outputs.

**Trunk-based development with required status checks.** *What:* everyone commits to one branch, but a check must pass before (or immediately after) a change lands. *Problem solved:* a broken trunk that nobody notices. *How:* CI on `push`; for teams, branch protection. *Needed now?* The CI-on-push half, yes; branch protection and mandatory PRs are optional for one person (see §10). *Teaches:* the difference between "tests exist" and "tests gate".

**Schema migrations via `PRAGMA user_version`.** *What:* SQLite keeps an integer in the file header that you use as the schema version. *Problem solved:* knowing which migrations a given database has had, so non-additive changes are possible. *How:* read version, apply each missing numbered step in a transaction, set the new version. *Pays off:* the first time a column must change type or an index definition changes. *Needed now?* Not strictly (index is rebuildable, additive changes work) but cheap and the rebuild-on-failure path (F-05) covers the same ground. *Teaches:* forward-only migrations, transactional DDL.

**Supply-chain basics (Dependabot, SHA pinning, SBOM).** *What:* automated update PRs; pinning third-party code to an immutable commit; a machine-readable list of what you ship. *Problem solved:* a compromised or yanked dependency reaching your signing step. *Needed now?* Dependabot yes; SHA-pinning only for the action that sees secrets; an SBOM is not needed for a private personal app.

**Mutation testing and fuzzing.** *What:* mutation testing changes your code (flip `<` to `<=`) and checks whether a test fails; fuzzing feeds mangled input to find crashes. *Needed now?* No. Your suite is large and it's not obviously weak; the better next spend is F-03. Revisit mutation testing on `sm2.rs`/`fsrs.rs`, which are pure and numerically tricky, if you want a learning exercise. Fuzzing would suit the PDF text-layer parser, if the PDF freeze ever lifts.

## 9. Existing strengths

- **Invariants are written down and referenced from code.** The save path, storage boundary and process-execution rules are stated in `CLAUDE.md` and `commands/CLAUDE.md`, and the allowlist for the CLI pipe is pinned by a test (`tests/cli_server.rs`, `NEVER_EXPOSED`).
- **Atomic writes** with temp-file cleanup on failure (`notes.rs:1094-1124`) and temp files gitignored/ignored by the watcher (`git.rs:955`, `watcher.rs`).
- **Security work was finished, not just reported:** CSP is set (`tauri.conf.json:app.security.csp`), eslint has `react/no-danger` and `no-unsanitized` rules, issues #1–#13 are closed. `cargo audit` ignores each carry a reason.
- **Release mechanics:** draft releases, `assertRetaggable` (refuses to retag a published release), release notes from commits, placeholder-key guard, signed updater artifacts, private-source/public-binaries mirror.
- **Testing breadth:** 1,242 Rust tests, 238 frontend test files, 35 real-binary e2e specs; the `ErrorBoundary` is tested.
- **Hygiene:** strict TypeScript with 3 `any` in non-test code, ~19 non-test `unwrap/expect`, a consistent conventional commit style, issue tracking used for everything including audit findings.

## 10. Not needed here

- **Cloud sync, accounts, collaboration, plugin API, encryption** (ROADMAP §7): no conflict-resolution service, no threat model for plugins, no key management to design.
- **Remote crash reporting / telemetry (Sentry-style)**: contradicts "local-first, no telemetry" (ROADMAP §5 *Observability*). The local error log plus a better "Copy diagnostics" (F-09) is the right shape.
- **Mandatory PRs and a second reviewer**: not available to a solo maintainer. CI on push (F-01) is the part of the practice that carries the value.
- **Staged rollout / canary channels / feature flags**: pays off with thousands of users; a single-digit audience needs only the draft-release checklist (F-02).
- **SLOs, on-call, incident process, change boards**: no service.
- **Code signing of the installer for public distribution** (#60, ROADMAP §7): consciously deferred.
- **Coverage thresholds**: `CLAUDE.md` decided against; revisit only if a regression slips through a covered area.
- **SBOM / reproducible builds**: meaningful for distributed software with downstream consumers; here they would be ceremony.

## 11. Prioritised roadmap

**Quick wins (one sitting, in this order)**
1. Fix `SettingsPanel.tsx:441`, then add `push: branches: [main]` to `ci.yml` (F-01). Everything else leans on this being green.
2. Bump `dompurify`; add `dependabot.yml` (F-06). Add `rust-toolchain.toml`, `.nvmrc` (F-07).
3. Self-healing `index.db` on init failure (F-05, part 1).
4. Back up the updater signing key off-GitHub; fix the two stale doc lines (F-12, F-11).

**Important (next few weeks)**
5. Corpus idempotence test over your own notes, then `fast-check` properties (F-03).
6. Release checklist plus "tag only if `main` is green" in `release.mjs` (F-02).
7. Golden Markdown for the PDF corpus (F-08).
8. `npm audit` step in CI; move `shadcn` out of `dependencies` (F-06 rest).

**Long-term**
9. Smoke e2e on tag builds (F-04), after (1).
10. `user_version` migration ladder (F-05 part 2), before the next non-additive schema change.
11. Pre-save version ring (F-10), after a ROADMAP §1 decision.
12. Log rotation + diagnostics (F-09), reindex benchmark (F-13), `unwrap_used` lint (F-14).

**Enterprise-scale (not now):** see §10.

**Concepts to learn before implementing:** property-based testing (before item 5), golden-file testing (before item 7), `PRAGMA user_version` (before item 10).

## 12. Changes since previous audit

Not applicable: this is the first engineering audit. The next run should start from this file and mark F-01 … F-14 Fixed / Still open / Changed.
