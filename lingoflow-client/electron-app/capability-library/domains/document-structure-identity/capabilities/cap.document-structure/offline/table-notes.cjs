"use strict";

// Offline-only continuation of Stage 75. Table rows stay table members;
// a prose note below the table may become a separate body Object.
const crypto = require("node:crypto");
const { validatePage } = require("./region-completeness.cjs");
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
const top = b => b.y - b.height;
const box = lines => ({ x: Math.min(...lines.map(l => l.bbox.x)),
  y: Math.min(...lines.map(l => top(l.bbox))),
  width: Math.max(...lines.map(l => l.bbox.x + l.bbox.width)) - Math.min(...lines.map(l => l.bbox.x)),
  height: Math.max(...lines.map(l => l.bbox.y)) - Math.min(...lines.map(l => top(l.bbox))) });
const wordCount = text => (text.match(/[A-Za-z]{2,}/g) || []).length;
const digitRatio = text => (text.match(/\d/g) || []).length / Math.max(1, text.replace(/\s/g, "").length);

function noteRun(table, page, byId) {
  const memberLines = table.sourceLineIds.map(id => byId.get(id));
  if (!memberLines.length || memberLines.some(l => !l)) return [];
  const last = memberLines.reduce((a, b) => a.bbox.y > b.bbox.y ? a : b);
  const pending = page.pendingMembership.filter(p => p.reason === "table_region_pending")
    .map(p => byId.get(p.sourceLineId)).filter(Boolean).sort((a, b) => a.bbox.y - b.bbox.y);
  const first = pending.find(l => l.bbox.y > last.bbox.y);
  if (!first) return [];
  const near = top(first.bbox) - last.bbox.y >= 0 &&
    top(first.bbox) - last.bbox.y <= Math.max(18, last.bbox.height * 2);
  const proseShape = /^(?:Note|Notes|Remark|Remarks)\s*[:.\u2014\u2013-]/iu.test(first.text.trim()) &&
    wordCount(first.text) >= 7 && digitRatio(first.text) < .4;
  const aligned = Math.abs(first.bbox.x - Math.min(...memberLines.map(l => l.bbox.x))) <=
    Math.max(45, last.bbox.height * 5) && first.bbox.width >= last.bbox.width * .7;
  if (!near || !proseShape || !aligned || first.column !== last.column) return [];
  const run = [first];
  for (const line of pending.filter(l => l.bbox.y > first.bbox.y)) {
    const previous = run.at(-1), pitch = line.bbox.y - previous.bbox.y;
    if (pitch > Math.max(17, first.bbox.height * 1.7) ||
        Math.abs(line.bbox.x - first.bbox.x) > Math.max(12, first.bbox.height * 1.5) ||
        line.column !== first.column || digitRatio(line.text) >= .4 || run.length >= 5) break;
    run.push(line);
  }
  if (run.length < 2 || wordCount(run.map(l => l.text).join(" ")) < 12 ||
      !/[.!?]\s*$/u.test(run.at(-1).text)) return [];
  return run.map(l => l.sourceLineId);
}
function build(inputs) {
  const prior = inputs?.prior;
  const inventory = inputs?.inventory;
  const out = structuredClone(prior), operations = [];
  for (const [key, page] of Object.entries(out.pages)) {
    const byId = new Map(inventory.pages[key].sourceLines.map(l => [l.sourceLineId, l]));
    for (const table of page.objects.filter(o => o.type === "table")) {
      const ids = noteRun(table, page, byId);
      if (!ids.length) continue;
      const members = ids.map(id => byId.get(id));
      const body = { objectId: `stage76:${hash([key, "table_adjacent_body_note", ids])}`,
        type: "body", page: members[0].page, sourceLineIds: ids,
        sourceText: members.map(l => l.text.trim()).join("\n"), memberCount: ids.length,
        memberLineBoxes: members.map(l => ({ sourceLineId: l.sourceLineId, bbox: l.bbox })),
        spatialFragments: [{ bbox: box(members), sourceLineIds: ids }],
        evidence: ["table_adjacent_explanatory_prose", "separate_from_numeric_table_rows",
          "aligned_multiline_sentence_continuation"], authority: "none", status: "offline_candidate_not_truth" };
      page.objects.push(body);
      const owned = new Set(ids);
      page.pendingMembership = page.pendingMembership.filter(p => !owned.has(p.sourceLineId));
      page.summary = { ...page.summary, objects: page.objects.length + (page.referenceObjectRefs || []).length,
        assigned: page.summary.assigned + ids.length, pending: page.pendingMembership.length,
        byType: { ...page.summary.byType, body: (page.summary.byType.body || 0) + 1 } };
      operations.push({ key, kind: "table_explanatory_note_as_body", objectId: body.objectId,
        tableObjectId: table.objectId, sourceLineIds: ids });
    }
    validatePage(key, page, inventory.pages[key]);
  }
  out.summary = { ...out.summary, assigned: out.summary.assigned + operations.reduce((n, o) => n + o.sourceLineIds.length, 0),
    pending: Object.values(out.pages).reduce((n, p) => n + p.pendingMembership.length, 0),
    pageLocalObjects: Object.values(out.pages).reduce((n, p) => n + p.objects.length, 0),
    byType: { ...out.summary.byType, body: out.summary.byType.body + operations.length } };
  if (out.summary.assigned + out.summary.pending + out.summary.excluded !== out.summary.sourceLines)
    throw Error("Stage 76 source conservation failed");
  out.schemaVersion = "OfflineStructuralObjectCandidate/vNext-table-note-boundary";
  out.stage76 = { authority: "none", status: "offline_candidate_not_truth", operations };
  return out;
}
module.exports = { build, noteRun };
