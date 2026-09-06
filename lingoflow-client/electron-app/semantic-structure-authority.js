"use strict";

const crypto = require("crypto");

const AUTHORITY_NAME = "semantic-structure-authority";
const AUTHORITY_VERSION = "1.0.0-shadow";
const SCHEMA_VERSION = "semantic-structure-artifact/v1";

const CANONICAL_SEMANTIC_TYPES = Object.freeze([
  "title", "author", "affiliation", "correspondence", "receivedDate", "funding",
  "abstract-title", "abstract", "keywords", "heading", "body", "caption", "reference",
  "formula", "imageText", "header", "footer", "pageNumber", "margin", "noise",
  "watermark", "licenseText", "arXivSideMark", "doiMetadata", "journalMetadata",
]);

const CANONICAL_TYPE_SET = new Set(CANONICAL_SEMANTIC_TYPES);
const INGRESS_TYPE_ALIASES = Object.freeze({
  paragraph: "body",
  equationBlock: "formula",
  formulaBlock: "formula",
  formula_block: "formula",
});

const PAPER_TRANSLATE_TYPES = new Set([
  "title", "affiliation", "correspondence", "receivedDate", "funding", "abstract-title",
  "abstract", "keywords", "heading", "body", "caption",
]);
const PAPER_PRESERVE_TYPES = new Set([
  "author", "reference", "formula", "imageText", "header", "footer", "pageNumber", "margin",
  "noise", "watermark", "licenseText", "arXivSideMark", "doiMetadata", "journalMetadata",
]);
const SIMPLE_TRANSLATE_TYPES = new Set(["title", "body"]);
const SIMPLE_PRESERVE_TYPES = new Set(["header", "footer", "pageNumber", "margin", "noise", "watermark"]);

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function stableValue(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) return String(value);
    return value;
  }
  if (seen.has(value)) throw new TypeError("Semantic structure input must not contain circular values");
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => stableValue(item, seen));
    seen.delete(value);
    return result;
  }
  const result = {};
  Object.keys(value).sort().forEach((key) => {
    const item = value[key];
    if (typeof item !== "function" && item !== undefined) result[key] = stableValue(item, seen);
  });
  seen.delete(value);
  return result;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.getOwnPropertyNames(value).forEach((key) => deepFreeze(value[key], seen));
  return Object.freeze(value);
}

function structureError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "SemanticStructureAuthorityError";
  error.code = code;
  error.details = stableValue(details);
  return error;
}

function normalizeMode(mode) {
  const value = String(mode || "");
  if (value === "paper_pdf") return "paper_pdf";
  if (value === "simple_pdf") return "simple_pdf";
  throw structureError("SEMANTIC_STRUCTURE_MODE_UNSUPPORTED", `Unsupported semantic structure mode: ${value || "<empty>"}`, { mode: value });
}

function normalizeCanonicalType(rawType) {
  const value = String(rawType || "").trim();
  if (!value) throw structureError("SEMANTIC_TYPE_MISSING", "Semantic type is required at Structure Authority ingress");
  const canonicalType = INGRESS_TYPE_ALIASES[value] || value;
  if (!CANONICAL_TYPE_SET.has(canonicalType)) {
    throw structureError("SEMANTIC_TYPE_UNKNOWN", `Unknown semantic type: ${value}`, { rawType: value });
  }
  return {
    rawType: value,
    semanticType: canonicalType,
    aliasApplied: canonicalType !== value,
    aliasReason: canonicalType !== value ? "ingress_alias_normalized" : "canonical_input_type",
  };
}

function deriveDisposition(mode, semanticType) {
  const translateTypes = mode === "simple_pdf" ? SIMPLE_TRANSLATE_TYPES : PAPER_TRANSLATE_TYPES;
  const preserveTypes = mode === "simple_pdf" ? SIMPLE_PRESERVE_TYPES : PAPER_PRESERVE_TYPES;
  if (translateTypes.has(semanticType)) {
    return {
      translationDisposition: "translate",
      preserveDisposition: "not_preserved",
      writeDisposition: "translate_then_write",
      policyReason: `${mode}_${semanticType}_translate`,
    };
  }
  if (preserveTypes.has(semanticType)) {
    return {
      translationDisposition: "preserve",
      preserveDisposition: "preserve_original",
      writeDisposition: "do_not_write",
      policyReason: `${mode}_${semanticType}_preserve_original`,
    };
  }
  return {
    translationDisposition: "blocked",
    preserveDisposition: "unresolved",
    writeDisposition: "blocked",
    policyReason: `${mode}_${semanticType}_policy_unresolved`,
  };
}

