#!/usr/bin/env node
"use strict";

const { build: recover } = require("./post-reference-recovery.cjs");

function build(inputs) {
  const baseline = inputs?.composed;
  const replay = recover({ formulaBarrier: true }, inputs);
  const pages = structuredClone(baseline.pages);
  let addedObjects = 0, addedLines = 0;
  for (const [key, proposal] of Object.entries(replay.pages)) {
    const page = pages[key], pending = new Map(page.pendingMembership.map(item => [item.sourceLineId, item]));
    const eligible = proposal.objects.filter(object => !object.riskFlags.length &&
      ["heading", "body"].includes(object.type));
    for (const object of eligible) {
      if (!object.sourceLineIds.every(id => pending.has(id)))
        throw Error(`Recovery overlaps existing ownership ${key}:${object.objectId}`);
      for (const id of object.sourceLineIds) pending.delete(id);
      page.objects.push({ ...object, evidence: [...object.evidence, "conflict_safe_post_reference_resumption"],
        authority: "none", status: "offline_candidate_not_truth" });
      addedObjects++;
      addedLines += object.sourceLineIds.length;
    }
    page.pendingMembership = [...pending.values()];
    page.summary.objects = page.objects.length + (page.referenceObjectRefs || []).length;
    page.summary.assigned += eligible.reduce((n, object) =>
      n + object.sourceLineIds.length, 0);
    page.summary.pending = page.pendingMembership.length;
    page.summary.byType = { ...page.summary.byType };
    for (const object of eligible) {
      page.summary.byType[object.type] = (page.summary.byType[object.type] || 0) + 1;
    }
  }
  const summary = { ...baseline.summary, assigned: baseline.summary.assigned + addedLines,
    pending: baseline.summary.pending - addedLines,
    pageLocalObjects: baseline.summary.pageLocalObjects + addedObjects,
    postReferenceAddedObjects: addedObjects, postReferenceAddedLines: addedLines,
    byType: { ...baseline.summary.byType } };
  for (const page of Object.values(replay.pages)) for (const object of page.objects) {
    if (object.riskFlags.length || !["heading", "body"].includes(object.type)) continue;
    summary.byType[object.type] = (summary.byType[object.type] || 0) + 1;
  }
  for (const [key, page] of Object.entries(pages)) {
    const ids = new Set();
    for (const object of page.objects) for (const id of object.sourceLineIds) {
      if (ids.has(id)) throw Error(`Duplicate local owner ${key}:${id}`);
      ids.add(id);
    }
    for (const ref of page.referenceObjectRefs || []) for (const id of ref.sourceLineIds) {
      if (ids.has(id)) throw Error(`Duplicate reference owner ${key}:${id}`);
      ids.add(id);
    }
    for (const item of page.pendingMembership) if (ids.has(item.sourceLineId))
      throw Error(`Pending line already owned ${key}:${item.sourceLineId}`);
    if (ids.size + page.pendingMembership.length + page.excludedSourceLines.length !== page.sourceLineCount)
      throw Error(`Source conservation failure ${key}`);
    if (ids.size !== page.summary.assigned) throw Error(`Incorrect assigned count ${key}`);
  }
  if (summary.assigned + summary.pending + summary.excluded !== summary.sourceLines)
    throw Error("Global source conservation failure");
  return { ...baseline, schemaVersion: "OfflineStructuralObjectCandidate/vNext-post-reference-safe",
    status: "machine_composition_not_review_ready", summary, pages,
    postReferenceReplay: { schemaVersion: replay.schemaVersion,
      formulaBoundaryDisposition: "held_pending_not_forced_body_or_formula",
      overlapDisposition: "held_out", authority: "none" } };
}
module.exports = { build };
