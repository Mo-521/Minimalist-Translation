#!/usr/bin/env node
"use strict";

// Offline, non-authoritative region proposals from frozen source lines and
// read-only layout hints. No prior Object Candidate or human frame is input.
const crypto = require("node:crypto");
const clean = text => String(text || "").replace(/\s+/g, " ").trim();
const top = box => box.y - box.height;
const center = box => ({ x: box.x + box.width / 2, y: top(box) + box.height / 2 });
const overlapX = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
const captionLabel = /^(table|fig(?:ure)?\.?)\s+(?:\d+|[IVXLCDM]+)\s*[:.|]/i;
const id = value => crypto.createHash("sha256").update(value).digest("hex").slice(0, 20);
const bbox = lines => {
  const x = Math.min(...lines.map(line => line.bbox.x));
  const y = Math.min(...lines.map(line => top(line.bbox)));
  const right = Math.max(...lines.map(line => line.bbox.x + line.bbox.width));
  const bottom = Math.max(...lines.map(line => line.bbox.y));
  return { x, y, width: right - x, height: bottom - y };
};
function proposal(page, kind, lines, box, basis, extra = {}) {
  const ids = [...new Set(lines.map(line => line.sourceLineId))];
  return { proposalId: `stage36:${id(`${page.paper}:${page.pageNumber}:${kind}:${ids.join(":")}:${JSON.stringify(box)}`)}`,
    kind, sourceLineIds: ids, sourceText: lines.map(line => clean(line.text)).join(" "),
    frame: box, basis, authority: "none", status: "machine_proposal_not_truth", ...extra };
}
function abstractRegion(page, diagnostic, byId) {
  const anchor = diagnostic.reservedSemanticLines.find(line => line.kind === "heading_candidate" && /^abstract$/i.test(clean(line.text)));
  if (!anchor) return null;
  const heading = byId.get(anchor.sourceLineId);
  if (!heading) return null;
  const nearby = page.sourceLines.filter(line => line.coverageClass === "reviewable_content" &&
    line.bbox.y > heading.bbox.y + 2 && line.bbox.y - heading.bbox.y < 46 && clean(line.text).length > 12);
  if (!nearby.length) return null;
  // Prefer a row aligned with the actual ABSTRACT heading. A neighboring
  // column may start slightly higher; vertical-first selection misroutes it.
  const ranked = nearby.map(line => ({ line,
    alignment: overlapX(heading.bbox, line.bbox) / Math.max(1, heading.bbox.width),
    gap: line.bbox.y - heading.bbox.y }))
    .sort((a, b) => b.alignment - a.alignment || a.gap - b.gap);
  const first = ranked[0].line;
  const row = page.sourceLines.filter(line => Math.abs(line.bbox.y - first.bbox.y) < 3.5);
  const left = Math.min(...row.map(line => line.bbox.x));
  const right = Math.max(...row.map(line => line.bbox.x + line.bbox.width));
  const fullWidth = left < page.pageSize.width * .3 && right > page.pageSize.width * .7;
  const lane = fullWidth ? "full" : center(first.bbox).x < page.pageSize.width * .5 ? "left" : "right";
  const inLane = line => lane === "full" || (lane === "left" ? center(line.bbox).x < page.pageSize.width * .53 :
    center(line.bbox).x > page.pageSize.width * .47);
  const nextBoundary = diagnostic.reservedSemanticLines.filter(line => line.sourceLineId !== anchor.sourceLineId &&
    (line.kind === "heading_candidate" || /^keywords\s*:/i.test(clean(line.text))))
    .map(line => byId.get(line.sourceLineId)).filter(line => line && line.bbox.y > first.bbox.y + 8 && inLane(line))
    .sort((a, b) => a.bbox.y - b.bbox.y)[0];
  const keyword = page.sourceLines.filter(line => /^keywords\s*:/i.test(clean(line.text)) &&
    line.bbox.y > first.bbox.y + 8 && inLane(line)).sort((a, b) => a.bbox.y - b.bbox.y)[0];
  const forbidden = new Set(diagnostic.reservedSemanticLines.filter(line =>
    ["heading_candidate", "caption_start_candidate", "front_matter_pending", "reference_region_pending",
      "table_region_pending", "unsupported_structured_block_pending"].includes(line.kind))
    .map(line => line.sourceLineId));
  const endY = Math.min(nextBoundary?.bbox.y ?? Infinity, keyword?.bbox.y ?? Infinity, page.pageSize.height * .85);
  const lines = page.sourceLines.filter(line => line.coverageClass === "reviewable_content" &&
    line.bbox.y >= first.bbox.y - .5 && line.bbox.y < endY && inLane(line) && !forbidden.has(line.sourceLineId))
    .sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  if (lines.length < 2) return null;
  return proposal(page, "abstract", lines, bbox(lines),
    ["explicit_abstract_heading", "heading_aligned_first_row", "next_semantic_boundary"],
    { lane, headingSourceLineId: anchor.sourceLineId });
}
function frontMatter(page, diagnostic, byId) {
  if (page.pageNumber !== 1) return [];
  const heading = diagnostic.reservedSemanticLines.find(line => line.kind === "heading_candidate" && /^abstract$/i.test(clean(line.text)));
  const end = heading ? byId.get(heading.sourceLineId)?.bbox.y ?? page.pageSize.height * .42 : page.pageSize.height * .42;
  const pending = diagnostic.reservedSemanticLines.filter(line => line.kind === "front_matter_pending")
    .map(line => byId.get(line.sourceLineId)).filter(line => line && line.bbox.y < end);
  const metadata = /^(?:draft version|typeset using|original article|open access|received:|revised:|accepted:|funding:|keywords:)/i;
  const affiliation = /\b(?:university|department|institute|school|college|laboratory|centre|center|hospital|correspondence|email:)\b|@/i;
  const ordered = pending.filter(line => !metadata.test(clean(line.text)))
    .sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  const firstAffiliation = ordered.findIndex(line => affiliation.test(clean(line.text).replace(/^\d+\s*/, "")));
  const lines = firstAffiliation < 0 ? [] : ordered.slice(firstAffiliation).filter(line =>
    line.bbox.y - ordered[firstAffiliation].bbox.y < 75);
  if (!lines.length) return [];
  const groups = []; let group = [];
  for (const line of lines) {
    if (group.length && top(line.bbox) - group.at(-1).bbox.y > 26) { groups.push(group); group = []; }
    group.push(line);
  }
  if (group.length) groups.push(group);
  return groups.map(lines => proposal(page, "front_matter_affiliation_or_contact", lines, bbox(lines),
    ["pre_abstract_front_matter", "institution_or_contact_lexical_evidence"],
    { proposedTypeExtension: "affiliation_or_front_matter_note" }));
}
function geometryContainers(page, diagnostic, byId) {
  const captions = new Set(diagnostic.reservedSemanticLines.filter(line => line.kind === "caption_start_candidate")
    .map(line => line.sourceLineId));
  const tablePending = diagnostic.reservedSemanticLines.filter(line => line.kind === "table_region_pending")
    .map(line => byId.get(line.sourceLineId)).filter(Boolean);
  const containers = [];
  for (const hint of page.layoutHints.filter(hint => hint.kind === "table" || hint.kind === "figure")) {
    const b = hint.box;
    const inside = line => {
      const c = center(line.bbox);
      return c.x >= b.x && c.x <= b.x + b.width && c.y >= b.y && c.y <= b.y + b.height;
    };
    const labeledCaptions = page.sourceLines.filter(line => {
      const label = captionLabel.exec(clean(line.text));
      return label && (hint.kind === "table" ? /^table$/i.test(label[1]) : !/^table$/i.test(label[1])) &&
        line.bbox.y >= b.y - 25 && line.bbox.y <= b.y + b.height + 25 &&
        overlapX(line.bbox, b) > 0;
    }).sort((a, b) => a.bbox.y - b.bbox.y);
    const captionStart = labeledCaptions.find(line => line.bbox.y <= b.y + b.height * .45);
    const bottomCaption = labeledCaptions.find(line => line.bbox.y >= b.y + b.height * .7);
    const captionRows = [];
    if (captionStart) {
      captionRows.push(captionStart);
      const rows = page.sourceLines.filter(line => line.coverageClass === "reviewable_content" && inside(line) &&
        line.bbox.y > captionStart.bbox.y + .5).sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
      let previousY = captionStart.bbox.y;
      for (const line of rows) {
        if (captionRows.length && line.bbox.y - previousY > Math.max(18, captionStart.bbox.height * 1.7)) break;
        if (captionRows.length && /^(?:model|metric|component|parameter|method|time-to-go|value of|α\s*=)/i.test(clean(line.text))) break;
        captionRows.push(line);
        previousY = line.bbox.y;
      }
    }
    const captionIds = new Set(captionRows.map(line => line.sourceLineId));
    const afterCaption = captionRows.length ? Math.max(...captionRows.map(line => line.bbox.y)) + 2 : b.y;
    const pending = hint.kind === "table" ? tablePending.filter(line => inside(line) && line.bbox.y > afterCaption &&
      !captionIds.has(line.sourceLineId)) : [];
    const startY = pending.length ? Math.max(b.y, Math.min(...pending.map(line => top(line.bbox))) - 4) :
      Math.max(b.y, afterCaption);
    const bottomY = bottomCaption && bottomCaption !== captionStart ?
      Math.min(b.y + b.height, top(bottomCaption.bbox) - 3) : b.y + b.height;
    const frame = { x: b.x, y: startY, width: b.width, height: Math.max(0, bottomY - startY) };
    if (frame.height <= 0) continue;
    const heldOut = [];
    const textLines = page.sourceLines.filter(line => {
      const c = center(line.bbox);
      if (!(c.x >= frame.x && c.x <= frame.x + frame.width && c.y >= frame.y && c.y <= frame.y + frame.height)) return false;
      const text = clean(line.text);
      const furniture = /^\d{1,3}$/.test(text) && Number(text) === page.pageNumber &&
        (c.y < page.pageSize.height * .13 || c.y > page.pageSize.height * .87) &&
        (c.x < page.pageSize.width * .15 || c.x > page.pageSize.width * .85);
      const edgeProse = hint.kind === "figure" && c.y - frame.y < Math.max(25, frame.height * .1) &&
        text.split(/\s+/).length >= 7 && line.bbox.width > frame.width * .4;
      if (furniture || edgeProse) heldOut.push({ sourceLineId: line.sourceLineId,
        reason: furniture ? "possible_page_furniture" : "prose_at_geometry_prior_edge" });
      return !furniture && !edgeProse && !captions.has(line.sourceLineId) && !captionIds.has(line.sourceLineId) &&
        !captionLabel.test(text);
    }).sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
    const numericRows = textLines.filter(line => (clean(line.text).match(/\d+(?:\.\d+)?/g) || []).length >= 2).length;
    const evidence = { geometryPrior: true, captionLabelNearby: Boolean(captionStart || bottomCaption),
      numericDenseRows: numericRows, sparseTableClusterLines: pending.length };
    const tableEvidenceSufficient = hint.kind === "table" &&
      (pending.length >= 2 || numericRows >= 2) &&
      (evidence.captionLabelNearby || numericRows >= 4);
    containers.push(proposal(page, hint.kind, textLines, frame,
      ["read_only_geometry_region", ...(pending.length ? ["table_sparse_line_cluster"] : [])],
      { geometryPriorId: hint.regionId, geometryAuthority: "prior_only", internalTextIsMemberOnly: true,
        captionSeparate: true, evidence, reviewReadiness: tableEvidenceSufficient ?
          "candidate_evidence_sufficient_but_visual_unverified" : "diagnostic_only",
        heldOutSourceLines: heldOut }));
  }
  return containers;
}
function structuredContainers(page, diagnostic, byId) {
  const lines = diagnostic.reservedSemanticLines.filter(line => line.kind === "unsupported_structured_block_pending")
    .map(line => byId.get(line.sourceLineId)).filter(Boolean);
  const groups = new Map();
  for (const line of lines) {
    const lane = line.column || "unknown";
    if (!groups.has(lane)) groups.set(lane, []);
    groups.get(lane).push(line);
  }
  const proposals = [];
  for (const [lane, items] of groups) {
    items.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
    let group = [];
    const flush = () => {
      if (group.length) proposals.push(proposal(page, "unsupported_structured_block", group, bbox(group),
        ["structured_dump_pattern", "not_assumed_table"], { lane }));
      group = [];
    };
    for (const line of items) {
      if (group.length && top(line.bbox) - group.at(-1).bbox.y > 35) flush();
      group.push(line);
    }
    flush();
  }
  return proposals;
}
function build(inputs) {
  const frozen = inputs?.frozen;
  const boundaries = inputs?.boundaries;
  if (!frozen?.pages || !boundaries?.pages) throw Error("Source pages and boundary proposals required");
  const pages = {};
  const totals = { pages: 0, abstracts: 0, frontMatter: 0, tables: 0, figures: 0, unsupported: 0 };
  for (const [key, page] of Object.entries(frozen.pages)) {
    const diagnostic = boundaries.pages[key];
    if (!diagnostic) throw Error(`missing source-only boundary page ${key}`);
    const byId = new Map(page.sourceLines.map(line => [line.sourceLineId, line]));
    const abstract = abstractRegion(page, diagnostic, byId);
    const front = frontMatter(page, diagnostic, byId);
    const geometry = geometryContainers(page, diagnostic, byId);
    const structured = structuredContainers(page, diagnostic, byId);
    pages[key] = { paper: page.paper, pageNumber: page.pageNumber, sourcePdfSha256: page.sourcePdfSha256,
      abstract: abstract ? [abstract] : [], frontMatter: front,
      tables: geometry.filter(item => item.kind === "table"), figures: geometry.filter(item => item.kind === "figure"),
      unsupportedStructuredBlocks: structured };
    totals.pages++;
    totals.abstracts += pages[key].abstract.length;
    totals.frontMatter += front.length;
    totals.tables += pages[key].tables.length;
    totals.figures += pages[key].figures.length;
    totals.unsupported += structured.length;
  }
  return { schemaVersion: "OfflineSemanticRegionProposal/v1", authority: "none", status: "machine_proposal_not_truth",
    input: "stage35/FROZEN_INPUT.json + SOURCE_ONLY_PAGE_BOUNDARIES.json",
    warnings: ["Geometry hints are spatial priors, not Structure truth", "Human rectangles do not determine source-line membership",
      "This is not a complete all-type StructuralObjectCandidate or promotion gate"], totals, pages };
}
module.exports = { build, abstractRegion, frontMatter, geometryContainers, structuredContainers, captionLabel };