function normalizeBbox(bbox) {
  if (!bbox || typeof bbox !== "object") return null;
  return {
    x: Number(bbox.x || 0),
    y: Number(bbox.y || 0),
    width: Number(bbox.width || 0),
    height: Number(bbox.height || 0),
  };
}

function normalizeLineOwnership(segment, segmentId) {
  const lineBoxes = Array.isArray(segment && segment.lineBoxes) ? segment.lineBoxes : [];
  const lines = Array.isArray(segment && segment.lines) ? segment.lines : [];
  if (lineBoxes.length) {
    return lineBoxes.map((line, index) => {
      const text = String(line && (line.sourceLineText || line.text) || lines[index] && (lines[index].sourceLineText || lines[index].text) || "");
      const pageNumber = Number(line && line.pageNumber || segment && segment.pageNumber || 0);
      const bbox = normalizeBbox(line);
      const explicitId = String(line && (line.sourceLineId || line.lineId || line.id) || "");
      const sourceLineId = explicitId || `source-line-sha256:${sha256(stableStringify({ pageNumber, bbox, text }))}`;
      return { sourceLineId, pageNumber, bbox, textHash: sha256(text), ownerSegmentId: segmentId };
    });
  }
  const sourceLineNumbers = Array.isArray(segment && segment.sourceLineNumbers) ? segment.sourceLineNumbers : [];
  if (sourceLineNumbers.length) {
    return sourceLineNumbers.map((lineNumber) => ({
      sourceLineId: `page:${Number(segment.pageNumber || 0)}:line:${Number(lineNumber || 0)}`,
      pageNumber: Number(segment.pageNumber || 0),
      bbox: null,
      textHash: "",
      ownerSegmentId: segmentId,
    }));
  }
  return [];
}

function buildClassificationEvidence(segment, normalizedType) {
  return {
    ingressType: normalizedType.rawType,
    aliasApplied: normalizedType.aliasApplied,
    aliasReason: normalizedType.aliasReason,
    classificationReason: String(segment && segment.classificationReason || "legacy_structure_candidate"),
    zoneType: String(segment && segment.zoneType || ""),
    referenceModeApplied: Boolean(segment && segment.referenceModeApplied),
    formulaEvidence: {
      formulaLinePreserve: Boolean(segment && segment.formulaLinePreserve),
      pureFormulaSegment: Boolean(segment && segment.pureFormulaSegment),
      strictPureEquationBlock: Boolean(segment && segment.strictPureEquationBlock),
    },
  };
}

