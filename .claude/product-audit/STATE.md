# Audit State

Last audit:
2026-10-22 (fourth run, ink sidecars + card navigation)

Repository state:
main @ dea65e7 (feat(mobile): full-screen overlays, keyboard-top editor toolbar and 44px rows #118). Working tree: docs/plans/mobile-native-shell.md modified (not audited).

Last inspected areas:
- product docs (PRODUCT.md, docs/ROADMAP.md phase list, §4 cuts, §7 out-of-scope, §8 polish)
- all GitHub issues #1-#120 (titles/labels/state only; bodies read for #71)
- note delete / rename / wiki-link resolution (notes.rs, WikiLink.tsx, db/notes.rs backlinks)
- scan_workspace / reindex path (surface only)

Last GitHub issue audit:
2026-10-22

Architecture confidence:
medium-high (seeded from CLAUDE.md + sub-CLAUDE.md files + roadmap; spot-checked in code)

Feature inventory confidence:
medium (derived from roadmap phase status + extension/command file listing; few features code-verified)

Known areas requiring re-audit:
- study: SR internals reviewed (ReviewSession, due_cards); remaining: DeckView/card authoring UX
- export surface (PrintDialog / ExportPdfDialog scope: single note only?) vs P18 LaTeX
- ink <-> diagram <-> PDF interplay
- mobile shell (P16) once docs/plans/mobile-native-shell.md lands
- search ranking / fuzzy matching

Last created issues:
- #121, #122, #123, #124, #125, #126, #127, #128
