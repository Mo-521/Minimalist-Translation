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

test("simple structure roles are classified only by the canonical producer", () => {
  const candidates = [
    { id: "simple-1", structureRole: "simple_title", sourceText: "Title", firstLinePageNumber: 1 },
    { id: "simple-2", structureRole: "simple_paragraph", sourceText: "Body", firstLinePageNumber: 1 },
  ];
  const artifact = authority.produceSemanticStructureArtifact({ mode: "simple_pdf", segments: candidates });
  assert.deepEqual(artifact.segments.map((segment) => segment.semanticType), ["title", "body"]);
  assert.deepEqual(artifact.segments.map((segment) => segment.classification.evidence.structureRole), ["simple_title", "simple_paragraph"]);
  assert.equal(authority.compareCandidateSemanticStructure(candidates, artifact).status, "match");
  assert.throws(
    () => authority.produceSemanticStructureArtifact({ mode: "simple_pdf", segments: [{ id: "simple-conflict", structureRole: "simple_title", type: "body" }] }),
    (error) => error && error.code === "SEMANTIC_STRUCTURE_ROLE_TYPE_CONFLICT",
  );
});

test("paper line semantic precedence is owned by Structure Authority", () => {
  const classify = authority.semanticStructureProducerStages.classifyPaperLineEvidence;
  assert.equal(classify({ noiseRole: "paper_watermark_line", chineseTitleCandidate: true }), "watermark");
  assert.equal(classify({ topMatterRole: "paper_funding_line", abstractLabel: true }), "funding");
  assert.equal(classify({ chineseTitleCandidate: true, captionStart: true }), "title");
  assert.equal(classify({ abstractLabel: true, keywordsLabel: true }), "abstract");
  assert.equal(classify({ keywordsLabel: true, numberedHeading: true }), "keywords");
  assert.equal(classify({ referencesHeading: true, captionStart: true }), "heading");
  assert.equal(classify({ captionStart: true }), "caption");
  assert.equal(classify({}), "body");
  assert.throws(
    () => classify({ noiseRole: "paper_unknown_line" }),
    (error) => error && error.code === "SEMANTIC_PAPER_LINE_ROLE_UNKNOWN",
  );
  const mainSource = fs.readFileSync(path.join(root, "electron-app/main.js"), "utf8");
  assert.match(mainSource, /semanticStructureProducerStages\.classifyPaperLineEvidence\(\{/);
  assert.doesNotMatch(mainSource, /function getPdfNoiseLineType|function getTopMatterLineType/);
});

test("paper segment noise reclassification is written only by Structure Authority", () => {
  const stages = authority.semanticStructureProducerStages;
  const candidates = [
    { id: "body-margin", type: "body", sourceText: "side mark" },
    { id: "body-watermark", type: "body", sourceText: "Downloaded from Wiley" },
    { id: "body-license", type: "body", sourceText: "Creative Commons" },
    { id: "heading", type: "heading", sourceText: "Downloaded from Wiley" },
  ];
  const result = stages.applyPaperSegmentNoiseClassification(candidates, [
    { segmentIndex: 0, narrowTallMargin: true, footerOrWatermarkText: false, downloadedOrWileyText: false },
    { segmentIndex: 1, narrowTallMargin: false, footerOrWatermarkText: true, downloadedOrWileyText: true },
    { segmentIndex: 2, narrowTallMargin: false, footerOrWatermarkText: true, downloadedOrWileyText: false },
    { segmentIndex: 3, narrowTallMargin: false, footerOrWatermarkText: true, downloadedOrWileyText: true },
  ]);
  assert.deepEqual(result.map((segment) => segment.type), ["margin", "watermark", "licenseText", "heading"]);
  assert.equal(candidates[0].type, "body");
  assert.throws(
    () => stages.applyPaperSegmentNoiseClassification(candidates, []),
    (error) => error && error.code === "SEMANTIC_PAPER_SEGMENT_EVIDENCE_COUNT_MISMATCH",
  );
  const mainSource = fs.readFileSync(path.join(root, "electron-app/main.js"), "utf8");
  assert.match(mainSource, /semanticStructureProducerStages\.applyPaperSegmentNoiseClassification\(/);
  assert.doesNotMatch(mainSource, /function getSegmentNoiseType|function applySegmentNoiseTyping/);
});

test("paper image-text body-like demotion is written only by Structure Authority", () => {
  const stages = authority.semanticStructureProducerStages;
  const candidates = [
    { id: "image-body-like", type: "imageText", sourceText: "body prose", status: "preserved", skipReason: "image_preserve", preserveReasonLabel: "image", zoneType: "imageZone" },
    { id: "image-label", type: "imageText", sourceText: "North" },
    { id: "body", type: "body", sourceText: "body prose" },
  ];
  const result = stages.applyPaperImageTextDemotionClassification(candidates, [
    { segmentIndex: 0, bodyLikeReason: "image_text_body_like_verb" },
    { segmentIndex: 1, bodyLikeReason: "" },
    { segmentIndex: 2, bodyLikeReason: "image_text_body_like_verb" },
  ]);
  assert.deepEqual(result.map((segment) => segment.type), ["body", "imageText", "body"]);
  assert.equal(result[0].classificationReason, "image_text_body_like_demoted_to_body");
  assert.equal(result[0].imageTextDemoteReason, "image_text_body_like_verb");
  assert.equal(result[0].status, "pending");
  assert.equal(result[0].zoneType, "");
  assert.equal(candidates[0].type, "imageText");
  assert.throws(
    () => stages.applyPaperImageTextDemotionClassification(candidates, []),
    (error) => error && error.code === "SEMANTIC_PAPER_IMAGE_TEXT_EVIDENCE_COUNT_MISMATCH",
  );
  const mainSource = fs.readFileSync(path.join(root, "electron-app/main.js"), "utf8");
  assert.match(mainSource, /semanticStructureProducerStages\.applyPaperImageTextDemotionClassification\(/);
  assert.doesNotMatch(mainSource, /function auditPaperImageTextPreserveRisk/);
});

test("paper caption body-like demotion is written only by Structure Authority", () => {
  const stages = authority.semanticStructureProducerStages;
  const candidates = [
    { id: "caption-body-like", type: "caption", sourceText: "Figure 1 shows prose", zoneType: "captionZone", warnings: [] },
    { id: "caption", type: "caption", sourceText: "Figure 1: label" },
    { id: "body", type: "body", sourceText: "Figure 1 shows prose" },
  ];
  const result = stages.applyPaperCaptionBodyDemotionClassification(candidates, [
    { segmentIndex: 0, bodyLikeReason: "caption_marker_body_sentence" },
    { segmentIndex: 1, bodyLikeReason: "" },
    { segmentIndex: 2, bodyLikeReason: "caption_marker_body_sentence" },
  ]);
  assert.deepEqual(result.map((segment) => segment.type), ["body", "caption", "body"]);
  assert.equal(result[0].classificationReason, "caption_body_like_demoted_to_body");
  assert.equal(result[0].captionBodyLikeRiskReason, "caption_marker_body_sentence");
  assert.equal(result[0].zoneType, "");
  assert.deepEqual(result[0].warnings, ["caption_body_like_demoted_to_body"]);
  assert.equal(candidates[0].type, "caption");
  assert.throws(
    () => stages.applyPaperCaptionBodyDemotionClassification(candidates, []),
    (error) => error && error.code === "SEMANTIC_PAPER_CAPTION_BODY_EVIDENCE_COUNT_MISMATCH",
  );
  const mainSource = fs.readFileSync(path.join(root, "electron-app/main.js"), "utf8");
  assert.match(mainSource, /semanticStructureProducerStages\.applyPaperCaptionBodyDemotionClassification\(/);
  assert.doesNotMatch(mainSource, /function demoteBodyLikeCaptionSegmentsBeforeTranslation/);
});

test("paper abstract paragraph continuation is written only by Structure Authority", () => {
  const classify = authority.semanticStructureProducerStages.applyPaperAbstractContinuationClassification;
  const paragraph = { type: "body", pageNumber: 1, column: "single", lines: [], items: [] };
  const classified = classify(paragraph, { previousType: "abstract", samePage: true, sameColumn: true });
  assert.equal(classified.type, "abstract");
  assert.equal(paragraph.type, "body");
  assert.strictEqual(classify(paragraph, { previousType: "body", samePage: true, sameColumn: true }), paragraph);
  assert.strictEqual(classify(paragraph, { previousType: "abstract", samePage: false, sameColumn: true }), paragraph);
  assert.strictEqual(classify({ ...paragraph, type: "heading" }, { previousType: "abstract", samePage: true, sameColumn: true }).type, "heading");
  const mainSource = fs.readFileSync(path.join(root, "electron-app/main.js"), "utf8");
  assert.match(mainSource, /semanticStructureProducerStages\.applyPaperAbstractContinuationClassification\(/);
  assert.doesNotMatch(mainSource, /paragraph\.type\s*=\s*["']abstract["']/);
});

test("paper single-line top-matter header is written only by Structure Authority", () => {
  const classify = authority.semanticStructureProducerStages.applyPaperTopMatterSingleLineHeaderClassification;
  const segment = { type: "body", pageNumber: 1, column: "single", sourceText: "Draft version" };
  const classified = classify(segment, { singleLineHeader: true });
  assert.equal(classified.type, "header");
  assert.equal(classified.column, "single");
  assert.equal(segment.type, "body");
  assert.strictEqual(classify(segment, { singleLineHeader: false }), segment);
  assert.throws(
    () => classify(null, { singleLineHeader: true }),
    (error) => error && error.code === "SEMANTIC_PAPER_TOP_MATTER_SEGMENT_REQUIRED",
  );
  const mainSource = fs.readFileSync(path.join(root, "electron-app/main.js"), "utf8");
  assert.match(mainSource, /semanticStructureProducerStages\.applyPaperTopMatterSingleLineHeaderClassification\(/);
  assert.doesNotMatch(mainSource, /return \[\{ \.\.\.segment, type: ["']header["'], column: ["']single["'] \}\]/);
});

test("paper split top-matter roles are mapped to semantic types only by Structure Authority", () => {
  const classify = authority.semanticStructureProducerStages.applyPaperTopMatterPartClassification;
  const roles = {
    paper_top_matter_header: "header",
    paper_top_matter_title: "title",
    paper_top_matter_author: "author",
    paper_top_matter_affiliation: "affiliation",
    paper_top_matter_correspondence: "correspondence",
    paper_top_matter_received_date: "receivedDate",
    paper_top_matter_funding: "funding",
    paper_top_matter_body: "body",
  };
  Object.entries(roles).forEach(([structureRole, expectedType]) => {
    const candidate = { sourceText: structureRole, column: "single" };
    const classified = classify(candidate, { structureRole });
    assert.equal(classified.type, expectedType);
    assert.equal(candidate.type, undefined);
  });
  assert.throws(
    () => classify({}, { structureRole: "paper_top_matter_unknown" }),
    (error) => error && error.code === "SEMANTIC_PAPER_TOP_MATTER_PART_ROLE_UNKNOWN",
  );
  const mainSource = fs.readFileSync(path.join(root, "electron-app/main.js"), "utf8");
  const splitStart = mainSource.indexOf("function splitTopMatterSegment(");
  const splitEnd = mainSource.indexOf("\nfunction ", splitStart + 1);
  const splitSource = mainSource.slice(splitStart, splitEnd);
  assert.match(splitSource, /makeTopMatterSegmentFromParts\(/);
  assert.doesNotMatch(splitSource, /makeSegmentFromParts\(/);
});

test("paper title-zone roles are mapped to semantic types only by Structure Authority", () => {
  const classify = authority.semanticStructureProducerStages.applyPaperTitleZonePartClassification;
  const roles = {
    paper_title_zone_header: "header",
    paper_title_zone_title: "title",
    paper_title_zone_author: "author",
    paper_title_zone_affiliation: "affiliation",
    paper_title_zone_correspondence: "correspondence",
  };
  Object.entries(roles).forEach(([structureRole, expectedType]) => {
    const candidate = { sourceText: structureRole, column: "single" };
    const classified = classify(candidate, { structureRole, inheritedSemanticType: "body" });
    assert.equal(classified.type, expectedType);
    assert.equal(candidate.type, undefined);
  });
  assert.equal(classify({}, { structureRole: "paper_title_zone_inherit", inheritedSemanticType: "body" }).type, "body");
  assert.throws(
    () => classify({}, { structureRole: "paper_title_zone_unknown", inheritedSemanticType: "body" }),
    (error) => error && error.code === "SEMANTIC_PAPER_TITLE_ZONE_PART_ROLE_UNKNOWN",
  );
  assert.throws(
    () => classify({}, { structureRole: "paper_title_zone_inherit" }),
    (error) => error && error.code === "SEMANTIC_TYPE_MISSING",
  );
  const mainSource = fs.readFileSync(path.join(root, "electron-app/main.js"), "utf8");
  const splitStart = mainSource.indexOf("function splitTitleZoneSegment(");
  const splitEnd = mainSource.indexOf("\nfunction ", splitStart + 1);
  const splitSource = mainSource.slice(splitStart, splitEnd);
  assert.match(splitSource, /makeTitleZoneSegmentFromParts\(/);
  assert.match(splitSource, /makeTitleZoneSingleLineSegmentFromText\(/);
  assert.match(splitSource, /const semanticType = semanticStructureProducerStages\.applyPaperTitleZonePartClassification\(/);
  assert.match(splitSource, /semanticType !== currentSemanticType/);
  assert.doesNotMatch(splitSource, /makeSegmentFromParts\(/);
  assert.doesNotMatch(splitSource, /makeSingleLineSegmentFromText\(/);
  assert.doesNotMatch(splitSource, /structureRole !== currentStructureRole/);
  assert.doesNotMatch(mainSource, /function getTitleZoneLineType\(/);
});

test("paper contaminated-caption boundary roles are mapped to semantic types only by Structure Authority", () => {
  const classify = authority.semanticStructureProducerStages.applyPaperCaptionBoundaryPartClassification;
  assert.equal(classify({}, { structureRole: "paper_caption_boundary_caption", inheritedSemanticType: "heading" }).type, "caption");
  assert.equal(classify({}, { structureRole: "paper_caption_boundary_body", inheritedSemanticType: "caption" }).type, "body");
  assert.equal(classify({}, { structureRole: "paper_caption_boundary_inherit", inheritedSemanticType: "heading" }).type, "heading");
  assert.throws(
    () => classify({}, { structureRole: "paper_caption_boundary_unknown", inheritedSemanticType: "body" }),
    (error) => error && error.code === "SEMANTIC_PAPER_CAPTION_BOUNDARY_PART_ROLE_UNKNOWN",
  );
  assert.throws(
    () => classify({}, { structureRole: "paper_caption_boundary_inherit" }),
    (error) => error && error.code === "SEMANTIC_TYPE_MISSING",
  );
  const mainSource = fs.readFileSync(path.join(root, "electron-app/main.js"), "utf8");
  const splitStart = mainSource.indexOf("function splitContaminatedCaption(");
  const splitEnd = mainSource.indexOf("\nfunction ", splitStart + 1);
  const splitSource = mainSource.slice(splitStart, splitEnd);
  assert.match(splitSource, /makePaperCaptionBoundaryPart\(/);
  assert.match(splitSource, /makePaperCaptionBoundarySingleLinePart\(/);
  assert.doesNotMatch(splitSource, /makeSingleLineSegmentFromText\(/);
  assert.doesNotMatch(splitSource, /type:\s*(?:segment\.type|["']caption["']|["']body["'])/);
});

test("paper image/caption-region chunk roles are mapped to semantic types only by Structure Authority", () => {
  const classify = authority.semanticStructureProducerStages.applyPaperImageCaptionRegionPartClassification;
  assert.equal(classify({}, { structureRole: "paper_image_caption_region_caption", inheritedSemanticType: "body" }).type, "caption");
  assert.equal(classify({}, { structureRole: "paper_image_caption_region_image_text", inheritedSemanticType: "heading" }).type, "imageText");
  assert.equal(classify({}, { structureRole: "paper_image_caption_region_inherit", inheritedSemanticType: "heading" }).type, "heading");
  assert.equal(classify({}, { structureRole: "paper_image_caption_region_caption", inheritedSemanticType: "body", captionBodyLikeReason: "caption_marker_body_sentence" }).type, "body");
  assert.equal(classify({}, { structureRole: "paper_image_caption_region_image_text", inheritedSemanticType: "heading", imageTextBodyLike: true }).type, "heading");
  assert.throws(
    () => classify({}, { structureRole: "paper_image_caption_region_unknown", inheritedSemanticType: "body" }),
    (error) => error && error.code === "SEMANTIC_PAPER_IMAGE_CAPTION_REGION_PART_ROLE_UNKNOWN",
  );
  assert.throws(
    () => classify({}, { structureRole: "paper_image_caption_region_caption" }),
    (error) => error && error.code === "SEMANTIC_TYPE_MISSING",
  );
  const mainSource = fs.readFileSync(path.join(root, "electron-app/main.js"), "utf8");
  const splitStart = mainSource.indexOf("function splitSegmentByImageCaptionRegions(");
  const splitEnd = mainSource.indexOf("\nfunction ", splitStart + 1);
  const splitSource = mainSource.slice(splitStart, splitEnd);
  assert.match(splitSource, /getPaperImageCaptionRegionLineRole\(/);
  assert.match(splitSource, /applyPaperImageCaptionRegionPartClassification\(/);
  assert.match(splitSource, /makePaperImageCaptionRegionPart\(/);
  assert.doesNotMatch(mainSource, /function getPaperImageCaptionRegionLineKind\(/);
  assert.doesNotMatch(splitSource, /const type = regionKind/);
  assert.doesNotMatch(splitSource, /const safeType = chunk\.type/);
});

test("paper oversized-split roles are mapped to semantic types only by Structure Authority", () => {
  const classify = authority.semanticStructureProducerStages.applyPaperOversizedPartClassification;
  assert.equal(classify({}, { structureRole: "paper_oversized_part_caption" }).type, "caption");
  assert.equal(classify({}, { structureRole: "paper_oversized_part_heading" }).type, "heading");
  assert.equal(classify({}, { structureRole: "paper_oversized_part_body" }).type, "body");
  assert.throws(
    () => classify({}, { structureRole: "paper_oversized_part_unknown" }),
    (error) => error && error.code === "SEMANTIC_PAPER_OVERSIZED_PART_ROLE_UNKNOWN",
  );
  const mainSource = fs.readFileSync(path.join(root, "electron-app/main.js"), "utf8");
  const splitStart = mainSource.indexOf("function splitOversizedPaperBodySegment(");
  const splitEnd = mainSource.indexOf("\nfunction ", splitStart + 1);
  const splitSource = mainSource.slice(splitStart, splitEnd);
  assert.match(splitSource, /applyPaperOversizedPartClassification\(/);
  assert.match(splitSource, /paper_oversized_part_caption/);
  assert.doesNotMatch(splitSource, /const partType =/);
  assert.doesNotMatch(splitSource, /makeSegmentFromParts\(segment, indexes, partType/);
});

test("paper heading-to-body continuation typing is written only by Structure Authority", () => {
  const stages = authority.semanticStructureProducerStages;
  const heading = { type: "heading", sourceText: "continues as prose" };
  const demoted = stages.applyPaperBodyContinuationSegmentClassification(heading, { continuationReason: "body_context_continuation" });
  assert.equal(demoted.type, "body");
  assert.equal(demoted.classificationReason, "body_continuation_demoted_from_heading");
  assert.equal(demoted.mergeReason, "body_context_continuation");
  assert.deepEqual(demoted.continuationMergeReasons, ["body_context_continuation"]);
  assert.equal(heading.type, "heading");
  assert.strictEqual(stages.applyPaperBodyContinuationSegmentClassification(heading, {}), heading);
  assert.strictEqual(stages.applyPaperBodyContinuationSegmentClassification({ type: "body" }, { continuationReason: "numeric_continuation" }).type, "body");

  const body = { type: "body", classificationReason: "body", continuationMergeReasons: ["hyphen_continuation"] };
  const merged = stages.applyPaperBodyContinuationMergedClassification(body, {
    continuationReason: "numeric_continuation",
    incomingWasHeading: true,
  });
  assert.equal(merged.type, "body");
  assert.equal(merged.classificationReason, "body_continuation_demoted_from_heading");
  assert.equal(merged.headingDemotedToBody, true);
  assert.equal(merged.headingContinuationMerged, true);
  assert.deepEqual(merged.continuationMergeReasons, ["hyphen_continuation", "numeric_continuation"]);
  assert.equal(body.headingDemotedToBody, undefined);

  const mainSource = fs.readFileSync(path.join(root, "electron-app/main.js"), "utf8");
  const start = mainSource.indexOf("function applyBodyContinuationMerges(");
  const end = mainSource.indexOf("\nfunction ", start + 1);
  const source = mainSource.slice(start, end);
  assert.match(source, /applyPaperBodyContinuationSegmentClassification\(/);
  assert.match(source, /applyPaperBodyContinuationMergedClassification\(/);
  assert.doesNotMatch(source, /type:\s*["']body["']/);
});

test("paper line paragraph and segment carriers are typed only by Structure Authority", () => {
  const materialize = authority.semanticStructureProducerStages.materializePaperClassifiedCarrier;
  const carrier = { pageNumber: 1, column: "left", sourceText: "Body" };
  const body = materialize(carrier, { semanticType: "body" });
  assert.equal(body.type, "body");
  assert.equal(carrier.type, undefined);
  assert.throws(
    () => materialize({}, {}),
    (error) => error && error.code === "SEMANTIC_TYPE_MISSING",
  );
  assert.throws(
    () => materialize({ type: "heading" }, { semanticType: "body" }),
    (error) => error && error.code === "SEMANTIC_PAPER_CARRIER_ALREADY_TYPED",
  );
  const mainSource = fs.readFileSync(path.join(root, "electron-app/main.js"), "utf8");
  const mergeStart = mainSource.indexOf("function mergeLinesIntoParagraphs(");
  const mergeEnd = mainSource.indexOf("\nfunction ", mergeStart + 1);
  const mergeSource = mainSource.slice(mergeStart, mergeEnd);
  const convertStart = mainSource.indexOf("function paragraphsToSegments(");
  const convertEnd = mainSource.indexOf("\nfunction ", convertStart + 1);
  const convertSource = mainSource.slice(convertStart, convertEnd);
  assert.match(mergeSource, /materializePaperClassifiedCarrier\(/);
  assert.doesNotMatch(mergeSource, /type:\s*lineType/);
  assert.doesNotMatch(mergeSource, /getPdfLineType\(paragraph\.lines\[0\]\)\s*\|\|\s*["']body["']/);
  assert.match(convertSource, /materializePaperClassifiedCarrier\(/);
  assert.doesNotMatch(convertSource, /paragraph\.type\s*\|\|\s*["']body["']/);
});

test("retired legacy simple mode is rejected instead of aliasing canonical simple authority", () => {
  assert.throws(
    () => authority.produceSemanticStructureArtifact({ mode: "legacy_simple_pdf", segments: [] }),
    (error) => error && error.code === "SEMANTIC_STRUCTURE_MODE_UNSUPPORTED",
  );
});

test("ingress aliases are normalized once and candidate differences are explicitly explained", () => {
  const legacy = [{ id: "seg-alias", type: "formulaBlock", sourceText: "E = mc2" }];
  const artifact = authority.produceSemanticStructureArtifact({ mode: "paper_pdf", segments: legacy });
  const comparison = authority.compareCandidateSemanticStructure(legacy, artifact);
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

test("candidate comparison reports boundary drift with a stable unexplained reason", () => {
  const legacy = sampleSegments();
  const artifact = authority.produceSemanticStructureArtifact({ mode: "paper_pdf", segments: legacy.slice(0, 2) });
  const comparison = authority.compareCandidateSemanticStructure(legacy, artifact);
  assert.equal(comparison.status, "unexplained_differences");
  assert.equal(comparison.unexplainedDifferenceCount, 1);
  assert.equal(comparison.differences[0].explanationCode, "canonical_segment_missing");
});

test("main extraction publishes the canonical artifact directly and keeps comparison as evidence", () => {
  const mainSource = fs.readFileSync(path.join(root, "electron-app/main.js"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "electron-app/package.json"), "utf8"));
  assert.match(mainSource, /produceSemanticStructureArtifact\(\{/);
  assert.match(mainSource, /const semanticStructureValidationEvidence = compareCandidateSemanticStructure/);
  assert.match(mainSource, /bindSemanticStructureConsumerSegments\(structureCandidates\.segments, semanticStructureArtifact/);
  assert.doesNotMatch(mainSource, /runSemanticStructureShadowValidation|compareLegacySemanticStructure|legacyConsumersRemainAuthoritative|shadowOnly|legacyResult/);
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
    produceSemanticStructureArtifact: (input) => {
      calls.push(input);
      return { frozen: true, mode: input.mode, segments: input.segments };
    },
    compareCandidateSemanticStructure: () => ({ status: "match" }),
    bindSemanticStructureConsumerSegments: () => ({ report: { status: "match" } }),
    simpleBuildReport: (_segments, summary) => summary,
    simpleBuildBlockDebugReport: () => [],
  });
  vm.runInContext(functionSource, context);
  const simpleResult = context.runPdfExtractionPipeline(new Map(), { mode: "simple_pdf" });
  const paperResult = context.runPdfExtractionPipeline(new Map(), { mode: "paper_pdf" });
  assert.strictEqual(simpleResult.segments, simpleLegacy.segments);
  assert.strictEqual(paperResult.segments, paperLegacy.segments);
  assert.equal(simpleResult.semanticStructureValidationEvidence.status, "match");
  assert.equal(paperResult.semanticStructureValidationEvidence.status, "match");
  assert.deepEqual(calls.map((call) => call.mode), ["simple_pdf", "paper_pdf"]);
});
