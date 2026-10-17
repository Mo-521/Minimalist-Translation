#!/usr/bin/env node
"use strict";

// Diagnostic-only replay after a source-confirmed bibliography end. Stage 35's
// broad carryover hint can otherwise mark entire later appendix pages as
// reference pending. No accepted human frame or Geometry fact is read here.
const crypto = require("node:crypto");
const { auditPage } = require("./source-page-boundaries.cjs");
const { composePage } = require("./compose-source-candidates.cjs");
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
const clean = value => String(value || "").replace(/\s+/g, " ").trim();
function extent(lines) {
  const x = Math.min(...lines.map(line => line.bbox.x));
  const y = Math.min(...lines.map(line => line.bbox.y - line.bbox.height));
  const right = Math.max(...lines.map(line => line.bbox.x + line.bbox.width));
  const bottom = Math.max(...lines.map(line => line.bbox.y));
  return { x, y, width: right - x, height: bottom - y };
}
function splitAppendixHeading(object, page, byId) {
  if (object.type !== "body" || object.sourceLineIds.length < 2) return [object];
  const first = byId.get(object.sourceLineIds[0]), second = byId.get(object.sourceLineIds[1]);
  if (!first || !second) return [object];
  const sectionShape = /^[A-Z]\.\d+(?:\.\d+)?\s+Proof\b/i.test(clean(first.text));
  const independentLine = first.bbox.width < page.pageSize.width * .65 &&
    second.bbox.y - first.bbox.y > Math.max(16, first.bbox.height * 1.35);
  if (!sectionShape || !independentLine) return [object];
  const rebuild = (ids, type) => {
    const lines = ids.map(id => byId.get(id));
    return { ...object, objectId: `stage39:${hash([page.sourcePdfSha256, page.pageNumber, type, ids])}`,
      type, sourceLineIds: ids, sourceText: lines.map(line => clean(line.text)).join("\n"),
      memberCount: ids.length,
      memberLineBoxes: lines.map(line => ({ sourceLineId: line.sourceLineId, bbox: line.bbox })),
      spatialFragments: [{ bbox: extent(lines), sourceLineIds: ids }],
      evidence: [...object.evidence, "lettered_appendix_heading_shape", "visual_line_break"] };
  };
  return [rebuild([first.sourceLineId], "heading"), rebuild(object.sourceLineIds.slice(1), "body")];
}

