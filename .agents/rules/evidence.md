# Rule: Evidence & Citation Discipline

Standing directive for every persona and every artifact. Always applies.

## Every claim carries evidence
- Each `ResearchFinding` and every scored statement includes `Evidence`:
  a **source** (URL, file path + line, dataset name + column) and a
  **confidence** stamp (`high` | `medium` | `low`).
- `high` = directly observed or quoted from the source. `medium` = inferred
  from the source. `low` = assumption; must be labeled *"assumption"*.

## Never fabricate sources
- If a source was not actually fetched/read, do not cite it. Cite what the
  tools actually returned.
- When input is missing (no rubric, no data), the persona says so and continues
  on a clearly-labeled assumption — it never invents a rubric or dataset.

## Traceability
- Every score in `shortlist.md` and `decision-brief.md` traces to a claim in
  `evidence-dossier.md`, which traces to a source.
- Reviewers' `revise` feedback must cite evidence or the *absence* of evidence
  ("nothing in the dossier supports X").
- Human directives are logged verbatim and treated as authoritative input, not
  claims to be re-verified.

## Enforcement
- The runner validates that structured persona output conforms to the
  `ResearchFinding`/`IdeaCard`/`ReviewerVerdict` shapes before the engine
  consumes it. Non-conforming output is rejected and re-requested once, then
  flagged as a degraded role.
