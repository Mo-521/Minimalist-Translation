"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { configuration, probeNativeDependencies, reportFor,
  scheduleShadowForPdf } = require("./shadow-runtime.cjs");

test("shadow native preflight separates installation failures from recognition", () => {
  const invocations = [];
  const ready = (file, args) => {
    invocations.push({ file, args });
    return { status: 0, stderr: "" };
  };
  assert.deepEqual(probeNativeDependencies("python.exe", "pdftoppm.exe", ready),
    { status: "ready" });
  assert.equal(invocations.length, 2);
  assert.deepEqual(invocations[0].args,
    ["-c", "import pdfplumber; from PIL import Image"]);
  assert.deepEqual(invocations[1].args, ["-v"]);
  assert.equal(probeNativeDependencies("python.exe", "pdftoppm.exe",
    () => ({ status: 1, stderr: "No module named pdfplumber" })).status,
    "python_modules_unavailable");
  assert.equal(probeNativeDependencies("python.exe", "pdftoppm.exe",
    (file) => ({ status: file === "python.exe" ? 0 : 1, stderr: "missing DLL" })).status,
    "pdftoppm_unavailable");
});

test("shadow is disabled by default and cannot affect the current PDF result", () => {
  assert.deepEqual(configuration({}), { status: "disabled" });
  assert.deepEqual(scheduleShadowForPdf("missing.pdf", { env: {} }), { status: "disabled" });
  assert.deepEqual(configuration({ LINGOFLOW_OBJECT_FIRST_SHADOW: "1" }),
    { status: "missing_native_dependencies" });
});

test("shadow report contains accounting, not canonical Objects", () => {
  const box = { x: 1, y: 2, width: 3, height: 4 };
  const input = { sourcePdfSha256: "pdf-hash",
    extractionMainSha256: "extractor-hash",
    observedSource: { summary: { pageCount: 2 } },
    source: { schemaVersion: "DerivedSourceSpanInventory/test", authority: "none",
      pages: {
        "1:1": { paper: 1, pageNumber: 1, sourcePdfSha256: "pdf-hash",
          sourceLines: ["a", "b", "c"].map(sourceLineId => ({ sourceLineId })) },
        "1:2": { paper: 1, pageNumber: 2, sourcePdfSha256: "pdf-hash",
          sourceLines: ["d", "e"].map(sourceLineId => ({ sourceLineId })) },
      } },
    candidate: { schemaVersion: "OfflineStructuralObjectCandidate/test",
      authority: "none", status: "machine_candidate_pending_human_review",
      summary: { sourceLines: 5, assigned: 3, pending: 2,
        excluded: 0, pages: 2, pageLocalObjects: 1,
        documentReferenceObjects: 0, byType: { body: 1 } },
      documentReferenceObjects: [], pages: {
        "1:1": { paper: 1, pageNumber: 1, sourcePdfSha256: "pdf-hash",
          objects: [{ objectId: "body-1", type: "body", page: 1,
            sourceLineIds: ["a", "b", "c"], sourceText: "not exported",
            spatialFragments: [{ bbox: box, sourceLineIds: ["a", "b", "c"] }] }],
          pendingMembership: [], excludedSourceLines: [] },
        "1:2": { paper: 1, pageNumber: 2, sourcePdfSha256: "pdf-hash",
          objects: [], pendingMembership: [{ sourceLineId: "d" }, { sourceLineId: "e" }],
          excludedSourceLines: [] },
      } },
    nativeVisualRegions: { summary: { tables: 0, figures: 1 } } };
  const report = reportFor(input);
  assert.equal(report.authority, "none");
  assert.equal(report.status, "completed_not_semantically_accepted");
  assert.equal(report.pending, 2);
  assert.match(report.candidateArtifactId, /^object-first-candidate-sha256:[a-f0-9]{64}$/);
  assert.match(report.objectContractArtifactId,
    /^object-first-structure-candidate-sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(report).includes("not exported"), false);
  const malformed = structuredClone(input);
  malformed.candidate.summary.assigned = 4;
  assert.throws(() => reportFor(malformed), /source accounting/);
  const authority = structuredClone(input);
  authority.candidate.authority = "runtime";
  assert.throws(() => reportFor(authority), /non-authoritative/);
  const pageCount = structuredClone(input);
  pageCount.observedSource.summary.pageCount = 3;
  assert.throws(() => reportFor(pageCount), /page count/);
  const lost = structuredClone(input);
  lost.candidate.pages["1:2"].pendingMembership.pop();
  assert.throws(() => reportFor(lost), /exactly once/);
  assert.equal(reportFor(input).candidateArtifactId, report.candidateArtifactId);
  const changed = structuredClone(input);
  changed.candidate.pages["1:1"].objects[0].sourceText = "different";
  assert.notEqual(reportFor(changed).candidateArtifactId, report.candidateArtifactId);
});
