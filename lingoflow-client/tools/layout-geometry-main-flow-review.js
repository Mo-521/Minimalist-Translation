#!/usr/bin/env node
"use strict";

// Isolated offline Body revision. The human draft is comparison evidence, never
// an input to predictPage(). No oracle, pool, Column truth, or runtime is written.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const source = require("./layout-geometry-candidate-intake");

const ROOT = path.resolve(__dirname, "../..");
const APP = path.join(ROOT, "lingoflow-client", "electron-app");
const EVIDENCE = path.join(ROOT, ".governance", "archive", "evidence", "layout-geometry-capability-audit", "evidence", "phase-2-paper-geometry");
const INPUT = path.join(EVIDENCE, "human-review-body-editable-v1");
const OUTPUT = path.join(EVIDENCE, "human-review-main-flow-v1");
const COLUMN_CORPUS = path.join(APP, "capability-library", "capabilities", "cap.column-recognition", "corpus.json");
const PAPERS = Array.from({ length: 7 }, (_, index) => `paper${index + 1}`);
const EDGE = 2.5;
const round = (number) => Math.round(number * 100) / 100;
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const escaped = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const box = (x, y, width, height) => ({ x: round(x), y: round(y), width: round(width), height: round(height) });
const bottom = (rect) => rect.y + rect.height;
const right = (rect) => rect.x + rect.width;
const textOf = (line) => String(line.text || "").replace(/\s+/g, " ").trim();
const words = (line) => textOf(line).split(/\s+/).filter(Boolean).length;
const sectionHeading = (line) => /^(?:\d+(?:\.\d+)*[.)]?\s+)?(?:introduction|background|methods?|results?|discussion|conclusions?)\b/i.test(textOf(line)) && words(line) <= 10;
const metadata = (line) => /^(?:key\s*words?|index terms|correspondence|received|revised|accepted|funding|copyright)\s*[:.]/i.test(textOf(line));
const citationLead = (line) => /^\s*(?:\[\d+\]|\d+[.)])\s+/.test(textOf(line));
const mathLine = (line) => /[=<>∑∫√≈≤≥±µμσλ∂]/.test(textOf(line));
const proseLine = (line) => words(line) >= 3 && line.width >= 36 && line.maxFont <= 14.5;

