"use strict";

// Offline-only reconstruction. Visual frames never determine source ownership:
// paragraph grammar, typography, source order and native ink are separate gates.
const { validatePage } = require("./region-completeness.cjs");

const union = boxes => { const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x,
    height: Math.max(...boxes.map(b => b.y + b.height)) - y }; };
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const box = o => o.spatialFragments[0].bbox;
const nonterminal = text => /\b(?:as|and|or|of|the|that|because|where|then|hence|for|to)\s*$/iu.test(text.trim());
const dominantProseFont = (evidence, line) => {
  const count = new Map();
  for (const c of evidence?.lines?.[line.sourceLineId]?.chars || []) {
    if (!/^[A-Za-z]$/u.test(c.text) || !/SFRM|CMR10|CMTI10|CMBX|CMSS/u.test(c.font)) continue;
    if (Math.abs(c.box.y + c.box.height - line.bbox.y) > Math.max(5, line.bbox.height * .65)) continue;
    count.set(c.font, (count.get(c.font) || 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1])[0] || [null, 0];
};
const proseInk = (evidence, line) => (evidence?.lines?.[line.sourceLineId]?.chars || [])
  .filter(c => c.box.y >= line.bbox.y - line.bbox.height - 2 && c.box.y <= line.bbox.y + 2);
const formulaInkTop = (formula, lines, evidence) => {
  const rows = formula.sourceLineIds.flatMap(id => {
    const line = lines.get(id);
    if (!line) return [];
    return (evidence?.lines?.[id]?.chars || []).filter(c =>
      c.box.y >= line.bbox.y - Math.min(5, line.bbox.height * .25) && c.box.y <= line.bbox.y + 2);
  });
  return rows.length ? Math.min(...rows.map(c => c.box.y)) : null;
};
const refresh = (o, lines) => {
  o.sourceLineIds.sort((a, b) => lines.get(a).bbox.y - lines.get(b).bbox.y ||
    lines.get(a).bbox.x - lines.get(b).bbox.x);
  o.sourceText = o.sourceLineIds.map(id => lines.get(id).text.trim()).join("\n");
  o.memberCount = o.sourceLineIds.length;
  o.memberLineBoxes = o.sourceLineIds.map(id => ({ sourceLineId: id, bbox: lines.get(id).bbox }));
  o.spatialFragments = [{ bbox: box(o), sourceLineIds: [...o.sourceLineIds] }];
};
function mergeProseTail(page, lines, evidence) {
  const bodies = page.objects.filter(o => o.type === "body" && o.spatialFragments?.length === 1)
    .sort((a, b) => box(a).y - box(b).y);
  const matches = [];
  for (let i = 0; i + 1 < bodies.length; i++) {
    const a = bodies[i], b = bodies[i + 1], A = box(a), B = box(b), gap = B.y - A.y - A.height;
    if (!nonterminal(a.sourceText) || Math.abs(A.x - B.x) > 3 || gap < -1 || gap > 6 ||
      a.sourceLineIds.length + b.sourceLineIds.length > 18) continue;
    const last = lines.get(a.sourceLineIds.at(-1)), first = lines.get(b.sourceLineIds[0]);
    if (!last || !first || last.column !== first.column || first.bbox.y <= last.bbox.y) continue;
    const [af, ac] = dominantProseFont(evidence, last), [bf, bc] = dominantProseFont(evidence, first);
    if (!af || af !== bf || ac < 6 || bc < 6) continue;
    const combined = union([A, B]);
    if (page.objects.some(o => o !== a && o !== b &&
      ["heading", "caption", "table", "figure", "reference", "unsupported_structured_block",
        "page_number", "running_header", "running_footer"].includes(o.type) &&
      o.spatialFragments?.some(f => overlap(f.bbox, combined) > 1))) continue;
    // The input candidate may already have a few points of visual overlap.
    // Joining the prose tail must not increase that overlap, but need not be
    // blocked by an unchanged pre-existing display-frame excess.
    if (page.objects.some(o => o !== a && o !== b && o.spatialFragments?.some(f =>
      overlap(f.bbox, combined) > Math.max(overlap(f.bbox, A), overlap(f.bbox, B)) + 1))) continue;
    matches.push({ a, b, combined, gap, font: af });
  }
  if (matches.length !== 1) return [];
  const { a, b, combined, gap, font } = matches[0];
  a.sourceLineIds.push(...b.sourceLineIds);
  a.spatialFragments[0].bbox = combined;
  refresh(a, lines);
  a.evidence = [...(a.evidence || []), "nonterminal_prose_tail_same_font_and_flow"];
  page.objects.splice(page.objects.indexOf(b), 1);
  page.summary.objects--;
  page.summary.byType.body--;
  return [{ kind: "semantic_prose_tail_join", objectId: a.objectId, removedObjectId: b.objectId,
    sourceLineIds: [...b.sourceLineIds], signals: { gap, font, nonterminal: true } }];
}
function attachPendingProse(page, lines, evidence) {
  const proposals = [];
  for (const pending of page.pendingMembership.filter(p => p.reason === "math_or_equation_label_pending")) {
    const line = lines.get(pending.sourceLineId);
    if (!line || /^\s*\(?\d+(?:\.\d+)*\)?\s*$/u.test(line.text)) continue;
    const [font, letters] = dominantProseFont(evidence, line);
    if (!font || letters < 8 || !/\b[A-Za-z]{3,}\b/u.test(line.text)) continue;
    const targets = page.objects.filter(o => o.type === "body" && o.spatialFragments?.length === 1)
      .filter(o => { const last = lines.get(o.sourceLineIds.at(-1));
        return last && last.column === line.column && Math.abs(last.bbox.x - line.bbox.x) < 3 &&
          line.bbox.y - last.bbox.y > 4 && line.bbox.y - last.bbox.y < 18 &&
          !/[.!?:]\s*$/u.test(last.text) && dominantProseFont(evidence, last)[0] === font; });
    if (targets.length !== 1) continue;
    const body = targets[0], chars = proseInk(evidence, line);
    if (!chars.length) continue;
    const ink = union(chars.map(c => c.box)), blockers = page.objects.filter(o => o !== body &&
      o.type !== "formula" && o.spatialFragments?.some(f => overlap(f.bbox, ink) > 1));
    if (blockers.length) continue;
    const nearbyFormulas = page.objects.filter(o => o.type === "formula" &&
      o.spatialFragments?.some(f => overlap(f.bbox, ink) > 1));
    const inkTops = nearbyFormulas.map(o => formulaInkTop(o, lines, evidence));
    if (inkTops.some(top => top === null || top < ink.y + ink.height + 4)) continue;
    proposals.push({ pending, line, body, ink, nearbyFormulas, inkTops, font });
  }
  if (proposals.length !== 1) return [];
  const { pending, line, body, ink, nearbyFormulas, inkTops, font } = proposals[0];
  const oldBody = box(body);
  const newBody = union([oldBody, ink]);
  const trimmedBoxes = nearbyFormulas.map((formula, i) => {
    const old = box(formula), top = inkTops[i];
    return top > old.y && top - old.y < 25
      ? { ...old, y: top, height: old.y + old.height - top } : old;
  });
  if (trimmedBoxes.some(b => overlap(newBody, b) > 1)) return [];
  for (let i = 0; i < nearbyFormulas.length; i++) {
    if (trimmedBoxes[i].y === box(nearbyFormulas[i]).y) continue;
    nearbyFormulas[i].spatialFragments[0].bbox = trimmedBoxes[i];
    nearbyFormulas[i].evidence = [...(nearbyFormulas[i].evidence || []),
      "native_math_ink_excludes_neighboring_prose_row"];
  }
  body.sourceLineIds.push(line.sourceLineId);
  body.spatialFragments[0].bbox = newBody;
  refresh(body, lines);
  body.evidence = [...(body.evidence || []), "pending_prose_continuation_native_font_and_flow"];
  page.pendingMembership.splice(page.pendingMembership.indexOf(pending), 1);
  page.summary.assigned++;
  page.summary.pending = page.pendingMembership.length;
  return [{ kind: "pending_prose_continuation_attached", objectId: body.objectId,
    sourceLineId: line.sourceLineId, signals: { font, nativeProseInk: ink,
      formulaInkTops: inkTops, previousBodyBox: oldBody, completedBodyBox: newBody } },
    ...nearbyFormulas.map((o, i) => ({ kind: "formula_frame_trimmed_to_native_ink", objectId: o.objectId,
      top: inkTops[i], visualBox: box(o) }))];
}
function build(inputs = {}) {
  const prior = inputs.prior;
  const inventory = inputs.inventory;
  const native = inputs.native;
  const output = structuredClone(prior), operations = [];
  for (const [key, page] of Object.entries(output.pages)) {
    const lines = new Map(inventory.pages[key].sourceLines.map(l => [l.sourceLineId, l]));
    for (const op of mergeProseTail(page, lines, native.pages[key])) operations.push({ key, ...op });
    for (const op of attachPendingProse(page, lines, native.pages[key])) operations.push({ key, ...op });
    validatePage(key, page, inventory.pages[key]);
  }
  output.summary.pageLocalObjects -= operations.filter(o => o.kind === "semantic_prose_tail_join").length;
  output.summary.byType.body -= operations.filter(o => o.kind === "semantic_prose_tail_join").length;
  output.summary.assigned += operations.filter(o => o.kind === "pending_prose_continuation_attached").length;
  output.summary.pending = Object.values(output.pages).reduce((n, p) => n + p.pendingMembership.length, 0);
  if (output.summary.assigned + output.summary.pending + output.summary.excluded !== output.summary.sourceLines)
    throw Error("Stage 80 source conservation failed");
  output.schemaVersion = "OfflineStructuralObjectCandidate/vNext-prose-ink-boundaries";
  output.stage80 = { authority: "none", status: "offline_candidate_not_truth", operations };
  return output;
}
module.exports = { build, mergeProseTail, attachPendingProse, dominantProseFont, formulaInkTop };
