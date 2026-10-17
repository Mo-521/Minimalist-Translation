"use strict";

// Offline-only whole-display completion from a narrow existing formula tail.
// Mixed prose/math source lines remain pending until defensible span evidence.
const { validatePage } = require("./region-completeness.cjs");
const center = b => b.x + b.width / 2;
const marks = text => (text.match(/[=≈≤≥⩽⩾⪯⪰∑∫√^_{}⟨⟩⊙∈∉⊂⊆∞α-ωΑ-Ωλ−±]/gu) || []).length;
const lexicalBridge = text => /\b(?:and|where|then|hence|yields|since|therefore|moreover|because|we|for)\b/iu.test(text);
function regionMembers(formula, page, inv) {
  if (formula.sourceLineIds.length > 2 || !formula.spatialFragments?.length) return [];
  const box = formula.spatialFragments[0].bbox, width = inv.pageSize.width;
  if (box.width >= width * .12 || formula.sourceText.length > 40 || marks(formula.sourceText) < 2) return [];
  const byId = new Map(inv.sourceLines.map(l => [l.sourceLineId, l]));
  const anchors = formula.sourceLineIds.map(id => byId.get(id)).filter(Boolean);
  if (!anchors.length) return [];
  const base = Math.max(...anchors.map(l => l.bbox.y));
  const matched = page.pendingMembership.filter(p => p.reason === "math_or_equation_label_pending")
    .map(p => byId.get(p.sourceLineId)).filter(Boolean)
    .filter(l => l.column === anchors[0].column && !lexicalBridge(l.text) && marks(l.text) >= 2 &&
      l.bbox.y < base && base - l.bbox.y <= Math.max(45, anchors[0].bbox.height * 5) &&
      Math.abs(center(l.bbox) - center(box)) < width * .16)
    .sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  if (matched.length < 2 || !matched.some(l => l.bbox.width >= box.width * 2.2)) return [];
  const spread = matched.at(-1).bbox.y - matched[0].bbox.y;
  if (spread > Math.max(25, anchors[0].bbox.height * 3)) return [];
  // Any printed sentence or different semantic Object between the main row
  // and narrow tail makes this a conflict, not an attachment opportunity.
  const low = matched[0].bbox.y, high = base;
  const intervening = page.objects.some(o => o !== formula &&
    o.sourceLineIds.some(id => { const l = byId.get(id);
      return l && l.bbox.y > low && l.bbox.y < high &&
        Math.abs(center(l.bbox) - center(box)) < width * .2; }));
  if (intervening) return [];
  return matched.map(l => l.sourceLineId);
}
function completedBox(formula, ids, byId) {
  const rows = ids.map(id => byId.get(id));
  const old = formula.spatialFragments[0].bbox;
  const x = Math.min(old.x, ...rows.map(l => l.bbox.x));
  const right = Math.max(old.x + old.width, ...rows.map(l => l.bbox.x + l.bbox.width));
  // Baseline-height glyph rectangles overstate the visual rise of a display;
  // use a conservative row envelope, then retain the old tail's full extent.
  const y = Math.min(old.y, ...rows.map(l => l.bbox.y - l.bbox.height * .55));
  const bottom = Math.max(old.y + old.height, ...rows.map(l => l.bbox.y));
  return { x, y, width: right - x, height: bottom - y };
}
function build(inputs) {
  const prior = inputs?.prior;
  const source = inputs?.source;
  const out = structuredClone(prior), operations = [], held = [];
  for (const [key, page] of Object.entries(out.pages)) {
    const inv = source.pages[key], byId = new Map(inv.sourceLines.map(l => [l.sourceLineId, l]));
    for (const formula of page.objects.filter(o => o.type === "formula")) {
      const ids = regionMembers(formula, page, inv);
      if (!ids.length) continue;
      const competing = page.objects.filter(o => o !== formula && o.type === "formula" &&
        o.sourceLineIds.some(id => ids.includes(id)));
      if (competing.length) { held.push({ key, formulaId: formula.objectId, reason: "competing_formula_owner" }); continue; }
      const box = completedBox(formula, ids, byId);
      const bodyOverlap = page.objects.filter(o => o.type === "body").some(o => o.spatialFragments.some(f => {
        const b = f.bbox;
        return Math.max(0, Math.min(box.x + box.width, b.x + b.width) - Math.max(box.x, b.x)) *
          Math.max(0, Math.min(box.y + box.height, b.y + b.height) - Math.max(box.y, b.y)) > 1;
      }));
      if (bodyOverlap) { held.push({ key, formulaId: formula.objectId, reason: "body_frame_intersection" }); continue; }
      formula.sourceLineIds = [...formula.sourceLineIds, ...ids].sort((a, b) =>
        byId.get(a).bbox.y - byId.get(b).bbox.y || byId.get(a).bbox.x - byId.get(b).bbox.x);
      formula.sourceText = formula.sourceLineIds.map(id => byId.get(id).text.trim()).join("\n");
      formula.memberCount = formula.sourceLineIds.length;
      formula.memberLineBoxes = formula.sourceLineIds.map(id => ({ sourceLineId: id, bbox: byId.get(id).bbox }));
      formula.spatialFragments = [{ bbox: box, sourceLineIds: [...formula.sourceLineIds] }];
      formula.evidence = [...(formula.evidence || []), "pending_math_rows_complete_narrow_formula_tail"];
      const owned = new Set(ids);
      page.pendingMembership = page.pendingMembership.filter(p => !owned.has(p.sourceLineId));
      page.summary = { ...page.summary, assigned: page.summary.assigned + ids.length,
        pending: page.pendingMembership.length };
      operations.push({ key, kind: "whole_display_members_restored", formulaId: formula.objectId,
        addedSourceLineIds: ids, memberCount: formula.memberCount, visualBox: box });
    }
    validatePage(key, page, inv);
  }
  out.summary = { ...out.summary, assigned: out.summary.assigned +
    operations.reduce((n, o) => n + o.addedSourceLineIds.length, 0),
    pending: Object.values(out.pages).reduce((n, p) => n + p.pendingMembership.length, 0) };
  if (out.summary.assigned + out.summary.pending + out.summary.excluded !== out.summary.sourceLines)
    throw Error("Stage 77 source conservation failed");
  out.schemaVersion = "OfflineStructuralObjectCandidate/vNext-display-region-members";
  out.stage77 = { authority: "none", status: "offline_candidate_not_truth", operations, held };
  return out;
}
module.exports = { build, regionMembers, completedBox };
