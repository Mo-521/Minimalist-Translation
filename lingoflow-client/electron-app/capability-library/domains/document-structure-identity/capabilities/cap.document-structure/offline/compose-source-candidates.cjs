#!/usr/bin/env node
"use strict";

// One offline, non-authoritative ownership composer for every frozen page.
// Conflicting type proposals stay pending; rectangles never invent members.
const crypto = require("node:crypto");
const { captionLabel } = require("./semantic-regions.cjs");
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
const clean = value => String(value || "").replace(/\s+/g, " ").trim();
const top = box => box.y - box.height;
const extent = lines => {
  const x = Math.min(...lines.map(line => line.bbox.x));
  const y = Math.min(...lines.map(line => top(line.bbox)));
  const right = Math.max(...lines.map(line => line.bbox.x + line.bbox.width));
  const bottom = Math.max(...lines.map(line => line.bbox.y));
  return { x, y, width: right - x, height: bottom - y };
};
const order = (a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x;
const appendixHeadingShape = text => {
  const value = clean(text);
  if (value.length < 8 || value.length > 72 || /[.!?]$/.test(value)) return false;
  const indexed = /^[A-Z]\.\d+(?:\.\d+)?\s+[A-Z][A-Za-z-]{2,}(?:\s+(?:[A-Za-z][A-Za-z-]{2,}|\d+)){0,8}$/.test(value);
  const topLevel = /^[A-Z]\s+[A-Z][A-Za-z-]{3,}(?:\s+[A-Za-z][A-Za-z-]+){0,8}$/.test(value);
  return indexed || topLevel;
};
function appendixHeadingPrefix(block, byId, page) {
  if (block.sourceLineIds.length < 2) return [];
  const lines = block.sourceLineIds.map(id => byId.get(id));
  const first = lines[0], second = lines[1];
  if (!first || !second || !appendixHeadingShape(first.text) ||
      first.bbox.width > page.pageSize.width * .62 || first.column !== second.column) return [];
  const gap = top(second.bbox) - first.bbox.y;
  const typography = first.bbox.height >= second.bbox.height * .95;
  if (!typography || gap < -1 || gap < Math.max(4, first.bbox.height * .36)) {
    // A wrapped heading can have a tight second line, followed by a clear
    // text break. This is still a semantic heading, not a line-per-Object rule.
    const third = lines[2];
    const wrapped = third && clean(second.text).split(/\s+/).length <= 2 &&
      second.bbox.x - first.bbox.x >= 12 && second.bbox.height >= first.bbox.height * .9 &&
      top(second.bbox) - first.bbox.y >= -1 && top(second.bbox) - first.bbox.y <= 4 &&
      top(third.bbox) - second.bbox.y >= Math.max(4, second.bbox.height * .4);
    return wrapped ? [first.sourceLineId, second.sourceLineId] : [];
  }
  return [first.sourceLineId];
}
function composePage(page, diagnostic, regional, formulaProposals) {
  const byId = new Map(page.sourceLines.map(line => [line.sourceLineId, line]));
  if (byId.size !== page.sourceLines.length) throw Error(`Duplicate frozen line ID ${page.paper}:${page.pageNumber}`);
  const diagnosticExcluded = new Map(diagnostic.excludedSourceLines.map(item => [item.sourceLineId, item]));
  const reviewable = new Set(page.sourceLines.filter(line => line.coverageClass === "reviewable_content")
    .map(line => line.sourceLineId).filter(id => !diagnosticExcluded.has(id)));
  const owners = new Map(), objects = [], conflicts = [], heldOut = [];
  const reservedKinds = new Map(diagnostic.reservedSemanticLines.map(item => [item.sourceLineId, item.kind]));
  const proposed = (kind, ids, evidence, additional = {}) => {
    const unique = [...new Set(ids)];
    const missing = unique.filter(id => !byId.has(id) || !reviewable.has(id));
    const occupied = unique.filter(id => owners.has(id));
    if (missing.length || occupied.length || !unique.length) {
      conflicts.push({ kind, evidence, sourceLineIds: unique, missing, occupied,
        reason: !unique.length ? "empty_proposal" : missing.length ? "invalid_or_excluded_member" : "already_owned" });
      return false;
    }
    const lines = unique.map(id => byId.get(id)).sort(order);
    const objectId = `stage37:${hash([page.sourcePdfSha256, page.pageNumber, kind, unique])}`;
    for (const id of unique) owners.set(id, objectId);
    objects.push({ objectId, type: kind, page: page.pageNumber,
      sourceLineIds: lines.map(line => line.sourceLineId), sourceText: lines.map(line => clean(line.text)).join("\n"),
      memberCount: lines.length, memberLineBoxes: lines.map(line => ({ sourceLineId: line.sourceLineId, bbox: line.bbox })),
      spatialFragments: [{ bbox: extent(lines), sourceLineIds: lines.map(line => line.sourceLineId) }],
      evidence, authority: "none", status: "offline_candidate_not_truth", ...additional });
    return true;
  };

  // Explicit semantic regions precede coarse paragraph groups. Figure frames
  // remain unaccepted spatial hints until original-PDF box calibration.
  for (const item of regional.abstract) proposed("abstract", item.sourceLineIds, ["stage36_explicit_heading_region"]);
  for (const item of regional.frontMatter) proposed("front_matter_affiliation_or_contact", item.sourceLineIds,
    ["stage36_front_matter_proposal"], { proposedTypeExtension: true });
  for (const item of regional.unsupportedStructuredBlocks) proposed("unsupported_structured_block", item.sourceLineIds,
    ["stage36_structured_container"], { proposedTypeExtension: true });
  for (const item of regional.tables) {
    if (item.reviewReadiness !== "candidate_evidence_sufficient_but_visual_unverified") {
      heldOut.push({ kind: "table", proposalId: item.proposalId, reason: "insufficient_independent_evidence" });
      continue;
    }
    proposed("table", item.sourceLineIds, ["stage36_table_container", "caption_separate"],
      { visualFrameHint: item.frame, visualFrameStatus: "unverified", internalTextIsMemberOnly: true });
  }
  for (const item of regional.figures) heldOut.push({ kind: "figure", proposalId: item.proposalId,
    sourceLineIds: item.sourceLineIds, frame: item.frame, reason: "geometry_prior_frame_not_structure_truth" });

  // The source-only formula detector overlaps prose on some pages. Only
  // entirely math-pending, disjoint proposals can acquire formula ownership.
  for (const item of formulaProposals) {
    if (!item.sourceLineIds.length || item.riskFlags?.length ||
      !item.sourceLineIds.every(id => reservedKinds.get(id) === "math_or_equation_label_pending")) {
      heldOut.push({ kind: "formula", sourceLineIds: item.sourceLineIds, reason: "prose_or_boundary_conflict" });
      continue;
    }
    proposed("formula", item.sourceLineIds, ["source_only_display_math", ...item.basis]);
  }
  for (const item of diagnostic.reservedSemanticLines) {
    if (item.kind === "heading_candidate") proposed("heading", [item.sourceLineId], item.basis || []);
    if (item.kind === "caption_start_candidate") proposed("caption", [item.sourceLineId], item.basis || []);
  }
  for (const block of diagnostic.bodyBoundaryCandidates) {
    const headingIds = appendixHeadingPrefix(block, byId, page);
    if (headingIds.length && headingIds.every(id => !owners.has(id)))
      proposed("heading", headingIds, ["lettered_appendix_section_shape", "line_width", "typography", "following_break"]);
    const remaining = block.sourceLineIds.filter(id => !owners.has(id));
    if (!remaining.length) continue;
    if (remaining.length !== block.sourceLineIds.length - headingIds.length) {
      heldOut.push({ kind: "body", sourceLineIds: remaining, reason: "semantic_region_cut_through_paragraph_block",
        originalSourceLineIds: block.sourceLineIds });
      continue;
    }
    const first = byId.get(remaining[0]);
    if (first && captionLabel.test(clean(first.text))) {
      proposed("caption", remaining, ["general_roman_or_arabic_caption_label", "source_only_continuation_block"]);
    } else {
      proposed("body", remaining, ["source_only_paragraph_boundary", block.breakReason]);
    }
  }
  const pending = page.sourceLines.filter(line => reviewable.has(line.sourceLineId) && !owners.has(line.sourceLineId))
    .map(line => ({ sourceLineId: line.sourceLineId, text: line.text, bbox: line.bbox,
      reason: reservedKinds.get(line.sourceLineId) || "unresolved_membership" }));
  const excluded = page.sourceLines.filter(line => !reviewable.has(line.sourceLineId))
    .map(line => ({ sourceLineId: line.sourceLineId, coverageClass: line.coverageClass,
      exclusionReason: diagnosticExcluded.get(line.sourceLineId)?.kind || "upstream_excluded",
      exclusionEvidence: diagnosticExcluded.get(line.sourceLineId)?.basis || [line.coverageClass] }));
  const countByType = objects.reduce((counts, object) => {
    counts[object.type] = (counts[object.type] || 0) + 1; return counts;
  }, {});
  if (owners.size + pending.length + excluded.length !== page.sourceLines.length) {
    throw Error(`Source conservation failed ${page.paper}:${page.pageNumber}`);
  }
  return { paper: page.paper, pageNumber: page.pageNumber, sourcePdfSha256: page.sourcePdfSha256,
    sourceLineCount: page.sourceLines.length, reviewableLineCount: reviewable.size,
    objects, pendingMembership: pending, excludedSourceLines: excluded, conflicts, heldOut,
    summary: { objects: objects.length, byType: countByType, assigned: owners.size, pending: pending.length,
      excluded: excluded.length, conflicts: conflicts.length, heldOut: heldOut.length, duplicateOwnership: 0,
      lostSourceLines: 0 } };
}
function build(inputs) {
  const frozen = inputs?.frozen;
  const boundaries = inputs?.boundaries;
  const formula = inputs?.formula;
  const regions = inputs?.regions;
  if (!frozen?.pages || !boundaries?.pages || !Array.isArray(formula?.proposals) || !regions?.pages)
    throw Error("Stage 37 source, boundary, formula and region inputs required");
  const groupedFormula = new Map();
  for (const item of formula.proposals) {
    if (!groupedFormula.has(item.page)) groupedFormula.set(item.page, []);
    groupedFormula.get(item.page).push(item);
  }
  const pages = {};
  for (const [key, page] of Object.entries(frozen.pages)) {
    if (!boundaries.pages[key] || !regions.pages[key]) throw Error(`Missing layer for ${key}`);
    pages[key] = composePage(page, boundaries.pages[key], regions.pages[key], groupedFormula.get(key) || []);
  }
  const summary = { pages: Object.keys(pages).length, sourceLines: 0, reviewable: 0, assigned: 0,
    pending: 0, excluded: 0, objects: 0, conflicts: 0, heldOut: 0, byType: {} };
  for (const page of Object.values(pages)) {
    summary.sourceLines += page.sourceLineCount;
    summary.reviewable += page.reviewableLineCount;
    for (const key of ["assigned", "pending", "excluded", "objects", "conflicts", "heldOut"])
      summary[key] += page.summary[key];
    for (const [type, count] of Object.entries(page.summary.byType))
      summary.byType[type] = (summary.byType[type] || 0) + count;
  }
  return { schemaVersion: "OfflineStructuralObjectCandidate/vNext-diagnostic", authority: "none",
    status: "machine_composition_not_review_ready", rule: "one_source_line_at_most_one_object_or_explicit_pending",
    input: ["frozen_source_lines", "source_only_page_boundaries", "source_only_formula_proposals",
      "stage36_semantic_region_proposals"],
    caution: "Pending or conflicting lines are never silently forced into body; figure frames are hints only",
    summary, pages };
}
module.exports = { build, composePage };
