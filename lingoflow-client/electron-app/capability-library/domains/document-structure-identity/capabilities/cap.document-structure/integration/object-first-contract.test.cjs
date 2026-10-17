"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildObjectFirstContract, validateObjectFirstContract, SCHEMA_VERSION } = require("./object-first-contract.cjs");

const box = { x: 1, y: 2, width: 3, height: 4 };
function fixture() {
  const reference = { objectId: "ref-1", type: "reference", paper: 1,
    sourceLineIds: ["b", "c"], sourceText: "entry", spatialFragments: [
      { page: 1, bbox: box, sourceLineIds: ["b"] },
      { page: 2, bbox: box, sourceLineIds: ["c"] },
    ] };
  const source = { schemaVersion: "DerivedSourceSpanInventory/test", authority: "none",
    pages: {
      "1:1": { paper: 1, pageNumber: 1, sourcePdfSha256: "pdf", sourceLines: [
        { sourceLineId: "a" }, { sourceLineId: "b" }] },
      "1:2": { paper: 1, pageNumber: 2, sourcePdfSha256: "pdf", sourceLines: [
        { sourceLineId: "c" }] },
    } };
  const candidate = { schemaVersion: "OfflineStructuralObjectCandidate/test",
    authority: "none", status: "machine_candidate_pending_human_review",
    summary: { pages: 2, sourceLines: 3, assigned: 3, pending: 0, excluded: 0,
      pageLocalObjects: 2, documentReferenceObjects: 1,
      byType: { reference: 2, formula: 1, figure: 1 } },
    documentReferenceObjects: [reference], pages: {
      "1:1": { paper: 1, pageNumber: 1, sourcePdfSha256: "pdf",
        objects: [
          { objectId: "formula-1", type: "formula", page: 1,
            sourceLineIds: ["a"], sourceText: "x=y",
            spatialFragments: [{ bbox: box, sourceLineIds: ["a"] }] },
          { objectId: "figure-1", type: "figure", page: 1,
            sourceLineIds: [], sourceText: "", internalTextOpaque: true,
            spatialFragments: [{ bbox: box, sourceLineIds: [] }] },
        ], referenceObjectRefs: [{ objectId: "ref-1", type: "reference",
          sourceLineIds: ["b"], bbox: box }], pendingMembership: [], excludedSourceLines: [] },
      "1:2": { paper: 1, pageNumber: 2, sourcePdfSha256: "pdf",
        objects: [], referenceObjectRefs: [{ objectId: "ref-1", type: "reference",
          sourceLineIds: ["c"], bbox: box }], pendingMembership: [], excludedSourceLines: [] },
    } };
  return { candidate, source };
}

test("Object-first contract keeps Objects separate from legacy segments", () => {
  const { candidate, source } = fixture();
  const result = buildObjectFirstContract(candidate, source);
  assert.equal(result.schemaVersion, SCHEMA_VERSION);
  assert.equal(result.authority, "none");
  assert.equal(result.legacySegmentCompatibility, "not_wire_compatible");
  assert.equal(result.summary.byType.reference, 1);
  assert.equal(result.summary.referencePlacements, 2);
  assert.equal(result.referenceFragments.length, 2);
  assert.deepEqual(result.residuals, []);
  assert.equal(result.summary.assigned, 3);
  assert.equal(result.objects.find(o => o.objectId === "figure-1").internalTextOpaque, true);
  assert.match(result.artifactId, /^object-first-structure-candidate-sha256:[a-f0-9]{64}$/);
  assert.equal(buildObjectFirstContract(candidate, source).artifactId, result.artifactId);
  assert.equal(validateObjectFirstContract(JSON.parse(JSON.stringify(result))).artifactId,
    result.artifactId);
  source.pages["1:2"].sourceLines.push({ sourceLineId: "d" });
  candidate.pages["1:2"].pendingMembership.push({ sourceLineId: "d" });
  candidate.summary.sourceLines += 1;
  candidate.summary.pending += 1;
  assert.deepEqual(buildObjectFirstContract(candidate, source).residuals,
    [{ pageKey: "1:2", sourceLineId: "d", disposition: "pending" }]);
});

test("serialized Object contract fails closed after mutation", () => {
  const { candidate, source } = fixture();
  const contract = JSON.parse(JSON.stringify(buildObjectFirstContract(candidate, source)));
  contract.objects[0].sourceLineIds.push("injected");
  assert.throws(() => validateObjectFirstContract(contract), /content hash differs/);
  const intact = JSON.parse(JSON.stringify(buildObjectFirstContract(candidate, source)));
  intact.artifactId = "semantic-structure-sha256:fake";
  assert.throws(() => validateObjectFirstContract(intact), /content hash differs/);
});

test("figure and table contracts stay opaque regardless of legacy flag", () => {
  for (const type of ["figure", "table"]) for (const flag of [undefined, false, true]) {
    const { candidate, source } = fixture();
    const object = candidate.pages["1:1"].objects[1];
    object.type = type;
    if (flag === undefined) delete object.internalTextOpaque;
    else object.internalTextOpaque = flag;
    if (type === "table") {
      delete candidate.summary.byType.figure;
      candidate.summary.byType.table = 1;
    }
    const before = structuredClone(candidate);
    const result = buildObjectFirstContract(candidate, source);
    assert.equal(result.objects.find(o => o.objectId === object.objectId).internalTextOpaque, true);
    assert.equal(result.objects.find(o => o.type === "formula").internalTextOpaque, false);
    assert.deepEqual(candidate, before, "projection must not rewrite inference evidence");
    validateObjectFirstContract(JSON.parse(JSON.stringify(result)));
  }
});

test("Object-first contract fails closed on lost ownership or unknown type", () => {
  const { candidate, source } = fixture();
  const duplicate = structuredClone(candidate);
  duplicate.pages["1:1"].objects[0].sourceLineIds.push("b");
  assert.throws(() => buildObjectFirstContract(duplicate, source), /exactly once/);
  const unknown = structuredClone(candidate);
  unknown.pages["1:1"].objects[0].type = "mystery";
  assert.throws(() => buildObjectFirstContract(unknown, source), /unsupported Object type/);
  const wrongAuthority = structuredClone(candidate);
  wrongAuthority.authority = "runtime";
  assert.throws(() => buildObjectFirstContract(wrongAuthority, source), /non-authoritative/);
});
