"use strict";

// A versioned, non-authoritative boundary for Object-first candidates. This
// deliberately does not masquerade as the segment-based SemanticStructureArtifact.
const crypto = require("node:crypto");

const SCHEMA_VERSION = "object-first-structure-candidate/v1";
const OBJECT_TYPES = new Set([
  "title", "author", "front_matter_affiliation_or_contact", "abstract",
  "heading", "body", "caption", "figure", "table", "formula",
  "equation_number", "reference", "page_number", "running_header",
  "unsupported_structured_block",
]);
const hash = value => crypto.createHash("sha256")
  .update(JSON.stringify(value)).digest("hex");
const fail = message => { throw Error(`Object-first contract: ${message}`); };
const sorted = object => Object.keys(object || {}).sort();
const validBox = b => Boolean(b && [b.x, b.y, b.width, b.height].every(Number.isFinite) &&
  b.width > 0 && b.height > 0);
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function projectObject(object, scope, pageContext) {
  return {
    objectId: object.objectId,
    type: object.type,
    scope,
    paper: object.paper ?? pageContext?.paper ?? null,
    page: scope === "page" ? pageContext.pageNumber : null,
    sourceLineIds: [...object.sourceLineIds],
    sourceText: String(object.sourceText || ""),
    spatialFragments: structuredClone(object.spatialFragments),
    // Figures/tables are atomic D1 consumption units. Older producers may
    // omit this redundant flag; omission must not expose their member text.
    // This policy does not certify the region or repair foreign ownership.
    internalTextOpaque: object.type === "figure" || object.type === "table" ||
      Boolean(object.internalTextOpaque),
    unsupportedKind: object.unsupportedKind || null,
  };
}

