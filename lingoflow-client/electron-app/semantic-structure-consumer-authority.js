"use strict";

const crypto = require("crypto");
const {
  SCHEMA_VERSION,
  deepFreeze,
  normalizeCanonicalType,
} = require("./semantic-structure-authority");

const CONSUMER_AUTHORITY_NAME = "semantic-structure-consumer-authority";
const CONSUMER_AUTHORITY_VERSION = "1.0.0";
const CONSUMER_REPORT_SCHEMA_VERSION = "semantic-structure-consumer-validation/v1";

function stableValue(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) return String(value);
    return value;
  }
  if (seen.has(value)) throw consumerError("SEMANTIC_CONSUMER_CIRCULAR_VALUE", "Semantic consumer input must not contain circular values");
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

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function consumerError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "SemanticStructureConsumerAuthorityError";
  error.code = code;
  error.details = stableValue(details);
  return error;
}

function artifactHashBody(artifact) {
  return {
    schemaVersion: artifact.schemaVersion,
    revision: artifact.revision,
    producer: artifact.producer,
    vocabulary: artifact.vocabulary,
    segmentCount: artifact.segmentCount,
    segments: artifact.segments,
  };
}

function validateAndRefreezeArtifact(inputArtifact, stage = "consumer_boundary") {
  if (!inputArtifact || typeof inputArtifact !== "object") {
    throw consumerError("SEMANTIC_ARTIFACT_REQUIRED", `SemanticStructureArtifact is required at ${stage}`, { stage });
  }
  if (inputArtifact.schemaVersion !== SCHEMA_VERSION) {
    throw consumerError("SEMANTIC_ARTIFACT_SCHEMA_MISMATCH", `Unsupported semantic artifact schema at ${stage}`, {
      stage,
      expected: SCHEMA_VERSION,
      actual: String(inputArtifact.schemaVersion || ""),
    });
  }
  if (!Array.isArray(inputArtifact.segments) || Number(inputArtifact.segmentCount) !== inputArtifact.segments.length) {
    throw consumerError("SEMANTIC_ARTIFACT_SEGMENT_COUNT_MISMATCH", `Semantic artifact segment count is invalid at ${stage}`, {
      stage,
      declared: Number(inputArtifact.segmentCount || 0),
      actual: Array.isArray(inputArtifact.segments) ? inputArtifact.segments.length : -1,
    });
  }
  const expectedHash = sha256(stableStringify(artifactHashBody(inputArtifact)));
  if (String(inputArtifact.contentHash || "") !== expectedHash || String(inputArtifact.artifactId || "") !== `semantic-structure-sha256:${expectedHash}`) {
    throw consumerError("SEMANTIC_ARTIFACT_HASH_MISMATCH", `Semantic artifact hash is invalid at ${stage}`, {
      stage,
      artifactId: String(inputArtifact.artifactId || ""),
      expectedHash,
      actualHash: String(inputArtifact.contentHash || ""),
    });
  }
  const seenIds = new Set();
  inputArtifact.segments.forEach((segment, index) => {
    const segmentId = String(segment && segment.segmentId || "");
    if (!segmentId) throw consumerError("SEMANTIC_ARTIFACT_SEGMENT_ID_MISSING", `Artifact segment ${index} has no identity at ${stage}`, { stage, index });
    if (seenIds.has(segmentId)) throw consumerError("SEMANTIC_ARTIFACT_SEGMENT_ID_DUPLICATE", `Artifact segment identity is duplicated at ${stage}`, { stage, segmentId });
    seenIds.add(segmentId);
    if (!segment.sourceOwnership || String(segment.sourceOwnership.ownerSegmentId || "") !== segmentId) {
      throw consumerError("SEMANTIC_ARTIFACT_OWNERSHIP_INVALID", `Artifact ownership is invalid at ${stage}`, { stage, segmentId });
    }
    if (String(segment.segmentIdentity && segment.segmentIdentity.segmentId || "") !== segmentId) {
      throw consumerError("SEMANTIC_ARTIFACT_IDENTITY_INVALID", `Artifact segment identity is invalid at ${stage}`, { stage, segmentId });
    }
    if (normalizeCanonicalType(segment.semanticType).semanticType !== segment.semanticType) {
      throw consumerError("SEMANTIC_ARTIFACT_TYPE_NOT_CANONICAL", `Artifact semantic type is not canonical at ${stage}`, { stage, segmentId, semanticType: segment.semanticType });
    }
  });
  return deepFreeze(inputArtifact);
}

