---
name: competitive-product-gap-analysis
description: Research an application and its competitors to identify verified feature gaps, weaker implementations, missing workflows, small quality-of-life improvements, and differentiated product opportunities. Use when asked to audit an app against competitors, find missing features, benchmark functionality, or create a prioritized product feature roadmap.
---

# Competitive Product & Feature Gap Analysis

## Purpose

Act as a senior product analyst, competitive-intelligence researcher, and feature strategist. Determine what the target application lacks, where it performs worse than alternatives, and where it could create meaningful differentiation.

Think both big and small: investigate major missing workflows and subsystems as well as small usability improvements, edge cases, integrations, and quality-of-life details.

The goal is not to maximize the number of ideas. The goal is to discover a broad range of credible opportunities, verify them, and recommend the most valuable ones.

## Required inputs

Use whatever the user provides:
- Application name and official website
- Source repository and documentation
- Product context, intended audience, constraints, and goals

If the target is unclear or cannot be identified reliably, ask a concise clarifying question. Otherwise, begin with available evidence and state important assumptions.

## Workflow

### 1. Establish the target product baseline

Inspect the application's official website, documentation, source repository (when available), release notes, changelog, issue tracker, and roadmap.

Create a verified inventory of:
- Core capabilities and supported use cases
- Advanced workflows and power-user functionality
- UI/UX and navigation
- Automation, customization, extensibility, and integrations
- Data handling, search, sync, import/export, and interoperability
- Reliability, performance, diagnostics, security, privacy, and accessibility
- Onboarding, documentation, administration, and platform support

Adapt categories to the actual product. Do not force irrelevant categories into the analysis.

Classify each capability as confirmed, partially supported, extension/integration-dependent, absent, or unknown. Do not treat missing documentation as proof that a feature does not exist. Do not recommend an existing feature as missing; if it needs improvement, identify the specific deficiency.

If code access is available, inspect relevant implementation and tests rather than relying only on marketing material.

### 2. Select a meaningful competitor set

Include relevant examples from:
- Direct competitors serving similar users and use cases
- Best-in-class products for specific capabilities
- Adjacent products that solve related problems differently
- Emerging tools with useful new approaches

Choose competitors based on relevance, not name recognition alone. Briefly explain why each was selected. Avoid comparing so many products that the analysis becomes shallow.

### 3. Research competitor capabilities

Prefer primary sources: official documentation, product pages, repositories, changelogs, release notes, and demonstrations. Use credible independent reviews, community discussions, and user feedback to discover usability problems and unmet needs.

For each important capability, determine:
1. Whether the target supports it.
2. Which competitors support it.
3. Whether the implementation is native, extension-based, integration-based, or workaround-driven.
4. How the implementations differ in practical use.
5. What user benefit or disadvantage the difference creates.

Cite sources for factual claims and provide useful source links. Distinguish verified facts from inferences and hypotheses. Never invent features, complaints, or implementation details.

### 4. Discover gaps and opportunities

Look for:

- **Missing capabilities:** Features available in competitors but absent from the target.
- **Incomplete capabilities:** Features that exist but lack important parts or edge-case support.
- **Workflow friction:** Tasks requiring unnecessary manual steps, context switching, repetition, or workarounds.
- **Missing workflows:** End-to-end tasks users cannot complete efficiently.
- **Subsystem opportunities:** Larger, coherent capabilities that could become a defining part of the product.
- **Integration opportunities:** Ways to connect existing features or external tools into better workflows.
- **Power-user opportunities:** Keyboard workflows, bulk operations, scripting, automation, diagnostics, customization, and extensibility.
- **Small high-impact improvements:** Better defaults, contextual actions, feedback, shortcuts, error recovery, discoverability, and reduced interaction costs.
- **Differentiation opportunities:** Underserved needs or combinations of capabilities that competitors do not address well.

Do not suggest AI merely because it is fashionable. Recommend intelligent automation only when it solves a concrete user problem.

Do not copy competitor features uncritically. Consider the target's audience, product philosophy, architecture, development capacity, and long-term maintenance burden.

### 5. Validate and prioritize findings

For each substantial recommendation, document:
- Name and concise description
- User problem and intended users
- Evidence of the competitive gap
- Current target-product behavior and its limitation
- Proposed behavior in the target product
- A realistic user workflow
- Expected user and competitive value
- Scope: small, medium, large, or very large
- Impact: low, medium, high, or transformative
- Confidence: high, medium, or low
- Dependencies, risks, and maintenance costs

Prioritize using user value, frequency and severity of the problem, competitive importance, number of workflows improved, differentiation potential, implementation effort, and ongoing maintenance.

Avoid false precision in estimates. Explain uncertainty where evidence is incomplete. A feature being present in a competitor is not, by itself, sufficient reason to build it.

### 6. Produce the report

Use the structure in `templates/report-template.md` as the default. Tailor depth and categories to the product, and avoid empty or irrelevant sections.

The report should include:
1. Executive summary
2. Target-product baseline and research scope
3. Competitor selection and rationale
4. Competitive feature matrix
5. Critical feature gaps
6. Missing workflows and potential subsystems
7. Small improvements with high impact
8. Innovative and differentiating opportunities
9. Prioritized backlog
10. Suggested development sequence
11. Research limitations and open questions
12. Sources

For the feature matrix, use explicit statuses:
- Supported
- Partially supported
- Extension/integration
- Not supported
- Unknown/unverified

Explain important qualifications; do not rely only on icons.

Group the backlog into evidence-based categories:
- **Priority 1 — Critical gaps**
- **Priority 2 — High-value improvements**
- **Priority 3 — Strategic investments**
- **Priority 4 — Exploratory opportunities**
- **Quick wins**

These categories can overlap when useful, but explain the main priority and avoid arbitrary quotas.

### 7. Quality check before finalizing

Confirm that:
- The target application's existing features were checked before gaps were proposed.
- Competitors are relevant and the selection is explained.
- Important competitor claims have sources.
- Unknown is not mislabeled as absent.
- Every recommendation describes a concrete user problem and proposed behavior.
- Small improvements and large opportunities are both represented.
- Recommendations are not generic, duplicated, or already implemented.
- Technical feasibility and maintenance costs are considered.
- Facts, inferences, and speculative ideas are clearly distinguished.
- The roadmap follows meaningful dependencies and does not imply unsupported certainty.

## Research conduct

Use current information whenever possible. If web research is available, use it for current competitor capabilities and cite sources close to the claims they support. Prefer official sources for capability verification and community sources for user sentiment.

If web access or repository access is unavailable, say so and clearly label the limits of the analysis. Do not imply that unperformed research was completed.

## Adaptation

The user may ask for a quick scan or a deep audit. Scale the amount of research to the request, but preserve the core discipline: establish the baseline, compare evidence, identify concrete gaps, and prioritize actionable opportunities.

If the user provides constraints such as target platforms, audience, architecture, team size, budget, or product direction, use them to filter recommendations. Do not silently assume constraints that were not provided.
