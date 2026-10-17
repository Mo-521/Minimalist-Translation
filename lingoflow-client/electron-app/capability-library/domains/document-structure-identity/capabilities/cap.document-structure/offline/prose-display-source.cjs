"use strict";

// Offline-only split of one extraction unit that fuses a prose bridge and
// a neighboring display. Source-span lineage conserves its complete text.
const crypto = require("node:crypto");
const { validatePage } = require("./region-completeness.cjs");
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
const union = boxes => { const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x,
    height: Math.max(...boxes.map(b => b.y + b.height)) - y }; };
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const bridge = /^(and|where|hence|then|therefore|moreover)\s+/iu;
function proposal(line, page, evidence) {
  if (line.sourceSpanKind) return null;
  const m = bridge.exec(line.text.trimStart());
  if (!m || !/[=≤≥⩽⩾∑∫√]/u.test(line.text.slice(m[0].length))) return null;
  const chars = evidence?.chars || [];
  const sorted = [...chars].sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y);
  const prefix = sorted.slice(0, m[1].length);
  if (prefix.map(c => c.text).join("").toLowerCase() !== m[1].toLowerCase() ||
      prefix.some(c => /CMMI|CMSY|CMEX/u.test(c.font))) return null;
  const proseBox = union(prefix.map(c => c.box));
  const math = chars.filter(c => c.box.x > proseBox.x + proseBox.width + 7);
  if (math.length < 5 || !math.some(c => /CMMI|CMSY|CMEX/u.test(c.font))) return null;
  const mathBox = union(math.map(c => c.box));
  const targets = page.objects.filter(o => o.type === "formula" && o.spatialFragments.some(f => {
    const b = f.bbox;
    return b.y >= proseBox.y - 5 && b.y <= proseBox.y + 35 &&
      Math.abs((b.x + b.width / 2) - (mathBox.x + mathBox.width / 2)) < mathBox.width * .65;
  }));
  if (targets.length !== 1) return null;
  const other = page.objects.filter(o => o.type === "formula" && o !== targets[0])
    .flatMap(o => o.spatialFragments.map(f => f.bbox))
    .filter(b => b.y < targets[0].spatialFragments[0].bbox.y && b.y + b.height > mathBox.y);
  const nextTop = other.length ? Math.max(...other.map(b => b.y + b.height)) + .5 : mathBox.y;
  const targetBox = targets[0].spatialFragments[0].bbox;
  const combined = union([mathBox, targetBox]);
  if (nextTop > combined.y) { combined.height -= nextTop - combined.y; combined.y = nextTop; }
  if (combined.height <= 0 || overlap(combined, proseBox) > 1 ||
      page.objects.some(o => o.type === "body" && o.spatialFragments.some(f => overlap(combined, f.bbox) > 1))) return null;
  const splitAt = line.text.indexOf(m[1]) + m[0].length;
  return { formula: targets[0], proseBox, mathBox, combined, splitAt, chars: { prose: prefix, math } };
}
function build(inputs = {}) {
  const prior = inputs.prior;
  const frozenSource = inputs.source;
  const native = inputs.native;
  const candidate = structuredClone(prior), source = structuredClone(frozenSource), operations = [], lineage = [];
  for (const [key, page] of Object.entries(candidate.pages)) {
    const inv = source.pages[key];
    for (const pending of [...page.pendingMembership]) {
      if (pending.reason !== "math_or_equation_label_pending") continue;
      const line = inv.sourceLines.find(l => l.sourceLineId === pending.sourceLineId);
      if (!line) continue;
      const found = proposal(line, page, native.pages[key].lines[line.sourceLineId]);
      if (!found) continue;
      const kinds = ["prose_bridge", "display_member"], boxes = [found.proseBox, found.mathBox];
      const cuts = [[0, found.splitAt], [found.splitAt, line.text.length]];
      const spans = kinds.map((kind, i) => ({ ...line,
        sourceLineId: `${line.sourceLineId}:stage78:${kind}`, text: line.text.slice(...cuts[i]),
        bbox: { ...boxes[i], y: boxes[i].y + boxes[i].height }, sourceSpanKind: kind,
        parentSourceLineId: line.sourceLineId, textSpan: { start: cuts[i][0], end: cuts[i][1] } }));
      inv.sourceLines.splice(inv.sourceLines.indexOf(line), 1, ...spans);
      page.pendingMembership = page.pendingMembership.filter(p => p !== pending);
      const prose = spans[0], display = spans[1], target = found.formula;
      const body = { objectId: `stage78:${hash([key, "prose_bridge", prose.sourceLineId])}`,
        type: "body", page: prose.page, sourceLineIds: [prose.sourceLineId], sourceText: prose.text.trim(),
        memberCount: 1, memberLineBoxes: [{ sourceLineId: prose.sourceLineId, bbox: prose.bbox }],
        spatialFragments: [{ bbox: found.proseBox, sourceLineIds: [prose.sourceLineId] }],
        evidence: ["native_font_prose_bridge", "separated_from_display_glyphs"],
        authority: "none", status: "offline_candidate_not_truth" };
      page.objects.push(body);
      target.sourceLineIds.push(display.sourceLineId);
      const byId = new Map(inv.sourceLines.map(l => [l.sourceLineId, l]));
      target.sourceLineIds.sort((a, b) => byId.get(a).bbox.y - byId.get(b).bbox.y);
      target.sourceText = target.sourceLineIds.map(id => byId.get(id).text.trim()).join("\n");
      target.memberCount = target.sourceLineIds.length;
      target.memberLineBoxes = target.sourceLineIds.map(id => ({ sourceLineId: id, bbox: byId.get(id).bbox }));
      target.spatialFragments = [{ bbox: found.combined, sourceLineIds: [...target.sourceLineIds] }];
      target.evidence = [...(target.evidence || []), "native_prose_display_span_partition"];
      const record = { key, parentSourceLineId: line.sourceLineId, parentText: line.text,
        spans: spans.map(s => ({ sourceLineId: s.sourceLineId, text: s.text, textSpan: s.textSpan, bbox: s.bbox })) };
      lineage.push(record);
      page.sourceSpanLineage = [...(page.sourceSpanLineage || []), record];
      page.sourceLineCount = inv.sourceLines.length;
      page.summary = { ...page.summary, objects: page.objects.length + (page.referenceObjectRefs || []).length,
        assigned: page.summary.assigned + 2, pending: page.pendingMembership.length,
        byType: { ...page.summary.byType, body: (page.summary.byType.body || 0) + 1 } };
      operations.push({ key, kind: "fused_prose_display_line_partitioned", parentSourceLineId: line.sourceLineId,
        bodyObjectId: body.objectId, formulaObjectId: target.objectId,
        sourceLineIds: spans.map(s => s.sourceLineId), formulaBox: found.combined });
    }
    validatePage(key, page, inv);
  }
  candidate.summary = { ...candidate.summary, sourceLines: candidate.summary.sourceLines + operations.length,
    reviewable: candidate.summary.reviewable + operations.length,
    assigned: candidate.summary.assigned + operations.length * 2,
    pending: Object.values(candidate.pages).reduce((n, p) => n + p.pendingMembership.length, 0),
    pageLocalObjects: Object.values(candidate.pages).reduce((n, p) => n + p.objects.length, 0),
    byType: { ...candidate.summary.byType, body: candidate.summary.byType.body + operations.length } };
  if (candidate.summary.assigned + candidate.summary.pending + candidate.summary.excluded !== candidate.summary.sourceLines)
    throw Error("Stage 78 source conservation failure");
  candidate.schemaVersion = "OfflineStructuralObjectCandidate/vNext-prose-display-source-spans";
  candidate.stage78 = { authority: "none", status: "offline_candidate_not_truth", operations, lineage };
  source.stage78 = { authority: "none", status: "derived_evidence_not_truth", lineage };
  return { candidate, source };
}
module.exports = { build, proposal };
