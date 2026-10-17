"use strict";

// Source-only, noncanonical protection for dense numerical tables. A printed
// caption is evidence of adjacency, not itself a member of the table.
const clean = value => String(value || "").replace(/\s+/g, " ").trim();
const tableCaption = text => /^(?:table|tab\.)\s*(?:\d+|[IVXLCDM]+)\s*[:.]/i.test(clean(text));
const digitRatio = text => (clean(text).match(/\d/g) || []).length /
  Math.max(1, clean(text).replace(/\s/g, "").length);
const bottom = line => line.bbox.y + line.bbox.height;
const union = lines => ({ x: Math.min(...lines.map(line => line.bbox.x)),
  y: Math.min(...lines.map(line => line.bbox.y)),
  width: Math.max(...lines.map(line => line.bbox.x + line.bbox.width)) -
    Math.min(...lines.map(line => line.bbox.x)),
  height: Math.max(...lines.map(bottom)) - Math.min(...lines.map(line => line.bbox.y)) });
function denseRow(line, pageWidth) {
  const text = clean(line.text);
  return text.length >= 12 && line.bbox.width >= pageWidth * .3 &&
    (digitRatio(text) >= .33 ||
      (digitRatio(text) >= .16 && (text.match(/[=α-ωΑ-Ω]/gu) || []).length >= 3));
}
function proposeTabularRegions(page) {
  if (!page || !Array.isArray(page.lines) || !(page.width > 0))
    throw Error("PDF source page with width and lines required");
  const lines = page.lines.map(line => ({ ...line, sourceLineId: line.sourceLineId || line.id }));
  if (lines.some(line => !line.sourceLineId || !line.bbox)) throw Error("PDF source lines require IDs and boxes");
  const ordered = lines.slice().sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  const regions = [];
  for (const caption of ordered.filter(line => tableCaption(line.text))) {
    const preceding = ordered.filter(line => line !== caption &&
      line.bbox.y < caption.bbox.y && line.bbox.y >= caption.bbox.y - 220 &&
      Math.abs(line.bbox.x + line.bbox.width - (caption.bbox.x + caption.bbox.width)) < page.width * .45);
    const rows = [];
    let previousTop = caption.bbox.y;
    for (const row of preceding.reverse()) {
      const gap = previousTop - bottom(row);
      if (gap > (rows.length ? 13 : 29) || gap < -3 || !denseRow(row, page.width)) break;
      if (rows.length && Math.abs(row.bbox.x + row.bbox.width -
        (rows[0].bbox.x + rows[0].bbox.width)) > 26) break;
      rows.push(row);
      previousTop = row.bbox.y;
    }
    if (rows.length < 4 || rows.filter(row => digitRatio(row.text) >= .4).length < 3) continue;
    rows.reverse();
    regions.push({ candidateId: `tabular:${caption.sourceLineId}`,
      type: "table", sourceLineIds: rows.map(row => row.sourceLineId), bbox: union(rows),
      captionSourceLineId: caption.sourceLineId,
      evidence: "dense_aligned_numeric_rows_above_printed_table_caption" });
  }
  const assigned = regions.flatMap(region => region.sourceLineIds);
  if (new Set(assigned).size !== assigned.length) throw Error("Overlapping tabular regions");
  return regions;
}
module.exports = { proposeTabularRegions };
