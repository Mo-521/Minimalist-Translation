#!/usr/bin/env node
"use strict";

// Offline source-only whole-entry reference proposals. Older candidates and
// human frames are regression evidence, never producer inputs.
const crypto = require("node:crypto");
const clean = text => String(text || "").replace(/\s+/g, " ").trim();
const top = box => box.y - box.height;
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
const numbered = text => /^\[(\d{1,3})\]\s+\S/.exec(clean(text));
const heading = text => /^(?:references|bibliography)$/i.test(clean(text));
const reset = text => /^(?:appendix|appendices|supplementary(?:\s+material)?|[A-Z](?:\.\d+)?\s+Proofs?\b|[A-Z]\.\d+\s+Proof\b|author\s+information|correspondence)\b/i.test(clean(text));
const affiliation = text => /(?:@|\b(?:university|universit[eé]|institute|department|correspondence))/i.test(clean(text));
const box = lines => {
  const x = Math.min(...lines.map(line => line.bbox.x));
  const y = Math.min(...lines.map(line => top(line.bbox)));
  const right = Math.max(...lines.map(line => line.bbox.x + line.bbox.width));
  const bottom = Math.max(...lines.map(line => line.bbox.y));
  return { x, y, width: right - x, height: bottom - y };
};
function laneModel(page) {
  const left = page.sourceLines.filter(line => line.column === "left" && !heading(line.text));
  const right = page.sourceLines.filter(line => line.column === "right" && !heading(line.text));
  const two = left.length >= 3 && right.length >= 3;
  const lane = line => {
    if (!two) return "single";
    if (line.column === "left" || line.column === "right") return line.column;
    return line.bbox.x + line.bbox.width / 2 < page.pageSize.width / 2 ? "left" : "right";
  };
  const bases = two ? {
    left: Math.min(...left.map(line => line.bbox.x)), right: Math.min(...right.map(line => line.bbox.x)),
  } : { single: Math.min(...page.sourceLines.map(line => line.bbox.x)) };
  return { two, lane, bases, lanes: two ? ["left", "right"] : ["single"] };
}
function sectionAnchor(pages) {
  for (const page of pages) {
    const found = page.sourceLines.filter(line => heading(line.text)).sort((a, b) => a.bbox.y - b.bbox.y)[0];
    if (found) return { pageNumber: page.pageNumber, line: found, basis: "explicit_reference_heading" };
  }
  // Some papers have no printed heading. Require a late-document monotone
  // numbered bibliography beginning at [1], not an isolated inline citation.
  for (const page of pages.filter(page => page.pageNumber > pages.length * .6)) {
    const starts = page.sourceLines.map(line => ({ line, number: Number(numbered(line.text)?.[1]) }))
      .filter(item => Number.isInteger(item.number));
    if (starts.length < 3 || !starts.some(item => item.number === 1)) continue;
    const first = starts.find(item => item.number === 1);
    const larger = starts.filter(item => item.number > 1 && item.number <= 5).length;
    if (larger >= 2) return { pageNumber: page.pageNumber, line: first.line,
      basis: "late_document_monotone_numbered_bibliography", synthetic: true };
  }
  return null;
}
function sectionLines(pages, anchor, diagnostic) {
  if (!anchor) return { lines: [], excludedByBoundary: [], heldOutSourceLines: [], mode: "absent" };
  const all = [], excludedByBoundary = [], heldOutSourceLines = [];
  let stopped = false;
  for (const page of pages.filter(page => page.pageNumber >= anchor.pageNumber)) {
    if (stopped) break;
    // A new section title at the top of a later page applies to the entire
    // page, even if PDF extraction tags the centered title as one column.
    if (page.pageNumber > anchor.pageNumber && page.sourceLines.some(line =>
      reset(line.text) && line.bbox.y < page.pageSize.height * .25)) {
      stopped = true;
      excludedByBoundary.push({ sourceLineId: page.sourceLines.find(line =>
        reset(line.text) && line.bbox.y < page.pageSize.height * .25).sourceLineId,
        reason: "new_top_of_page_semantic_section" });
      break;
    }
    const model = laneModel(page);
    const anchorLane = page.pageNumber === anchor.pageNumber ? model.lane(anchor.line) : null;
    const centered = page.pageNumber === anchor.pageNumber && !anchor.synthetic && model.two &&
      Math.abs(anchor.line.bbox.x + anchor.line.bbox.width / 2 - page.pageSize.width / 2) < page.pageSize.width * .03;
    const ordered = page.sourceLines.filter(line => line.coverageClass === "reviewable_content" &&
      !heading(line.text)).map(line => ({ ...line, logicalLane: model.lane(line) }))
      .sort((a, b) => model.lanes.indexOf(a.logicalLane) - model.lanes.indexOf(b.logicalLane) ||
        a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
    const firstNumberedByLane = new Map();
    if (page.pageNumber === anchor.pageNumber && model.two) for (const lane of model.lanes) {
      const first = ordered.find(line => line.logicalLane === lane && numbered(line.text));
      if (first) firstNumberedByLane.set(lane, first.bbox.y);
    }
    const pageExcluded = new Set(diagnostic.pages[`${page.paper}:${page.pageNumber}`].excludedSourceLines
      .map(item => item.sourceLineId));
    for (const line of ordered) {
      if (pageExcluded.has(line.sourceLineId)) continue;
      if (page.pageNumber === anchor.pageNumber) {
        const lineLane = model.lanes.indexOf(line.logicalLane), startLane = model.lanes.indexOf(anchorLane);
        if (centered && line.bbox.y <= anchor.line.bbox.y) continue;
        if (!centered && (lineLane < startLane ||
          (lineLane === startLane && line.bbox.y < anchor.line.bbox.y + (anchor.synthetic ? -.5 : .5)))) continue;
        if (firstNumberedByLane.has(line.logicalLane) &&
          line.bbox.y < firstNumberedByLane.get(line.logicalLane) - .5) {
          heldOutSourceLines.push({ sourceLineId: line.sourceLineId,
            reason: "before_first_numbered_entry_in_lane" });
          continue;
        }
      }
      const text = clean(line.text);
      if (/^\d{1,3}$/.test(text) && Number(text) === page.pageNumber &&
        (line.bbox.y < page.pageSize.height * .13 || line.bbox.y > page.pageSize.height * .87)) {
        heldOutSourceLines.push({ sourceLineId: line.sourceLineId, reason: "isolated_page_number" });
        continue;
      }
      if (/^[A-Za-z]{1,2}-$/.test(text) && line.bbox.width < 20) {
        heldOutSourceLines.push({ sourceLineId: line.sourceLineId, reason: "isolated_extraction_fragment" });
        continue;
      }
      if (reset(line.text)) { stopped = true; excludedByBoundary.push({ sourceLineId: line.sourceLineId,
        reason: "semantic_section_after_references" }); break; }
      // A separated affiliation/contact block after a bibliography is not an entry.
      const previous = all.at(-1);
      if (all.length >= 3 && affiliation(line.text) &&
        (!previous || line.page !== previous.page ||
          line.bbox.y - previous.bbox.y > Math.max(18, line.bbox.height * 1.5)) &&
        !numbered(line.text)) {
        stopped = true; excludedByBoundary.push({ sourceLineId: line.sourceLineId,
          reason: "separate_affiliation_or_contact_after_references" }); break;
      }
      all.push(line);
    }
  }
  return { lines: all, excludedByBoundary, heldOutSourceLines,
    mode: all.some(line => numbered(line.text)) ? "numbered" : "unnumbered" };
}
function fragments(lines) {
  const groups = [];
  for (const line of lines) {
    let group = groups.at(-1);
    if (!group || group[0].page !== line.page || group[0].logicalLane !== line.logicalLane) {
      group = []; groups.push(group);
    }
    group.push(line);
  }
  return groups.map(group => ({ page: group[0].page, lane: group[0].logicalLane,
    bbox: box(group), sourceLineIds: group.map(line => line.sourceLineId) }));
}
function groupEntries(paper, section) {
  const entries = [], heldOut = [];
  if (!section.lines.length) return { entries, heldOut };
  let current = [], reason = null;
  const flush = () => {
    if (!current.length) return;
    if (!reason) heldOut.push({ sourceLineIds: current.map(line => line.sourceLineId),
      reason: "no_confirmed_entry_start" });
    else entries.push({ proposalId: `stage38:${hash([paper, current.map(line => line.sourceLineId)])}`,
      paper, type: "reference", sourceLineIds: current.map(line => line.sourceLineId),
      sourceText: current.map(line => clean(line.text)).join("\n"),
      spatialFragments: fragments(current), startReason: reason,
      riskFlags: [...new Set(current.slice(1).filter((line, index) =>
        line.page !== current[index].page).map(() => "cross_page_continuation"))],
      authority: "none", status: "offline_whole_entry_proposal_not_truth" });
    current = []; reason = null;
  };
  for (let index = 0; index < section.lines.length; index++) {
    const line = section.lines[index], n = numbered(line.text);
    const prior = section.lines[index - 1];
    const laneLines = section.lines.filter(item => item.page === line.page && item.logicalLane === line.logicalLane);
    const base = Math.min(...laneLines.map(item => item.bbox.x));
    const nearBase = line.bbox.x - base <= 5;
    const priorIndented = prior && prior.page === line.page && prior.logicalLane === line.logicalLane &&
      prior.bbox.x - base >= 6;
    const gap = prior && prior.page === line.page && prior.logicalLane === line.logicalLane ?
      top(line.bbox) - prior.bbox.y : Infinity;
    const newEntryGap = gap > Math.max(3.5, line.bbox.height * .35);
    const newLane = !prior || prior.page !== line.page || prior.logicalLane !== line.logicalLane;
    let start = false, basis = null;
    if (section.mode === "numbered") {
      if (n) { start = true; basis = "numbered_entry_start"; }
    } else {
      const authorLike = /^[A-ZÀ-Þ][^=]{2,}/u.test(clean(line.text)) &&
        !/^(?:doi\s*:|https?:|arxiv\s*:)/i.test(clean(line.text));
      if (index === 0 && authorLike) { start = true; basis = "section_first_author_line"; }
      else if (nearBase && authorLike && (priorIndented || newEntryGap || newLane &&
        !/^[a-z,;:)}\]]/.test(clean(line.text)))) {
        start = true; basis = priorIndented ? "hanging_indent_reset" : newEntryGap ?
          "author_line_after_entry_gap" : "author_line_at_new_lane";
      }
    }
    if (start) { flush(); current = [line]; reason = basis; }
    else current.push(line);
  }
  flush();
  return { entries, heldOut };
}
function build(inputs) {
  const frozen = inputs?.frozen;
  const diagnostic = inputs?.diagnostic;
  const papers = {}, summary = { papers: 0, pagesWithEntries: 0, entries: 0,
    memberLines: 0, heldOutLines: 0, numberedEntries: 0, unnumberedEntries: 0 };
  for (const paper of frozen.papers) {
    const pages = Object.values(frozen.pages).filter(page => page.paper === paper.paper)
      .sort((a, b) => a.pageNumber - b.pageNumber);
    const anchor = sectionAnchor(pages);
    const section = sectionLines(pages, anchor, diagnostic);
    const grouped = groupEntries(paper.paper, section);
    papers[paper.paper] = { paper: paper.paper, sourcePdfSha256: paper.sourcePdfSha256,
      anchor: anchor ? { page: anchor.pageNumber, sourceLineId: anchor.line.sourceLineId, basis: anchor.basis } : null,
      mode: section.mode, sectionSourceLineIds: section.lines.map(line => line.sourceLineId),
      excludedByBoundary: section.excludedByBoundary, heldOutSourceLines: section.heldOutSourceLines,
      entries: grouped.entries, heldOut: grouped.heldOut };
    summary.papers++;
    summary.pagesWithEntries += new Set(grouped.entries.flatMap(entry => entry.spatialFragments.map(fragment => fragment.page))).size;
    summary.entries += grouped.entries.length;
    summary.memberLines += grouped.entries.reduce((sum, entry) => sum + entry.sourceLineIds.length, 0);
    summary.heldOutLines += section.heldOutSourceLines.length +
      grouped.heldOut.reduce((sum, item) => sum + item.sourceLineIds.length, 0);
    summary[section.mode === "numbered" ? "numberedEntries" : "unnumberedEntries"] += grouped.entries.length;
  }
  return { schemaVersion: "OfflineReferenceWholeEntryProposal/v1", authority: "none",
    status: "source_only_machine_proposals_not_accepted_truth", producerInput: "stage35_frozen_source_lines_only",
    warning: "No old candidate, human frame, Geometry region or review answer is a producer input",
    summary, papers };
}
module.exports = { build, sectionAnchor, sectionLines, groupEntries, laneModel };
