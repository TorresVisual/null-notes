# Engineering audit report template

File: `docs/engineering-audit-YYYY-MM-DD.md`. Keep sections in this order; omit nothing, write "None" where empty.

````markdown
# Engineering Audit — YYYY-MM-DD

Commit audited: `<git rev-parse --short HEAD>` · Previous audit: [link or "none"]

## 1. Executive summary
Three to six sentences: overall maturity, biggest risks, biggest strengths, what to do first.

## 2. Inspection coverage
| Area | Status (Inspected / Partial / Not inspected / N/A) | What was read |
|---|---|---|

Prior audits relied on rather than redone: [links].

## 3. Architecture overview
Short, from what was actually read (stack, boundaries, data flow, save path, storage boundary). Not a copy of CLAUDE.md.

## 4. Maturity matrix
| Discipline | Score 0–5 | Δ vs previous | Evidence |
|---|---|---|---|

## 5. Detailed findings
One block per finding, ordered by priority.

### F-01 · <title>
- **Discipline / Status:** Testing · Partial
- **Current state:**
- **Evidence:** `path:line`, command output
- **Gap:**
- **Why it matters here:**
- **How mature teams approach it:**
- **Recommendation:**
- **Priority / Effort / Learning value:** High · S · Medium

## 6. Quick wins
Finding IDs, each one line.

## 7. Long-term improvements
Finding IDs with dependencies.

## 8. Concepts worth learning
One block per concept: what it is · problem solved · how it works · when it pays off · needed now? · what implementing it teaches · example from this repo.

## 9. Existing strengths
Good decisions worth preserving, with evidence.

## 10. Not needed here
Practices considered and rejected for this project's size/scope, with the reason (cite `docs/ROADMAP.md` §7 where relevant).

## 11. Prioritised roadmap
Ordered steps grouped as: quick wins · important · long-term · enterprise-scale (not now). State dependencies.

## 12. Changes since previous audit
(Re-runs only.) Each earlier finding: Fixed / Still open / Changed, with verification evidence; new gaps.
````
