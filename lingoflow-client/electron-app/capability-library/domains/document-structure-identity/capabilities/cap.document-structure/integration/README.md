# Object-first integration boundary

`object-first-contract.cjs` turns a completed offline candidate and its derived
source inventory into a versioned, non-authoritative Object contract. It checks
the exact-once ownership of every source unit, document-reference fragment
membership, page/PDF identity, supported Object types and finite geometry. It
retains page placements and explicit pending/excluded source-unit residuals, so
a future consumer cannot silently treat missing Objects as absent content.
The returned contract is frozen and content-addressed. It is deliberately **not**
wire-compatible with the current segment-based `SemanticStructureArtifact`.
`validateObjectFirstContract` rechecks a serialized contract's hash, schema,
Object identities, geometry, document-reference page placements and internal
source accounting before a future consumer accepts it. This is an interface
gate, not a new classifier or an approval of a machine candidate.

The accepted 126-page Stage 82 candidate passes this boundary with 7,730 source
units, 2,086 Objects, 371 document-level reference Objects and 374 reference
page placements. Its historical `summary.byType.reference` counts placements;
the new contract reports object count and placement count separately. This is
an interface accounting distinction, not a new classification decision.

The development-only shadow path validates this contract and records its
artifact ID without publishing Objects to legacy consumers. Separately, the
formal application's `main.js` registers `pdf:object-first-structure`:
`integration/shadow-runtime.cjs` runs the accepted PDF pipeline in a Worker,
then the main/renderer boundary validates the returned Object contract, source
inventory and PDF identity. The renderer exposes a separate "run D1" action;
it does **not** replace the old extraction, translation, layout, masking or PDF
export path. The result remains `authority: none`,
`candidate_pending_runtime_gate` and `not_wire_compatible` with the old
segment artifact. Missing native tools, invalid input and Worker/contract
failure are reported explicitly rather than publishing an unverified result.

`pdf:configure-object-first-tools` saves checked absolute Python and Poppler
paths in the application's own userData; explicit environment paths also
work. Python with pdfplumber/Pillow and `pdftoppm` remain external runtime
prerequisites. Local discovery or a successful development run does not mean
they are bundled or that an installer/another machine has been validated.
Native preflight distinguishes missing Python modules and a broken Poppler
executable from semantic pipeline errors, off the UI thread.

The first-batch validation history and future consumer limitations are recorded
once in [`../batches/B001/README.md`](../batches/B001/README.md). Formal
implementation and tests are in this capability and the app; the closed
Runtime Task's PDF write/shadow reports are not inputs to current D1 IPC.