function applyFormulaBarriers(diagnostic, page, proposals) {
  const counts = new Map();
  for (const proposal of proposals.filter(item => !item.riskFlags?.length))
    for (const id of proposal.sourceLineIds) counts.set(id, (counts.get(id) || 0) + 1);
  const barriers = new Set([...counts].filter(([, count]) => count === 1).map(([id]) => id));
  const byId = new Map(page.sourceLines.map(line => [line.sourceLineId, line]));
  for (const block of diagnostic.bodyBoundaryCandidates) {
    for (let index = 1; index < block.sourceLineIds.length; index++) {
      const prior = byId.get(block.sourceLineIds[index - 1]);
      const line = byId.get(block.sourceLineIds[index]);
      const text = clean(line.text);
      const offset = line.bbox.x - prior.bbox.x;
      const isolated = offset > Math.max(30, page.pageSize.width * .08) &&
        line.bbox.width < page.pageSize.width * .6;
      const mathMarks = (text.match(/[=≈≃≤≥⩽⩾∑∫√^_{}⟨⟩⊙∈∉⊂⊆∪∩∞α-ωΑ-Ωλ−±]/gu) || []).length;
      const compactMath = mathMarks >= 2 && (text.match(/\b[A-Za-z]{3,}\b/g) || []).length <= 2;
      const extractionFragment = text.length < 20 && /^[\[({].*[\]})]?$/.test(text) &&
        (text.match(/\b[A-Za-z]{3,}\b/g) || []).length === 0;
      if (isolated && (compactMath || extractionFragment)) barriers.add(line.sourceLineId);
    }
  }
  const blocks = [];
  for (const block of diagnostic.bodyBoundaryCandidates) {
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const words = run.map(id => byId.get(id).text).join(" ").match(/\b[A-Za-z]{2,}\b/g) || [];
      if (words.length >= 3) blocks.push({ ...block, sourceLineIds: run,
        firstLine: clean(byId.get(run[0]).text), lastLine: clean(byId.get(run.at(-1)).text),
        lineCount: run.length, breakReason: "source_only_display_math_barrier" });
      else diagnostic.unresolvedMembership.push({ kind: "unresolved_membership", sourceLineIds: run,
        reason: "short_prose_adjacent_to_display_math_barrier" });
      run = [];
    };
    for (const id of block.sourceLineIds) {
      if (barriers.has(id)) flush();
      else run.push(id);
    }
    flush();
  }
  diagnostic.bodyBoundaryCandidates = blocks;
  diagnostic.reservedSemanticLines = diagnostic.reservedSemanticLines.filter(item => !barriers.has(item.sourceLineId));
  for (const id of barriers) diagnostic.reservedSemanticLines.push({ sourceLineId: id,
    text: byId.get(id).text, kind: "display_math_boundary_pending",
    basis: ["source_only_formula_proposal", "barrier_not_formula_truth"] });
  return barriers;
}
function build(options = {}, inputs) {
  const frozen = inputs?.frozen;
  const formula = inputs?.formula;
  const references = inputs?.references;
  const composed = inputs?.composed;
  const pages = {}, summary = { pagesExamined: 0, candidateObjects: 0,
    candidateMemberLines: 0, highRiskObjects: 0, heldOutProposals: 0, byType: {} };
  for (const [paper, set] of Object.entries(references.papers)) {
    const ending = set.excludedByBoundary.find(item =>
      item.reason === "semantic_section_after_references" ||
      item.reason === "new_top_of_page_semantic_section");
    if (!ending) continue;
    const stop = Object.values(frozen.pages).flatMap(page => page.sourceLines)
      .find(line => line.sourceLineId === ending.sourceLineId);
    if (!stop) throw Error(`Missing bibliography end line ${ending.sourceLineId}`);
    for (const [key, page] of Object.entries(frozen.pages)) {
      if (String(page.paper) !== paper || page.pageNumber < stop.page) continue;
      const original = composed.pages[key];
      const pendingIds = new Set(original.pendingMembership.map(item => item.sourceLineId));
      const suffix = page.sourceLines.filter(line => page.pageNumber > stop.page ||
        line.bbox.y >= stop.bbox.y - .5);
      if (!suffix.length || !suffix.some(line => pendingIds.has(line.sourceLineId))) continue;
      const slice = { ...page, sourceLines: suffix };
      const diagnostic = auditPage(slice, new Set(), false);
      const emptyRegions = { abstract: [], frontMatter: [], unsupportedStructuredBlocks: [],
        tables: [], figures: [] };
      const proposals = formula.proposals.filter(item => item.page === key &&
        item.sourceLineIds.every(id => suffix.some(line => line.sourceLineId === id)));
      const formulaMemberIds = new Set(proposals.flatMap(item => item.sourceLineIds));
      const byId = new Map(page.sourceLines.map(line => [line.sourceLineId, line]));
      const barriers = options.formulaBarrier ? applyFormulaBarriers(diagnostic, slice, proposals) : new Set();
      const replay = composePage(slice, diagnostic, emptyRegions, options.formulaBarrier ? [] : proposals);
      const accepted = [], heldOut = [];
      for (const object of replay.objects) {
        if (object.sourceLineIds.every(id => pendingIds.has(id))) {
          for (const part of splitAppendixHeading(object, page, byId)) {
            const riskFlags = [];
            if (part.type === "body" && part.sourceLineIds.some(id => formulaMemberIds.has(id)))
              riskFlags.push("body_contains_display_formula_proposal");
            accepted.push({ ...part, evidence: [...part.evidence, "after_confirmed_reference_end"],
              riskFlags, status: "offline_post_reference_proposal_not_truth" });
          }
        } else heldOut.push({ objectId: object.objectId, type: object.type,
          sourceLineIds: object.sourceLineIds, reason: "overlap_with_prior_composed_ownership" });
      }
      pages[key] = { paper: page.paper, pageNumber: page.pageNumber,
        endBoundarySourceLineId: ending.sourceLineId, boundaryReason: ending.reason,
        displayMathBarrierIds: [...barriers],
        replayInputLines: suffix.length, priorPendingLines: suffix.filter(line => pendingIds.has(line.sourceLineId)).length,
        objects: accepted, heldOut,
        remainingPendingIds: suffix.filter(line => pendingIds.has(line.sourceLineId) &&
          !accepted.some(object => object.sourceLineIds.includes(line.sourceLineId)))
          .map(line => line.sourceLineId) };
      summary.pagesExamined++;
      summary.candidateObjects += accepted.length;
      summary.candidateMemberLines += accepted.reduce((n, object) => n + object.sourceLineIds.length, 0);
      summary.highRiskObjects += accepted.filter(object => object.riskFlags.length).length;
      summary.heldOutProposals += heldOut.length;
      for (const object of accepted) summary.byType[object.type] = (summary.byType[object.type] || 0) + 1;
    }
  }
  return { schemaVersion: options.formulaBarrier ? "OfflinePostReferenceRecoveryProposal/v2" :
      "OfflinePostReferenceRecoveryProposal/v1", authority: "none",
    status: "diagnostic_proposal_not_truth", summary, pages };
}
module.exports = { build };
