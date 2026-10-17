"use strict";

// Converts observed PDF extraction lines into source-only inputs. The PDF
// extraction owns geometry; this adapter neither classifies nor changes it.
const crypto = require("node:crypto");
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const norm = value => String(value || "").replace(/\s+/g, " ").trim();
const numericBox = value => ({ x: Number(value?.x || 0), y: Number(value?.y || 0),
  width: Number(value?.width || 0), height: Number(value?.height || 0) });
function sourcePagesFromExtraction(output, sourceSha256) {
  if (!/^[a-f0-9]{64}$/i.test(sourceSha256 || "") || !Array.isArray(output?.lines) ||
    !Array.isArray(output?.textItems) || !Number.isInteger(output?.pages))
    throw Error("Observed PDF extraction and source SHA-256 required");
  const byPage = new Map(), seen = new Set();
  for (const line of output.lines) {
    const text = norm(line.text || line.sourceLineText), bbox = numericBox(line.bbox);
    if (!text || !(bbox.width > 0 && bbox.height > 0)) continue;
    const page = Number(line.pageNumber), column = String(line.column || "single");
    if (!Number.isInteger(page) || page < 1 || page > output.pages) throw Error("PDF source page outside document");
    const id = `offline-line-sha256:${sha(JSON.stringify([sourceSha256, page, bbox, text]))}`;
    if (seen.has(id)) throw Error(`Observed PDF repeats source line: ${id}`);
    seen.add(id);
    const sizes = (line.items || []).map(item => Number(item.fontSize || item.height)).filter(Boolean);
    const member = { id, sourceLineId: id, page, column, text, bbox,
      fontSize: sizes.length ? Math.max(...sizes) : bbox.height,
      fontNames: [...new Set((line.items || []).map(item => String(item.fontName || "")).filter(Boolean))],
      items: line.items || [] };
    const bucket = byPage.get(page) || []; bucket.push(member); byPage.set(page, bucket);
  }
  const pages = [];
  for (let page = 1; page <= output.pages; page++) {
    const item = output.textItems.find(entry => Number(entry.pageNumber) === page && Number(entry.pageWidth) > 0);
    if (!item && (byPage.get(page) || []).length) throw Error(`Page ${page} has source lines but no page width`);
    pages.push({ page, width: item ? Number(item.pageWidth) : null,
      height: item ? Number(item.pageHeight) : null, lines: byPage.get(page) || [] });
  }
  return pages;
}
module.exports = { sourcePagesFromExtraction };
