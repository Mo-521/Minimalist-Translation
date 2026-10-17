"use strict";

// Input-driven extraction of the frozen Stage 35 first-pass proposal rules.
// Keep decisions and output shape equivalent; later stages own later repairs.
const clean = s => String(s || "").replace(/\s+/g, " ").trim();
const proseWords = s => (clean(s).match(/\b[A-Za-z]{3,}\b/g) || []).length;
const equationNumber = s => /^\(\d{1,3}(?:\.\d+)?[a-z]?\)$/.test(clean(s));
const bridge = s => /^(?:and\s+)?(?:where|hence|therefore|then|moreover|so|we\s+(?:have|obtain|define|also\s+put))\b/i.test(clean(s));
const proseGrammar = s => /\b(?:we|the|which|that|this|using|obtain|assume|defined|immediately|respectively|hence|therefore)\b/i.test(clean(s));
const mathMarks = s => (clean(s).match(/[=≈≃≤≥⩽⩾∑∫√^_{}⟨⟩⊙∈∉⊂⊆∪∩∞α-ωΑ-Ωλ−±]/gu) || []).length;
function strongMath(o) {
  if (!o.orderedMembers?.length || o.type === "equation_number" || o.type === "reference" ||
    o.type === "caption" || o.type === "table") return false;
  const t = clean(o.sourceText);
  if (!t || equationNumber(t) || bridge(t) || proseGrammar(t) || proseWords(t) > 3) return false;
  if (t.length <= 20 && !/[=≈≃]/u.test(t) && !/^\(\d/.test(t)) return false;
  return mathMarks(t) >= 2 && (/[=≈≃≤≥⩽⩾]/u.test(t) ||
    (/^\(\d/.test(t) && /[∑∫√]/u.test(t)));
}
function compactMath(o) {
  if (!o.orderedMembers || o.orderedMembers.length !== 1 ||
    ![null, "unknown", "unresolved", "body"].includes(o.type)) return false;
  const t = clean(o.sourceText);
  if (!t || t.length > 18 || equationNumber(t) || bridge(t) || proseWords(t) > 1 ||
    /^(?:and|or|the|where|then|so|we|is|for)(?:[_\d]+)?[.,;:]?$/i.test(t)) return false;
  return mathMarks(t) > 0 || /^[A-Za-z][A-Za-z0-9]{0,2}$/.test(t);
}
function near(a, b) {
  const xOverlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x));
  const gap = Math.max(0, a.y - b.bottom, b.y - a.bottom), height = Math.max(a.bottom - a.y, b.bottom - b.y);
  return xOverlap >= Math.min(a.right - a.x, b.right - b.x) * .25 &&
    gap <= Math.min(19, Math.max(7, height * .85));
}
const label = /^\(\d{1,3}(?:\.\d+)?[a-z]?\)\s*/i;
const relation = /[=≈≃≤≥⩽⩾∑∫√]/u;
const proseSyntax = /\b(?:the|this|that|these|those|where|which|we|is|are|was|were|then|hence|therefore|from|into|using|yields|gives|implies|for|with|of|in|to|by|on|and|or)\b/i;
const naturalSentence = /\b(?:is|are|was|were|thus|therefore|however|consequently|means|denotes|shows|implies|gives)\b/i;
const discourseLead = /^(?:equivalently|consequently|furthermore|similarly|hence|therefore|thus|however|in\s+particular|moreover)\b/i;
const proseFragment = s => /^[A-Za-z]{4,}(?:\s+[A-Za-z]{2,})?\s*:/i.test(clean(s)) ||
  discourseLead.test(clean(s)) || /\b(?:imply|implies|yields|gives)\b/i.test(clean(s));
const wrap = line => ({ type: null, sourceText: line.text,
  orderedMembers: [{ sourceLineId: line.sourceLineId, bbox: line.bbox }] });
const rect = line => ({ x: line.bbox.x, y: line.bbox.y - line.bbox.height,
  right: line.bbox.x + line.bbox.width, bottom: line.bbox.y });