function buildCanonicalSegment(segment, index, mode) {
  if (!segment || typeof segment !== "object") {
    throw structureError("SEMANTIC_SEGMENT_INVALID", `Invalid semantic segment at index ${index}`, { index });
  }
  const segmentId = String(segment.id || segment.segmentIdentity && segment.segmentIdentity.segmentId || "").trim();
  if (!segmentId) throw structureError("SEMANTIC_SEGMENT_ID_MISSING", `Semantic segment at index ${index} has no stable identity`, { index });
  const segmentIdentity = segment.segmentIdentity && typeof segment.segmentIdentity === "object"
    ? stableValue(segment.segmentIdentity)
    : {
      schemaVersion: "semantic-structure-shadow-identity/v1",
      segmentId,
      origin: "legacy_candidate_id",
      parentSegmentId: String(segment.splitFromSegmentId || ""),
    };
  if (String(segmentIdentity.segmentId || "") !== segmentId) {
    throw structureError("SEMANTIC_SEGMENT_IDENTITY_DRIFT", `Segment id and identity artifact disagree: ${segmentId}`, {
      segmentId,
      identitySegmentId: String(segmentIdentity.segmentId || ""),
    });
  }
  const normalizedType = normalizeCanonicalType(segment.semanticType || segment.type);
  const sourceText = String(segment.sourceText || "");
  const sourceLines = normalizeLineOwnership(segment, segmentId);
  const sourceOwnership = {
    ownerSegmentId: segmentId,
    sourceLineIds: sourceLines.map((line) => line.sourceLineId),
    sourceLineCount: sourceLines.length,
    sourceTextHash: sha256(sourceText),
    sourcePageRange: Array.isArray(segment.sourcePageRange)
      ? segment.sourcePageRange.map((value) => Number(value || 0))
      : [Number(segment.firstLinePageNumber || segment.pageNumber || 0), Number(segment.lastLinePageNumber || segment.pageNumber || 0)],
    sourceLineRange: Array.isArray(segment.sourceLineRange)
      ? segment.sourceLineRange.map((value) => Number(value || 0))
      : [],
  };
  const classificationEvidence = buildClassificationEvidence(segment, normalizedType);
  const decisionBasis = {
    segmentId,
    semanticType: normalizedType.semanticType,
    sourceOwnership,
    classificationEvidence,
  };
  return {
    segmentId,
    segmentIdentity,
    outputOrder: index,
    pageNumber: Number(segment.pageNumber || segment.firstLinePageNumber || 0),
    column: String(segment.column || "single"),
    layoutType: String(segment.layoutType || ""),
    zoneType: String(segment.zoneType || ""),
    bbox: normalizeBbox(segment.bbox),
    sourceText,
    sourceOwnership,
    sourceLines,
    semanticType: normalizedType.semanticType,
    semanticDecisionId: `semantic-decision-sha256:${sha256(stableStringify(decisionBasis))}`,
    classification: {
      producer: AUTHORITY_NAME,
      producerVersion: AUTHORITY_VERSION,
      winningRule: classificationEvidence.classificationReason,
      evidence: classificationEvidence,
      confidence: {
        level: Number.isFinite(Number(segment.classificationConfidence)) ? "provided" : "inherited",
        score: Number.isFinite(Number(segment.classificationConfidence)) ? Number(segment.classificationConfidence) : null,
      },
    },
    policy: deriveDisposition(mode, normalizedType.semanticType),
  };
}

function produceSemanticStructureArtifact(input = {}) {
  const mode = normalizeMode(input.mode);
  const candidates = Array.isArray(input.segments) ? input.segments : [];
  const seenIds = new Set();
  const segments = candidates.map((segment, index) => {
    const canonical = buildCanonicalSegment(segment, index, mode);
    if (seenIds.has(canonical.segmentId)) {
      throw structureError("SEMANTIC_SEGMENT_ID_DUPLICATE", `Duplicate semantic segment identity: ${canonical.segmentId}`, { segmentId: canonical.segmentId });
    }
    seenIds.add(canonical.segmentId);
    return canonical;
  });
  const artifactBody = {
    schemaVersion: SCHEMA_VERSION,
    revision: 1,
    producer: {
      name: AUTHORITY_NAME,
      version: AUTHORITY_VERSION,
      mode,
      inputStage: String(input.inputStage || "legacy_structure_candidate_shadow"),
    },
    vocabulary: CANONICAL_SEMANTIC_TYPES.slice(),
    segmentCount: segments.length,
    segments,
  };
  const contentHash = sha256(stableStringify(artifactBody));
  return deepFreeze({
    ...artifactBody,
    artifactId: `semantic-structure-sha256:${contentHash}`,
    contentHash,
    frozen: true,
    freezeStage: "semantic_structure_authority_finalize",
  });
}

function shadowDifference(kind, segmentId, expected, actual, explanationCode, explanation, explained) {
  return { kind, segmentId: String(segmentId || ""), expected, actual, explanationCode, explanation, explained: Boolean(explained) };
}

