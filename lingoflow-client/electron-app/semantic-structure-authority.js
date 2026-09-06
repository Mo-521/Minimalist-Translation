"use strict";

const crypto = require("crypto");

const AUTHORITY_NAME = "semantic-structure-authority";
const AUTHORITY_VERSION = "1.0.0";
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
const SIMPLE_STRUCTURE_ROLE_TYPES = Object.freeze({
  simple_title: "title",
  simple_paragraph: "body",
});
const PAPER_LINE_NOISE_ROLE_TYPES = Object.freeze({
  paper_watermark_line: "watermark",
  paper_license_line: "licenseText",
  paper_footer_marker_line: "footer",
  paper_page_number_line: "pageNumber",
  paper_header_line: "header",
  paper_footer_line: "footer",
  paper_margin_line: "margin",
});
const PAPER_LINE_TOP_MATTER_ROLE_TYPES = Object.freeze({
  paper_funding_line: "funding",
  paper_keywords_line: "keywords",
  paper_correspondence_line: "correspondence",
  paper_received_date_line: "receivedDate",
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

function resolveCandidateSemanticType(segment, mode) {
  const structureRole = String(segment && segment.structureRole || "").trim();
  const rawType = String(segment && (segment.semanticType || segment.type) || "").trim();
  if (!structureRole) return { ...normalizeCanonicalType(rawType), structureRole: "" };
  if (mode !== "simple_pdf") {
    throw structureError("SEMANTIC_STRUCTURE_ROLE_UNSUPPORTED", `Structure role is not supported for ${mode}: ${structureRole}`, { mode, structureRole });
  }
  const semanticType = SIMPLE_STRUCTURE_ROLE_TYPES[structureRole];
  if (!semanticType) {
    throw structureError("SEMANTIC_STRUCTURE_ROLE_UNKNOWN", `Unknown Simple structure role: ${structureRole}`, { mode, structureRole });
  }
  if (rawType) {
    const declared = normalizeCanonicalType(rawType);
    if (declared.semanticType !== semanticType) {
      throw structureError("SEMANTIC_STRUCTURE_ROLE_TYPE_CONFLICT", `Simple structure role conflicts with declared semantic type: ${structureRole} -> ${rawType}`, {
        mode,
        structureRole,
        declaredType: rawType,
        resolvedType: semanticType,
      });
    }
  }
  return {
    rawType,
    semanticType,
    aliasApplied: false,
    aliasReason: "simple_structure_role_decision",
    structureRole,
  };
}

function resolvePaperLineRole(role, roleTypes, field) {
  const value = String(role || "").trim();
  if (!value) return "";
  const semanticType = roleTypes[value];
  if (!semanticType) {
    throw structureError("SEMANTIC_PAPER_LINE_ROLE_UNKNOWN", `Unknown Paper line ${field}: ${value}`, { field, role: value });
  }
  return semanticType;
}

function classifyPaperLineEvidence(evidence = {}) {
  const noiseType = resolvePaperLineRole(evidence.noiseRole, PAPER_LINE_NOISE_ROLE_TYPES, "noiseRole");
  if (noiseType) return noiseType;
  const topMatterType = resolvePaperLineRole(evidence.topMatterRole, PAPER_LINE_TOP_MATTER_ROLE_TYPES, "topMatterRole");
  if (topMatterType) return topMatterType;
  if (evidence.chineseTitleCandidate) return "title";
  if (evidence.abstractLabel) return "abstract";
  if (evidence.keywordsLabel) return "keywords";
  if (evidence.numberedHeading || evidence.referencesHeading || evidence.sectionHeading) return "heading";
  if (evidence.captionStart) return "caption";
  return "body";
}

function classifyPaperSegmentNoiseEvidence(evidence = {}) {
  if (evidence.narrowTallMargin) return "margin";
  if (evidence.footerOrWatermarkText) return evidence.downloadedOrWileyText ? "watermark" : "licenseText";
  return "";
}

function applyPaperSegmentNoiseClassification(segments, evidenceByIndex) {
  const candidates = Array.isArray(segments) ? segments : [];
  const evidence = Array.isArray(evidenceByIndex) ? evidenceByIndex : [];
  if (evidence.length !== candidates.length) {
    throw structureError("SEMANTIC_PAPER_SEGMENT_EVIDENCE_COUNT_MISMATCH", "Paper segment noise evidence must align with every candidate", {
      segmentCount: candidates.length,
      evidenceCount: evidence.length,
    });
  }
  return candidates.map((segment, index) => {
    const itemEvidence = evidence[index];
    if (!itemEvidence || Number(itemEvidence.segmentIndex) !== index) {
      throw structureError("SEMANTIC_PAPER_SEGMENT_EVIDENCE_ORDER_MISMATCH", "Paper segment noise evidence order does not match candidates", {
        index,
        evidenceIndex: itemEvidence && itemEvidence.segmentIndex,
      });
    }
    const currentType = normalizeCanonicalType(segment && (segment.semanticType || segment.type)).semanticType;
    if (currentType !== "body") return segment;
    const semanticType = classifyPaperSegmentNoiseEvidence(itemEvidence);
    return semanticType
      ? { ...segment, type: semanticType, classificationReason: `${semanticType}_segment_geometry` }
      : segment;
  });
}

function applyPaperImageTextDemotionClassification(segments, evidenceByIndex) {
  const candidates = Array.isArray(segments) ? segments : [];
  const evidence = Array.isArray(evidenceByIndex) ? evidenceByIndex : [];
  if (evidence.length !== candidates.length) {
    throw structureError("SEMANTIC_PAPER_IMAGE_TEXT_EVIDENCE_COUNT_MISMATCH", "Paper image-text demotion evidence must align with every candidate", {
      segmentCount: candidates.length,
      evidenceCount: evidence.length,
    });
  }
  return candidates.map((segment, index) => {
    const itemEvidence = evidence[index];
    if (!itemEvidence || Number(itemEvidence.segmentIndex) !== index) {
      throw structureError("SEMANTIC_PAPER_IMAGE_TEXT_EVIDENCE_ORDER_MISMATCH", "Paper image-text demotion evidence order does not match candidates", {
        index,
        evidenceIndex: itemEvidence && itemEvidence.segmentIndex,
      });
    }
    const currentType = normalizeCanonicalType(segment && (segment.semanticType || segment.type)).semanticType;
    const bodyLikeReason = String(itemEvidence.bodyLikeReason || "");
    if (currentType !== "imageText" || !bodyLikeReason) return segment;
    return {
      ...segment,
      type: "body",
      status: "pending",
      skipReason: "",
      preserveReasonLabel: "",
      classificationReason: "image_text_body_like_demoted_to_body",
      imageTextDemotedToBody: true,
      imageTextDemoteReason: bodyLikeReason,
      translatedText: segment.translatedText || "",
      zoneType: segment.zoneType === "imageZone" ? "" : segment.zoneType,
    };
  });
}

const semanticStructureProducerStages = Object.freeze({
  classifyPaperLineEvidence,
  classifyPaperSegmentNoiseEvidence,
  applyPaperSegmentNoiseClassification,
  applyPaperImageTextDemotionClassification,
});

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
    structureRole: normalizedType.structureRole || "",
    aliasApplied: normalizedType.aliasApplied,
    aliasReason: normalizedType.aliasReason,
    classificationReason: String(segment && segment.classificationReason || "structure_candidate_type_input"),
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
      schemaVersion: "semantic-structure-identity/v1",
      segmentId,
      origin: "structure_candidate_id",
      parentSegmentId: String(segment.splitFromSegmentId || ""),
    };
  if (String(segmentIdentity.segmentId || "") !== segmentId) {
    throw structureError("SEMANTIC_SEGMENT_IDENTITY_DRIFT", `Segment id and identity artifact disagree: ${segmentId}`, {
      segmentId,
      identitySegmentId: String(segmentIdentity.segmentId || ""),
    });
  }
  const normalizedType = resolveCandidateSemanticType(segment, mode);
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
      inputStage: String(input.inputStage || "structure_candidates"),
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

function candidateDifference(kind, segmentId, expected, actual, explanationCode, explanation, explained) {
  return { kind, segmentId: String(segmentId || ""), expected, actual, explanationCode, explanation, explained: Boolean(explained) };
}

function compareCandidateSemanticStructure(candidateSegments, artifact) {
  const candidates = Array.isArray(candidateSegments) ? candidateSegments : [];
  if (!artifact || artifact.schemaVersion !== SCHEMA_VERSION || !Array.isArray(artifact.segments)) {
    throw structureError("SEMANTIC_ARTIFACT_INVALID", "A valid SemanticStructureArtifact is required for candidate comparison");
  }
  const differences = [];
  const canonicalById = new Map(artifact.segments.map((segment) => [segment.segmentId, segment]));
  const candidateIds = [];
  candidates.forEach((segment, index) => {
    const segmentId = String(segment && (segment.id || segment.segmentIdentity && segment.segmentIdentity.segmentId) || "");
    candidateIds.push(segmentId);
    const canonical = canonicalById.get(segmentId);
    if (!canonical) {
      differences.push(candidateDifference("segment_boundary", segmentId, "candidate_segment_present", "canonical_segment_missing", "canonical_segment_missing", "Structure candidate has no canonical counterpart", false));
      return;
    }
    const normalized = resolveCandidateSemanticType(segment, artifact.producer.mode);
    const declaredType = String(segment.semanticType || segment.type || "");
    if (declaredType && declaredType !== canonical.semanticType) {
      const aliasExplained = normalized.aliasApplied && normalized.semanticType === canonical.semanticType;
      differences.push(candidateDifference("semantic_type", segmentId, declaredType, canonical.semanticType, aliasExplained ? "ingress_alias_normalized" : "semantic_type_divergence", aliasExplained ? "Candidate ingress alias was normalized once by Structure Authority" : "Canonical semantic type differs from the normalized structure candidate", aliasExplained));
    }
    const candidateTextHash = sha256(String(segment.sourceText || ""));
    if (candidateTextHash !== canonical.sourceOwnership.sourceTextHash) {
      differences.push(candidateDifference("source_ownership", segmentId, candidateTextHash, canonical.sourceOwnership.sourceTextHash, "source_text_hash_mismatch", "Canonical source snapshot differs from the structure candidate", false));
    }
    if (canonical.outputOrder !== index) {
      differences.push(candidateDifference("segment_order", segmentId, index, canonical.outputOrder, "segment_order_mismatch", "Canonical segment order differs from candidate order", false));
    }
    canonicalById.delete(segmentId);
  });
  canonicalById.forEach((segment, segmentId) => {
    differences.push(candidateDifference("segment_boundary", segmentId, "candidate_segment_missing", "canonical_segment_present", "canonical_segment_extra", "Canonical artifact contains a segment absent from the candidate set", false));
  });
  const explainedDifferenceCount = differences.filter((difference) => difference.explained).length;
  const unexplainedDifferenceCount = differences.length - explainedDifferenceCount;
  const reportBody = {
    schemaVersion: "semantic-structure-validation-evidence/v1",
    artifactId: artifact.artifactId,
    candidateSegmentCount: candidates.length,
    canonicalSegmentCount: artifact.segments.length,
    candidateSegmentIds: candidateIds,
    canonicalSegmentIds: artifact.segments.map((segment) => segment.segmentId),
    differenceCount: differences.length,
    explainedDifferenceCount,
    unexplainedDifferenceCount,
    status: unexplainedDifferenceCount > 0 ? "unexplained_differences" : (differences.length ? "explained_differences" : "match"),
    differences,
  };
  return deepFreeze({ ...reportBody, reportHash: sha256(stableStringify(reportBody)), frozen: true });
}

module.exports = {
  AUTHORITY_NAME,
  AUTHORITY_VERSION,
  SCHEMA_VERSION,
  CANONICAL_SEMANTIC_TYPES,
  INGRESS_TYPE_ALIASES,
  deepFreeze,
  normalizeCanonicalType,
  semanticStructureProducerStages,
  produceSemanticStructureArtifact,
  compareCandidateSemanticStructure,
};