const median = values => { if (!values.length) return null; const sorted = values.slice().sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
function laneProfile(page, column) {
  const lines = page.sourceLines.filter(l => l.column === column && l.coverageClass === "reviewable_content");
  const maxWidth = Math.max(0, ...lines.map(l => l.bbox.width));
  const proseLines = lines.filter(l => l.bbox.width >= maxWidth * .64).sort((a, b) => a.bbox.y - b.bbox.y);
  return { proseLines, medianWidth: median(proseLines.map(l => l.bbox.width)),
    center: median(proseLines.map(l => l.bbox.x + l.bbox.width / 2)),
    medianHeight: median(lines.map(l => l.bbox.height)) };
}
function isolatedRelationalDisplay(line, profile) {
  const s = clean(line.text);
  if (!profile || profile.proseLines.length < 3 || !profile.medianWidth || s.length > 100 ||
    proseSyntax.test(s) || proseFragment(s)) return false;
  if (/<\/?[A-Za-z]{3,}/.test(s) || /https?:|url\s*=|\\n\\t/i.test(s)) return false;
  const outsideArguments = s.replace(/\(\s*[<>][^)]*\)/g, "");
  if (!/[<>∨∧]/u.test(outsideArguments) || (s.match(/[A-Z](?:_?\d+)?/g) || []).length < 2) return false;
  if ((s.match(/\b[A-Za-z]{3,}\b/g) || []).length > 1) return false;
  const b = line.bbox, c = b.x + b.width / 2, threshold = Math.max(4, (profile.medianHeight || 9) * .45);
  if (b.width > profile.medianWidth * .56 || Math.abs(c - profile.center) > profile.medianWidth * .16) return false;
  const before = profile.proseLines.filter(x => x.bbox.y < b.y).at(-1), after = profile.proseLines.find(x => x.bbox.y > b.y);
  const beforeGap = before ? b.y - b.height - before.bbox.y : Infinity;
  const afterGap = after ? after.bbox.y - after.bbox.height - b.y : Infinity;
  return beforeGap > threshold && afterGap > threshold;
}
function displayAnchor(line, page, profile) {
  const text = clean(line.text);
  if (!text || equationNumber(text) || proseFragment(text)) return null;
  const after = text.replace(label, ""), startsLabel = after !== text;
  if (startsLabel && naturalSentence.test(after)) return null;
  const marks = (after.match(/[=≈≃≤≥⩽⩾∑∫√^_{}⟨⟩⊙∈∉⊂⊆∪∩∞α-ωΑ-Ωλ−±]/gu) || []).length;
  const mathEvidence = relation.test(after) && marks >= 2;
  const relationOnly = !mathEvidence && isolatedRelationalDisplay(line, profile);
  if (!relationOnly && (!mathEvidence || !strongMath(wrap(line)))) return null;
  if (proseSyntax.test(after) && (!startsLabel || marks < 5)) return null;
  const widthRatio = line.bbox.width / page.pageSize.width;
  if (widthRatio > .86 && !startsLabel) return null;
  return { sourceLineId: line.sourceLineId,
    evidence: relationOnly ? ["relational_math_without_equal", "lane_centering", "vertical_prose_isolation", "short_non_prose_line"] :
      ["math_relation", "symbol_density", startsLabel ? "equation_label_with_math" : "non_prose_line_shape", "display_width_check"],
    riskFlags: widthRatio > .72 ? ["wide_display_or_mixed_line"] : [], marks, widthRatio: Number(widthRatio.toFixed(3)) };
}
function proposePage(page) {
  const lines = page.sourceLines.filter(l => l.coverageClass === "reviewable_content"),
    profiles = new Map([...new Set(lines.map(l => l.column))].map(c => [c, laneProfile(page, c)])),
    anchors = lines.map(line => ({ line, decision: displayAnchor(line, page, profiles.get(line.column)) })).filter(x => x.decision);
  const reserved = new Set(anchors.map(x => x.line.sourceLineId));
  const proposals = anchors.map(({ line, decision }) => ({ page: `${page.paper}:${page.pageNumber}`,
    paper: page.paper, pageNumber: page.pageNumber, anchorSourceLineId: line.sourceLineId,
    sourceLineIds: [line.sourceLineId], sourceTextPreview: line.text.slice(0, 200),
    basis: decision.evidence, riskFlags: decision.riskFlags, mathMarks: decision.marks,
    widthRatio: decision.widthRatio }));
  for (const line of lines) {
    if (reserved.has(line.sourceLineId) || equationNumber(line.text) || proseFragment(line.text) ||
      proseSyntax.test(clean(line.text)) || !compactMath(wrap(line))) continue;
    const matching = anchors.filter(({ line: anchor }) => anchor.column === line.column && near(rect(line), rect(anchor)));
    if (matching.length !== 1) continue;
    const proposal = proposals.find(p => p.anchorSourceLineId === matching[0].line.sourceLineId);
    if (!proposal) continue;
    proposal.sourceLineIds.push(line.sourceLineId);
    proposal.basis.push("unique_spatially_compatible_compact_math_member");
    reserved.add(line.sourceLineId);
  }
  return proposals;
}
function build(input, inputSha256) {
  if (!input?.pages || typeof inputSha256 !== "string") throw Error("Stage 35 source pages and input hash required");
  const proposals = [], summary = { papers: {}, totalPages: Object.keys(input.pages).length };
  for (const page of Object.values(input.pages)) {
    const list = proposePage(page); proposals.push(...list);
    const paper = summary.papers[page.paper] ??= { pages: 0, anchors: 0, attachedLines: 0 };
    paper.pages++; paper.anchors += list.length;
    paper.attachedLines += list.reduce((n, p) => n + p.sourceLineIds.length - 1, 0);
  }
  summary.proposals = proposals.length;
  summary.proposedSourceLineIds = new Set(proposals.flatMap(p => p.sourceLineIds)).size;
  return { schemaVersion: "OfflineSourceOnlyFormulaProposal/v1", authority: "none",
    status: "diagnostic_proposals_not_review_ready",
    producerVersion: "stage35-common-frozen-source-line-formula/v1", inputSha256,
    inputRule: "only_frozen_source_lines_no_previous_object_labels", summary, proposals };
}
module.exports = { displayAnchor, proposePage, build };
