---
name: engineering-audit
description: Audit null-notes' engineering maturity — testing, CI/CD, release process, security, observability, dependency hygiene, data-integrity safeguards, developer experience, docs — and surface professional practices the maintainer may not know exist, each explained and tied to repo evidence. Writes a dated report to docs/ and files nothing. Use whenever the user asks for an engineering audit, an engineering-maturity or "what are we missing" review, how professional teams would run this project, or what to harden before it gets more users — even if they don't say "audit". Not for product feature gaps (product-audit), UI/a11y/design reviews, single-PR code review, or implementing fixes.
---

# Engineering Audit

Act as a staff engineer reviewing how null-notes is *built and run*, not what it does. The maintainer is a solo CS student who is learning software engineering, so the goal is twofold: find real gaps, and teach the concepts behind them — including practices they don't know exist ("find the things we don't know we're missing").

Product gaps belong to `product-audit`; visual/a11y/consistency reviews already have their own docs. This skill covers the engineering system around the code.

## Hard rule: read-only, one output file

The only file this skill writes is the report. Do not modify source or config, install anything, create branches, file issues, commit, or push. Implementing a recommendation needs separate, explicit authorization. After the report, *offer* to turn chosen findings into issues via `file-issue`.

The reason: an audit that also "fixes things" can't be trusted as an assessment, and the user decides what is worth the time.

## Context to absorb first

Read these before judging anything missing — they settle most "is this a gap?" questions and stop you rediscovering known work:

- Root `CLAUDE.md`, `src-tauri/src/pdf/CLAUDE.md`, `src-tauri/src/commands/CLAUDE.md` — stated invariants (save path, storage boundary, process-execution rules, frozen PDF pipeline).
- `PRODUCT.md` and `docs/ROADMAP.md` — what is deliberately out of scope (§7: cloud sync, collaboration, plugin API, public distribution, encryption…), and the decision records. **Don't recommend things the roadmap rejected**; if a practice is only relevant to a rejected direction, say so under "not needed here".
- Prior audits in `docs/`: `security-audit-*.md`, `accessibility-audit.md`, `ui-consistency-audit.md`, `file-architecture.md`, earlier `engineering-audit-*.md`. Link to them and mark covered ground instead of redoing it; re-verify only if the code has since changed.
- Open issues (`gh issue list --repo TorresVisual/null-notes --state all --limit 200`) — a gap already filed is not a discovery.

Project calibration: one maintainer, commits straight to `main`, Windows-first Tauri app, local-first, data integrity is the top product principle. Weight findings by that. A silent-corruption risk outranks a missing dashboard; enterprise rituals (on-call rotations, SLOs, change boards) are usually "not needed — here's the idea, here's when it would matter".

## Workflow

1. **Discover.** Use `graphify query` / `graphify explain` for orientation when `graphify-out/` exists, then read the real implementations (workflows in `.github/workflows/`, `package.json` / `Cargo.toml` scripts, test dirs, `e2e/`, hooks, release config, error/log handling, the save path). Keep a coverage checklist per area: Inspected / Partial / Not inspected / N/A. Never claim coverage you don't have, and don't read missing docs as a missing practice — check the code and CI first.
2. **Assess** each discipline: architecture; code quality; testing & QA; security; CI/CD & release; observability & reliability (logging, crash reporting, recovery); developer experience; dependency & supply chain; workflow/process; performance; data management (migrations, backups, index rebuild); documentation. Add disciplines the project reveals. For each: what exists, how well, what's manual, what breaks as it grows.
3. **Hunt unknown unknowns** — the most valuable step. Ask what an experienced team would have that this repo doesn't, and what happens when things go wrong: How are regressions caught? How is a release verified before users get it? What if a user's workspace is corrupted, or an update ships a bad schema? Which knowledge lives only in the maintainer's head? What would a second contributor trip over? Look beyond the discipline list above.
4. **Write findings** (format below), **teach** unfamiliar concepts, **score**, and **sequence** a roadmap.
5. **Write the report**, then summarise.

## Findings

Each finding needs: title; discipline; status (**Missing** / **Partial** / **Weak** / **Improvement** / **Unknown**); current state; evidence as `file:line` or command output; the gap; why it matters *for this project*; how mature teams handle it; recommendation; priority (Critical/High/Medium/Low); effort (S/M/L); learning value.

Use **Unknown** when evidence is insufficient rather than guessing. Every claim must trace to something you read or ran; if you couldn't verify it, say so.

## Teaching

For each concept the maintainer is unlikely to know (e.g. property-based testing, fuzzing, SBOMs, reproducible builds, mutation testing, canary releases, ADRs, migration testing), give a short block: what it is, the problem it solves, how it works, when it starts paying off, whether null-notes needs it *now*, and what implementing it would teach. Anchor the explanation in an example from this codebase. Judgment is the deliverable — "not yet, because…" is a good answer.

## Scoring

Score each discipline 0–5 (0 none, 1 ad hoc, 2 basic, 3 consistent and automated, 4 mature and measured, 5 continuously optimised) with a one-line evidence note. Score against what suits a solo local-first desktop app: don't penalise missing infrastructure that's inappropriate at this size, and don't inflate for tooling that exists but doesn't run (e.g. a check that only runs on `pull_request` while all work lands on `main`).

## Roadmap

Group into quick wins, important improvements, long-term investments, enterprise-scale (explicitly "not now"), and concepts worth learning before implementing. Note dependencies between items and give an order. Don't suggest doing everything at once.

## Output

Report path: `docs/engineering-audit-YYYY-MM-DD.md` (docs/ keeps audits as dated files, e.g. `security-audit-2026-09-07.md`). Never overwrite an existing audit. Structure: `references/report-template.md`.

Re-runs: read the latest prior audit, re-inspect the code, mark each earlier finding Fixed / Still open / Changed (verified, not assumed), add newly introduced gaps, rescore with a delta column, and write a new dated file that links to the old one.

## Final message

Short: report path, top 3–5 findings, maturity scores in one line, and the offer to file chosen findings as issues via `file-issue`. Don't repeat the report.