function compareLegacySemanticStructure(legacySegments, artifact) {
  const legacy = Array.isArray(legacySegments) ? legacySegments : [];
  if (!artifact || artifact.schemaVersion !== SCHEMA_VERSION || !Array.isArray(artifact.segments)) {
    throw structureError("SEMANTIC_ARTIFACT_INVALID", "A valid SemanticStructureArtifact is required for shadow comparison");
  }
  const differences = [];
  const canonicalById = new Map(artifact.segments.map((segment) => [segment.segmentId, segment]));
  const legacyIds = [];
  legacy.forEach((segment, index) => {
    const segmentId = String(segment && (segment.id || segment.segmentIdentity && segment.segmentIdentity.segmentId) || "");
    legacyIds.push(segmentId);
    const canonical = canonicalById.get(segmentId);
    if (!canonical) {
      differences.push(shadowDifference("segment_boundary", segmentId, "legacy_segment_present", "canonical_segment_missing", "canonical_segment_missing", "Legacy segment has no canonical counterpart", false));
      return;
    }
    const normalized = normalizeCanonicalType(segment.semanticType || segment.type);
    if (String(segment.type || "") !== canonical.semanticType) {
      const aliasExplained = normalized.aliasApplied && normalized.semanticType === canonical.semanticType;
      differences.push(shadowDifference("semantic_type", segmentId, String(segment.type || ""), canonical.semanticType, aliasExplained ? "ingress_alias_normalized" : "semantic_type_divergence", aliasExplained ? "Legacy ingress alias was normalized once by Structure Authority" : "Canonical semantic type differs from the normalized legacy candidate", aliasExplained));
    }
    const legacyTextHash = sha256(String(segment.sourceText || ""));
    if (legacyTextHash !== canonical.sourceOwnership.sourceTextHash) {
      differences.push(shadowDifference("source_ownership", segmentId, legacyTextHash, canonical.sourceOwnership.sourceTextHash, "source_text_hash_mismatch", "Canonical source snapshot differs from the legacy source candidate", false));
    }
    if (canonical.outputOrder !== index) {
      differences.push(shadowDifference("segment_order", segmentId, index, canonical.outputOrder, "segment_order_mismatch", "Canonical segment order differs from legacy order", false));
    }
    canonicalById.delete(segmentId);
  });
  canonicalById.forEach((segment, segmentId) => {
    differences.push(shadowDifference("segment_boundary", segmentId, "legacy_segment_missing", "canonical_segment_present", "canonical_segment_extra", "Canonical artifact contains a segment absent from the legacy result", false));
  });
  const explainedDifferenceCount = differences.filter((difference) => difference.explained).length;
  const unexplainedDifferenceCount = differences.length - explainedDifferenceCount;
  const reportBody = {
    schemaVersion: "semantic-structure-shadow-validation/v1",
    artifactId: artifact.artifactId,
    legacySegmentCount: legacy.length,
    canonicalSegmentCount: artifact.segments.length,
    legacySegmentIds: legacyIds,
    canonicalSegmentIds: artifact.segments.map((segment) => segment.segmentId),
    differenceCount: differences.length,
    explainedDifferenceCount,
    unexplainedDifferenceCount,
    status: unexplainedDifferenceCount > 0 ? "unexplained_differences" : (differences.length ? "explained_differences" : "match"),
    differences,
  };
  return deepFreeze({ ...reportBody, reportHash: sha256(stableStringify(reportBody)), frozen: true });
}

function runSemanticStructureShadowValidation(legacyResult, options = {}) {
  const result = legacyResult && typeof legacyResult === "object" ? legacyResult : {};
  const legacySegments = Array.isArray(result.segments) ? result.segments : [];
  try {
    const artifact = produceSemanticStructureArtifact({
      mode: options.mode,
      segments: legacySegments,
      inputStage: options.inputStage || "legacy_structure_candidate_shadow",
    });
    return deepFreeze({
      artifact,
      comparison: compareLegacySemanticStructure(legacySegments, artifact),
      legacyConsumersRemainAuthoritative: true,
      shadowOnly: true,
    });
  } catch (error) {
    const comparison = {
      schemaVersion: "semantic-structure-shadow-validation/v1",
      status: "producer_error",
      differenceCount: 1,
      explainedDifferenceCount: 0,
      unexplainedDifferenceCount: 1,
      differences: [{
        kind: "producer_error",
        segmentId: "",
        expected: "frozen_semantic_structure_artifact",
        actual: String(error && error.code || error && error.name || "Error"),
        explanationCode: String(error && error.code || "SEMANTIC_STRUCTURE_PRODUCER_ERROR"),
        explanation: String(error && error.message || error),
        explained: false,
      }],
      frozen: true,
    };
    comparison.reportHash = sha256(stableStringify(comparison));
    return deepFreeze({ artifact: null, comparison, legacyConsumersRemainAuthoritative: true, shadowOnly: true });
  }
}

module.exports = {
  AUTHORITY_NAME,
  AUTHORITY_VERSION,
  SCHEMA_VERSION,
  CANONICAL_SEMANTIC_TYPES,
  INGRESS_TYPE_ALIASES,
  deepFreeze,
  normalizeCanonicalType,
  produceSemanticStructureArtifact,
  compareLegacySemanticStructure,
  runSemanticStructureShadowValidation,
};
