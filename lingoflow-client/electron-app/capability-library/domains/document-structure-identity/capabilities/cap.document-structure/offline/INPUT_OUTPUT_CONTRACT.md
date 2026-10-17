# D1 Object-first implementation: declared input/output contract

Contract documentation for the existing implementation, 2026-10-16. This file
does not change classification, create a new algorithm version, promote the
capability beyond `pilot_ready`, or authorize canonical Runtime use.

## Entry points and required inputs

| Entry | Inputs and responsibility |
|---|---|
| `pdf-full-pipeline.cjs::buildFromPdf` | Existing native-text PDF path, positive integer `paper` identity, Python executable, `pdftoppm` executable, existing writable run directory; default `visualRegionMode: "native"` |
| `pdf-stage35-82.cjs::build` | Caller-provided observed source inventory, input identity hash/bytes, the same native tools and run directory; `visualRegionMode` explicitly `none` or `native` |
| `inherited-stage35-82.cjs::{prepare,complete,build}` | Source-only pages, their input identity, and all named independent native-PDF evidence objects; does not read a reviewed corpus or acquire missing evidence |
| `integration/object-first-contract.cjs::{buildObjectFirstContract,validateObjectFirstContract}` | Completed candidate plus derived source inventory to build the contract; serialized contract for content-hash/schema/internal-accounting revalidation |

The evidence-driven pure boundary requires these inputs before its preparation:
`stage44LabelSpans`, `stage44GlyphBoxes`, `stage48MissedLabelSpans`,
`stage49LabelSpans`, `stage49GlyphEvidence`, `stage50PanelEvidence`,
`stage52RightLabelSpans`. Completion additionally requires
`stage53RecalledGlyphExtents`, `stage56GlyphExtents`, `stage58GlyphExtents`,
`stage59GlyphExtents`, `stage60GlyphExtents`, `stage61GlyphExtents`,
`stage62GlyphAudit`, `stage65GlyphAudit`, `stage66BodyGlyphSupport`,
`stage67GlyphEvidence`, `stage68LabelEvidence`, `stage69Typography`,
`stage70BoundaryEvidence`, `stage71SpanEvidence`, `stage72MemberEvidence`,
`stage73NativeEvidence`. Missing named evidence fails rather than loading a saved
answer. The names preserve algorithm lineage; validation batch IDs such as B001
are a separate namespace and do not rename these inputs.

`buildFromPdf` derives these evidence objects from the current PDF at the
appropriate intermediate candidate, using the capability-local Python scripts.
Its Node extraction adapter evaluates the current application's `main.js` in a
blocked VM to reuse PDF.js line formation and geometry. This is an explicit
application-source dependency. Although that extractor also computes a legacy
semantic artifact, only observed line/item text, geometry, page dimensions and
column information are passed into Object-first inference. A diagnostic
`legacyStructureArtifact` return field currently exists in the dirty worktree;
it is a paused integration proposal and is not part of this D1 contract.

The raw-PDF adapter cannot handle every PDF: each page must provide native text
items and positive page dimensions. Image-only/scanned pages have no supported
OCR path here; encryption, nonhorizontal text and other untested input forms are
not accepted as covered. Source accounting starts at the observed inventory;
it does not prove all painted PDF content survived upstream extraction.

The validated environment must be recorded, including Node/PDF.js, Python,
pdfplumber/pdfminer/Pillow and Poppler versions and relevant code hashes.
Python/Poppler are caller-supplied dependencies, not bundled by this contract.
The PDF path, hash and page count must agree with the source inventory used by
native evidence. The input must not change during a run. Large runs require
enough temporary disk and memory for per-character evidence. Scripts use
bounded per-process timeouts; failures must remain visible.

## Output bundle

The full D1 validation/traceability bundle is **candidate + derived source +
source/PDF identity + evidence/provenance + code/environment manifest**.
The compact Object contract is a validated index into that bundle, not a
replacement for all source text, span lineage or geometric evidence.

- Candidate schema prefix: `OfflineStructuralObjectCandidate/`; authority
  `none`; status `machine_candidate_pending_human_review`.
- Derived source schema prefix: `DerivedSourceSpanInventory/`; authority `none`.
  Source pages retain paper/page identity, PDF SHA-256, dimensions and explicit
  source units. Original observed input uses `OfflineStructureFrozenInput/v1`;
  its word "Frozen" does not mean human-reviewed truth on a new PDF.
- A page has `objects`, `referenceObjectRefs`, `pendingMembership` and
  `excludedSourceLines`. Every derived source unit occurs exactly once across
  these dispositions. Preservation/exclusion and pending must remain explicit.
- A page-local Object has `objectId`, `type`, ordered `sourceLineIds`,
  `sourceText` and one or more `spatialFragments`. Geometry alone must not be
  used to silently recompute source membership.
- A whole-reference Object is document-scoped. Its page placements are separate
  `referenceObjectRefs`; one reference may span pages. Count document Objects
  and page placements separately.
