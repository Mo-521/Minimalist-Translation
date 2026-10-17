"use strict";

// Offline-only semantic-region completion. Stage 73 and its source inventory
// remain immutable. A pending line is not automatically a body/table member.
const crypto = require("node:crypto");
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
const top = box => box.y - box.height;
const union = boxes => {
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(top));
  return { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x,
    height: Math.max(...boxes.map(b => b.y)) - y };
};
const words = text => (text.match(/[A-Za-z]{2,}/g) || []).length;
const mathMarks = text => (text.match(/[=≈≤≥⩽⩾∑∫√^_{}⟨⟩⊙∈∉⊂⊆∞α-ωΑ-Ωλ−±]/gu) || []).length;
const digitRatio = text => (text.match(/\d/g) || []).length / Math.max(1, text.replace(/\s/g, "").length);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] || 0;

function makeObject(key, type, ids, lines, evidence) {
  const members = ids.map(id => lines.get(id));
  return { objectId: `stage75:${hash([key, type, ids])}`, type, page: members[0].page,
    sourceLineIds: ids, sourceText: members.map(l => l.text.trim()).join("\n"), memberCount: ids.length,
    memberLineBoxes: members.map(l => ({ sourceLineId: l.sourceLineId, bbox: l.bbox })),
    spatialFragments: [{ bbox: union(members.map(l => l.bbox)), sourceLineIds: ids }],
    evidence,
    authority: "none", status: "offline_candidate_not_truth" };
}
function makeBody(key, ids, lines) {
  return makeObject(key, "body", ids, lines,
    ["strong_boundary_cut_residual_prose_reconstructed", "multi_line_prose_continuity"]);
}
function proseRun(ids, lines, pending) {
  if (ids.length < 3 || ids.some(id => pending.get(id)?.reason !== "unresolved_membership")) return false;
  const members = ids.map(id => lines.get(id));
  if (members.some(l => !l) || new Set(members.map(l => l.column)).size !== 1) return false;
  if (members.slice(0, -1).some(l => words(l.text) < 5 || mathMarks(l.text) > 3)) return false;
  const steps = members.slice(1).map((l, i) => l.bbox.y - members[i].bbox.y);
  const pitch = median(steps);
  return pitch > 4 && steps.every(step => step > 0 && step <= Math.max(22, pitch * 1.35)) &&
    members.every(l => digitRatio(l.text) < .4);
}
function cutResidualRuns(block, pending) {
  const runs = [], current = [];
  const flush = () => { if (current.length) runs.push(current.splice(0)); };
  for (const id of block.originalSourceLineIds) {
    if (block.sourceLineIds.includes(id) && pending.has(id)) current.push(id);
    else flush();
  }
  flush();
  return runs;
}
function tableRows(table, page, lines, pending) {
  const members = table.sourceLineIds.map(id => lines.get(id)).filter(Boolean);
  if (!members.length) return [];
  const last = members.reduce((a, b) => a.bbox.y > b.bbox.y ? a : b);
  const header = union(members.map(l => l.bbox));
  const pool = page.pendingMembership.filter(p => p.reason === "table_region_pending")
    .map(p => lines.get(p.sourceLineId)).filter(Boolean).sort((a, b) => a.bbox.y - b.bbox.y);
  const rows = [];
  let previous = last;
  for (const line of pool) {
    if (line.bbox.y <= last.bbox.y) continue;
    const gap = top(line.bbox) - previous.bbox.y;
    const pitch = line.bbox.y - previous.bbox.y;
    // A unit/header row can be indented relative to the table's first column.
    const leftAnchor = Math.min(...members.map(member => member.bbox.x));
    const aligned = Math.abs(line.bbox.x - leftAnchor) <= Math.max(10, last.bbox.height * 1.25) &&
      line.bbox.width >= header.width * .72 && line.bbox.width <= header.width * 1.2;
    const numeric = (line.text.match(/\d/g) || []).length >= 8 && digitRatio(line.text) >= .4;
    if (gap > Math.max(11, last.bbox.height * 1.4) || pitch > Math.max(25, last.bbox.height * 2.8) ||
        !aligned || !numeric || line.column !== last.column) break;
    rows.push(line.sourceLineId);
    previous = line;
  }
  // A single nearby number is not evidence for expansion of a table region.
  return rows.length >= 2 && rows.every(id => pending.has(id)) ? rows : [];
}
function postReferenceSuffix(key, page, lines, pending, postReference, inventory) {
  const replay = postReference.pages[key];
  if (!replay || replay.boundaryReason !== "semantic_section_after_references") return [];
  const pageWidth = inventory.pages[key].pageSize.width;
  const bodyLines = page.objects.filter(o => o.type === "body")
    .flatMap(o => o.sourceLineIds.map(id => lines.get(id))).filter(Boolean);
  const candidates = page.pendingMembership.filter(p => p.reason === "reference_region_pending")
    .map(p => lines.get(p.sourceLineId)).filter(Boolean).sort((a, b) => a.bbox.y - b.bbox.y);
  const proposals = [];
  for (const line of candidates) {
    const prev = bodyLines.filter(b => b.bbox.y < line.bbox.y)
      .sort((a, b) => b.bbox.y - a.bbox.y)[0];
    if (!prev || line.bbox.y - prev.bbox.y > Math.max(34, prev.bbox.height * 2.7)) continue;
    const text = line.text.trim();
    const relationCount = (text.match(/[=≈≤≥⩽⩾⪯⪰<>]/gu) || []).length;
    const math = relationCount >= 2 && mathMarks(text) >= 3 && words(text) <= 6 &&
      line.bbox.x - prev.bbox.x > pageWidth * .12 &&
      line.bbox.width < pageWidth * .7;
    if (!math) continue;
    const replayBoundary = replay.objects.some(o => o.type === "body" &&
      o.evidence?.includes("math_pending_boundary") &&
      o.sourceLineIds.includes(line.sourceLineId));
    if (!replayBoundary) continue;
    proposals.push({ type: "formula", ids: [line.sourceLineId],
      evidence: ["post_reference_display_region_recovered", "indented_multi_relation_math", "replay_math_boundary"] });
    const next = candidates.find(l => l.bbox.y > line.bbox.y);
    if (!next || !pending.has(next.sourceLineId) ||
        next.bbox.y - line.bbox.y > Math.max(35, line.bbox.height * 2.6)) continue;
    const nextText = next.text.trim();
    const aligned = Math.abs(next.bbox.x - prev.bbox.x) < Math.max(12, prev.bbox.height);
    const proseGrammar = /^[A-Z][a-z]{2,}\s+\S+.*[.!?]$/u.test(nextText) &&
      (nextText.match(/[=≈≤≥⩽⩾⪯⪰<>]/gu) || []).length < 2;
    if (aligned && proseGrammar) proposals.push({ type: "body", ids: [next.sourceLineId],
      evidence: ["post_reference_prose_after_display", "body_margin_and_sentence_grammar"] });
  }
  return proposals;
}
function validatePage(key, page, source) {
  const ids = source.sourceLines.map(l => l.sourceLineId), count = new Map(ids.map(id => [id, 0]));
  for (const object of [...page.objects, ...(page.referenceObjectRefs || [])])
    for (const id of object.sourceLineIds) {
      if (!count.has(id)) throw Error(`${key}: unknown Object member ${id}`);
      count.set(id, count.get(id) + 1);
    }
  for (const entry of [...page.pendingMembership, ...page.excludedSourceLines]) {
    if (!count.has(entry.sourceLineId)) throw Error(`${key}: unknown residual ${entry.sourceLineId}`);
    count.set(entry.sourceLineId, count.get(entry.sourceLineId) + 1);
  }
  if ([...count.values()].some(n => n !== 1)) throw Error(`${key}: source ownership failure`);
}
function build(inputs) {
  const baseline = inputs?.baseline;
  const inventory = inputs?.inventory;
  const stage37 = inputs?.stage37;
  const postReference = inputs?.postReference;
  const output = structuredClone(baseline), operations = [], held = [];
  for (const [key, page] of Object.entries(output.pages)) {
    const operationStart = operations.length;
    const lines = new Map(inventory.pages[key].sourceLines.map(l => [l.sourceLineId, l]));
    const pending = new Map(page.pendingMembership.map(p => [p.sourceLineId, p]));
    const cuts = stage37.pages[key].heldOut.filter(h => h.reason === "semantic_region_cut_through_paragraph_block");
    for (const cut of cuts) for (const ids of cutResidualRuns(cut, pending)) {
      if (!proseRun(ids, lines, pending)) {
        held.push({ key, kind: "cut_body", sourceLineIds: ids, reason: "insufficient_prose_continuity" });
        continue;
      }
      const body = makeBody(key, ids, lines);
      page.objects.push(body);
      for (const id of ids) pending.delete(id);
      operations.push({ key, kind: "cut_body_run_recovered", objectId: body.objectId, sourceLineIds: ids });
    }
    for (const table of page.objects.filter(o => o.type === "table")) {
      const ids = tableRows(table, page, lines, pending);
      if (!ids.length) continue;
      for (const id of ids) pending.delete(id);
      table.sourceLineIds.push(...ids);
      table.memberCount = table.sourceLineIds.length;
      table.sourceText = table.sourceLineIds.map(id => lines.get(id).text.trim()).join("\n");
      table.memberLineBoxes = table.sourceLineIds.map(id => ({ sourceLineId: id, bbox: lines.get(id).bbox }));
      table.spatialFragments = [{ bbox: union(table.sourceLineIds.map(id => lines.get(id).bbox)),
        sourceLineIds: [...table.sourceLineIds] }];
      table.evidence = [...(table.evidence || []), "aligned_contiguous_numeric_table_rows_beyond_hint"];
      operations.push({ key, kind: "table_rows_extended_beyond_layout_hint", objectId: table.objectId,
        sourceLineIds: ids });
    }
    for (const proposal of postReferenceSuffix(key, page, lines, pending, postReference, inventory)) {
      if (!proposal.ids.every(id => pending.has(id))) continue;
      const object = makeObject(key, proposal.type, proposal.ids, lines, proposal.evidence);
      page.objects.push(object);
      for (const id of proposal.ids) pending.delete(id);
      operations.push({ key, kind: `post_reference_${proposal.type}_recovered`,
        objectId: object.objectId, sourceLineIds: proposal.ids });
    }
    if (operations.length === operationStart) {
      validatePage(key, page, inventory.pages[key]);
      continue;
    }
    page.pendingMembership = [...pending.values()];
    const byType = {};
    for (const object of [...page.objects, ...(page.referenceObjectRefs || [])])
      byType[object.type] = (byType[object.type] || 0) + 1;
    page.sourceLineCount = inventory.pages[key].sourceLines.length;
    page.summary = { ...page.summary, objects: page.objects.length + (page.referenceObjectRefs || []).length,
      assigned: page.objects.reduce((n, o) => n + o.sourceLineIds.length, 0) +
        (page.referenceObjectRefs || []).reduce((n, o) => n + o.sourceLineIds.length, 0),
      pending: page.pendingMembership.length, excluded: page.excludedSourceLines.length, byType };
    validatePage(key, page, inventory.pages[key]);
  }
  const summary = structuredClone(baseline.summary);
  summary.sourceLines = Object.values(inventory.pages).reduce((n, p) => n + p.sourceLines.length, 0);
  summary.excluded = Object.values(output.pages).reduce((n, p) => n + p.excludedSourceLines.length, 0);
  summary.reviewable = summary.sourceLines - summary.excluded;
  summary.assigned = Object.values(output.pages).reduce((n, p) => n +
    [...p.objects, ...(p.referenceObjectRefs || [])].reduce((m, o) => m + o.sourceLineIds.length, 0), 0);
  summary.pending = Object.values(output.pages).reduce((n, p) => n + p.pendingMembership.length, 0);
  summary.pageLocalObjects = Object.values(output.pages).reduce((n, p) => n + p.objects.length, 0);
  summary.byType = {};
  for (const page of Object.values(output.pages)) for (const object of [...page.objects, ...(page.referenceObjectRefs || [])])
    summary.byType[object.type] = (summary.byType[object.type] || 0) + 1;
  if (summary.assigned + summary.pending + summary.excluded !== summary.sourceLines)
    throw Error("Global source conservation failure");
  output.schemaVersion = "OfflineStructuralObjectCandidate/vNext-region-completeness";
  output.summary = summary;
  output.stage75 = { authority: "none", status: "offline_candidate_not_truth", operations, held };
  return output;
}
module.exports = { build, proseRun, tableRows, validatePage };
