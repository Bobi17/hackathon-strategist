---
name: data-analysis
description: Profile provided hackathon datasets — schema, size, quality, distributions, and signals — and produce a solution-leverage map. Use before scoring so data-driven ideas are grounded.
---

# Data Analysis — dataset profiling & leverage map

Procedure for the Data Analyst persona. Turns raw data files into evidence the
innovation and scoring stages can build on.

## Steps
1. **Inventory:** enumerate `dataFiles`, detect format (csv/json/xlsx/pdf), and
   record row/column counts and rough size. Unreadable files are flagged, not
   dropped silently.
2. **Profile:** per dataset — columns + types, missing-value rate, value
   distributions, and obvious outliers. Compute nothing heavy; the goal is
   signal, not a pipeline.
3. **Signals:** list the 3–5 most decision-relevant findings (e.g., a column
   that predicts the outcome, a geographic skew, a time dimension).
4. **Leverage map:** for each signal, state which *solution classes* it enables
   ("this dataset can drive a prediction UI") and which it precludes. This map
   feeds `dataLeverage` scoring.
5. **Cite:** each finding references the file + column, stamped with confidence.

## Degradation
- No datasets → the Data Analyst reports "no data provided"; the
  `dataLeverage` weight is dropped and renormalized in the scoring model.
- Large files → sample deterministically (seeded) and say so; never block the
  budget on full scans.

## Output
`DataProfile[]` (schema, quality, signals) + a `LeverageMap` (class → enabled /
precluded), all with citations, written into `evidence-dossier.md`.