- Image-only regions may validly have no text members. `internalTextOpaque`
  marks a container whose internal text must not be independently reclassified
  as page prose. Its correctness remains an inference/acceptance question.

Supported type identifiers:

```text
title
author
front_matter_affiliation_or_contact
abstract
heading
body
caption
figure
table
formula
equation_number
reference
page_number
running_header
unsupported_structured_block
```

Unknown/ambiguous membership is a pending disposition, not an implicit `body`
Object or a new `unresolved` type. `unsupported_structured_block` explicitly
retains an object region when recognized structure is outside supported forms;
it does not imply the structure's detailed contents have been understood.
Inline mathematics remains in prose when supported by paragraph semantics;
displayed formulas and printed equation numbers have distinct identities.

## Coordinates, spans and identity

All coordinates are PDF points relative to the page. Source line `bbox.y` is
the extraction baseline/envelope convention used by this pipeline; its
top-left envelope is obtained with `y - height`. Object `spatialFragments.bbox`
already uses a top-left origin and downward y. Do not subtract height again
from an Object fragment or treat source-line and Object coordinates as
interchangeable. Native glyph evidence can refine the visual frame. Large
PDF-drawn parentheses/brackets can lie beyond extracted glyph/source envelopes;
that historical accepted visual limitation is not a new ownership Object.

Split units retain `parentSourceLineId`, `sourceSpanKind`, `textSpan` and
appropriate `sourceSpanLineage` records. Historical span representation may be
`[start,end]` or `{start,end}`; both express half-open JavaScript string offsets
in the corresponding normalized parent text, not PDF file byte offsets.
Parent/native text and evidence must remain available when a parent no longer
appears in the final source array. Intermediate lineage is not inferred from
suffixes or a painted rectangle. Preserve the full bundle for exact tracing.

Object IDs are scoped to a candidate revision. They are not a tested promise
of stable identity across different PDFs, input paper IDs, extraction changes,
code revisions or corrected split/merge decisions. Use
`(contract.artifactId, objectId)` for immutable references and retain explicit
source/split/merge provenance when comparing revisions. Do not renumber Objects
at a consumer boundary or deduce revision lineage from a matching ID alone.

`object-first-structure-candidate/v1` is recursively frozen and content-addressed
by `object-first-structure-candidate-sha256:<hash>`. It records page/PDF identity,
Objects, reference placements and pending/excluded residuals. Revalidate after
serialization. Correcting source/type/membership/geometry requires a new
candidate/contract and preserved prior evidence, not an in-place edit to an
accepted artifact. Raw producer candidate/source objects are ordinary mutable
data; the contract's recursive freeze does not retroactively freeze that bundle.

## Validation strength and failure boundaries

At contract construction, `figure` and `table` are always projected with
`internalTextOpaque: true`, including legacy candidates with an absent/false
flag. Their source members remain available for provenance, not independent
translation/classification. This is a type-level consumption rule, not proof
that the frame is correct or that no foreign-owned source lies within it.
Construction does not mutate the original candidate. Previously serialized
contracts retain their original content hash; regenerate a new contract rather
than patching an old artifact in place. Serialized validation alone checks its
declared payload, not retrospective application of the current projection rule.

Contract construction checks schema/status/authority, unique Object/source
identities, supported types, finite positive frame geometry, exact source
ownership, complete reference placements and declared summary counts. Serialized
validation checks the content hash and internal accounting again. These checks
do not constitute semantic classification accuracy, native glyph transcription,
pixel-perfect frames, full-page visible coverage or a human acceptance decision.

An unknown type, mismatched page/PDF identity, missing evidence, missing native
tool, lost/duplicated member or invalid reference placement must fail visibly.
Valid but pending source units are retained rather than fabricated as Objects;
their severity and consumer consequences need explicit acceptance. A zero
pending count still does not certify correct types, grouping or discovered
figures/tables.

## Domain and Runtime ownership

D1 owns types, grouping, member assignments, provenance, contract validity and
disclosure of inference defects. D2/its architecture authorities own declared
Column/Geometry facts; this pipeline's native visual proposals are explicitly
priors derived from the current PDF and are not a replacement D2 canonical
authority. Ambiguous spatial inputs must be reported with their provenance.

The compact contract explicitly declares `not_wire_compatible` with the legacy
`semantic-structure-artifact/v1`. Translation policy, reading-order/carrier
adaptation, Layout/Mask/Write/Export integration, canonical publication and
rollback belong to the separate Runtime migration task. In particular the
combined affiliation/contact type is not automatically a translation policy.
No consumer should create a local classifier to compensate for D1 defects.

Stage82 remains historically accepted with stated limits at `pilot_ready`.
Independent validation evidence must distinguish reproducible execution/source
conservation from semantic acceptance and retain actual new-PDF defects. This
document does not close an acceptance gate by declaration.