function buildObjectFirstContract(candidate, source) {
  if (!String(candidate?.schemaVersion || "").startsWith("OfflineStructuralObjectCandidate/") ||
      candidate.authority !== "none" ||
      candidate.status !== "machine_candidate_pending_human_review")
    fail("requires a non-authoritative offline candidate");
  if (!String(source?.schemaVersion || "").startsWith("DerivedSourceSpanInventory/") ||
      source.authority !== "none") fail("requires a derived source inventory");
  const keys = sorted(source.pages);
  if (keys.length !== sorted(candidate.pages).length ||
      keys.some((key, index) => key !== sorted(candidate.pages)[index]))
    fail("candidate and source pages differ");

  const documentObjects = candidate.documentReferenceObjects || [];
  const documentById = new Map();
  const objectIds = new Set();
  const objects = [];
  const byType = {};
  const addObject = (object, scope, pageContext = null) => {
    if (!object || typeof object.objectId !== "string" || !object.objectId ||
        objectIds.has(object.objectId)) fail("missing or duplicated Object identity");
    if (!OBJECT_TYPES.has(object.type)) fail(`unsupported Object type ${object.type}`);
    if (!Array.isArray(object.sourceLineIds) ||
        !Array.isArray(object.spatialFragments) || !object.spatialFragments.length)
      fail(`invalid Object members or geometry ${object.objectId}`);
    if (new Set(object.sourceLineIds).size !== object.sourceLineIds.length)
      fail(`duplicated Object member ${object.objectId}`);
    for (const fragment of object.spatialFragments) {
      const b = fragment?.bbox;
      if (!validBox(b))
        fail(`invalid Object geometry ${object.objectId}`);
    }
    objectIds.add(object.objectId);
    byType[object.type] = (byType[object.type] || 0) + 1;
    objects.push(projectObject(object, scope, pageContext));
  };
  for (const object of documentObjects) {
    if (object.type !== "reference") fail("document-scoped Object must be a reference");
    addObject(object, "document");
    documentById.set(object.objectId, object);
  }

  let sourceLines = 0, assigned = 0, pending = 0, excluded = 0;
  let pageLocalObjects = 0, referencePlacements = 0;
  const referenceFragments = [], residuals = [];
  const documentMembers = new Map(documentObjects.map(object =>
    [object.objectId, new Set(object.sourceLineIds)]));
  const documentSeen = new Map(documentObjects.map(object => [object.objectId, new Set()]));
  for (const key of keys) {
    const page = candidate.pages[key], inventory = source.pages[key];
    if (page.pageNumber !== inventory.pageNumber || page.paper !== inventory.paper ||
        page.sourcePdfSha256 !== inventory.sourcePdfSha256)
      fail(`${key}: page identity differs`);
    if (!Array.isArray(inventory.sourceLines) || !Array.isArray(page.objects) ||
        !Array.isArray(page.pendingMembership) || !Array.isArray(page.excludedSourceLines))
      fail(`${key}: missing page collections`);
    const counts = new Map();
    for (const line of inventory.sourceLines) {
      if (!line.sourceLineId || counts.has(line.sourceLineId))
        fail(`${key}: missing or duplicated source identity`);
      counts.set(line.sourceLineId, 0);
    }
    const claim = id => {
      if (!counts.has(id)) fail(`${key}: unknown source member ${id}`);
      counts.set(id, counts.get(id) + 1);
    };
    for (const object of page.objects) {
      if (object.page != null && object.page !== page.pageNumber)
        fail(`${key}: Object page differs`);
      addObject(object, "page", page);
      pageLocalObjects += 1;
      object.sourceLineIds.forEach(claim);
    }
    for (const ref of page.referenceObjectRefs || []) {
      referencePlacements += 1;
      const document = documentById.get(ref.objectId);
      if (!document || ref.type !== "reference" || !Array.isArray(ref.sourceLineIds))
        fail(`${key}: unknown document reference fragment`);
      if (!validBox(ref.bbox)) fail(`${key}: invalid document reference geometry`);
      referenceFragments.push({ objectId: ref.objectId, pageKey: key,
        sourceLineIds: [...ref.sourceLineIds], bbox: { ...ref.bbox } });
      for (const id of ref.sourceLineIds) {
        if (!documentMembers.get(ref.objectId).has(id) ||
            documentSeen.get(ref.objectId).has(id))
          fail(`${key}: invalid document reference membership`);
        documentSeen.get(ref.objectId).add(id);
        claim(id);
      }
    }
    for (const item of page.pendingMembership) {
      claim(item.sourceLineId);
      residuals.push({ pageKey: key, sourceLineId: item.sourceLineId,
        disposition: "pending" });
    }
    for (const item of page.excludedSourceLines) {
      claim(item.sourceLineId);
      residuals.push({ pageKey: key, sourceLineId: item.sourceLineId,
        disposition: "excluded" });
    }
    if ([...counts.values()].some(count => count !== 1))
      fail(`${key}: source ownership is not exactly once`);
    sourceLines += counts.size;
    assigned += page.objects.reduce((n, object) => n + object.sourceLineIds.length, 0) +
      (page.referenceObjectRefs || []).reduce((n, ref) => n + ref.sourceLineIds.length, 0);
    pending += page.pendingMembership.length;
    excluded += page.excludedSourceLines.length;
  }
  for (const [id, members] of documentMembers)
    if (documentSeen.get(id).size !== members.size)
      fail(`document reference ${id} has unplaced members`);
  const summary = candidate.summary || {};
  if (sourceLines !== summary.sourceLines || assigned !== summary.assigned ||
      pending !== summary.pending || excluded !== summary.excluded ||
      pageLocalObjects !== summary.pageLocalObjects ||
      documentObjects.length !== summary.documentReferenceObjects ||
      keys.length !== summary.pages)
    fail("global source or Object accounting differs");
  for (const type of new Set([...Object.keys(summary.byType || {}), ...Object.keys(byType)]))
    if ((summary.byType?.[type] || 0) !==
        (type === "reference" ? referencePlacements : (byType[type] || 0)))
      fail(`Object type count differs: ${type}`);

  const body = {
    schemaVersion: SCHEMA_VERSION,
    authority: "none",
    status: "candidate_pending_runtime_gate",
    legacySegmentCompatibility: "not_wire_compatible",
    sourceInventorySchemaVersion: source.schemaVersion,
    sourcePdfSha256ByPage: Object.fromEntries(keys.map(key =>
      [key, source.pages[key].sourcePdfSha256])),
    summary: { pages: keys.length, sourceLines, assigned, pending, excluded,
      pageLocalObjects, documentReferenceObjects: documentObjects.length,
      referencePlacements,
      byType },
    objects,
    referenceFragments,
    residuals,
  };
  const contentHash = hash(body);
  return deepFreeze({ ...body, contentHash,
    artifactId: `object-first-structure-candidate-sha256:${contentHash}` });
}

