# Capability Library

This directory is an evidence and regression catalog. It is deliberately outside the PDF runtime authority chain.

Capability-specific formal assets live under `capabilities/<capability-id>/`. The root `capabilities.json` and `corpus.json` contain only unlayered definitions; the loader validates and merges every capability subdirectory into one frozen read-only snapshot. A capability subdirectory is the canonical data source for that capability. Archived governance Tasks remain audit provenance and are never loaded by the application.

The first layered capability is `capabilities/cap.column-recognition/`: seven formally promoted papers, 90 reviewed pages, frozen page/independent-region truth, the current 90/90 regression baseline, and the historical pre-repair findings/RCA.

`geometry-oracle.schema.json` and `geometry-oracle.js` freeze the independent Layout Geometry regression contract. They are offline evidence validators. They must not be imported by Main, Writer, Export, Column producer or UI. They do not store paper1–7 coordinate truth.

## Boundary

- It may describe capabilities, boundary features, expected regression outcomes, evidence and corpus provenance.
- It may validate and recursively freeze catalog snapshots.
- It must not classify a live document or produce semantic type, column type, reading order, layout, write or export decisions.
- Runtime facts remain owned by the matching `AA-*` Architecture Authority.
- Production code must never route by sample ID, file name, hash, publisher or expected result from this catalog.

## Intake

Run from `lingoflow-client/electron-app`:

```text
npm run capability:intake -- --manifest capability-library/examples/sample-intake.example.json --source C:\path\paper.pdf --out C:\path\review-record.json
```

The command computes file metadata and page count, validates the evidence-only boundary, and creates a review record. It never copies the PDF or appends directly to `corpus.json`; a human review is required before a record is committed.

## Candidate Pool (offline, no UI)

The existing PDF intake is reused; `candidate-pool.js` adds review and promotion, not another PDF parser or capability authority. Ajv executes the existing capability/corpus schemas and the new candidate schema. The public library loader and intake validation also execute the complete existing schemas. Candidate ingress rejects forbidden fields across the entire submission and rejects unknown top-level fields before projecting data. No application UI or PDF runtime decision logic is changed by these validation gates.

State flow: `pending -> under_review -> accepted | insufficient_evidence`; insufficient evidence can return to under_review. Accepted is terminal; promotion is a separately audited accepted-to-accepted event. Precheck validates format/references and exact ID/SHA-256 duplicates only. It does not infer root cause, classify PDF features, assess similarity semantically, or accept a candidate.

Run from electron-app, with each `--out` naming a **new** directory:

```text
npm run capability:candidates -- intake --manifest capability-library/examples/candidate-intake.example.json --source C:\path\paper.pdf --out C:\path\revision-1
npm run capability:candidates -- review --state C:\path\revision-1 --id candidate.replace-with-stable-id --status under_review --audit capability-library/examples/candidate-review.example.json --out C:\path\revision-2
npm run capability:candidates -- review --state C:\path\revision-2 --id candidate.replace-with-stable-id --status accepted --audit C:\path\acceptance-audit.json --out C:\path\revision-3
npm run capability:candidates -- promote --state C:\path\revision-3 --id candidate.replace-with-stable-id --audit C:\path\promotion-audit.json --out C:\path\revision-4
```

Replace example values; examples are templates, not reviewed samples. Acceptance requires a linked declared boundary, one reviewed oracle per attached capability, non-empty evidence references, and original AA owners. Promotion cannot introduce unreviewed oracles. Review may add evidence and oracles through events; original submission/provenance never changes. Conflicting oracle updates are explicit, retained in history, and latest reviewed assertion is materialized at promotion. Actor/time/reason are mandatory audit metadata; actor is human supplied, **not authenticated identity or cryptographic signing**.

Each revision contains candidates.json, corpus.json and capabilities.json together; COMMITTED is written last and its hash is verified before the CLI reads it. Existing directories are never overwritten. Failed/partial writes have no valid commit marker and cannot be used by the CLI. A promoted revision contains the formal regression corpus and synchronized capability references; candidates stay in the pool with promotion history. No revision is automatically published to the installed app or source catalogs. Preserve the entire immutable revision, not an individually copied corpus file. Concurrent branches require explicit human selection, not automatic merging.

Event chains detect accidental edits/truncation inconsistent with materialized state; they are not protection against an operator deliberately recomputing all hashes. Preserve revisions in version control or trusted evidence storage for stronger provenance. PDFs stay external; no binaries, secrets or absolute source paths are copied. Source hash is used only for evidence deduplication, never production routing. Initial candidates/corpus remain empty until an explicit user submission/review/promotion.