function makeDifference(kind, segmentId, expected, actual, explanationCode) {
  return { kind, segmentId: String(segmentId || ""), expected, actual, explanationCode };
}

function compareConsumerCarrierSegments(inputSegments, artifact, options = {}) {
  const stage = String(options.stage || "consumer_boundary");
  const allowSubset = Boolean(options.allowSubset);
  const segments = Array.isArray(inputSegments) ? inputSegments : [];
  const artifactById = new Map(artifact.segments.map((segment) => [segment.segmentId, segment]));
  const seenIds = new Set();
  const differences = [];
  let previousOutputOrder = -1;

  segments.forEach((segment, index) => {
    const segmentId = String(segment && (segment.id || segment.segmentId) || "");
    if (!segmentId) {
      differences.push(makeDifference("identity", "", "stable_segment_id", "missing", "consumer_segment_id_missing"));
      return;
    }
    if (seenIds.has(segmentId)) {
      differences.push(makeDifference("identity", segmentId, "unique_segment_id", "duplicate", "consumer_segment_id_duplicate"));
      return;
    }
    seenIds.add(segmentId);
    const canonical = artifactById.get(segmentId);
    if (!canonical) {
      differences.push(makeDifference("boundary", segmentId, "artifact_segment", "consumer_only_segment", "consumer_segment_not_in_artifact"));
      return;
    }
    if (canonical.outputOrder <= previousOutputOrder) {
      differences.push(makeDifference("order", segmentId, `>${previousOutputOrder}`, canonical.outputOrder, "consumer_segment_order_drift"));
    }
    previousOutputOrder = canonical.outputOrder;

    let carrierType = "";
    try {
      carrierType = normalizeCanonicalType(segment.semanticType || segment.type).semanticType;
    } catch (error) {
      differences.push(makeDifference("semantic_type", segmentId, canonical.semanticType, String(segment.semanticType || segment.type || ""), String(error && error.code || "consumer_semantic_type_invalid")));
    }
    if (carrierType && carrierType !== canonical.semanticType) {
      differences.push(makeDifference("semantic_type", segmentId, canonical.semanticType, carrierType, "consumer_semantic_type_drift"));
    }
    if (segment.segmentIdentity && stableStringify(segment.segmentIdentity) !== stableStringify(canonical.segmentIdentity)) {
      differences.push(makeDifference("identity", segmentId, canonical.segmentIdentity, segment.segmentIdentity, "consumer_segment_identity_drift"));
    }
    const sourceTextHash = sha256(String(segment.sourceText || ""));
    if (sourceTextHash !== canonical.sourceOwnership.sourceTextHash) {
      differences.push(makeDifference("ownership", segmentId, canonical.sourceOwnership.sourceTextHash, sourceTextHash, "consumer_source_text_ownership_drift"));
    }
    if (String(canonical.sourceOwnership.ownerSegmentId || "") !== segmentId) {
      differences.push(makeDifference("ownership", segmentId, segmentId, canonical.sourceOwnership.ownerSegmentId, "consumer_owner_segment_drift"));
    }
    if (Array.isArray(segment.sourcePageRange) && stableStringify(segment.sourcePageRange.map(Number)) !== stableStringify(canonical.sourceOwnership.sourcePageRange)) {
      differences.push(makeDifference("ownership", segmentId, canonical.sourceOwnership.sourcePageRange, segment.sourcePageRange, "consumer_source_page_range_drift"));
    }
    artifactById.delete(segmentId);
  });

  if (!allowSubset) {
    artifactById.forEach((_segment, segmentId) => {
      differences.push(makeDifference("boundary", segmentId, "consumer_segment", "artifact_only_segment", "consumer_segment_missing"));
    });
  }

  const reportBody = {
    schemaVersion: CONSUMER_REPORT_SCHEMA_VERSION,
    consumerAuthority: CONSUMER_AUTHORITY_NAME,
    consumerAuthorityVersion: CONSUMER_AUTHORITY_VERSION,
    artifactId: artifact.artifactId,
    stage,
    mode: String(options.mode || artifact.producer && artifact.producer.mode || ""),
    allowSubset,
    carrierSegmentCount: segments.length,
    artifactSegmentCount: artifact.segments.length,
    differenceCount: differences.length,
    status: differences.length ? "drift" : "match",
    differences,
  };
  return deepFreeze({ ...reportBody, reportHash: sha256(stableStringify(reportBody)), frozen: true });
}

