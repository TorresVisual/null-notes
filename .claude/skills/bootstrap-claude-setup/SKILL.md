---
name: bootstrap-claude-setup
description: Set up Claude Code for a repo end to end — enable stack plugins, then create project-specific skills, subagents and (with consent) hooks/permissions derived from the repo's own rules and workflows, and commit them. Use when asked to "set up Claude for this project", "create the skills/tools we need", or "bootstrap this repo". Goes beyond project-setup, which only enables plugins.
disable-model-invocation: true
---

Goal: encode what is *specific to this repo* (its rules, workflow, build and measurement loops), not generic tooling.

1. **Plugins first.** Invoke `project-setup` (stack detection, catalog matches). Never install anything from its shortlist unless the user names it that turn.
2. **Read the sources of truth**, in this order: `CLAUDE.md`/`AGENTS.md`, `README`, CI config, `docs/`, existing `.claude/`, the issue tracker if CLAUDE.md names one (`gh issue list`), then scripts and CLI entry points (`--help`, clap/argparse definitions). Note which rules the docs call "easy to violate" and which tasks recur.
3. **Pick candidates**, one per recurring workflow, using this mapping:
   - Rule/convention that a diff can break → read-only **reviewer subagent** (`.claude/agents/<name>.md`, tools `Read, Grep, Glob, Bash`) listing the rules verbatim.
   - Task with side effects (posting to issues, GPU/long runs, writing data files) → **user-only skill** (`disable-model-invocation: true`) that drafts, shows, and waits for approval before anything outward-facing.
   - Read-only lookup or "what's next" → normal skill.
   - Exact CI replica → `ci-local` style skill (run what CI runs, never claim green unrun).
   - Result analysis → read-only analyst subagent.
   Skip anything the repo's CLAUDE.md or an installed plugin already covers. Prefer 3–6 sharp artifacts over a long list; offer more on request.
4. **Write them** under `.claude/skills/<name>/SKILL.md` and `.claude/agents/<name>.md`: concrete commands copied from the repo (verify they exist), the repo's own constraints stated as hard rules, short imperative steps. No generic advice.
5. **Hooks and permissions** (`.claude/settings.json`: format-on-edit, cargo/npm allowlists) change what Claude may do, so the harness may block writing them. Don't work around a block: show the exact JSON, say why it was blocked, and let the user apply or authorise it. Use `.claude/settings.local.json` only for personal paths.
6. **Respect repo boundaries**: if CLAUDE.md forbids touching `~/.claude` or other repos, write project-scope files only and tell the user how to promote a skill to user scope.
7. **Commit** only the new `.claude/` files, in the repo's commit style (check CLAUDE.md/`.githooks`), without unrelated working-tree changes. Report hash, what was created, what was blocked, and what plugins/MCP servers are suggested but uninstalled.

Untested artifacts are drafts: say they were not exercised.
