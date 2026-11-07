# Engineering Audit — Enterprise Benchmark — 2026-11-07

Commit audited: `d2043b4` · Companion to [engineering-audit-2026-11-07.md](engineering-audit-2026-11-07.md)

## 0. Why this second pass exists

The first report scored null-notes against what suits a solo project and listed enterprise practices under "not needed here". That answered "what is cheap to fix?", not "how far is this from how a professional desktop-app team ships?". This pass drops the size discount. For each area it lists what an enterprise-grade Windows desktop product normally has, whether null-notes has it, and how big the gap is. Findings **F-01 … F-14** (issues #176–#189) are the cheap subset; the items below are the rest of the distance.

Correction to the first report: **F-12 was partly wrong.** `docs/installing.md` already says "Back the private key up outside the repo — losing it strands every installed copy" and records the signing-cert expiry (2027-09-13). What I cannot see is whether the backup was actually made. Issue #187 should be read that way.

Gap size: **XL** = a different system (weeks, new infrastructure or money), **L** = days, **M** = a day, **S** = hours.

## 1. Headline

The product code is closer to enterprise grade than the delivery system around it. Enterprise teams treat build, release, quality gates and operations as products of their own; here they are a few scripts and one workflow. The five biggest distances:

1. **Trust chain of the shipped binary** — unsigned installer, no provenance, no SBOM, and the installer adds a self-signed certificate to the user's trust store (§3).
2. **No enforced change control** — no branch protection or rulesets, no required checks, no code scanning, secret scanning off, 30 open Dependabot alerts (1 critical, 10 high) that nobody is triaging (§2, §4).
3. **No visibility into the field** — no crash reporting, no structured logging, no way to know what version/OS a failure came from (§6).
4. **Release is one big-bang channel** — one stable stream, no beta/nightly, no staged rollout, no rollback, no upgrade/downgrade test matrix (§3, §7).
5. **Quality gates run on one OS, once per release** — and the suite has no coverage trend, mutation, fuzz, visual-regression, accessibility-automation or performance-regression signal (§5).

## 2. Source control and change management

| Enterprise norm | null-notes today | Gap |
|---|---|---|
| Protected default branch, required status checks, no force-push | `gh api .../branches/main/protection` → 404 "Branch not protected"; rulesets `[]`. Release script force-pushes tags | M |
| Pull requests with a review gate (or merge queue) | 1,241 of 1,247 commits direct to `main` | M (needs a workflow change, see below) |
| CODEOWNERS, PR and issue templates | none (`.github/` holds only workflows) | S |
| Signed commits / verified authorship | not enforced | S |
| Changelog curated per release | release notes are raw commit subjects (`release.yml` "Release notes from commits"); no `CHANGELOG.md` | S–M |
| Conventional-commit lint feeding automated versioning and changelog (release-please, semantic-release) | commit style is conventional by habit, not enforced; version bump is manual `npm run release -- patch/minor/major` | M |
| Local pre-commit / pre-push hooks (husky, lefthook) | none | S |
| `.editorconfig`, formatter for the frontend (Prettier/Biome) | none; `eslint.config.js` says "prettier-less convention" | S |

*Solo adaptation, if wanted:* rulesets can require status checks without requiring a second reviewer, and "PR to yourself" with auto-merge on green gives the same gate as a team without the review step.

## 3. Build, packaging, signing, release

| Enterprise norm | null-notes today | Gap |
|---|---|---|
| **Authenticode-signed binaries and installer** (EV or OV certificate, or Azure Trusted Signing / SignPath), timestamped | No `signCommand`/thumbprint anywhere in `src-tauri/*.json`; installer unsigned, so Windows SmartScreen warns on download | L + money |
| Installer does not alter machine trust | `trust-cert.ps1 -Action Install` puts a self-signed `CN=null-notes-dev` cert in the user's trust store so the MSIX identity package registers (`docs/installing.md`, "Explorer right-click integration"). An enterprise security review would reject any app that installs its own trusted root | L (needs a real signing cert; this cert is what the shell integration depends on) |
| Build provenance (SLSA, `actions/attest-build-provenance`) so a user can verify an artifact came from this repo's workflow | none | S–M |
| SBOM per release (CycloneDX / SPDX) attached to the release | none (`grep sbom|cyclonedx|syft` empty) | S–M |
| Published checksums for every artifact | the updater has minisign signatures; no `SHA256SUMS` for manual downloads | S |
| Reproducible / hermetic builds: pinned toolchain, locked inputs, builds on clean runners | lockfiles committed (good), but `rust-toolchain` unpinned and `pdfium` fetched from a URL at build time (`scripts/download-pdfium.ps1`) without a checksum check I could find (not verified: did not read the script's body) | M |
| Release channels (stable / beta / nightly) with separate updater endpoints | single endpoint (`.../latest/download/latest.json`) | M |
| Staged rollout (1% → 10% → 100%), kill switch, minimum-version gate, rollback | none; "Published" means every installed copy gets it; recovery is fix-forward | L |
| Automated install / upgrade / uninstall tests on clean VMs (Windows 10, 11, per architecture) | none; CI runs on `windows-latest` only and never installs the artifact | L |
| Third-party licence inventory shipped with the app (`THIRD-PARTY-NOTICES`) | none found; app bundles pdfium, fonts (`excalidraw-fonts`), ~540 Rust crates and the npm tree; no `LICENSE` file at the repo root either | M |
| Delta/differential updates | full installer each time (49 MB exe) | L, low value |
| Release dashboards: what shipped when, what failed | `gh run list` shows 12 failed of 19 `Release` runs; nobody is alerted | S |

## 4. Security and supply chain

| Enterprise norm | null-notes today | Gap |
|---|---|---|
| SAST on every change (CodeQL, Semgrep) | code scanning not enabled (API: 403). Note: on a private repo this needs GitHub Advanced Security; Semgrep CLI or CodeQL run in Actions works without it | M |
| Secret scanning and push protection | "Secret scanning is disabled on this repository" (API). `gitleaks` in CI is the free substitute | S |
| Dependabot alerts triaged to zero or to documented exceptions | 30 open alerts: 1 critical, 10 high, 15 medium, 4 low | M |
| Dependency review on PRs, `cargo-deny` (licences, bans, advisories, sources) | none (`deny.toml` absent); only `cargo audit` with 6 documented ignores | S–M |
| Action pinning by SHA, least-privilege `permissions:` per job | `ci.yml` and `publish-mirror.yml` set `contents: read` (good); actions on mutable tags; `format.yml` holds `contents: write` and pushes (issue #13 closed, but it still exists) | S |
| Short-lived credentials (OIDC) instead of long-lived PATs | `RELEASES_REPO_TOKEN` is a fine-grained PAT with an expiry; signing key is a static secret | M |
| Signing key in an HSM / cloud KMS with rotation plan | updater key is a file in a secret; rotation not defined (rotating strands installed copies) | L |
| Written threat model, `SECURITY.md` disclosure policy, periodic pentest | a security audit exists (strong) but no threat-model document and no `SECURITY.md` | S–M |
| Fuzzing of every parser that takes untrusted input | none (`grep fuzz` empty). Candidates: `db/fts_query.rs`, `properties.rs` (frontmatter edits), the CLI pipe protocol, PDF layout | M–L |
| Sandboxing of risky features (code execution, terminal) | deliberately unsandboxed with friction instead (`commands/CLAUDE.md`); enterprise would sandbox or gate by policy | L (design decision) |
| Enterprise deployment controls: MSI with silent switches, Group Policy / registry settings to disable updater, CLI access, code execution | MSI target exists but without the install hook; no policy knobs | L |

Strengths here are real: CSP, no-shell launchers, allowlisted CLI, signed updates, DOMPurify sink, a closed security audit.

## 5. Quality engineering

| Enterprise norm | null-notes today | Gap |
|---|---|---|
| Required CI on every change, test matrix (OS versions × architectures) | CI on PR/tag only, one runner (`windows-latest`) | M |
| Coverage collected, trended and gated on changed lines (Codecov-style) | `test:coverage` exists, runs nowhere | S |
| Mutation testing on core logic | none | M (see companion §8) |
| Property-based tests | none (issue #178) | M |
| Golden-file / snapshot tests for converters | PDF corpus untracked (issue #183) | M |
| Visual-regression tests (Playwright/Chromatic screenshot diffs) | e2e takes screenshots "so a person can look" but nothing compares them | M–L |
| Automated accessibility checks in CI (axe-core) | none (`grep axe` empty); only a manual audit doc | M |
| Performance regression gates: startup time, typing latency, large-workspace open, bundle-size budget | none; budget stated in prose only (issue #188) | M–L |
| Soak / long-run tests (memory growth with a 10,000-note workspace open for hours) | none | L |
| Flaky-test tracking, quarantine, retries reported | `retries: 1` in wdio config, no tracking | S |
| Test reports published per run (JUnit, trends) | none | S |
| Compatibility tests: open each previous release's workspace/index with the new build | none | M–L |
| Static analysis beyond clippy: `cargo geiger` for unsafe, `cargo udeps` for unused deps | none | S |

## 6. Observability and operations

| Enterprise norm | null-notes today | Gap |
|---|---|---|
| Structured, levelled logging (`tracing` crate) with rotation | ad hoc `errors.log`, JSON lines, no levels, no rotation (issue #184) | M |
| Crash reporting with minidumps and symbol upload (Crashpad / Sentry) | panic hook writes a text line; native crashes (pdfium, WebView2) leave nothing | L |
| Opt-in anonymous usage and health telemetry (version adoption, update success rate, feature use) | none, by design | M. Enterprise apps with a privacy stance ship this as *opt-in with a visible payload*, which keeps the local-first promise |
| "Export diagnostics" bundle (version, OS, settings minus secrets, last N log lines, index stats) | partial: error log copy; no version/OS (issue #184, #145) | S |
| Health checks on startup (index integrity, workspace readable, disk space) | none; DB failure is a panic (issue #180) | S–M |
| Runbooks: "release failed", "updater broke", "key lost", "user reports data loss" | the release section of `docs/installing.md` only | S–M |
| Post-incident reviews (blameless postmortems) | the #167–#175 corruption cluster had no write-up of *why* the class went undetected | S |
| Support workflow: user-facing docs, known-issues page, version-specific release notes | `docs/installing.md` is the only end-user doc | M |

## 7. Data and compatibility

| Enterprise norm | null-notes today | Gap |
|---|---|---|
| Versioned schema migrations with up-tests from every released version | none (issue #180) | M |
| **Downgrade protection**: an older app refuses, or opens read-only, state written by a newer one | none. If v1.0.9 opens an `index.db` or `.base`/`.canvas`/`.scheduler.json` produced by a future version, nothing checks | M |
| Documented file-format specs with version fields (`.canvas`, `.base`, `.bookmarks`, `.scheduler.json`, sidecars) | specs in `docs/specs/` (58 files, good); no `version` field I verified in the formats | M |
| Workspace integrity checker ("verify and repair": orphan sidecars, broken links, invalid frontmatter, stale `.tmp` files) | none; sidecar cleanup is #127 (closed) but no whole-workspace check | M |
| Backup / restore built in; point-in-time recovery | Git automation (optional) + machine-local trash; no non-Git version history (issue #185) | M |
| Multi-instance and multi-process safety (single-instance lock, file locks, watcher races) | CLI and watcher handle some of it; no single-instance plugin in `Cargo.toml`. I did not trace whether two app instances on one workspace are safe | Unknown |
| Large-input limits and graceful degradation (huge notes, huge sidecars, deep nesting) | #88 added a sidecar size guard for Git; no general limits documented | M |

## 8. Architecture and code governance

| Enterprise norm | null-notes today | Gap |
|---|---|---|
| Architecture Decision Records | decisions live in a 1,600-line `docs/ROADMAP.md`; `docs/adr/` does not exist (the repo's domain doc says it is created lazily) | S |
| Module-boundary enforcement by tooling (dependency-cruiser, cargo `deny`/workspace splits) | rules like "`layout.rs` must not gain a pdfium dependency" and "storage boundary" are prose | M |
| Typed, generated IPC contract (tauri-specta / ts-rs) so Rust and TypeScript cannot drift | `src/lib/tauri.ts` hand-maintained; Rust commands return `Result<T, String>` | M–L |
| Error taxonomy with stable error codes shown to users and logged | CLI has `ErrorCode`; Tauri commands return strings | M |
| File-size / complexity budgets | `commands/notes.rs` 225 KB, `git.rs` 98 KB, `git_mobile.rs` 67 KB, `db/notes.rs` 89 KB; already covered by `docs/file-architecture.md` | L |
| API stability policy for the CLI (`nullnotes`) and the file formats | `PROTOCOL_VERSION` exists in the CLI pipe; no written compatibility policy | S |

## 9. Developer experience and onboarding

| Enterprise norm | null-notes today | Gap |
|---|---|---|
| One-command bootstrap (dev container, `just`/`make setup`) that installs toolchains and fetches pdfium | none (`.devcontainer` absent); setup knowledge is in `CLAUDE.md` and scripts | M |
| `CONTRIBUTING.md`, architecture overview for newcomers, good-first-issue triage | `CLAUDE.md` is excellent for agents; no human-facing onboarding | S–M |
| Build-time and test-time budgets tracked | `npm run lint` takes ~50 s locally; no tracking | S |
| Pre-merge preview artifacts (installer built per PR) | none | M |

## 10. Accessibility, internationalisation, compliance

| Enterprise norm | null-notes today | Gap |
|---|---|---|
| Automated + manual accessibility testing against WCAG, VPAT/ACR for buyers | manual audit (`docs/accessibility-audit.md`), forced-colors work done; no automation | M |
| Localisation pipeline (string extraction, translators, pseudo-locale tests) | English-only (issue #143) | L |
| Licence compliance and notices (see §3) | missing | M |
| Privacy statement (what is and isn't collected) | implicit ("no accounts, no backend"); not written for users | S |
| Data-protection review | N/A today since nothing leaves the machine except Git and update checks; becomes relevant the moment opt-in telemetry exists | — |

## 11. Prioritised path from here

Ordered by "closes the largest distance for the least new infrastructure". Items 1–4 are the foundation for the rest.

1. **Make the main branch a gated trunk**: CI on push (#176), then a ruleset requiring the `check` job, with PR-to-self + auto-merge if you want the discipline of a pull request. *Everything below assumes a green, enforced trunk.*
2. **Turn on the free security scanners**: Dependabot config and triage of the 30 alerts, `gitleaks`, `cargo-deny`, Semgrep or CodeQL in Actions, `npm audit` (#181).
3. **Establish the trust chain for releases**: build-provenance attestation, `SHA256SUMS`, CycloneDX SBOM, `THIRD-PARTY-NOTICES`, all added to `release.yml`. These are small workflow edits and need no money.
4. **Field visibility**: adopt `tracing` with rotating logs, add an "Export diagnostics" bundle with version/OS/backtrace (#184, #145). Decide on opt-in crash reporting separately.
5. **Real code signing** (Azure Trusted Signing or an OV/EV certificate), which also removes the self-signed trust-store installation. This is the single largest gap and the only one that costs money; it is also what `ROADMAP §7` deferred (#60), so it is a decision to revisit, not an oversight.
6. **Compatibility safety**: `user_version` migrations with a downgrade guard (#180), then golden workspaces from each released version that CI opens with the new build.
7. **Quality signal**: property tests and corpus tests (#178), golden PDF files (#183), coverage trend, axe in e2e, screenshot diffs, a performance benchmark with a recorded baseline (#188).
8. **Release management**: beta channel (a second `latest.json` endpoint), pre-publish smoke tests (#179), staged rollout, written rollback runbook.
9. **Governance**: ADRs, CODEOWNERS and templates, typed IPC contract, module-boundary linting.

## 12. Concepts worth learning next

Only the ones not already explained in the first report.

- **Software supply-chain levels (SLSA) and build attestations.** A signed statement, produced by the CI runner, that "this exact file was built from commit X by workflow Y". A user (or enterprise IT) can verify it with `gh attestation verify`. Pays off the moment someone else installs your binary; costs one action step.
- **SBOM.** A machine-readable list of every component in a release. Enterprises feed it to vulnerability scanners to answer "does the new advisory affect the version we deployed?". Here it would answer in seconds which of the 30 alerts are in shipped code versus build tooling.
- **Authenticode and SmartScreen reputation.** Windows judges downloads by signature and by accumulated reputation. An unsigned installer is warned about; an OV certificate removes the "unknown publisher" label slowly; EV or Azure Trusted Signing removes it faster. Also the reason a self-signed trusted root is the wrong tool.
- **Rings / staged rollout.** Ship to yourself first (ring 0), then 10% of users, then all. The updater endpoint is the lever: a JSON file you control decides who sees the version. With few users it means a beta channel you run on your own machines for a week.
- **Crash dumps and symbol servers.** A native crash leaves a minidump; with the matching `.pdb` you get a stack trace. Without them, "it just closed" is all you ever know.
- **Compatibility matrix and golden workspaces.** Keep one real workspace per released version in the repo; CI opens each with the new build and asserts nothing is lost. It is the data-side twin of the e2e suite and the only protection against migration bugs.
- **Policy as code / repository rulesets.** The branch rules, required checks and scanner settings live in versioned config (or at least in a documented setup), not in someone's memory.

## 13. What would change my mind

- If you intend to distribute beyond yourself, items 3 and 5 move to the front. If not, 1, 2, 4 and 6 still pay for themselves, because they are what stand between a hidden regression and your own notes.
- I did not inspect: the NSIS hooks and MSIX scripts in `scripts/windows/`, `download-pdfium.ps1`'s verification, the Android/iOS build paths, or multi-instance behaviour. Gaps in those areas are probably larger than shown here, not smaller.

## 14. Learning path (free only)

The goal of this project includes learning professional practice (ROADMAP §1: "enjoyment and learning are legitimate terms"), and nothing here needs a paid licence. Item 5 of §11 (a purchased signing certificate) is therefore **study-only**: read how Authenticode, SmartScreen reputation and `signtool` work, and sign a throwaway binary with a self-signed cert to see the mechanics. Do not buy anything for a tool with one user. The self-signed trust-store behaviour stays as is, documented as a known limitation.

Order chosen so each step teaches a concept the next one uses. Every tool named is free for a private repo unless stated.

| # | Do | Concept it teaches | Tool / cost |
|---|---|---|---|
| 1 | CI on push (#176), then a repository ruleset requiring the `check` job | Trunk-based development, required status checks | GitHub, free |
| 2 | `dependabot.yml`, triage the 30 alerts into "ships / build-only / dismissed with reason" | Vulnerability triage, reachability | Dependabot, free |
| 3 | `gitleaks`, `cargo-deny`, `npm audit` in CI | Secret scanning, licence and source policy | OSS CLIs, free |
| 4 | Build attestation, `SHA256SUMS`, CycloneDX SBOM on each release | Supply-chain provenance (SLSA), SBOMs | `actions/attest-build-provenance`, `cargo-cyclonedx`, free |
| 5 | Corpus round-trip test, then `fast-check` properties (#178) | Property-based testing | `fast-check`, free |
| 6 | `PRAGMA user_version` migrations, self-healing index, downgrade guard (#180) | Schema migration, forward/backward compatibility | SQLite, free |
| 7 | One "golden workspace" per released version opened by CI | Compatibility matrix | none |
| 8 | `tracing` with rotating logs and an Export-diagnostics bundle (#184) | Structured logging, supportability | `tracing`, free |
| 9 | `cargo-fuzz` on `db/fts_query.rs` and `properties.rs` | Fuzzing | `cargo-fuzz`, free (nightly Rust) |
| 10 | Coverage trend, `axe-core` in an e2e spec, one screenshot-diff spec | Coverage gating, automated a11y, visual regression | `vitest` coverage, `axe-core`, Playwright, free |
| 11 | A beta updater endpoint (second `latest.json`) | Release rings / channels | GitHub releases, free |
| 12 | ADRs for the next two real decisions; release and rollback runbook | Decision records, operational docs | markdown |

Skip until there is a reason: opt-in crash reporting (a hosted service or self-hosted Sentry), staged rollout percentages, localisation, an HSM or KMS for the updater key, enterprise MSI/Group Policy controls. Each is worth *reading about* once; building them for one user teaches little the items above do not.