function latestReviewDraft(paperKey) {
  const prefix = `${paperKey}-body-ground-truth-draft`;
  const choices = fs.readdirSync(INPUT).filter((name) => name === `${prefix}.json`
    || new RegExp(`^${prefix} \\(\\d+\\)\\.json$`).test(name))
    .map((name) => ({ name, path: path.join(INPUT, name), mtime: fs.statSync(path.join(INPUT, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));
  if (!choices.length) throw new Error(`No exported Body review draft for ${paperKey}`);
  return choices[0];
}

function union(rects) {
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  return box(x, y, Math.max(...rects.map(right)) - x, Math.max(...rects.map(bottom)) - y);
}

function hasCenterIn(rect, zone) {
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  return x >= zone.x && x <= right(zone) && y >= zone.y && y <= bottom(zone);
}

function paddedContent(lines, pageSize, horizontal = EDGE) {
  if (!lines.length) return null;
  const tight = union(lines);
  const x = Math.max(0, tight.x - horizontal);
  const y = Math.max(0, tight.y - EDGE);
  return box(x, y, Math.min(pageSize.width, right(tight) + horizontal) - x, Math.min(pageSize.height, bottom(tight) + EDGE) - y);
}

function readingLines(page) {
  return source.groupLines(page.items).filter((line) => {
    const text = textOf(line);
    if (!text || /^\d{1,4}$/.test(text) || /(?:downloaded from|https?:\/\/)/i.test(text)) return false;
    if (source.isHeaderLikeLine(line, page) || source.isFooterLikeLine(line, page)) return false;
    return line.y >= page.pageSize.height * 0.045 && bottom(line) <= page.pageSize.height * 0.96;
  }).sort((a, b) => a.y - b.y || a.x - b.x);
}

function laneReadingLines(page, wall) {
  // Group text after assigning PDF spans to their frozen Column lane. Grouping
  // the whole page first can fuse a left-column tail with a right-column head
  // into one false full-width line, hiding both from the lane flow.
  const items = page.items.filter((item) => {
    const center = item.x + item.width / 2;
    return center >= wall.x && center <= right(wall) && item.width <= wall.width * 1.14;
  });
  return source.groupLines(items).filter((line) => {
    const text = textOf(line);
    if (!text || /^\d{1,4}$/.test(text)) return false;
    if (source.isFooterLikeLine(line, page)) return false;
    if (/(?:downloaded from|https?:\/\/)/i.test(text) && line.y < page.pageSize.height * 0.08) return false;
    return line.y >= page.pageSize.height * 0.025 && bottom(line) <= page.pageSize.height * 0.96;
  }).sort((a, b) => a.y - b.y || a.x - b.x);
}

function restartHeading(line, page) {
  const text = textOf(line);
  const explicitAppendix = /^(?:supplementary|supplemental)\s+material\s*$/i.test(text)
    || /^appendix(?:\s+[A-Z])?(?:\s*[:.])?$/i.test(text)
    || /^proofs\s*$/i.test(text)
    || /^[A-Z](?:\.\d+)*\s+(?:proofs?|appendix|supplementary|supplemental)\b/i.test(text);
  if (explicitAppendix) return words(line) <= 12 && line.width <= page.pageSize.width * 0.7;
  if (line.y > page.pageSize.height * 0.45) return false;
  return false;
}

function referenceBoundary(extracted) {
  let start = null;
  for (const page of extracted.pages) {
    const lines = readingLines(page);
    if (start) {
      const resume = lines.find((line) => restartHeading(line, page));
      if (resume) return { ...start, resumePageNumber: page.pageNumber, resumeY: bottom(resume) + 4 };
      continue;
    }
    const heading = lines.find(source.isReferencesHeadingLine);
    const following = heading ? lines.filter((line) => line.y > heading.y && line.y < heading.y + page.pageSize.height * 0.24) : [];
    if (heading && (following.filter(citationLead).length >= 2 || page.pageNumber >= Math.ceil(extracted.pageCount * 0.6))) {
      start = { pageNumber: page.pageNumber, y: heading.y, x: heading.x, width: heading.width };
      continue;
    }
    // Some journals start the bibliography after a rule without a heading.
    // Require several numbered citation leads in the bottom reading flow;
    // ordinary numbered section headings do not satisfy this density gate.
    const leads = lines.filter((line) => citationLead(line) && line.y > page.pageSize.height * 0.3);
    if (page.pageNumber >= Math.ceil(extracted.pageCount * 0.55) && leads.length >= 5) {
      const tail = lines.filter((line) => line.y >= leads[0].y);
      const citationSignals = tail.filter((line) => /(?:\b(?:19|20)\d{2}\b|arxiv|journal|doi|\bvol\b)/i.test(textOf(line))).length;
      if (citationSignals >= 3) start = { pageNumber: page.pageNumber, y: leads[0].y, x: leads[0].x, width: leads[0].width };
    }
  }
  return start;
}

function captionFlowSegments(page, lines) {
  const starters = lines.filter((line) => /^(?:(?:figure|fig\.?)\s*\d+|table\s*(?:\d+|[ivxlcdm]+))\s*[.:|—-]/i.test(textOf(line)));
  const claimed = new Set();
  return starters.map((start) => {
    const block = [start];
    claimed.add(start);
    let edge = bottom(start);
    for (const line of lines) {
      if (line.y < edge - 0.5 || line.y - edge > 9 || claimed.has(line)) continue;
      // Caption typography is usually smaller than the following prose. A
      // same-column paragraph may begin only a few points below a caption;
      // whitespace alone cannot be its ownership boundary.
      if (line.maxFont > start.maxFont + 0.75 || sectionHeading(line) || metadata(line)
        || /^(?:(?:figure|fig\.?)\s*\d+|table\s*(?:\d+|[ivxlcdm]+))\s*[.:|—-]/i.test(textOf(line))) continue;
      if (Math.abs(line.x - start.x) > page.pageSize.width * 0.2) continue;
      block.push(line); claimed.add(line); edge = bottom(line);
      // A caption can run across substantially more than four lines. Cutting
      // it here made the remaining caption tail look like the top of Body.
      if (block.length >= 16) break;
    }
    return { geometry: paddedContent(block, page.pageSize, 3), lineCount: block.length };
  }).filter((segment) => segment.geometry.width >= 40);
}

function denseTableTextHints(page, lines, drawnVisuals) {
  const captions = lines.filter((line) => /^table\s*\d+\s*[.:|—-]/i.test(textOf(line)));
  return captions.map((caption) => {
    const sameRowTail = lines.filter((line) => line !== caption
      && Math.abs(line.y - caption.y) <= 1.2
      && line.x >= right(caption) && line.x - right(caption) <= 12
      && Math.abs(line.maxFont - caption.maxFont) <= 0.5);
    const captionSpan = union([caption, ...sameRowTail]);
    const nextCaption = captions.find((line) => line.y > caption.y + 3);
    const limitY = Math.min(caption.y + page.pageSize.height * 0.45,
      nextCaption ? nextCaption.y - 3 : page.pageSize.height);
    // A one-column table may sit alongside ordinary prose in the other lane.
    // Restrict row evidence to the caption's horizontal footprint before
    // building density rows; otherwise neighboring prose makes a false
    // full-width table barrier that swallows the other Body column.
    const nearby = lines.filter((line) => line.y > caption.y + 8
      && line.y < limitY
      && line.x >= caption.x - 12
      && (line.x <= right(captionSpan) + 8 || line.maxFont <= caption.maxFont - 1.4));
    const rows = [];
    nearby.forEach((line) => {
      let row = rows.find((item) => Math.abs(item.y - line.y) <= 2.5);
      if (!row) { row = { y: line.y, lines: [] }; rows.push(row); }
      row.lines.push(line);
    });
    const dense = rows.filter((row) => row.lines.length >= 3
      || (row.lines.length >= 2 && row.lines.some((line) => line.width < 80)
        && row.lines.some((line) => line.width > 80)));
    if (dense.length < 2) return null;
    let edge = bottom(caption);
    const priorRowFonts = [];
    for (const row of dense.sort((a, b) => a.y - b.y)) {
      if (row.y - edge > (edge === bottom(caption) ? 55 : 35)) break;
      const fonts = row.lines.map((line) => line.maxFont).sort((a, b) => a - b);
      const rowFont = fonts[Math.floor(fonts.length / 2)];
      // A PDF may split two ordinary prose columns into many fragments on
      // the same baseline. Once smaller tabular rows are established, a
      // materially larger prose row is the table's lower boundary.
      const stableFonts = priorRowFonts.slice(-3).sort((a, b) => a - b);
      const stableFont = stableFonts[Math.floor(stableFonts.length / 2)];
      if (stableFonts.length >= 3 && rowFont > stableFont + 1.5
        && row.lines.some(proseLine)) break;
      edge = Math.max(edge, ...row.lines.map(bottom));
      priorRowFonts.push(rowFont);
    }
    if (edge - caption.y < 35) return null;
    const tableNotes = [];
    const noteStart = lines.find((line) => line.y > edge && line.y - edge <= 24
      && /^(?:notes?)\s*[—:.-]/i.test(textOf(line)));
    if (noteStart) {
      tableNotes.push(noteStart);
      let noteEdge = bottom(noteStart);
      for (const line of lines) {
        if (line.y <= noteStart.y || line.y - noteEdge > 8) continue;
        if (line.maxFont > noteStart.maxFont + 0.75) break;
        tableNotes.push(line);
        noteEdge = Math.max(noteEdge, bottom(line));
        if (tableNotes.length >= 5) break;
      }
      edge = Math.max(edge, ...tableNotes.map(bottom));
    }
    const rowLines = [...dense.filter((row) => row.y <= edge).flatMap((row) => row.lines), ...tableNotes];
    const left = Math.max(0, Math.min(captionSpan.x, ...rowLines.map((line) => line.x)) - 3);
    const rightEdge = Math.min(page.pageSize.width, Math.max(right(captionSpan), ...rowLines.map(right)) + 3);
    const base = box(left, caption.y - 2, rightEdge - left, edge - caption.y + 5);
    // A graphic immediately following a tabular text band remains the same
    // non-anchor stretch even when its own semantic class is unknown.
    const following = drawnVisuals.filter((visual) => visual.y <= bottom(base) + 70
      && bottom(visual) > bottom(base) && visual.width > page.pageSize.width * 0.4);
    return following.length ? box(0, base.y, page.pageSize.width, Math.max(...following.map(bottom)) - base.y) : base;
  }).filter(Boolean);
}

function abstractFlow(page, lines, partition) {
  if (page.pageNumber !== 1) return null;
  const labelIndex = lines.findIndex((line) => /^abstract\s*[:.]?$/i.test(textOf(line)));
  if (labelIndex < 0) return null;
  const label = lines[labelIndex];
  const stop = lines.slice(labelIndex + 1).find((line) => (metadata(line) || sectionHeading(line)) && line.y > label.y + 12);
  const limit = stop ? stop.y : page.pageSize.height * 0.61;
  const content = lines.filter((line) => line.y >= label.y - 3 && line.y < limit && !metadata(line) && line.maxFont <= 15);
  if (content.length < 3) return null;
  const tight = union(content);
  const laneWidth = partition.layout === "double_column" ? partition.lanes.left.width : partition.lanes.single.width;
  // A true spanning abstract has PDF text spans crossing the gutter. A page-
  // global line assembled from two ordinary columns is not that evidence.
  if (partition.layout === "double_column") {
    const crossing = page.items.filter((item) => item.y >= label.y - 3 && item.y < limit
      && item.x < partition.gutterMid - 10 && item.x + item.width > partition.gutterMid + 10
      && item.width > page.pageSize.width * 0.5);
    if (crossing.length < 2) return null;
  }
  // A wide textual abstract is a reading-flow segment, not a semantic blocker.
  if (tight.width < Math.max(page.pageSize.width * 0.56, laneWidth * 1.13)) return null;
  return { geometry: paddedContent(content, page.pageSize, 3), endY: bottom(tight), lineCount: content.length };
}

function wideFlowSegments(page, lines, partition, abstract, captions = []) {
  if (partition.layout !== "double_column") return [];
  const middle = partition.gutterMid;
  const spans = lines.filter((line) => line.x < middle - 10 && right(line) > middle + 10
    && line.width >= page.pageSize.width * 0.53 && line.maxFont <= 14.5
    && words(line) >= 3 && !metadata(line) && !source.isReferencesHeadingLine(line)
    && !captions.some((caption) => hasCenterIn(line, caption.geometry))
    && (page.pageNumber !== 1 || !abstract || line.y >= abstract.endY + 4)
    && (!abstract || !hasCenterIn(line, abstract.geometry)));
  const groups = [];
  spans.forEach((line) => {
    const last = groups[groups.length - 1];
    // On the first page, a title/author/affiliation preamble can sit only a
    // little above a real abstract. Keep its larger inter-block whitespace
    // from joining two semantically different text stretches.
    const maxGap = page.pageNumber === 1 ? 12 : 20;
    if (last && line.y - bottom(last[last.length - 1]) <= maxGap) last.push(line);
    else groups.push([line]);
  });
  // A lone across-gutter line can be a title, an acknowledgement, or PDF text
  // order joining two columns. Require a multi-line flow instead.
  return groups.filter((group) => group.length >= (page.pageNumber === 1 ? 3 : 2))
    .map((group) => ({ geometry: paddedContent(group, page.pageSize, 3), lineCount: group.length }));
}

function firstPageLaneStart(page, lines, abstract) {
  if (page.pageNumber !== 1) return 0;
  if (abstract) {
    const laterHeading = lines.find((line) => sectionHeading(line) && line.y > abstract.endY + 5);
    return laterHeading ? laterHeading.y - 4 : abstract.endY + 5;
  }
  const abstractLabel = lines.find((line) => /^abstract\s*[:.]?$/i.test(textOf(line)));
  // The Abstract label names the region; its readable paragraph is the first
  // main-flow evidence. A heading inside an established Body frame may still
  // remain there, but a standalone front-matter label cannot anchor its top.
  if (abstractLabel) return bottom(abstractLabel) + 1;
  const heading = lines.find((line) => sectionHeading(line) && line.y > page.pageSize.height * 0.12);
  if (heading) return heading.y - 4;
  const large = lines.filter((line) => line.y < page.pageSize.height * 0.35 && line.maxFont > 15.5);
  return large.length ? Math.max(...large.map(bottom)) + 6 : page.pageSize.height * 0.14;
}

function laneBody(page, lines, lane, wall, top, end, wideSegments, visualObjects, panels, singleLane, structuralObjects = []) {
  let candidates = lines.filter((line) => {
    const centerX = line.x + line.width / 2;
    if (centerX < wall.x || centerX > right(wall) || line.width > lane.width * 1.14) return false;
    if (line.y < top || line.y >= end || metadata(line) || source.isReferencesHeadingLine(line)) return false;
    if (wideSegments.some((region) => hasCenterIn(line, region.geometry))) return false;
    // Bibliography entries are outside the main flow until an explicit
    // continuation anchor resumes it. Figure/table regions only block a
    // leading run below: a trailing object's coarse box may overlap genuine
    // prose or formula and must not silently truncate an established frame.
    if (structuralObjects.some((object) => object.objectType === "reference_entries"
      && hasCenterIn(line, object.geometry))) return false;
    // Broad graphic/table clusters are not reliable extent anchors. Their
    // presence never splits prose already established on both sides.
    const coveringVisuals = visualObjects.filter((rect) => hasCenterIn(line, rect));
    if (coveringVisuals.length) {
      if (coveringVisuals.some((rect) => rect.hintKind === "dense_table")) return false;
      // PDF drawing groups can over-connect a table to adjacent prose. A
      // sustained normal-size text line in its frozen lane remains Body
      // evidence even when that coarse graphics rectangle crosses it.
      const readableLaneProse = line.maxFont >= 10.4 && words(line) >= 3
        && line.width >= lane.width * 0.45;
      if (!readableLaneProse) return false;
    }
    return true;
  });
  const laneOverlap = (object) => Math.max(0, Math.min(right(object.geometry), right(lane))
    - Math.max(object.geometry.x, lane.x));
  const localObjects = structuralObjects.filter((object) => laneOverlap(object) >= lane.width * 0.28)
    .sort((a, b) => a.geometry.y - b.geometry.y);
  const firstCandidateY = candidates.length ? Math.min(...candidates.map((line) => line.y)) : Infinity;
  const leadingObject = localObjects.find((object) => ["figure", "table"].includes(object.objectType)
    && object.geometry.height >= 25 && object.geometry.y <= firstCandidateY + 5);
  let leadingCaption = null;
  if (leadingObject) {
    let blockedUntil = bottom(leadingObject.geometry);
    for (const object of localObjects) {
      if (object.geometry.y < leadingObject.geometry.y - 5 || object.geometry.y > blockedUntil + 45) continue;
      if (["figure", "table", "figure_caption"].includes(object.objectType)) {
        blockedUntil = Math.max(blockedUntil, bottom(object.geometry));
        if (object.objectType === "figure_caption") leadingCaption = object.geometry;
      }
    }
    candidates = candidates.filter((line) => line.y >= blockedUntil + 4);
  }
  // Main reading-flow evidence includes prose, formula, code, and section
  // headings. Semantic ownership is intentionally deferred to later layers.
  const anchors = candidates.filter((line) => line.width >= 28 && line.height >= 3
    && (line.maxFont <= 18 || sectionHeading(line)));
  // One isolated running title or author name before References is not a
  // trustworthy reading-flow extent. Real short Body tails still have at
  // least two successive lines (including formula lines).
  if (anchors.length < 2) return null;
  const firstY = Math.min(...anchors.map((line) => line.y));
  const lastY = Math.max(...anchors.map(bottom));
  const attached = candidates.filter((line) => mathLine(line) && line.y >= firstY - 24 && bottom(line) <= lastY + 24);
  // PDF equations are often emitted as many short glyph fragments. Once an
  // equation has a credible math anchor inside Body, include its nearby tail
  // glyphs as real content evidence; do not replace this with a page-bottom
  // or lane-bottom fallback.
  const mathAnchors = candidates.filter((line) => mathLine(line) && line.y >= lastY - 45 && line.y <= lastY + 18);
  const equationTail = mathAnchors.length ? candidates.filter((line) => line.y > lastY - 3
    && bottom(line) <= lastY + 32 && line.width >= 3 && line.maxFont <= 12
    && mathAnchors.some((anchor) => Math.abs(line.y - anchor.y) <= 35)) : [];
  // A text-rich ruled panel is content geometry, not empty decoration. Include
  // its actual border when the same lane has several readable lines inside.
  const textPanels = panels.filter((panel) => panel.width >= 40 && panel.height >= 20
    && panel.width <= lane.width * 1.1 && panel.height <= page.pageSize.height * 0.45
    && panel.x < right(wall) && right(panel) > wall.x
    && candidates.filter((line) => hasCenterIn(line, panel)).length >= 3);
  const evidence = [...anchors, ...attached, ...equationTail, ...textPanels];
  const tight = union(evidence);
  // A clear whitespace gap after a leading caption can include a modest
  // paragraph-top safety band. Scale it to the first real line, and never let
  // it reach the caption itself. Ordinary close-set captions get no expansion.
  const captionGap = leadingCaption === null ? 0 : tight.y - bottom(leadingCaption);
  const firstLineHeight = anchors.find((line) => line.y === firstY)?.height || 0;
  const captionSafety = leadingCaption?.height >= 80 && captionGap >= firstLineHeight * 2
    ? Math.min(firstLineHeight * 0.6, captionGap / 3) : 0;
  const y = Math.max(0, tight.y - EDGE - captionSafety);
  const maxY = Math.min(page.pageSize.height, bottom(tight) + EDGE);
  if (maxY - y < 5) return null;
  if (singleLane && anchors.length >= 3 && tight.width < lane.width * 0.68) {
    const x = Math.max(0, tight.x - EDGE);
    return box(x, y, Math.min(page.pageSize.width, right(tight) + EDGE) - x, maxY - y);
  }
  return box(lane.x, y, lane.width, maxY - y);
}

// PDF text order can join the tail of one column to the head of the other.
// Such cross-gutter lines must not create a stack of tiny "wide" Body boxes
// inside an otherwise continuous lane reading flow. Keep genuinely detached
// wide stretches (for example a first-page abstract) as separate frames.
function coalesceFlowFrames(frames, pageSize) {
  const lanes = frames.filter((frame) => frame.canonicalColumnId !== null);
  const loose = frames.filter((frame) => frame.canonicalColumnId === null)
    .sort((a, b) => b.geometry.height - a.geometry.height);
  const detached = [];
  for (const segment of loose) {
    // A genuinely spanning abstract remains its own reading area. All other
    // loose text that sits inside a continuous lane is redundant there.
    if (segment.evidence.kind === "abstract-reading-flow") {
      detached.push(segment);
      continue;
    }
    const overlapping = lanes.filter((lane) => segment.geometry.y <= bottom(lane.geometry) + 12
      && bottom(segment.geometry) >= lane.geometry.y - 12);
    if (!overlapping.length) {
      const duplicate = detached.some((other) => {
        const overlapY = Math.max(0, Math.min(bottom(segment.geometry), bottom(other.geometry))
          - Math.max(segment.geometry.y, other.geometry.y));
        const overlapX = Math.max(0, Math.min(right(segment.geometry), right(other.geometry))
          - Math.max(segment.geometry.x, other.geometry.x));
        const smaller = Math.min(segment.geometry.width * segment.geometry.height,
          other.geometry.width * other.geometry.height);
        return smaller > 0 && overlapX * overlapY / smaller > 0.75;
      });
      if (!duplicate) detached.push(segment);
      continue;
    }
    // A page-global line assembled across two columns can be dropped from one
    // local lane. If it joins one established lane, bridge the neighboring
    // lane only across a small vertical gap, never from a detached block.
    const nearby = lanes.filter((lane) => segment.geometry.y <= bottom(lane.geometry) + 35
      && bottom(segment.geometry) >= lane.geometry.y - 35);
    for (const lane of nearby) {
      const y = Math.max(0, Math.min(lane.geometry.y, segment.geometry.y));
      const end = Math.min(pageSize.height, Math.max(bottom(lane.geometry), bottom(segment.geometry)));
      lane.geometry = box(lane.geometry.x, y, lane.geometry.width, end - y);
    }
  }
  return [...detached, ...lanes];
}

function predictPage(page, column, model, referenceStart, visualObjects = [], panels = [], structuralObjects = []) {
  const partition = source.columnPartition(page, column.layout, model);
  const lines = readingLines(page);
  const result = [];
  if (referenceStart && page.pageNumber > referenceStart.pageNumber
    && (!referenceStart.resumePageNumber || page.pageNumber < referenceStart.resumePageNumber)) return result;
  const end = referenceStart && page.pageNumber === referenceStart.pageNumber ? referenceStart.y : page.pageSize.height;
  const abstract = abstractFlow(page, lines, partition);
  const captions = captionFlowSegments(page, lines).filter((segment) => segment.geometry.y < end);
  const wideSegments = wideFlowSegments(page, lines, partition, abstract, captions)
    .filter((segment) => segment.geometry.y < end)
    .filter((segment) => {
      // PDF line grouping sometimes joins two ordinary columns into several
      // apparent gutter-crossing lines. If both canonical lanes independently
      // contain a sustained local prose flow at this height, retain the lane
      // frames instead of inventing a page-wide Body box.
      const localCount = (side) => laneReadingLines(page, partition.walls[side])
        .filter((line) => line.y >= segment.geometry.y - 5
          && line.y <= bottom(segment.geometry) + 5 && proseLine(line)).length;
      return localCount("left") < 2 || localCount("right") < 2;
    });
  const blockers = structuralObjects.filter((object) => object && object.geometry
    && ["figure", "table", "figure_caption", "reference_entries"].includes(object.objectType));
  if (abstract && abstract.geometry.y < end) result.push({ id: `p${page.pageNumber}.main-flow.wide.1`, canonicalColumnId: null, geometry: abstract.geometry, evidence: { kind: "abstract-reading-flow", lineCount: abstract.lineCount } });
  wideSegments.forEach((segment, index) => result.push({ id: `p${page.pageNumber}.main-flow.wide.${index + (abstract ? 2 : 1)}`, canonicalColumnId: null, geometry: segment.geometry, evidence: { kind: "wide-reading-flow", lineCount: segment.lineCount } }));
  // Captions delimit Body evidence here; they are not Body candidates. Their
  // independent-region geometry belongs to the later non-Body review layer.
  const firstPageAbstractTop = page.pageNumber === 1 && partition.layout === "double_column"
    ? Math.min(...structuralObjects.filter((object) => object.objectType === "abstract")
      .map((object) => object.geometry.y - 8), Infinity)
    : 0;
  const top = Math.max(firstPageLaneStart(page, lines, abstract),
    Number.isFinite(firstPageAbstractTop) ? firstPageAbstractTop : 0,
    referenceStart && page.pageNumber === referenceStart.resumePageNumber ? referenceStart.resumeY : 0);
  const lanes = column.layout === "double_column" ? ["left", "right"] : ["single"];
  lanes.forEach((columnId) => {
    let laneEnd = end;
    if (referenceStart && page.pageNumber === referenceStart.pageNumber
      && partition.layout === "double_column") {
      const referenceLane = referenceStart.x < partition.gutterMid
        && referenceStart.x + referenceStart.width > partition.gutterMid ? "full"
        : referenceStart.x < partition.gutterMid ? "left" : "right";
      if (referenceLane === "right" && columnId === "left") laneEnd = page.pageSize.height;
    }
    let wall = partition.walls[columnId];
    let lane = partition.lanes[columnId];
    // A page may contain one surviving Body lane plus a bibliography in the
    // other physical lane. Column Truth is correctly single *for Body flow*,
    // but that must not turn its remaining frame into a page-wide rectangle.
    if (columnId === "single" && referenceStart && page.pageNumber === referenceStart.pageNumber
      && model?.columnGeometry?.left && model?.columnGeometry?.right) {
      const physical = model.columnGeometry;
      const mid = (physical.left.x + physical.left.width + physical.right.x) / 2;
      const referenceSide = referenceStart.x < mid ? "left" : "right";
      const opposite = referenceSide === "left" ? "right" : "left";
      const priorReferences = blockers.some((object) => object.objectType === "reference_entries"
        && object.geometry.y < referenceStart.y
        && object.geometry.x + object.geometry.width / 2 > (referenceSide === "left" ? mid : 0)
        && (referenceSide === "left" || object.geometry.x + object.geometry.width / 2 < mid));
      if (priorReferences) {
        lane = box(physical[referenceSide].x, 0, physical[referenceSide].width, page.pageSize.height);
        wall = referenceSide === "left"
          ? box(0, 0, mid, page.pageSize.height)
          : box(mid, 0, page.pageSize.width - mid, page.pageSize.height);
      }
    }
    const localLines = laneReadingLines(page, wall);
    const geometry = laneBody(page, localLines, lane, wall, top, laneEnd,
      [...wideSegments, ...captions, ...(abstract ? [abstract] : [])], visualObjects, panels,
      columnId === "single", blockers);
    if (geometry) result.push({ id: `p${page.pageNumber}.main-flow.${columnId}.1`, canonicalColumnId: columnId, geometry, evidence: { kind: "lane-reading-flow" } });
  });
  return coalesceFlowFrames(result, page.pageSize);
}

function setIou(left, right, size) {
  const step = 4;
  let intersection = 0, unionArea = 0;
  for (let y = step / 2; y < size.height; y += step) {
    for (let x = step / 2; x < size.width; x += step) {
      const inLeft = left.some((item) => x >= item.geometry.x && x < rightEdge(item.geometry) && y >= item.geometry.y && y < bottom(item.geometry));
      const inRight = right.some((item) => x >= item.geometry.x && x < rightEdge(item.geometry) && y >= item.geometry.y && y < bottom(item.geometry));
      if (inLeft && inRight) intersection++;
      if (inLeft || inRight) unionArea++;
    }
  }
  return unionArea ? round(intersection / unionArea) : 1;
}
const rightEdge = right;

function correctedCoverage(candidate, corrected, size) {
  const step = 4;
  let expected = 0, covered = 0;
  for (let y = step / 2; y < size.height; y += step) {
    for (let x = step / 2; x < size.width; x += step) {
      if (!corrected.some((item) => x >= item.geometry.x && x < right(item.geometry)
        && y >= item.geometry.y && y < bottom(item.geometry))) continue;
      expected++;
      if (candidate.some((item) => x >= item.geometry.x && x < right(item.geometry)
        && y >= item.geometry.y && y < bottom(item.geometry))) covered++;
    }
  }
  return expected ? round(covered / expected) : 1;
}

function svgBoxes(items, className, label) {
  return items.map((item, index) => {
    const rect = item.geometry;
    return `<g class="${className}"><rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}"/><text x="${rect.x + 2}" y="${Math.max(9, rect.y - 2)}">${label}${index + 1}</text></g>`;
  }).join("");
}

function reviewHtml(paperKey, sourceSha, rows, rasterDir) {
  const articles = rows.map((row) => {
    const file = path.join(rasterDir, `p${String(row.pageNumber).padStart(3, "0")}.jpg`);
    const image = `data:image/jpeg;base64,${fs.readFileSync(file).toString("base64")}`;
    const old = svgBoxes(row.predicted, "old", "旧");
    const candidate = svgBoxes(row.candidate, "new", "新");
    const corrected = svgBoxes(row.corrected, "human", "人工");
    return `<article id="p${row.pageNumber}"><header><h2>${paperKey} · p${row.pageNumber}</h2><span>${row.confirmed ? "人工已确认" : "人工未确认"} · IoU 旧 ${row.comparison.oldIou.toFixed(2)} → 新 ${row.comparison.newIou.toFixed(2)}</span></header><div class="stage" style="aspect-ratio:${row.pageSize.width}/${row.pageSize.height}"><img src="${image}" alt="${paperKey} page ${row.pageNumber}"><svg viewBox="0 0 ${row.pageSize.width} ${row.pageSize.height}" preserveAspectRatio="none">${old}${candidate}${corrected}</svg></div></article>`;
  }).join("\n");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${paperKey} main reading flow comparison</title><style>*{box-sizing:border-box}body{margin:0;background:#f5f5f4;color:#1c1917;font:14px/1.5 system-ui,"Segoe UI",sans-serif}.top{position:sticky;top:0;z-index:5;background:#1c1917;color:#fff;padding:12px 20px}.top h1{font-size:18px;margin:0}.top p{margin:4px 0;color:#d6d3d1}.top nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.top a{color:#fff}button{font:inherit;background:#44403c;color:#fff;border:0;border-radius:6px;padding:5px 9px;cursor:pointer}button[aria-pressed=true]{background:#0f766e}main{max-width:1050px;margin:auto;padding:18px}article{background:white;border:1px solid #d6d3d1;border-radius:10px;padding:15px;margin-bottom:28px}article header{display:flex;justify-content:space-between;gap:12px;align-items:baseline}h2{font-size:17px;margin:0}.stage{width:min(100%,860px);position:relative;margin:12px auto;box-shadow:0 4px 18px #0002}.stage img,.stage svg{position:absolute;inset:0;width:100%;height:100%}svg{pointer-events:none}svg g rect{fill:none;vector-effect:non-scaling-stroke;stroke-width:1.7}svg g text{font-size:8px;font-weight:700}.old rect{stroke:#2563eb;stroke-dasharray:5 3}.old text{fill:#1d4ed8}.new rect{stroke:#059669;stroke-width:2.2}.new text{fill:#047857}.human rect{stroke:#d97706;stroke-dasharray:2 2}.human text{fill:#b45309}body.hide-old .old,body.hide-new .new,body.hide-human .human{display:none}</style></head><body><div class="top"><h1>主内容阅读流对照 · ${paperKey}</h1><p>PDF 坐标绑定 · 旧预测 / 新候选 / 人工 corrected。人工只作对照，新候选未 Accept/Promote，不用于 Runtime。</p><nav><button data-layer="old" aria-pressed="true">旧预测 蓝</button><button data-layer="new" aria-pressed="true">新候选 绿</button><button data-layer="human" aria-pressed="true">人工 corrected 橙</button><a href="index.html">全部论文</a></nav></div><main>${articles}</main><script>document.querySelectorAll("button[data-layer]").forEach(b=>b.onclick=()=>{let on=b.getAttribute("aria-pressed")==="true";b.setAttribute("aria-pressed",String(!on));document.body.classList.toggle("hide-"+b.dataset.layer,on)})</script></body></html>`;
}

async function main() {
  const localRequire = createRequire(path.join(APP, "main.js"));
  const pdfjs = await import(pathToFileURL(localRequire.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
  const corpus = JSON.parse(fs.readFileSync(COLUMN_CORPUS, "utf8"));
  const bundles = [];
  for (const paperKey of PAPERS) {
    const sample = corpus.samples.find((entry) => entry.id === `sample.column-pilot.${paperKey}`);
    if (!sample) throw new Error(`Missing frozen Column sample: ${paperKey}`);
    const reviewDraft = latestReviewDraft(paperKey);
    const draftBytes = fs.readFileSync(reviewDraft.path);
    const draft = JSON.parse(draftBytes);
    if (draft.sourcePdfSha256 !== sample.source.sha256 || draft.pages.length !== sample.source.pageCount) throw new Error(`${paperKey} draft does not match frozen Column source`);
    const pdfPath = source.resolvePdfByHash(sample.source.sha256, sample.source.bytes);
    const extracted = await source.extractPdf(pdfjs, pdfPath);
    const models = source.loadColumnModels(paperKey);
    const referenceStart = referenceBoundary(extracted);
    const rows = extracted.pages.map((page) => {
      const human = draft.pages.find((entry) => entry.pageNumber === page.pageNumber);
      const column = source.columnIdentity(sample, page.pageNumber);
      const model = models.get(page.pageNumber);
      if (!human || !model || model.layoutType !== column.layout || human.pageSize.width !== page.pageSize.width || human.pageSize.height !== page.pageSize.height) throw new Error(`${paperKey} p${page.pageNumber} page identity conflict`);
      const hints = visualHintsForPage(page);
      const candidate = predictPage(page, column, model, referenceStart, hints.visualObjects, hints.pageVisuals);
      const oldIou = setIou(human.predicted, human.corrected, page.pageSize);
      const newIou = setIou(candidate, human.corrected, page.pageSize);
      return { pageNumber: page.pageNumber, pageSize: page.pageSize, columnLayout: column.layout, predicted: human.predicted, candidate, corrected: human.corrected, confirmed: human.confirmed, generationDiagnostics: { visualNonAnchorHints: hints.visualObjects }, comparison: { oldIou, newIou, delta: round(newIou - oldIou), correctedCoverage: correctedCoverage(candidate, human.corrected, page.pageSize), missingCandidateForCorrected: human.corrected.length > 0 && candidate.length === 0 } };
    });
    const rasterDir = path.join(INPUT, "pages", paperKey);
    const rasterMeta = JSON.parse(fs.readFileSync(path.join(rasterDir, "raster-meta.json")));
    if (rasterMeta.sourcePdfSha256 !== sample.source.sha256 || rasterMeta.pages.length !== rows.length) throw new Error(`${paperKey} raster identity conflict`);
    bundles.push({ paperKey, sourceSha256: sample.source.sha256, draftName: reviewDraft.name, draftSha256: hash(draftBytes), rows, rasterDir });
  }
  fs.mkdirSync(OUTPUT, { recursive: true });
  const summary = { schemaVersion: "layout-geometry-main-flow-comparison/v1", scope: "body_column_as_main_reading_flow_only", runtimeDecisionUse: "forbidden", candidateAcceptance: "not_performed", promotion: "not_performed", note: "Human corrected is comparison evidence; prediction uses PDF text and frozen Column geometry only. IoU and corrected-area coverage are coarse review diagnostics, not acceptance. Corrected boundaries include approximate user safety room.", papers: [] };
  for (const bundle of bundles) {
    const { paperKey, sourceSha256, draftName, draftSha256, rows, rasterDir } = bundle;
    const outputRows = { schemaVersion: "layout-geometry-main-flow-candidate/v1", paper: paperKey, sourcePdfSha256: sourceSha256, correctedDraftFile: draftName, correctedDraftSha256: draftSha256, coordinateSpace: "pdf-page-top-left-points", runtimeDecisionUse: "forbidden", candidateAcceptance: "not_performed", promotion: "not_performed", pages: rows };
    fs.writeFileSync(path.join(OUTPUT, `${paperKey}-comparison.json`), `${JSON.stringify(outputRows, null, 2)}\n`);
    fs.writeFileSync(path.join(OUTPUT, `${paperKey}.html`), reviewHtml(paperKey, sourceSha256, rows, rasterDir));
    const confirmed = rows.filter((row) => row.confirmed);
    summary.papers.push({ paper: paperKey, pages: rows.length, confirmedPages: confirmed.length, oldMeanIou: round(confirmed.reduce((sum, row) => sum + row.comparison.oldIou, 0) / (confirmed.length || 1)), newMeanIou: round(confirmed.reduce((sum, row) => sum + row.comparison.newIou, 0) / (confirmed.length || 1)), meanCorrectedCoverage: round(confirmed.reduce((sum, row) => sum + row.comparison.correctedCoverage, 0) / (confirmed.length || 1)), lowCoveragePages: confirmed.filter((row) => row.comparison.correctedCoverage < 0.85).map((row) => row.pageNumber), missingCandidatePages: confirmed.filter((row) => row.comparison.missingCandidateForCorrected).map((row) => row.pageNumber), improvedPages: confirmed.filter((row) => row.comparison.delta > 0.01).length, regressedPages: confirmed.filter((row) => row.comparison.delta < -0.01).length, unchangedPages: confirmed.filter((row) => Math.abs(row.comparison.delta) <= 0.01).length });
  }
  fs.writeFileSync(path.join(OUTPUT, "COMPARISON_SUMMARY.json"), `${JSON.stringify(summary, null, 2)}\n`);
  const links = PAPERS.map((paper) => `<li><a href="${paper}.html">${paper}</a> · <a href="${paper}-comparison.json">坐标 / 对照 JSON</a></li>`).join("");
  fs.writeFileSync(path.join(OUTPUT, "index.html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Main reading flow review</title><style>body{font:16px/1.6 system-ui;max-width:760px;margin:36px auto;padding:0 20px}li{margin:8px 0}</style><h1>paper1–7 主内容阅读流候选</h1><p>旧预测蓝色，新候选绿色，人工 corrected 橙色。仅为离线审核，不 Accept、不 Promote、不改其他 Geometry 区域。</p><p><a href="COMPARISON_SUMMARY.json">对照汇总</a></p><ol>${links}</ol></html>`);
  console.log(JSON.stringify({ output: OUTPUT, papers: summary.papers }));
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });

function visualHintsForPage(page) {
  const lines = readingLines(page);
  const pageVisuals = source.visualClusters(page);
  const drawnVisuals = pageVisuals.filter((geometry) => geometry.width > page.pageSize.width * 0.4
    && geometry.height > 50);
  return {
    pageVisuals,
    visualObjects: [
      ...drawnVisuals.map((geometry) => ({ ...geometry, hintKind: "drawn_visual" })),
      ...denseTableTextHints(page, lines, drawnVisuals).map((geometry) => ({ ...geometry, hintKind: "dense_table" })),
    ],
  };
}

module.exports = { predictPage, referenceBoundary, abstractFlow, wideFlowSegments, setIou, correctedCoverage, visualHintsForPage };
