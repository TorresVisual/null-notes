---
name: capture-findings
description: While working on a task, when you notice an unrelated bug, missing feature, enhancement or technical debt that the current task doesn't need, hand it to /file-issue and carry on with the task. Use proactively mid-task; not for problems that must be fixed to finish the current task correctly.
---

# Capture unrelated findings

Unrelated problems seen mid-task get lost unless they are written down. File them, don't fix them, and don't let them derail the current work.

## When it applies

A finding is unrelated when the current task doesn't need it and someone could reasonably pick it up later: a bug in code you only passed through, a missing feature, a worthwhile enhancement, technical debt.

Not for:
- Anything the current task needs to be correct. Fix that as part of the task.
- Trivia, unsupported speculation, duplicates, or things the task already covers.

## Steps

1. Finish the thought you're on; don't switch tasks.
2. Invoke `/file-issue` with a short description of the finding, its impact or motivation, and the files or locations you already know about.
3. Use only evidence from this session. Don't explore unrelated code to flesh out the issue.
4. Leave duplicate checks, formatting, labels and creation to `/file-issue`. If it asks you to clarify or approve a draft, answer from what you know, relay to the user only what you can't answer, then go back to the task.
5. Don't implement the finding unless the user explicitly asks.

## If `/file-issue` fails

Don't fall back to another way of creating issues (raw `gh`, editing `TODO.md`, etc.). Tell the user briefly what the finding was and that it was not filed.

## End of session

Mention any issues created, with titles and links. If none were warranted, say nothing.
