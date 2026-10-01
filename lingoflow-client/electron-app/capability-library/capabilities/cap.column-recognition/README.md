# cap.column-recognition

This directory is the canonical Capability Library source for Column Recognition Evidence. Archived Tasks are provenance/audit records only and are not loaded by the library.

## Formal assets

- `capabilities.json`: the single capability definition, Authority boundary and coverage declarations.
- `corpus.json`: ten explicitly promoted samples. Each sample contains immutable source metadata and the accepted page/independent-region truth under `expectedOutcomes`.
- `baseline/summary.json`: current regression baseline — paper1–10, 10 samples, 126 pages, 126 pass, 0 findings.
- `baseline/paperN-regression.json`: current per-page outputs from the accepted PageColumnModel implementation.
- `evidence/pre-repair-regression/`: the original formal comparisons that produced 34 findings.
- `evidence/root-cause-analysis.json`: the RCA that connected those findings to the former competing decision sites.
- `bundle.json`: canonical-source and provenance declaration.

## Coverage boundary

- Page `single_column`, `double_column`, and `mixed` are judged only from body text flow.
- Non-body material is recorded as an independent region. The frozen finite vocabulary in the promoted truth is `title`, `abstract`, `figure`, `figure_caption`, `table`, `references_section_header`, and `other_independent`.
- Current formal corpus covers 71 single-column pages and 55 double-column pages. It contains no real mixed-body-flow page.
- paper8–10 promotion is recorded in `evidence/paper8-10-promotion.json`, the accepted/promoted Candidate histories and the formal Column corpus. The historical `localReviewEvidence` pointer in that promotion record names an earlier review-pack directory that was already absent before the 2026-10-01 Geometry evidence relocation; do not treat it as a current file location. paper10 has a 10/10 confirmed Column export; paper8–9 were explicitly approved unchanged by the user. Finite independent-region type presence was derived from their separately confirmed non-body review exports. The original seven sample truths remain byte-for-byte equivalent as objects.
- `ordinary1`, `ordinary2`, and `scan1` were not promoted and are not formal samples.
- PDFs remain external. The corpus stores file name, hash, byte count, page count, provenance and reviewed expectations; it does not store PDF binaries.

## Authority boundary

`runtimeDecisionUse` is always `forbidden`. This bundle cannot classify a production page, change a PageColumnModel, or route PDF processing. Only `AA-COLUMN-001` owns runtime column decisions. The Capability Library and its UI are read-only Evidence consumers.
