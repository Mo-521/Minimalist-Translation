"use strict";

// Offline-only: transfer a single-row formula fragment into the one
// multi-row formula whose display region fully contains it. A visual frame
// alone is insufficient: the source member, math evidence, and ownership
// guards must all agree.
const { validatePage } = require("./region-completeness.cjs");

const math = text => /[=≤≥⩽⩾∑∫√^_{}⟨⟩α-ωΑ-Ωλ−±]/u.test(text);
const prose = text => /\b(?:where|therefore|because|since|however|moreover|we|the|that|which|yields)\b/iu.test(text);
const contains = (outer, inner) => inner.x >= outer.x - 3 &&
  inner.x + inner.width <= outer.x + outer.width + 3 &&
  inner.y >= outer.y - 3 && inner.y + inner.height <= outer.y + outer.height + 3;

function nestedPairs(page, lines) {
  const formulas = page.objects.filter(o => o.type === "formula" && o.spatialFragments?.length === 1);
  const proposals = [];
  for (const child of formulas.filter(o => o.sourceLineIds.length === 1)) {
    const line = lines.get(child.sourceLineIds[0]);
    const childBox = child.spatialFragments[0].bbox;
    // Extraction line rectangles use baseline y and can extend below the
    // visual glyph frame, so compare baseline and horizontal center instead.
    if (!line || !math(line.text) || prose(line.text) ||
        line.bbox.y < childBox.y - 2 || line.bbox.y > childBox.y + childBox.height + 2 ||
        line.bbox.x + line.bbox.width / 2 < childBox.x - 2 ||
        line.bbox.x + line.bbox.width / 2 > childBox.x + childBox.width + 2) continue;
    const candidates = formulas.filter(parent => parent !== child && parent.sourceLineIds.length >= 3 &&
      parent.page === child.page && contains(parent.spatialFragments[0].bbox, child.spatialFragments[0].bbox) &&
      parent.sourceLineIds.every(id => lines.get(id)?.column === line.column));
    if (candidates.length !== 1) continue;
    const parent = candidates[0];
    if (page.objects.some(o => o !== parent && o !== child && o.type !== "formula" &&
      o.sourceLineIds.includes(line.sourceLineId))) continue;
    proposals.push({ parent, child, line });
  }
  return proposals;
}

function build(inputs = {}) {
  const prior = inputs.prior;
  const inventory = inputs.inventory;
  const output = structuredClone(prior), operations = [];
  for (const [key, page] of Object.entries(output.pages)) {
    const inv = inventory.pages[key], lines = new Map(inv.sourceLines.map(l => [l.sourceLineId, l]));
    for (const { parent, child, line } of nestedPairs(page, lines)) {
      if (!page.objects.includes(child) || parent.sourceLineIds.includes(line.sourceLineId)) continue;
      parent.sourceLineIds.push(line.sourceLineId);
      parent.sourceLineIds.sort((a, b) => lines.get(a).bbox.y - lines.get(b).bbox.y ||
        lines.get(a).bbox.x - lines.get(b).bbox.x);
      parent.sourceText = parent.sourceLineIds.map(id => lines.get(id).text.trim()).join("\n");
      parent.memberCount = parent.sourceLineIds.length;
      parent.memberLineBoxes = parent.sourceLineIds.map(id => ({ sourceLineId: id, bbox: lines.get(id).bbox }));
      parent.spatialFragments[0].sourceLineIds = [...parent.sourceLineIds];
      parent.evidence = [...(parent.evidence || []), "nested_single_row_formula_member_transferred"];
      page.objects.splice(page.objects.indexOf(child), 1);
      page.summary.objects--;
      page.summary.byType.formula--;
      operations.push({ key, kind: "nested_formula_fragment_attached", parentObjectId: parent.objectId,
        removedFragmentObjectId: child.objectId, sourceLineId: line.sourceLineId });
    }
    validatePage(key, page, inv);
  }
  output.summary.pageLocalObjects -= operations.length;
  output.summary.byType.formula -= operations.length;
  if (output.summary.assigned + output.summary.pending + output.summary.excluded !== output.summary.sourceLines)
    throw Error("Stage 79 source conservation failed");
  output.schemaVersion = "OfflineStructuralObjectCandidate/vNext-nested-formula-members";
  output.stage79 = { authority: "none", status: "offline_candidate_not_truth", operations };
  return output;
}
module.exports = { build, nestedPairs };