// Recheck a serialized contract at the consumer boundary. The producer's
// source inventory is not available there, so this checks the content-addressed payload
// and its internal accounting without claiming a new semantic judgement.
function validateObjectFirstContract(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("requires a contract object");
  const { contentHash, artifactId, ...body } = input;
  if (body.schemaVersion !== SCHEMA_VERSION || body.authority !== "none" ||
      body.status !== "candidate_pending_runtime_gate" ||
      body.legacySegmentCompatibility !== "not_wire_compatible")
    fail("unsupported contract schema or authority");
  const expectedHash = hash(body);
  if (contentHash !== expectedHash || artifactId !==
      `object-first-structure-candidate-sha256:${expectedHash}`)
    fail("content hash differs");
  if (!Array.isArray(body.objects) || !Array.isArray(body.referenceFragments) ||
      !Array.isArray(body.residuals) || !body.summary ||
      !body.sourcePdfSha256ByPage ||
      typeof body.sourcePdfSha256ByPage !== "object")
    fail("missing contract collections");
  const pageKeys = new Set(Object.keys(body.sourcePdfSha256ByPage));
  const ids = new Set(), documentMembers = new Map(), seenMembers = new Map();
  const counts = {};
  let pageLocalObjects = 0, assigned = 0;
  for (const object of body.objects) {
    if (!object || !object.objectId || ids.has(object.objectId) ||
        !OBJECT_TYPES.has(object.type) || !Array.isArray(object.sourceLineIds) ||
        new Set(object.sourceLineIds).size !== object.sourceLineIds.length ||
        !Array.isArray(object.spatialFragments) || !object.spatialFragments.length ||
        object.spatialFragments.some(fragment => !validBox(fragment?.bbox)))
      fail("invalid Object identity, members or geometry");
    ids.add(object.objectId);
    counts[object.type] = (counts[object.type] || 0) + 1;
    if (object.scope === "document") {
      if (object.type !== "reference" || object.page !== null)
        fail("invalid document Object scope");
      documentMembers.set(object.objectId, new Set(object.sourceLineIds));
      seenMembers.set(object.objectId, new Set());
    } else if (object.scope === "page") {
      if (!Number.isInteger(object.page) || object.page < 1)
        fail("invalid page Object scope");
      pageLocalObjects += 1;
      assigned += object.sourceLineIds.length;
    } else fail("unknown Object scope");
  }
  for (const fragment of body.referenceFragments) {
    if (!fragment || !pageKeys.has(fragment.pageKey) ||
        !documentMembers.has(fragment.objectId) || !validBox(fragment.bbox) ||
        !Array.isArray(fragment.sourceLineIds))
      fail("invalid reference placement");
    const members = documentMembers.get(fragment.objectId);
    const seen = seenMembers.get(fragment.objectId);
    for (const id of fragment.sourceLineIds) {
      if (!members.has(id) || seen.has(id)) fail("invalid reference member placement");
      seen.add(id);
      assigned += 1;
    }
  }
  for (const [id, members] of documentMembers)
    if (seenMembers.get(id).size !== members.size)
      fail("unplaced document reference members");
  let pending = 0, excluded = 0;
  const residualIds = new Set();
  for (const residual of body.residuals) {
    if (!residual || !pageKeys.has(residual.pageKey) ||
        !residual.sourceLineId ||
        !["pending", "excluded"].includes(residual.disposition))
      fail("invalid source residual");
    const key = `${residual.pageKey}\0${residual.sourceLineId}`;
    if (residualIds.has(key)) fail("duplicate source residual");
    residualIds.add(key);
    if (residual.disposition === "pending") pending += 1;
    else excluded += 1;
  }
  const summary = body.summary;
  if (summary.pages !== pageKeys.size || summary.sourceLines !== assigned + pending + excluded ||
      summary.assigned !== assigned || summary.pending !== pending ||
      summary.excluded !== excluded || summary.pageLocalObjects !== pageLocalObjects ||
      summary.documentReferenceObjects !== documentMembers.size ||
      summary.referencePlacements !== body.referenceFragments.length ||
      !summary.byType ||
      Object.keys({ ...counts, ...summary.byType }).some(type =>
        (counts[type] || 0) !== (summary.byType[type] || 0)))
    fail("internal Object or source accounting differs");
  return deepFreeze(input);
}

module.exports = { SCHEMA_VERSION, OBJECT_TYPES, buildObjectFirstContract,
  validateObjectFirstContract };
