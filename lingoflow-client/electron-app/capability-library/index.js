"use strict";

const fs = require("fs");
const path = require("path");
const Ajv = require("ajv/dist/2020");
const schemaValidator = new Ajv({ strict: true, allErrors: true });
const capabilitySchema = JSON.parse(fs.readFileSync(path.join(__dirname, "capability.schema.json"), "utf8"));
const corpusSchema = JSON.parse(fs.readFileSync(path.join(__dirname, "sample-corpus.schema.json"), "utf8"));
schemaValidator.addSchema(capabilitySchema);
schemaValidator.addSchema(corpusSchema);
const validateCapabilitySchema = schemaValidator.getSchema(capabilitySchema.$id);
const validateCorpusSchema = schemaValidator.getSchema(corpusSchema.$id);
const validateSampleSchema = schemaValidator.compile({ $ref: corpusSchema.$id + "#/$defs/sample" });

function validateSchema(value, validator) {
  assertNoRuntimeDecisionFields(value);
  if (!validator(value)) fail("CAPABILITY_LIBRARY_SCHEMA_INVALID", "Evidence schema validation failed", { errors: validator.errors });
}

const FORBIDDEN_RUNTIME_DECISION_FIELDS = new Set([
  "semanticType",
  "canonicalType",
  "detectedColumn",
  "columnType",
  "readingOrderKey",
  "layoutDecision",
  "writeDecision",
  "runtimeClassification",
  "productionRoute",
]);
const EVIDENCE_LEVELS = new Set(["unit_contract", "artifact", "real_run", "pixel_visual", "user_acceptance"]);
const CAPABILITY_STATUSES = new Set(["defined", "pilot_ready", "covered", "deprecated"]);

function fail(code, message, details) {
  const error = new Error(message);
  error.name = "CapabilityLibraryError";
  error.code = code;
  error.details = details || {};
  throw error;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    fail("CAPABILITY_LIBRARY_SCHEMA_INVALID", `${label} must be a non-empty string`, { label });
  }
}

function requireArray(value, label) {
  if (!Array.isArray(value)) {
    fail("CAPABILITY_LIBRARY_SCHEMA_INVALID", `${label} must be an array`, { label });
  }
}

