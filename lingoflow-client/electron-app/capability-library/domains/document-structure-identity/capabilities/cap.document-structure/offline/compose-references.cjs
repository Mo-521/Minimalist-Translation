#!/usr/bin/env node
"use strict";

// Offline-only composition. A cross-page reference remains one document-level
// semantic object; pages contain fragment references, never duplicate objects.

function build(inputs) {
  const stage37 = inputs?.stage37;
  const frozen = inputs?.frozen;
  const references = inputs?.references;
  const pages = structuredClone(stage37.pages);
  const documentReferenceObjects = [];
  const referenceOwner = new Map();
  const frozenLine = new Map();
  for (const page of Object.values(frozen.pages)) for (const line of page.sourceLines) {
    if (frozenLine.has(line.sourceLineId)) throw Error(`Duplicate frozen ID ${line.sourceLineId}`);
    frozenLine.set(line.sourceLineId, { ...line, paper: page.paper, pageNumber: page.pageNumber });
  }
  for (const [paper, set] of Object.entries(references.papers)) for (const entry of set.entries) {
    const objectId = entry.proposalId;
    const fragments = entry.spatialFragments.map(fragment => ({ ...fragment }));
    for (const id of entry.sourceLineIds) {
      const line = frozenLine.get(id);
      if (!line || String(line.paper) !== paper) throw Error(`Invalid reference member ${paper}:${id}`);
      if (referenceOwner.has(id)) throw Error(`Duplicate reference member ${id}`);
      referenceOwner.set(id, objectId);
    }
    documentReferenceObjects.push({ objectId, paper: Number(paper), type: "reference",
      sourceLineIds: entry.sourceLineIds, sourceText: entry.sourceText,
      spatialFragments: fragments, memberCount: entry.sourceLineIds.length,
      evidence: ["stage38_source_only_whole_entry_proposal", entry.startReason],
      riskFlags: entry.riskFlags, authority: "none", status: "offline_candidate_not_truth" });
    for (const fragment of fragments) {
      const key = `${paper}:${fragment.page}`;
      const page = pages[key];
      if (!page) throw Error(`Missing reference page ${key}`);
      page.referenceObjectRefs ||= [];
      page.referenceObjectRefs.push({ objectId, type: "reference", sourceLineIds: fragment.sourceLineIds,
        bbox: fragment.bbox, lane: fragment.lane,
        memberLineBoxes: fragment.sourceLineIds.map(sourceLineId => ({ sourceLineId,
          bbox: frozenLine.get(sourceLineId).bbox })) });
    }
  }
  const displaced = [];
  const summary = { pages: 0, sourceLines: 0, reviewable: 0, assigned: 0, pending: 0,
    excluded: 0, pageLocalObjects: 0, documentReferenceObjects: documentReferenceObjects.length,
    referenceMemberLines: referenceOwner.size, displacedOldObjects: 0, byType: {} };
  for (const [key, page] of Object.entries(pages)) {
    const refs = new Set((page.referenceObjectRefs || []).flatMap(item => item.sourceLineIds));
    const originalObjects = page.objects;
    page.objects = originalObjects.filter(object => {
      const intersection = object.sourceLineIds.filter(id => refs.has(id));
      if (!intersection.length) return true;
      if (intersection.length !== object.sourceLineIds.length)
        throw Error(`Partial existing object/reference overlap ${key}:${object.objectId}`);
      displaced.push({ paper: page.paper, page: page.pageNumber, oldObjectId: object.objectId,
        oldType: object.type, replacementReferenceObjectIds: [...new Set(intersection.map(id => referenceOwner.get(id)))] });
      return false;
    });
    page.pendingMembership = page.pendingMembership.filter(item => !refs.has(item.sourceLineId));
    for (const item of page.excludedSourceLines) if (refs.has(item.sourceLineId))
      throw Error(`Reference member excluded in Stage37 ${key}:${item.sourceLineId}`);
    const seen = new Set();
    for (const object of page.objects) for (const id of object.sourceLineIds) {
      if (seen.has(id)) throw Error(`Duplicate object ownership ${key}:${id}`);
      seen.add(id);
    }
    for (const id of refs) {
      if (seen.has(id)) throw Error(`Reference and object duplicate ownership ${key}:${id}`);
      seen.add(id);
    }
    for (const item of page.pendingMembership) if (seen.has(item.sourceLineId))
      throw Error(`Pending and assigned duplicate ${key}:${item.sourceLineId}`);
    const assigned = seen.size, pending = page.pendingMembership.length, excluded = page.excludedSourceLines.length;
    if (assigned + pending + excluded !== page.sourceLineCount) throw Error(`Lost source line ${key}`);
    const byType = {};
    for (const object of page.objects) byType[object.type] = (byType[object.type] || 0) + 1;
    byType.reference = (page.referenceObjectRefs || []).length;
    page.summary = { ...page.summary, objects: page.objects.length + byType.reference, byType,
      assigned, pending, excluded, duplicateOwnership: 0, lostSourceLines: 0,
      displacedOldObjects: originalObjects.length - page.objects.length };
    page.referenceMemberCount = refs.size;
    summary.pages++;
    summary.sourceLines += page.sourceLineCount;
    summary.reviewable += page.reviewableLineCount;
    summary.assigned += assigned;
    summary.pending += pending;
    summary.excluded += excluded;
    summary.pageLocalObjects += page.objects.length;
    summary.displacedOldObjects += page.summary.displacedOldObjects;
    for (const [type, count] of Object.entries(byType)) summary.byType[type] = (summary.byType[type] || 0) + count;
  }
  return { schemaVersion: "OfflineStructuralObjectCandidate/vNext-reference-integrated",
    authority: "none", status: "machine_composition_not_review_ready",
    caution: "Whole-entry reference proposals are not accepted truth; page fragments reference one document-level object",
    producerInputs: ["stage35_frozen_source_lines", "stage35_source_only_boundaries",
      "stage36_source_only_semantic_regions", "stage38_source_only_reference_proposals"],
    summary, displacedOldObjects: displaced, documentReferenceObjects, pages };
}
module.exports = { build };
