"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../../..");
const authority = require(path.join(root, "electron-app/semantic-structure-authority"));

function sampleSegments() {
  return [
    {
      id: "seg-1",
      pageNumber: 1,
      column: "single",
      type: "title",
      sourceText: "A Stable Title",
      classificationReason: "title_zone_title",
      segmentIdentity: { schemaVersion: "pdf-segment-identity-v1", segmentId: "seg-1", origin: "extraction", parentSegmentId: "" },
      bbox: { x: 72, y: 40, width: 300, height: 24 },
      lineBoxes: [{ pageNumber: 1, x: 72, y: 40, width: 300, height: 24, sourceLineText: "A Stable Title" }],
    },
    {
      id: "seg-2",
      pageNumber: 1,
      column: "left",
      type: "body",
      sourceText: "Body prose.",
      classificationReason: "legacy_structure_candidate",
      bbox: { x: 48, y: 180, width: 240, height: 18 },
      lineBoxes: [{ pageNumber: 1, x: 48, y: 180, width: 240, height: 18, sourceLineText: "Body prose." }],
    },
    {
      id: "seg-3",
      pageNumber: 2,
      column: "single",
      type: "reference",
      sourceText: "References",
      classificationReason: "reference_heading",
      referenceModeApplied: true,
      bbox: { x: 48, y: 100, width: 120, height: 18 },
      lineBoxes: [{ pageNumber: 2, x: 48, y: 100, width: 120, height: 18, sourceLineText: "References" }],
    },
  ];
}

function assertDeepFrozen(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  Object.getOwnPropertyNames(value).forEach((key) => assertDeepFrozen(value[key], seen));
}

test("producer independently emits a complete deterministic paper artifact and does not mutate input", () => {
  const segments = sampleSegments();
  const before = JSON.parse(JSON.stringify(segments));
  const first = authority.produceSemanticStructureArtifact({ mode: "paper_pdf", segments });
  const second = authority.produceSemanticStructureArtifact({ mode: "paper_pdf", segments });
  assert.deepEqual(segments, before);
  assert.equal(first.schemaVersion, "semantic-structure-artifact/v1");
  assert.equal(first.segmentCount, segments.length);
  assert.equal(first.artifactId, second.artifactId);
  assert.equal(first.contentHash, second.contentHash);
  assert.deepEqual(first.segments.map((segment) => segment.semanticType), ["title", "body", "reference"]);
  assert.deepEqual(first.segments.map((segment) => segment.policy.translationDisposition), ["translate", "translate", "preserve"]);
  first.segments.forEach((segment) => {
    assert.match(segment.semanticDecisionId, /^semantic-decision-sha256:/);
    assert.match(segment.sourceOwnership.sourceTextHash, /^[a-f0-9]{64}$/);
    assert.equal(segment.sourceOwnership.ownerSegmentId, segment.segmentId);
  });
  assert.deepEqual(first.segments[0].segmentIdentity, {
    schemaVersion: "pdf-segment-identity-v1", segmentId: "seg-1", origin: "extraction", parentSegmentId: "",
  });
  assertDeepFrozen(first);
  assert.throws(() => { first.segments[0].semanticType = "body"; }, TypeError);
  assert.equal(first.segments[0].semanticType, "title");
});

test("simple mode uses the same artifact schema with a mode-specific frozen policy", () => {
  const artifact = authority.produceSemanticStructureArtifact({
    mode: "simple_pdf",
    segments: [
      { id: "simple-1", type: "title", sourceText: "Title", sourcePageRange: [1, 1], sourceLineRange: [1, 1] },
      { id: "simple-2", type: "body", sourceText: "Text", sourcePageRange: [1, 1], sourceLineRange: [2, 4] },
      { id: "simple-3", type: "footer", sourceText: "Page footer" },
    ],
  });
  assert.equal(artifact.producer.mode, "simple_pdf");
  assert.deepEqual(artifact.segments.map((segment) => segment.policy.translationDisposition), ["translate", "translate", "preserve"]);
  assert.deepEqual(artifact.segments[1].sourceOwnership.sourcePageRange, [1, 1]);
  assert.deepEqual(artifact.segments[1].sourceOwnership.sourceLineRange, [2, 4]);
  assertDeepFrozen(artifact);
});

test("ingress aliases are normalized once and shadow differences are explicitly explained", () => {
  const legacy = [{ id: "seg-alias", type: "formulaBlock", sourceText: "E = mc2" }];
  const artifact = authority.produceSemanticStructureArtifact({ mode: "paper_pdf", segments: legacy });
  const comparison = authority.compareLegacySemanticStructure(legacy, artifact);
  assert.equal(artifact.segments[0].semanticType, "formula");
  assert.equal(comparison.status, "explained_differences");
  assert.equal(comparison.explainedDifferenceCount, 1);
  assert.equal(comparison.unexplainedDifferenceCount, 0);
  assert.equal(comparison.differences[0].explanationCode, "ingress_alias_normalized");
  assertDeepFrozen(comparison);
});