function assertNoRuntimeDecisionFields(value, trail) {
  const currentTrail = trail || "$";
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoRuntimeDecisionFields(item, `${currentTrail}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  Object.keys(value).forEach((key) => {
    if (FORBIDDEN_RUNTIME_DECISION_FIELDS.has(key)) {
      fail(
        "CAPABILITY_LIBRARY_RUNTIME_AUTHORITY_FORBIDDEN",
        `Evidence catalog cannot contain runtime decision field '${key}'`,
        { field: key, trail: `${currentTrail}.${key}` }
      );
    }
    assertNoRuntimeDecisionFields(value[key], `${currentTrail}.${key}`);
  });
}

function validateAuthorityBoundary(catalog, expectedRole) {
  if (!isObject(catalog)) fail("CAPABILITY_LIBRARY_SCHEMA_INVALID", "Catalog must be an object");
  if (catalog.catalogRole !== expectedRole || catalog.runtimeDecisionUse !== "forbidden") {
    fail("CAPABILITY_LIBRARY_RUNTIME_AUTHORITY_FORBIDDEN", "Catalog must be evidence-only and forbidden for runtime decisions", {
      catalogRole: catalog.catalogRole,
      runtimeDecisionUse: catalog.runtimeDecisionUse,
    });
  }
  assertNoRuntimeDecisionFields(catalog);
}

function validateCapabilityCatalog(catalog) {
  validateAuthorityBoundary(catalog, "evidence_and_regression_only");
  validateSchema(catalog, validateCapabilitySchema);
  if (catalog.schemaVersion !== "capability-library/v1") {
    fail("CAPABILITY_LIBRARY_SCHEMA_INVALID", "Unsupported capability catalog schemaVersion");
  }
  requireArray(catalog.capabilities, "capabilities");
  const ids = new Set();
  catalog.capabilities.forEach((capability, index) => {
    const label = `capabilities[${index}]`;
    if (!isObject(capability)) fail("CAPABILITY_LIBRARY_SCHEMA_INVALID", `${label} must be an object`);
    ["id", "name", "description", "architectureRecord", "status"].forEach((key) => requireString(capability[key], `${label}.${key}`));
    if (!/^cap\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(capability.id)) fail("CAPABILITY_LIBRARY_SCHEMA_INVALID", `${label}.id is invalid`);
    if (!/^AA-[A-Z]+-[0-9]{3}$/.test(capability.architectureRecord)) fail("CAPABILITY_LIBRARY_SCHEMA_INVALID", `${label}.architectureRecord is invalid`);
    if (!CAPABILITY_STATUSES.has(capability.status)) fail("CAPABILITY_LIBRARY_SCHEMA_INVALID", `${label}.status is invalid`);
    if (ids.has(capability.id)) fail("CAPABILITY_LIBRARY_DUPLICATE_ID", `Duplicate capability id '${capability.id}'`);
    ids.add(capability.id);
    if (!isObject(capability.decisionAuthority)) fail("CAPABILITY_LIBRARY_SCHEMA_INVALID", `${label}.decisionAuthority must be an object`);
    requireString(capability.decisionAuthority.owner, `${label}.decisionAuthority.owner`);
    requireString(capability.decisionAuthority.statement, `${label}.decisionAuthority.statement`);
    ["boundaries", "expectedOutcomes", "evidenceRequirements", "regressionSampleIds"].forEach((key) => requireArray(capability[key], `${label}.${key}`));
    capability.boundaries.forEach((boundary, boundaryIndex) => {
      const boundaryLabel = `${label}.boundaries[${boundaryIndex}]`;
      if (!isObject(boundary) || !/^boundary\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(boundary.id || "")) fail("CAPABILITY_LIBRARY_SCHEMA_INVALID", `${boundaryLabel}.id is invalid`);
      requireString(boundary.description, `${boundaryLabel}.description`);
      requireArray(boundary.featureTags, `${boundaryLabel}.featureTags`);
    });
    capability.expectedOutcomes.forEach((outcome, outcomeIndex) => {
      const outcomeLabel = `${label}.expectedOutcomes[${outcomeIndex}]`;
      if (!isObject(outcome) || !/^assert\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(outcome.id || "")) fail("CAPABILITY_LIBRARY_SCHEMA_INVALID", `${outcomeLabel}.id is invalid`);
      requireString(outcome.assertion, `${outcomeLabel}.assertion`);
      if (!EVIDENCE_LEVELS.has(outcome.evidenceLevel)) fail("CAPABILITY_LIBRARY_SCHEMA_INVALID", `${outcomeLabel}.evidenceLevel is invalid`);
    });
    capability.evidenceRequirements.forEach((level) => {
      if (!EVIDENCE_LEVELS.has(level)) fail("CAPABILITY_LIBRARY_SCHEMA_INVALID", `${label}.evidenceRequirements contains an invalid level`);
    });
  });
  return catalog;
}

function validateCorpusSample(sample, label) {
  const at = label || "sample";
  validateSchema(sample, validateSampleSchema);
  if (!isObject(sample)) fail("CAPABILITY_LIBRARY_SCHEMA_INVALID", `${at} must be an object`);
  requireString(sample.id, `${at}.id`);
  requireString(sample.displayName, `${at}.displayName`);
  if (!/^sample\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(sample.id)) fail("CAPABILITY_LIBRARY_SCHEMA_INVALID", `${at}.id is invalid`);
  if (!isObject(sample.source) || sample.source.mediaType !== "application/pdf" || !/^[a-f0-9]{64}$/.test(sample.source.sha256 || "")) {
    fail("CAPABILITY_LIBRARY_SCHEMA_INVALID", `${at}.source must contain canonical PDF metadata`);
  }
  if (!Number.isInteger(sample.source.bytes) || sample.source.bytes < 1 || !Number.isInteger(sample.source.pageCount) || sample.source.pageCount < 1) {
    fail("CAPABILITY_LIBRARY_SCHEMA_INVALID", `${at}.source bytes/pageCount are invalid`);
  }
  if (!isObject(sample.rights) || sample.rights.canStoreMetadata !== true) fail("CAPABILITY_LIBRARY_RIGHTS_REQUIRED", `${at}.rights must allow metadata storage`);
  if (!isObject(sample.provenance)) fail("CAPABILITY_LIBRARY_SCHEMA_INVALID", `${at}.provenance is required`);
  requireString(sample.provenance.kind, `${at}.provenance.kind`);
  requireString(sample.provenance.reference, `${at}.provenance.reference`);
  ["boundaryFeatureIds", "expectedOutcomes", "evidenceRefs"].forEach((key) => requireArray(sample[key], `${at}.${key}`));
  if (!sample.boundaryFeatureIds.length) fail("CAPABILITY_LIBRARY_SCHEMA_INVALID", `${at}.boundaryFeatureIds cannot be empty`);
  if (!isObject(sample.storage) || !isObject(sample.authorityBoundary)) fail("CAPABILITY_LIBRARY_SCHEMA_INVALID", `${at} storage/authorityBoundary are required`);
  if (sample.authorityBoundary.catalogRole !== "regression_oracle" || sample.authorityBoundary.runtimeDecisionUse !== "forbidden") {
    fail("CAPABILITY_LIBRARY_RUNTIME_AUTHORITY_FORBIDDEN", `${at} cannot be used for runtime decisions`);
  }
  requireArray(sample.authorityBoundary.finalDecisionsOwnedBy, `${at}.authorityBoundary.finalDecisionsOwnedBy`);
  if (!sample.authorityBoundary.finalDecisionsOwnedBy.length || sample.authorityBoundary.finalDecisionsOwnedBy.some((id) => !/^AA-[A-Z]+-[0-9]{3}$/.test(id))) {
    fail("CAPABILITY_LIBRARY_SCHEMA_INVALID", `${at}.authorityBoundary.finalDecisionsOwnedBy is invalid`);
  }
  if (sample.storage.binaryCommitted && sample.rights.canStoreBinary !== true) {
    fail("CAPABILITY_LIBRARY_RIGHTS_REQUIRED", `${at} cannot commit a binary without explicit rights`);
  }
  sample.expectedOutcomes.forEach((outcome, index) => {
    const outcomeLabel = `${at}.expectedOutcomes[${index}]`;
    if (!isObject(outcome)) fail("CAPABILITY_LIBRARY_SCHEMA_INVALID", `${outcomeLabel} must be an object`);
    requireString(outcome.capabilityId, `${outcomeLabel}.capabilityId`);
    requireString(outcome.assertionId, `${outcomeLabel}.assertionId`);
    if (!["exact", "range", "manual"].includes(outcome.oracleType)) fail("CAPABILITY_LIBRARY_SCHEMA_INVALID", `${outcomeLabel}.oracleType is invalid`);
  });
  assertNoRuntimeDecisionFields(sample, at);
  return sample;
}

function validateCorpusCatalog(catalog) {
  validateAuthorityBoundary(catalog, "regression_only");
  validateSchema(catalog, validateCorpusSchema);
  if (catalog.schemaVersion !== "capability-corpus/v1") fail("CAPABILITY_LIBRARY_SCHEMA_INVALID", "Unsupported corpus schemaVersion");
  requireArray(catalog.samples, "samples");
  const ids = new Set();
  catalog.samples.forEach((sample, index) => {
    validateCorpusSample(sample, `samples[${index}]`);
    if (ids.has(sample.id)) fail("CAPABILITY_LIBRARY_DUPLICATE_ID", `Duplicate sample id '${sample.id}'`);
    ids.add(sample.id);
  });
  return catalog;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.getOwnPropertyNames(value).forEach((key) => deepFreeze(value[key]));
  return Object.freeze(value);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listCapabilityCatalogRoots(rootDir) {
  const capabilitiesRoot = path.join(rootDir, "capabilities");
  if (!fs.existsSync(capabilitiesRoot)) return [];
  return fs.readdirSync(capabilitiesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(capabilitiesRoot, entry.name))
    .filter((catalogRoot) => fs.existsSync(path.join(catalogRoot, "capabilities.json")) && fs.existsSync(path.join(catalogRoot, "corpus.json")))
    .sort();
}

function loadCapabilityCatalogState(options) {
  const rootDir = options && options.rootDir ? options.rootDir : __dirname;
  const catalogRoots = [rootDir, ...listCapabilityCatalogRoots(rootDir)];
  const capabilityCatalogs = catalogRoots.map((catalogRoot) => validateCapabilityCatalog(readJson(path.join(catalogRoot, "capabilities.json"))));
  const corpusCatalogs = catalogRoots.map((catalogRoot) => validateCorpusCatalog(readJson(path.join(catalogRoot, "corpus.json"))));
  const capabilityCatalog = validateCapabilityCatalog({
    schemaVersion: "capability-library/v1",
    catalogRole: "evidence_and_regression_only",
    runtimeDecisionUse: "forbidden",
    capabilities: capabilityCatalogs.flatMap((catalog) => catalog.capabilities),
  });
  const corpusCatalog = validateCorpusCatalog({
    schemaVersion: "capability-corpus/v1",
    catalogRole: "regression_only",
    runtimeDecisionUse: "forbidden",
    samples: corpusCatalogs.flatMap((catalog) => catalog.samples),
  });
  const capabilityIds = new Set(capabilityCatalog.capabilities.map((item) => item.id));
  if (capabilityIds.size !== capabilityCatalog.capabilities.length) {
    fail("CAPABILITY_LIBRARY_DUPLICATE_ID", "Capability subdirectories cannot redefine an existing capability");
  }
  const sampleIds = new Set();
  const sampleHashes = new Map();
  corpusCatalog.samples.forEach((sample) => {
    const capabilityIdsForSample = new Set(sample.expectedOutcomes.map((outcome) => outcome.capabilityId));
    const matchingSource = sampleHashes.get(sample.source.sha256);
    if (sampleIds.has(sample.id) || (matchingSource && [...capabilityIdsForSample].some((id) => matchingSource.capabilityIds.has(id)))) {
      fail("CAPABILITY_LIBRARY_DUPLICATE_ID", `Capability subdirectories contain a duplicate sample '${sample.id}'`);
    }
    if (matchingSource && (matchingSource.bytes !== sample.source.bytes || matchingSource.pageCount !== sample.source.pageCount || matchingSource.mediaType !== sample.source.mediaType)) {
      fail("CAPABILITY_LIBRARY_DUPLICATE_ID", `Shared PDF hash has inconsistent source metadata for sample '${sample.id}'`);
    }
    sampleIds.add(sample.id);
    if (matchingSource) capabilityIdsForSample.forEach((id) => matchingSource.capabilityIds.add(id));
    else sampleHashes.set(sample.source.sha256, { capabilityIds: capabilityIdsForSample, bytes: sample.source.bytes, pageCount: sample.source.pageCount, mediaType: sample.source.mediaType });
    sample.expectedOutcomes.forEach((outcome) => {
      if (!capabilityIds.has(outcome.capabilityId)) {
        fail("CAPABILITY_LIBRARY_UNKNOWN_CAPABILITY", `Sample '${sample.id}' references unknown capability '${outcome.capabilityId}'`);
      }
      const capability = capabilityCatalog.capabilities.find((item) => item.id === outcome.capabilityId);
      if (!capability.regressionSampleIds.includes(sample.id)) {
        fail("CAPABILITY_LIBRARY_REFERENCE_INVALID", `Sample '${sample.id}' is missing the capability back-reference`);
      }
    });
  });
  capabilityCatalog.capabilities.forEach((capability) => capability.regressionSampleIds.forEach((sampleId) => {
    const sample = corpusCatalog.samples.find((item) => item.id === sampleId);
    if (!sample || !sample.expectedOutcomes.some((outcome) => outcome.capabilityId === capability.id)) {
      fail("CAPABILITY_LIBRARY_REFERENCE_INVALID", `Capability '${capability.id}' has a dangling regression sample '${sampleId}'`);
    }
  }));
  return deepFreeze({ capabilities: capabilityCatalog, corpus: corpusCatalog });
}

function loadCapabilityLibrary(options) {
  const state = loadCapabilityCatalogState(options);
  return deepFreeze({
    schemaVersion: "capability-library-snapshot/v1",
    role: "evidence_and_regression_only",
    runtimeDecisionUse: "forbidden",
    capabilities: state.capabilities.capabilities,
    samples: state.corpus.samples,
  });
}

module.exports = {
  // Expose a detached inspection copy; callers cannot disable the shared guard by clearing it.
  FORBIDDEN_RUNTIME_DECISION_FIELDS: new Set(FORBIDDEN_RUNTIME_DECISION_FIELDS),
  assertNoRuntimeDecisionFields,
  deepFreeze,
  loadCapabilityCatalogState,
  loadCapabilityLibrary,
  validateCapabilityCatalog,
  validateCorpusCatalog,
  validateCorpusSample,
};
