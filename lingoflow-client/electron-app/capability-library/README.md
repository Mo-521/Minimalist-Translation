# Capability Library

This directory is an evidence and regression catalog outside the PDF runtime authority chain. Its single organization model is:

```text
Capability Library
  -> Domain
    -> independent Capability
      -> Capability-owned assets
```

Domains organize and present the system. They do not own Architecture Authority, Evidence, Regression, Oracle, Candidate Pool or runtime canonical facts. Independent Capabilities remain the units of implementation, Evidence, Regression, Promotion and Authority.

## Directory contract

```text
capability-library/
├─ domains/
│  ├─ document-structure-identity/
│  │  ├─ DOMAIN.md
│  │  └─ capabilities/cap.document-structure/
│  ├─ column-region-recognition/
│  │  ├─ DOMAIN.md
│  │  └─ capabilities/
│  │     ├─ cap.column-recognition/
│  │     └─ cap.layout-geometry/
│  ├─ content-placement/{DOMAIN.md, capabilities/}
│  ├─ layout-composition/{DOMAIN.md, capabilities/}
│  └─ export-validation/{DOMAIN.md, capabilities/}
├─ registry/{domains.json, capabilities.json, candidates.json}
├─ schemas/*.schema.json
├─ shared/corpus.json
├─ workflow/{candidate-pool.js, examples/}
├─ index.js
└─ README.md
```

`registry/domains.json` is the canonical five-Domain registry. `registry/capabilities.json` retains the historical top-level records as acceptance contracts or compatibility representations; it is not a second independent-Capability registry. `shared/corpus.json` is the library-level empty/shared corpus. The loader discovers independent Capability catalogs only below each Domain's `capabilities/` directory and merges all sources into one recursively frozen snapshot.

No legacy aliases remain at the old root paths. Archived governance Tasks may mention older paths as historical provenance, but the application and tools never load them.

## Current Capability graph

Three independent Capability records exist. `cap.document-structure` is `pilot_ready` after the first-batch review and regression. It is callable through a separate application action, but its candidates have no Capability-level consumer edge and have not replaced the legacy translation/export path. Column and Geometry retain their existing independent relationship:

```text
cap.document-structure (pilot_ready; separate non-authoritative app action; AA-STRUCTURE-001)
  produces fact.structure.canonical-semantic-type
           fact.structure.source-segment-boundary
  no established Capability DAG edge yet

cap.column-recognition
  produces fact.column.canonical-page-column-model (AA-COLUMN-001)
    -> cap.layout-geometry requires it as canonical_read_only
       and is forbidden to override AA-COLUMN-001
```

- `cap.column-recognition` owns Column facts and keeps its own Authority, Evidence, Regression and Promotion history.
- `cap.layout-geometry` owns reviewed region/geometry facts and keeps its own Authority, Evidence, Regression, Promotion and Oracle contract.

They are not merged. No Structure→Identity→Column edge is declared: Object Identity is not established and the current runtime Column model is prepared before the Structure artifact freezes. The D1 implementation under `cap.document-structure` can produce candidates independently when the user invokes it; the registry itself remains an evidence catalog and does not classify live documents or replace the existing translation-chain Structure producer.

`schemas/capability.v1.schema.json` exists only to validate immutable historical Candidate Pool revisions without rewriting their hashes or conclusions. The live loader accepts only `capability-library/v2`.

The Geometry Oracle validator and schema live with the owning Capability under `domains/column-region-recognition/capabilities/cap.layout-geometry/oracles/`. They remain offline evidence validators and must not be imported by Main, Writer, Export, Column producer or UI.

## Legacy record classification

| Record | Domain | Classification | Retention reason |
|---|---|---|---|
| `cap.semantic-structure` | document-structure-identity | acceptance contract | Keeps historical Structure acceptance assertions. Runtime facts belong to the existing producer documented by `cap.document-structure`; this record owns none. Review its assertions before any later retirement. |
| `cap.paragraph-object-identity` | document-structure-identity | acceptance contract | Preserves identity acceptance semantics without creating Identity runtime ownership. |
| `cap.geometry-layout` | layout-composition | acceptance contract | Preserves the broad layout acceptance view; it does not replace `cap.layout-geometry`. |
| `cap.mask-write` | content-placement | acceptance contract | Preserves mask/write acceptance semantics without beginning implementation. |
| `cap.translation-completeness` | content-placement | acceptance contract | Preserves translation terminal-state acceptance. |
| `cap.write-completeness` | content-placement | acceptance contract | Preserves write conservation acceptance. |
| `cap.scientific-object-fidelity` | layout-composition | acceptance contract | Preserves scientific-object fidelity acceptance. |
| `cap.export-state` | export-validation | acceptance contract | Preserves export terminal-state acceptance. |

These records appear only in the secondary “验收契约” section of a Domain Detail view. They do not count as established Capabilities.

## Boundary

- Catalogs may describe capability identity, boundary features, expected regression outcomes, evidence and corpus provenance.
- Catalogs must not classify a live document or produce semantic type, column type, reading order, layout, write or export decisions.
- Runtime facts stay with their matching `AA-*` Authority.
- Production code must never route by sample ID, file name, hash, publisher or expected result from this catalog.

## Offline intake and Candidate Pool

Run from `lingoflow-client/electron-app`:

```text
npm run capability:intake -- --manifest capability-library/workflow/examples/sample-intake.example.json --source C:\path\paper.pdf --out C:\path\review-record.json
npm run capability:candidates -- intake --manifest capability-library/workflow/examples/candidate-intake.example.json --source C:\path\paper.pdf --out C:\path\revision-1
npm run capability:candidates -- review --state C:\path\revision-1 --id candidate.replace-with-stable-id --status under_review --audit capability-library/workflow/examples/candidate-review.example.json --out C:\path\revision-2
```

`workflow/candidate-pool.js` is an offline review/promotion workflow, not Capability or runtime Authority. Revisions remain immutable three-file snapshots (`candidates.json`, `corpus.json`, `capabilities.json`) with `COMMITTED` written last. The source registry, accepted Oracle content, Candidate conclusions and promoted regression facts are not rewritten by the physical migration.
