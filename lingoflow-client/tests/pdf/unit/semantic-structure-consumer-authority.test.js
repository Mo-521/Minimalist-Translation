"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  produceSemanticStructureArtifact,
} = require("../../../electron-app/semantic-structure-authority");
const {
  validateAndRefreezeArtifact,
  compareConsumerCarrierSegments,
  assertSemanticConsumerTypeProjection,
  bindSemanticStructureConsumerSegments,
  bindSemanticStructureConsumerPayload,
} = require("../../../electron-app/semantic-structure-consumer-authority");
const paperLayoutAuthority = require("../../../electron-app/paper-layout-authority");

const root = path.resolve(__dirname, "../../..");

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

test("post-freeze flow or export reclassification fails instead of repairing canonical type", () => {
  const segment = {
    id: "seg-1",
    type: "body",
    semanticType: "body",
    semanticStructureArtifactId: "semantic-structure-sha256:test",
  };
  assert.equal(assertSemanticConsumerTypeProjection(segment, "body", "layout"), "body");
  assert.throws(() => assertSemanticConsumerTypeProjection(segment, "formula", "flow"), {
    code: "SEMANTIC_CONSUMER_RECLASSIFICATION",
  });
  assert.equal(segment.type, "body");
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

test("layout produces the same decision from a legacy carrier and its artifact-backed consumer", () => {
  const { segments, artifact } = fixture();
  const legacy = { ...segments[1], translatedText: "消费者正文", lineBoxes: [{ fontSize: 10 }] };
  const canonical = { ...legacy };
  bindSemanticStructureConsumerSegments([canonical], artifact, {
    stage: "layout",
    mode: "paper_pdf",
    allowSubset: true,
  });
  const input = {
    lineMasks: [{}, {}],
    averageFontSize: 10,
    targetLanguage: "zh",
    pageBodyMedianFontSize: 10,
    visualEqualZhFontSizeScale: { scale: { body: 8.5, fallback: 8.5 } },
    text: legacy.translatedText,
    fontStats: { sourceFontSizeRatioToPageBody: 1, sourceBoldLike: false },
  };
  const legacyDecision = paperLayoutAuthority.resolvePaperLayoutAuthority({ ...input, segment: legacy });
  const canonicalDecision = paperLayoutAuthority.resolvePaperLayoutAuthority({ ...input, segment: canonical });
  assert.deepEqual(
    JSON.parse(JSON.stringify(canonicalDecision)),
    JSON.parse(JSON.stringify(legacyDecision))
  );
  assert.deepEqual(
    canonicalDecision.metricsForFontSize(8.5, legacy.translatedText),
    legacyDecision.metricsForFontSize(8.5, legacy.translatedText)
  );
});

test("runtime transport requires the artifact at renderer, translation-plan, diagnostics and export boundaries", () => {
  const mainSource = fs.readFileSync(path.join(root, "electron-app/main.js"), "utf8");
  const rendererSource = fs.readFileSync(path.join(root, "electron-app/renderer.js"), "utf8");

  assert.match(mainSource, /semanticStructureArtifact\s*=\s*structured\.semanticStructureArtifact/);
  assert.match(mainSource, /semanticStructureArtifact,\s*\r?\n\s*semanticStructureShadowValidation/);
  assert.match(mainSource, /stage:\s*"main\.exportTranslatedPdf"/);
  assert.match(mainSource, /bindDiagnosticConsumerPayload\(payload,\s*"main\.debugBbox"\)/);

  assert.match(rendererSource, /bindSemanticStructureConsumerSegments\(\s*normalizedSegments/);
  assert.match(rendererSource, /stage:\s*"renderer\.extraction"/);
  assert.match(rendererSource, /semanticStructureArtifact:\s*state\.semanticStructureArtifact/);
  assert.doesNotMatch(mainSource, /semanticConsumerAuthorityRequired/);
  assert.doesNotMatch(rendererSource, /semanticConsumerAuthorityRequired/);
  assert.doesNotMatch(mainSource, /legacy_compatibility/);
  assert.doesNotMatch(mainSource, /const projectedType = simpleNormalizeBlockType\(/);
  assert.doesNotMatch(mainSource, /const projectedType\s*=/);
  assert.doesNotMatch(mainSource, /function normalizePaperPageBoundaryColumnFlowSegments\(/);
  assert.doesNotMatch(mainSource, /pageBoundaryFlowNormalized/);
  assert.doesNotMatch(mainSource, /const SIMPLE_PDF_EXPORT_(?:ALLOWED|PRESERVE)_TYPES\s*=/);
  assert.doesNotMatch(mainSource, /function getPdfExport(?:Allowed|Preserve)TypesForMode\(/);
  assert.match(mainSource, /requirePdfExportSemanticDisposition\(segment, "export_skip_reason"\)/);
  assert.match(mainSource, /semanticTranslationDisposition = requirePdfExportSemanticDisposition\(segment, "export_report"\)/);
  assert.match(mainSource, /semanticPolicy: segment && segment\.semanticPolicy \|\| null/);
  assert.match(mainSource, /translatableReports = segmentReports\.filter\(\(report\) => report\.semanticTranslationDisposition === 'translate'/);
  assert.match(mainSource, /function hasPdfExportReportDisposition\(/);
  assert.match(mainSource, /requirePdfExportSemanticDisposition\(segment, "source mask preserve boxes"\)/);
  assert.match(mainSource, /hasPdfExportReportDisposition\(report, "translate", "visual mask fallback"\)/);
  assert.match(mainSource, /assertSemanticConsumerTypeProjection\(segment, rawType, "export_report"\)/);
  assert.match(rendererSource, /semanticStructureConsumerReports:\s*state\.semanticStructureConsumerReports\.slice\(\)/);
  assert.match(rendererSource, /function requireSemanticTranslationDisposition\(segment, consumerName\)/);
  assert.match(rendererSource, /SEMANTIC_CONSUMER_POLICY_REQUIRED/);
  assert.match(rendererSource, /requireSemanticTranslationDisposition\(segment, "isPaperOverlayCandidateStrict"\) === "translate"/);
  assert.match(rendererSource, /requireSemanticTranslationDisposition\(segment, "isPaperPreserveSegmentStrict"\) === "preserve"/);
  assert.match(rendererSource, /requireSemanticTranslationDisposition\(segment, "isSimplePdfTranslatableSegment"\) === "translate"/);
  assert.doesNotMatch(rendererSource, /getPdfOverlayAllowedTypesByMode/);
  assert.doesNotMatch(rendererSource, /getPdfOverlayPreserveTypesByMode/);
  assert.doesNotMatch(rendererSource, /PAPER_PDF_OVERLAY_ALLOWED_TYPES/);
  assert.doesNotMatch(rendererSource, /PAPER_PDF_OVERLAY_PRESERVE_TYPES/);
  assert.doesNotMatch(rendererSource, /PDF_OVERLAY_ALLOWED_TYPES/);
  assert.doesNotMatch(rendererSource, /PDF_OVERLAY_PRESERVE_TYPES/);
  assert.match(rendererSource, /SEMANTIC_CONSUMER_SEGMENTS_REQUIRED/);
  assert.doesNotMatch(rendererSource, /function normalizeSimplePdfSegmentType\(/);
  assert.doesNotMatch(rendererSource, /simple-fallback-/);
  assert.doesNotMatch(rendererSource, /function splitPdfTextIntoSegments\(/);
  assert.doesNotMatch(rendererSource, /type:\s*segment\.type\s*\|\|\s*"body"/);
});

test("unreachable legacy structure producers and registry aliases stay retired", () => {
  const mainSource = fs.readFileSync(path.join(root, "electron-app/main.js"), "utf8");

  [
    "makeParagraphFromLines",
    "splitPageOneTopMatter",
    "postProcessPdfParagraphs",
    "simpleBuildCleanBlock",
    "simpleExtractSimplePdfLines",
    "simpleRemoveSimpleHeadersFooters",
    "simpleBuildBlock",
    "simpleBuildSimpleDocumentParagraphs",
    "simpleMergeSimpleCrossPageParagraphsSafely",
    "simpleBuildSimplePdfV2DebugReport",
    "runSimplePdfPipeline",
  ].forEach((name) => assert.doesNotMatch(mainSource, new RegExp(`function ${name}\\(`)));
  assert.doesNotMatch(mainSource, /const PAPER_PDF_EXPORT_ALLOWED_TYPES\s*=/);
  assert.doesNotMatch(mainSource, /const PAPER_PDF_EXPORT_PRESERVE_TYPES\s*=/);
});
