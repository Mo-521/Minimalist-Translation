"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  produceSemanticStructureArtifact,
} = require("../../../electron-app/semantic-structure-authority");
const {
  validateAndRefreezeArtifact,
  compareConsumerCarrierSegments,
  bindSemanticStructureConsumerSegments,
  bindSemanticStructureConsumerPayload,
} = require("../../../electron-app/semantic-structure-consumer-authority");

function fixture() {
  const segments = [
    {
      id: "seg-1",
      segmentIdentity: { schemaVersion: "pdf-segment-identity-v1", segmentId: "seg-1", origin: "extraction" },
      pageNumber: 1,
      type: "title",
      sourceText: "Authority",
      sourcePageRange: [1, 1],
      sourceLineRange: [1, 1],
      status: "pending",
    },
    {
      id: "seg-2",
      segmentIdentity: { schemaVersion: "pdf-segment-identity-v1", segmentId: "seg-2", origin: "extraction" },
      pageNumber: 1,
      type: "body",
      sourceText: "Consumer body",
      sourcePageRange: [1, 1],
      sourceLineRange: [2, 2],
      status: "pending",
    },
  ];
  return {
    segments,
    artifact: produceSemanticStructureArtifact({ mode: "paper_pdf", segments, inputStage: "consumer_test" }),
  };
}

test("IPC-cloned artifact is hash-validated and recursively re-frozen", () => {
  const { artifact } = fixture();
  const clone = JSON.parse(JSON.stringify(artifact));
  assert.equal(Object.isFrozen(clone), false);
  const restored = validateAndRefreezeArtifact(clone, "renderer_ipc");
  assert.equal(Object.isFrozen(restored), true);
  assert.equal(Object.isFrozen(restored.segments[0].sourceOwnership), true);
});

test("consumer shadow comparison proves identity, type, ownership, boundary and order parity", () => {
  const { segments, artifact } = fixture();
  const report = compareConsumerCarrierSegments(segments, artifact, { stage: "shadow", mode: "paper_pdf" });
  assert.equal(report.status, "match");
  assert.equal(report.differenceCount, 0);
  assert.equal(Object.isFrozen(report), true);
});

test("canonical binding makes semantic fields artifact-backed and rejects mutation", () => {
  const { segments, artifact } = fixture();
  const runtime = segments.map((segment) => ({ ...segment }));
  const bound = bindSemanticStructureConsumerSegments(runtime, artifact, { stage: "translation" });
  assert.equal(bound.segments[0].type, artifact.segments[0].semanticType);
  assert.equal(bound.segments[0].semanticPolicy, artifact.segments[0].policy);
  assert.equal(bound.segments[0].semanticStructureArtifactId, artifact.artifactId);
  assert.throws(() => { bound.segments[0].type = "body"; }, { code: "SEMANTIC_POST_FREEZE_MUTATION" });
  bound.segments[0].status = "done";
  assert.equal(bound.segments[0].status, "done");
});

test("type, identity and ownership drift fail fast without repair", () => {
  const { segments, artifact } = fixture();
  const cases = [
    segments.map((segment, index) => ({ ...segment, type: index === 0 ? "body" : segment.type })),
    segments.map((segment, index) => ({ ...segment, segmentIdentity: index === 0 ? { ...segment.segmentIdentity, origin: "changed" } : segment.segmentIdentity })),
    segments.map((segment, index) => ({ ...segment, sourceText: index === 0 ? "changed" : segment.sourceText })),
  ];
  cases.forEach((candidate) => {
    assert.throws(
      () => bindSemanticStructureConsumerSegments(candidate, artifact, { stage: "drift" }),
      { code: "SEMANTIC_CONSUMER_PARITY_FAILED" }
    );
  });
  assert.equal(segments[0].type, "title");
  assert.equal(segments[0].sourceText, "Authority");
});

test("artifact tampering and missing artifact fail before consumer execution", () => {
  const { artifact } = fixture();
  const tampered = JSON.parse(JSON.stringify(artifact));
  tampered.segments[0].semanticType = "body";
  assert.throws(() => validateAndRefreezeArtifact(tampered, "tampered"), { code: "SEMANTIC_ARTIFACT_HASH_MISMATCH" });
  assert.throws(() => validateAndRefreezeArtifact(null, "missing"), { code: "SEMANTIC_ARTIFACT_REQUIRED" });
});

test("payload binding requires an exact allSegments carrier and allows ordered export subsets", () => {
  const { segments, artifact } = fixture();
  const payload = {
    semanticStructureArtifact: JSON.parse(JSON.stringify(artifact)),
    allSegments: segments.map((segment) => ({ ...segment })),
    segments: [{ ...segments[1] }],
  };
  const bound = bindSemanticStructureConsumerPayload(payload, { stage: "export", mode: "paper_pdf" });
  assert.equal(bound.reports.length, 2);
  assert.equal(bound.payload.allSegments[0].semanticType, "title");
  assert.equal(bound.payload.segments[0].semanticType, "body");
  assert.throws(() => bindSemanticStructureConsumerPayload({ semanticStructureArtifact: artifact, segments: [] }, { stage: "invalid" }), {
    code: "SEMANTIC_CONSUMER_ALL_SEGMENTS_REQUIRED",
  });
});