function defineAuthorityField(target, propertyName, getter, segmentId, stage) {
  const descriptor = Object.getOwnPropertyDescriptor(target, propertyName);
  if (descriptor && descriptor.configurable === false) {
    const currentValue = target[propertyName];
    const expectedValue = getter();
    if (stableStringify(currentValue) !== stableStringify(expectedValue)) {
      throw consumerError("SEMANTIC_CONSUMER_REBIND_DRIFT", `Semantic authority field cannot be rebound at ${stage}`, { stage, segmentId, propertyName });
    }
    return;
  }
  Object.defineProperty(target, propertyName, {
    enumerable: true,
    configurable: false,
    get: getter,
    set(value) {
      throw consumerError("SEMANTIC_POST_FREEZE_MUTATION", `Cannot mutate ${propertyName} after semantic freeze at ${stage}`, {
        stage,
        segmentId,
        propertyName,
        attemptedValue: stableValue(value),
      });
    },
  });
}

function bindSemanticStructureConsumerSegments(inputSegments, inputArtifact, options = {}) {
  const stage = String(options.stage || "consumer_boundary");
  const artifact = validateAndRefreezeArtifact(inputArtifact, stage);
  const segments = Array.isArray(inputSegments) ? inputSegments : [];
  const report = compareConsumerCarrierSegments(segments, artifact, options);
  if (report.differenceCount > 0) {
    throw consumerError("SEMANTIC_CONSUMER_PARITY_FAILED", `Semantic consumer parity failed at ${stage}`, { stage, report });
  }
  const artifactById = new Map(artifact.segments.map((segment) => [segment.segmentId, segment]));
  segments.forEach((segment) => {
    const segmentId = String(segment.id || segment.segmentId || "");
    const canonical = artifactById.get(segmentId);
    defineAuthorityField(segment, "type", () => canonical.semanticType, segmentId, stage);
    defineAuthorityField(segment, "semanticType", () => canonical.semanticType, segmentId, stage);
    defineAuthorityField(segment, "semanticPolicy", () => canonical.policy, segmentId, stage);
    defineAuthorityField(segment, "semanticDecisionId", () => canonical.semanticDecisionId, segmentId, stage);
    defineAuthorityField(segment, "semanticSourceOwnership", () => canonical.sourceOwnership, segmentId, stage);
    defineAuthorityField(segment, "semanticStructureArtifactId", () => artifact.artifactId, segmentId, stage);
  });
  return { artifact, segments, report };
}

function bindSemanticStructureConsumerPayload(inputPayload, options = {}) {
  const stage = String(options.stage || "consumer_payload");
  const payload = inputPayload && typeof inputPayload === "object" ? inputPayload : {};
  const artifact = validateAndRefreezeArtifact(payload.semanticStructureArtifact, stage);
  const reports = [];
  const bindList = (name, allowSubset) => {
    if (!Array.isArray(payload[name])) return;
    const bound = bindSemanticStructureConsumerSegments(payload[name], artifact, {
      stage: `${stage}.${name}`,
      mode: options.mode,
      allowSubset,
    });
    reports.push(bound.report);
  };
  bindList("allSegments", false);
  bindList("segments", true);
  bindList("simpleBlocks", true);
  if (!Array.isArray(payload.allSegments)) {
    throw consumerError("SEMANTIC_CONSUMER_ALL_SEGMENTS_REQUIRED", `allSegments is required at ${stage}`, { stage });
  }
  return { artifact, payload, reports: deepFreeze(reports.slice()) };
}

module.exports = {
  CONSUMER_AUTHORITY_NAME,
  CONSUMER_AUTHORITY_VERSION,
  CONSUMER_REPORT_SCHEMA_VERSION,
  validateAndRefreezeArtifact,
  compareConsumerCarrierSegments,
  bindSemanticStructureConsumerSegments,
  bindSemanticStructureConsumerPayload,
};
