"use strict";

// Adapts observed extraction pages to the early offline pipeline contract.
// No reviewed Object, human rectangle or geometry-oracle hint enters here.
function stage35InputFromObservedPages(sourcePages, sourcePdfSha256, paper = 1, sourceFile = null) {
  if (!Array.isArray(sourcePages) || !sourcePages.length ||
    !/^[a-f0-9]{64}$/i.test(sourcePdfSha256 || "") ||
    !Number.isInteger(paper) || paper < 1) throw Error("Observed source pages, PDF hash and paper number required");
  const pages = {}, seen = new Set();
  for (let index = 0; index < sourcePages.length; index++) {
    const source = sourcePages[index], number = index + 1;
    if (source?.page !== number || !(source.width > 0 && source.height > 0) || !Array.isArray(source.lines))
      throw Error(`Observed page ${number} lacks contiguous identity or geometry`);
    const sourceLines = source.lines.map(line => {
      const id = line.sourceLineId || line.id;
      if (!id || seen.has(id) || line.page !== number || !line.bbox ||
        !(line.bbox.width > 0 && line.bbox.height > 0)) throw Error(`Observed source line invalid or duplicated on page ${number}`);
      seen.add(id);
      return { sourceLineId: id, text: line.text, page: number,
        column: line.column || "single", bbox: { ...line.bbox },
        coverageClass: "reviewable_content" };
    });
    pages[`${paper}:${number}`] = { paper, pageNumber: number, sourcePdfSha256,
      pageSize: { width: source.width, height: source.height }, sourceLines,
      layoutHints: [] };
  }
  return { schemaVersion: "OfflineStructureFrozenInput/v1", authority: "none",
    status: "observed_source_input_not_structure_truth",
    provenance: "raw_pdf_extraction_without_reviewed_layout_hints",
    papers: [{ paper, sourcePdfSha256, pageCount: sourcePages.length,
      ...(sourceFile ? { sourceFile } : {}) }], pages,
    summary: { paperCount: 1, pageCount: sourcePages.length, sourceLineCount: seen.size } };
}
module.exports = { stage35InputFromObservedPages };
