"use strict";

// Offline evidence workflow only. No PDF runtime Authority imports or classification.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Ajv = require("ajv/dist/2020");
const { assertNoRuntimeDecisionFields, deepFreeze, loadCapabilityCatalogState, validateCorpusSample } = require("./index");
const ajv = new Ajv({ strict: true, allErrors: true });
const schemas = ["capability.schema.json", "sample-corpus.schema.json", "candidate-pool.schema.json"];
schemas.forEach((name) => ajv.addSchema(JSON.parse(fs.readFileSync(path.join(__dirname, name), "utf8"))));
const validators = schemas.map((name) => ajv.getSchema(JSON.parse(fs.readFileSync(path.join(__dirname, name), "utf8")).$id));
const clone = (value) => JSON.parse(JSON.stringify(value));
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function schemaCheck(value, index) {
  assertNoRuntimeDecisionFields(value);
  if (!validators[index](value)) fail("CANDIDATE_SCHEMA_INVALID", JSON.stringify(validators[index].errors));
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
const hash = (value) => crypto.createHash("sha256").update(canonical(value)).digest("hex");
const payloadHash = (candidate) => hash({ id: candidate.id, capabilityIds: candidate.capabilityIds, sample: candidate.sample });
const transitions = { pending: ["under_review"], under_review: ["accepted", "insufficient_evidence"], insufficient_evidence: ["under_review"], accepted: [] };
function append(candidate, action, to, audit) {
  assertNoRuntimeDecisionFields(audit);
  if (audit && Object.keys(audit).some((key) => !["actor", "reason", "at", "evidenceRefs", "expectedOutcomes"].includes(key))) fail("CANDIDATE_AUDIT_INVALID", "Unknown audit fields are not silently discarded");
  if (action === "promote" && audit && audit.expectedOutcomes && audit.expectedOutcomes.length) fail("CANDIDATE_PROMOTION_FORBIDDEN", "Promotion cannot introduce unreviewed oracles");
  if (!audit || !audit.actor || !audit.actor.trim() || !audit.reason || !audit.reason.trim()) fail("CANDIDATE_AUDIT_REQUIRED", "Explicit actor and reason are required");
  const at = audit.at || new Date().toISOString();
  if (!Number.isFinite(Date.parse(at))) fail("CANDIDATE_AUDIT_INVALID", "Invalid audit time");
  const previous = candidate.history.at(-1);
  if (previous && Date.parse(at) < Date.parse(previous.at)) fail("CANDIDATE_AUDIT_INVALID", "Audit time cannot move backwards");
  const event = { sequence: candidate.history.length + 1, action, actor: audit.actor, at, reason: audit.reason,
    from: previous ? candidate.status : null, to, evidenceRefs: audit.evidenceRefs || [], expectedOutcomes: audit.expectedOutcomes || [], sampleHash: payloadHash(candidate), previousHash: previous ? previous.hash : null };
  candidate.history.push({ ...event, hash: hash(event) });
  candidate.status = to;
}
function checkHistory(candidate) {
  let status = null, previous = null, promoted = false;
  const outcomeKey = (outcome) => `${outcome.capabilityId}/${outcome.assertionId}`;
  const currentOutcomes = new Map(candidate.sample.expectedOutcomes.map((outcome) => [outcomeKey(outcome), outcome]));
  candidate.history.forEach((event, index) => {
    const { hash: digest, ...unsigned } = event;
    if (event.sequence !== index + 1 || event.from !== status || event.previousHash !== (previous ? previous.hash : null) || digest !== hash(unsigned) || event.sampleHash !== payloadHash(candidate)) fail("CANDIDATE_HISTORY_INVALID", "History or immutable submission was rewritten");
    if (!event.actor.trim() || !event.reason.trim() || !Number.isFinite(Date.parse(event.at)) || (previous && Date.parse(event.at) < Date.parse(previous.at))) fail("CANDIDATE_HISTORY_INVALID", "Invalid audit metadata");
    if (index === 0) {
      if (event.action !== "submit" || event.to !== "pending") fail("CANDIDATE_HISTORY_INVALID", "Submission must start pending");
    } else if (event.action === "review") {
      if (promoted || !(transitions[status] || []).includes(event.to)) fail("CANDIDATE_TRANSITION_INVALID", "Invalid review transition");
    } else if (event.action === "revise") {
      if (promoted || status !== "accepted" || event.to !== "under_review" || !event.evidenceRefs.length
        || event.expectedOutcomes.length !== currentOutcomes.size) {
        fail("CANDIDATE_REVISION_INVALID", "Revision requires an accepted unpromoted candidate, evidence and a complete outcome set");
      }
      const revised = new Map(event.expectedOutcomes.map((outcome) => [outcomeKey(outcome), outcome]));
      if (revised.size !== currentOutcomes.size
        || [...revised.keys()].some((key) => !currentOutcomes.has(key))
        || [...revised].every(([key, outcome]) => hash(outcome) === hash(currentOutcomes.get(key)))) {
        fail("CANDIDATE_REVISION_INVALID", "Revision must preserve assertion identities and change a reviewed outcome");
      }
    } else if (event.action === "promote") {
      if (status !== "accepted" || event.to !== "accepted" || promoted || event.expectedOutcomes.length) fail("CANDIDATE_PROMOTION_FORBIDDEN", "Only one explicit accepted promotion with reviewed oracles is allowed");
      promoted = true;
    } else fail("CANDIDATE_HISTORY_INVALID", "Invalid audit action");
    event.expectedOutcomes.forEach((outcome) => currentOutcomes.set(outcomeKey(outcome), outcome));
    status = event.to; previous = event;
  });
  if (candidate.status !== status || candidate.promotedSampleId !== (promoted ? candidate.sample.id : null)) fail("CANDIDATE_HISTORY_INVALID", "Materialized state differs from history");
}
function unique(items, key, label) {
  const seen = new Set();
  items.forEach((item) => { const value = key(item); if (seen.has(value)) fail("CANDIDATE_DUPLICATE", `Duplicate ${label}: ${value}`); seen.add(value); });
}
function sameSourceWithSharedCapability(left, right) {
  if (left.sample.source.sha256 !== right.sample.source.sha256) return false;
  return left.capabilityIds.some((id) => right.capabilityIds.includes(id));
}
function assertSharedSourceMetadata(entries) {
  const seen = new Map();
  entries.forEach((entry) => {
    const source = entry.sample.source;
    const prior = seen.get(source.sha256);
    if (prior && (prior.bytes !== source.bytes || prior.pageCount !== source.pageCount || prior.mediaType !== source.mediaType)) {
      fail("CANDIDATE_DUPLICATE", "Shared PDF hash has inconsistent source metadata");
    }
    seen.set(source.sha256, source);
  });
}
function corpusEntry(sample) {
  return { sample, capabilityIds: [...new Set(sample.expectedOutcomes.map((outcome) => outcome.capabilityId))] };
}
function checkSampleLinks(candidate, catalog, requireEvidence) {
  const capabilities = candidate.capabilityIds.map((id) => {
    const capability = catalog.capabilities.find((entry) => entry.id === id);
    if (!capability) fail("CANDIDATE_UNKNOWN_CAPABILITY", id);
    return capability;
  });
  const boundaries = new Set(capabilities.flatMap((entry) => entry.boundaries.map((boundary) => boundary.id)));
  if (candidate.sample.boundaryFeatureIds.some((id) => !boundaries.has(id))) fail("CANDIDATE_UNKNOWN_BOUNDARY", "Boundary must belong to a linked capability");
  candidate.sample.expectedOutcomes.forEach((outcome) => {
    const capability = capabilities.find((entry) => entry.id === outcome.capabilityId);
    if (!capability || !capability.expectedOutcomes.some((entry) => entry.id === outcome.assertionId)) fail("CANDIDATE_UNKNOWN_ASSERTION", "Oracle must reference a declared capability assertion");
  });
  unique(candidate.sample.expectedOutcomes, (outcome) => `${outcome.capabilityId}/${outcome.assertionId}`, "oracle assertion");
  if (requireEvidence) {
    const evidence = new Set([...candidate.sample.evidenceRefs, ...candidate.history.flatMap((event) => event.evidenceRefs)]);
    if (!evidence.size || capabilities.some((entry) => !candidate.sample.expectedOutcomes.some((outcome) => outcome.capabilityId === entry.id))) fail("CANDIDATE_INSUFFICIENT_EVIDENCE", "Acceptance requires evidence and an oracle for every linked capability");
    if (capabilities.some((entry) => !candidate.sample.authorityBoundary.finalDecisionsOwnedBy.includes(entry.architectureRecord))) fail("CANDIDATE_AUTHORITY_MISMATCH", "Regression owner must preserve existing Authority");
  }
}
function validateState(state) {
  assertNoRuntimeDecisionFields(state);
  if (!state || Object.keys(state).length !== 3 || Object.keys(state).some((key) => !["pool", "corpus", "capabilities"].includes(key))) fail("CANDIDATE_SCHEMA_INVALID", "State must contain only pool, corpus and capabilities");
  schemaCheck(state.capabilities, 0); schemaCheck(state.corpus, 1); schemaCheck(state.pool, 2);
  unique(state.capabilities.capabilities, (item) => item.id, "capability ID");
  state.capabilities.capabilities.forEach((capability) => {
    unique(capability.boundaries, (item) => item.id, "boundary ID");
    unique(capability.expectedOutcomes, (item) => item.id, "assertion ID");
  });
  unique(state.corpus.samples, (item) => item.id, "sample ID");
  unique(state.pool.candidates, (item) => item.id, "candidate ID"); unique(state.pool.candidates, (item) => item.sample.id, "candidate sample ID");
  const entries = [...state.corpus.samples.map(corpusEntry), ...state.pool.candidates];
  assertSharedSourceMetadata(entries);
  entries.forEach((entry, index) => {
    if (entries.slice(0, index).some((prior) => prior.sample.id !== entry.sample.id && sameSourceWithSharedCapability(prior, entry))) {
      fail("CANDIDATE_DUPLICATE", "Duplicate PDF hash for the same capability");
    }
  });
  state.pool.candidates.forEach((candidate) => {
    checkHistory(candidate);
    // Check every historical oracle, not only the latest, so invalid history cannot be hidden.
    candidate.history.forEach((event, index) => {
      const prefix = { ...candidate, history: candidate.history.slice(0, index + 1) };
      checkSampleLinks({ ...prefix, sample: promotedSample(prefix) }, state.capabilities, event.to === "accepted");
    });
    checkSampleLinks({ ...candidate, sample: promotedSample(candidate) }, state.capabilities, candidate.status === "accepted");
    const existing = state.corpus.samples.find((sample) => sample.id === candidate.sample.id);
    if (candidate.promotedSampleId) {
      const sample = promotedSample(candidate);
      if (!existing || hash(existing) !== hash(sample)) fail("CANDIDATE_PROMOTION_INVALID", "Promoted sample/provenance must match corpus");
    } else if (existing) fail("CANDIDATE_DUPLICATE", "Unpromoted candidate duplicates corpus");
  });
  state.corpus.samples.forEach((sample) => {
    validateCorpusSample(sample);
    const ids = [...new Set(sample.expectedOutcomes.map((entry) => entry.capabilityId))];
    checkSampleLinks({ sample, capabilityIds: ids, history: [] }, state.capabilities, false);
    ids.forEach((id) => { if (!state.capabilities.capabilities.find((entry) => entry.id === id).regressionSampleIds.includes(sample.id)) fail("CANDIDATE_REFERENCE_INVALID", "Corpus sample missing capability back-reference"); });
  });
  state.capabilities.capabilities.forEach((capability) => capability.regressionSampleIds.forEach((id) => {
    if (!state.corpus.samples.some((sample) => sample.id === id && sample.expectedOutcomes.some((entry) => entry.capabilityId === capability.id))) fail("CANDIDATE_REFERENCE_INVALID", "Dangling capability regression reference");
  }));
  return deepFreeze(state);
}
function precheck(state, submission) {
  assertNoRuntimeDecisionFields(submission);
  if (!submission || typeof submission !== "object" || Array.isArray(submission) || Object.keys(submission).some((key) => !["id", "capabilityIds", "sample"].includes(key))) fail("CANDIDATE_SCHEMA_INVALID", "Submission may contain only id, capabilityIds and sample; unknown fields are not discarded");
  validateState(clone(state));
  schemaCheck({ ...state.corpus, samples: [submission.sample] }, 1);
  if (!/^candidate\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(submission.id || "") || !Array.isArray(submission.capabilityIds) || !submission.capabilityIds.length || new Set(submission.capabilityIds).size !== submission.capabilityIds.length) fail("CANDIDATE_SCHEMA_INVALID", "Invalid candidate identity/capability links");
  checkSampleLinks({ ...submission, history: [] }, state.capabilities, false);
  assertSharedSourceMetadata([...state.corpus.samples.map(corpusEntry), ...state.pool.candidates, submission]);
  const duplicateCandidateIds = state.pool.candidates.filter((item) => item.id === submission.id || item.sample.id === submission.sample.id || sameSourceWithSharedCapability(item, submission)).map((item) => item.id);
  const duplicateCorpusIds = state.corpus.samples.filter((item) => item.id === submission.sample.id || sameSourceWithSharedCapability(corpusEntry(item), submission)).map((item) => item.id);
  return deepFreeze({ formatValid: true, duplicateCandidateIds, duplicateCorpusIds, rootCauseAssessment: "not_performed" });
}
function submitCandidate(state, submission, audit) {
  const report = precheck(state, submission);
  if (report.duplicateCandidateIds.length || report.duplicateCorpusIds.length) fail("CANDIDATE_DUPLICATE", "Duplicate identity or exact PDF hash; no automatic merge");
  const next = clone(state), candidate = { id: submission.id, capabilityIds: clone(submission.capabilityIds), sample: clone(submission.sample), status: "pending", promotedSampleId: null, history: [] };
  append(candidate, "submit", "pending", audit); next.pool.candidates.push(candidate);
  return validateState(next);
}
function getCandidate(state, id) { const candidate = state.pool.candidates.find((item) => item.id === id); if (!candidate) fail("CANDIDATE_NOT_FOUND", id); return candidate; }
function reviewCandidate(state, id, status, audit) {
  validateState(clone(state)); const next = clone(state), candidate = getCandidate(next, id);
  if (!(transitions[candidate.status] || []).includes(status)) fail("CANDIDATE_TRANSITION_INVALID", `${candidate.status} -> ${status} forbidden`);
  append(candidate, "review", status, audit);
  return validateState(next);
}
function reviseCandidate(state, id, audit) {
  validateState(clone(state)); const next = clone(state), candidate = getCandidate(next, id);
  if (candidate.status !== "accepted" || candidate.promotedSampleId) {
    fail("CANDIDATE_REVISION_INVALID", "Only an accepted unpromoted candidate may begin a truth revision");
  }
  append(candidate, "revise", "under_review", audit);
  return validateState(next);
}
function promotedSample(candidate) {
  const sample = clone(candidate.sample);
  sample.evidenceRefs = [...new Set([...sample.evidenceRefs, ...candidate.history.flatMap((event) => event.evidenceRefs)])];
  const outcomes = new Map(sample.expectedOutcomes.map((outcome) => [`${outcome.capabilityId}/${outcome.assertionId}`, outcome]));
  candidate.history.forEach((event) => event.expectedOutcomes.forEach((outcome) => outcomes.set(`${outcome.capabilityId}/${outcome.assertionId}`, clone(outcome))));
  sample.expectedOutcomes = [...outcomes.values()];
  return sample;
}
function promoteCandidate(state, id, audit) {
  validateState(clone(state)); const next = clone(state), candidate = getCandidate(next, id);
  if (candidate.status !== "accepted" || candidate.promotedSampleId) fail("CANDIDATE_PROMOTION_FORBIDDEN", "Candidate must be accepted and not yet promoted");
  // No production catalog writes: return an explicitly publishable three-file transaction snapshot.
  append(candidate, "promote", "accepted", audit); candidate.promotedSampleId = candidate.sample.id;
  next.corpus.samples.push(promotedSample(candidate));
  candidate.capabilityIds.forEach((capabilityId) => next.capabilities.capabilities.find((item) => item.id === capabilityId).regressionSampleIds.push(candidate.sample.id));
  return validateState(next);
}
function loadState(rootDir = __dirname) {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(rootDir, name), "utf8"));
  const catalogs = path.resolve(rootDir) === path.resolve(__dirname)
    ? loadCapabilityCatalogState({ rootDir })
    : { corpus: read("corpus.json"), capabilities: read("capabilities.json") };
  return validateState({ pool: read("candidates.json"), corpus: catalogs.corpus, capabilities: catalogs.capabilities });
}
function saveState(state, outputDir) {
  validateState(clone(state));
  // Exclusive directory creation prevents overwrite/lost updates. A COMMITTED marker is written last.
  fs.mkdirSync(outputDir);
  for (const [name, data] of [["candidates.json", state.pool], ["corpus.json", state.corpus], ["capabilities.json", state.capabilities]]) fs.writeFileSync(path.join(outputDir, name), JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
  fs.writeFileSync(path.join(outputDir, "COMMITTED"), hash(state) + "\n", { flag: "wx" });
}
function loadCommittedState(rootDir) {
  const state = loadState(rootDir);
  if (fs.readFileSync(path.join(rootDir, "COMMITTED"), "utf8").trim() !== hash(state)) fail("CANDIDATE_TRANSACTION_INVALID", "Incomplete or changed snapshot");
  return state;
}
module.exports = { precheck, submitCandidate, reviewCandidate, reviseCandidate, promoteCandidate, validateState, loadState, saveState, loadCommittedState };