test("unknown types and duplicate identities fail fast instead of becoming body", () => {
  assert.throws(
    () => authority.produceSemanticStructureArtifact({ mode: "paper_pdf", segments: [{ id: "seg-1", type: "mystery", sourceText: "x" }] }),
    (error) => error && error.code === "SEMANTIC_TYPE_UNKNOWN",
  );
  assert.throws(
    () => authority.produceSemanticStructureArtifact({ mode: "paper_pdf", segments: [{ id: "same", type: "body" }, { id: "same", type: "body" }] }),
    (error) => error && error.code === "SEMANTIC_SEGMENT_ID_DUPLICATE",
  );
});

test("shadow runner isolates producer failure and leaves legacy consumers authoritative", () => {
  const legacyResult = { segments: [{ id: "seg-1", type: "unknown-type", sourceText: "x" }], text: "x" };
  const before = JSON.parse(JSON.stringify(legacyResult));
  const shadow = authority.runSemanticStructureShadowValidation(legacyResult, { mode: "paper_pdf" });
  assert.deepEqual(legacyResult, before);
  assert.equal(shadow.artifact, null);
  assert.equal(shadow.comparison.status, "producer_error");
  assert.equal(shadow.comparison.differences[0].explanationCode, "SEMANTIC_TYPE_UNKNOWN");
  assert.equal(shadow.legacyConsumersRemainAuthoritative, true);
  assert.equal(shadow.shadowOnly, true);
  assertDeepFrozen(shadow);
});

test("shadow comparison reports boundary drift with a stable unexplained reason", () => {
  const legacy = sampleSegments();
  const artifact = authority.produceSemanticStructureArtifact({ mode: "paper_pdf", segments: legacy.slice(0, 2) });
  const comparison = authority.compareLegacySemanticStructure(legacy, artifact);
  assert.equal(comparison.status, "unexplained_differences");
  assert.equal(comparison.unexplainedDifferenceCount, 1);
  assert.equal(comparison.differences[0].explanationCode, "canonical_segment_missing");
});

test("main extraction convergence attaches shadow outputs without switching consumer modules", () => {
  const mainSource = fs.readFileSync(path.join(root, "electron-app/main.js"), "utf8");
  const rendererSource = fs.readFileSync(path.join(root, "electron-app/renderer.js"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "electron-app/package.json"), "utf8"));
  assert.match(mainSource, /runSemanticStructureShadowValidation\(legacyResult,/);
  assert.match(mainSource, /semanticStructureArtifact:\s*semanticStructureShadow\.artifact/);
  assert.match(mainSource, /semanticStructureShadowValidation:\s*semanticStructureShadow\.comparison/);
  assert.match(mainSource, /\.\.\.legacyResult/);
  assert.doesNotMatch(rendererSource, /semanticStructureArtifact|semanticStructureShadowValidation/);
  assert.ok(packageJson.build.files.includes("semantic-structure-authority.js"));

  const start = mainSource.indexOf("function runPdfExtractionPipeline(");
  const end = mainSource.indexOf("\nfunction ", start + 1);
  const functionSource = mainSource.slice(start, end);
  const simpleLegacy = { segments: [{ id: "simple-1", type: "body" }], text: "simple" };
  const paperLegacy = { segments: [{ id: "paper-1", type: "body" }], text: "paper" };
  const calls = [];
  const context = vm.createContext({
    Map,
    runSimplePdfSimplifiedCore: () => simpleLegacy,
    buildStructuredPdfText: () => paperLegacy,
    runSemanticStructureShadowValidation: (legacyResult, options) => {
      calls.push({ legacyResult, options });
      return { artifact: { frozen: true, mode: options.mode }, comparison: { status: "match" } };
    },
  });
  vm.runInContext(functionSource, context);
  const simpleResult = context.runPdfExtractionPipeline(new Map(), { mode: "simple_pdf" });
  const paperResult = context.runPdfExtractionPipeline(new Map(), { mode: "paper_pdf" });
  assert.strictEqual(simpleResult.segments, simpleLegacy.segments);
  assert.strictEqual(paperResult.segments, paperLegacy.segments);
  assert.equal(simpleResult.semanticStructureShadowValidation.status, "match");
  assert.equal(paperResult.semanticStructureShadowValidation.status, "match");
  assert.deepEqual(calls.map((call) => call.options.mode), ["simple_pdf", "paper_pdf"]);
});
