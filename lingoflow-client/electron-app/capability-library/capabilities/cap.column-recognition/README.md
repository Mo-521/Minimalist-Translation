# cap.column-recognition

This directory is the canonical Capability Library source for Column Recognition Evidence. Archived Tasks are provenance/audit records only and are not loaded by the library.

## Formal assets

- `capabilities.json`: the single capability definition, Authority boundary and coverage declarations.
- `corpus.json`: seven explicitly promoted samples. Each sample contains immutable source metadata and the accepted page/independent-region truth under `expectedOutcomes`.
- `baseline/summary.json`: current regression baseline — paper1–7, 7 samples, 90 pages, 90 pass, 0 findings.
- `baseline/paperN-regression.json`: current per-page outputs from the accepted PageColumnModel implementation.
- `evidence/pre-repair-regression/`: the original formal comparisons that produced 34 findings.
- `evidence/root-cause-analysis.json`: the RCA that connected those findings to the former competing decision sites.
- `bundle.json`: canonical-source and provenance declaration.

## Coverage boundary

- Page `single_column`, `double_column`, and `mixed` are judged only from body text flow.
- Non-body material is recorded as an independent region. The frozen finite vocabulary in the promoted truth is `title`, `abstract`, `figure`, `figure_caption`, `table`, `references_section_header`, and `other_independent`.
- Current formal corpus covers 44 single-column pages and 46 double-column pages. It contains no real mixed-body-flow page.
- `ordinary1`, `ordinary2`, and `scan1` were not promoted and are not formal samples.
- PDFs remain external. The corpus stores file name, hash, byte count, page count, provenance and reviewed expectations; it does not store PDF binaries.

## Authority boundary

`runtimeDecisionUse` is always `forbidden`. This bundle cannot classify a production page, change a PageColumnModel, or route PDF processing. Only `AA-COLUMN-001` owns runtime column decisions. The Capability Library and its UI are read-only Evidence consumers.
