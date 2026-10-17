"use strict";

// Offline, non-authoritative raw-PDF entry. The old application extractor is
// used only to observe PDF lines and geometry; its semantic artifact is not
// passed into Object-first inference. No Task file or reviewed rectangle is
// read by this module.
const crypto = require("node:crypto");
const { extractObservedPdf } = require("./pdf-observed-source.cjs");
const { sourcePagesFromExtraction } = require("./pdf-source-adapter.cjs");
const { stage35InputFromObservedPages } = require("./observed-stage35-input.cjs");
const { build } = require("./pdf-stage35-82.cjs");

async function buildFromPdf({ pdfPath, paper, python, pdftoppm, runDirectory,
  visualRegionMode = "native" } = {}) {
  if (!pdfPath || !Number.isInteger(paper) || paper < 1)
    throw Error("Raw PDF path and positive paper identity required");
  const extraction = await extractObservedPdf(pdfPath);
  const observed = sourcePagesFromExtraction(extraction.output, extraction.sourceSha);
  const source = stage35InputFromObservedPages(
    observed, extraction.sourceSha, paper, pdfPath);
  if (Object.values(source.pages).some(page => page.layoutHints?.length))
    throw Error("Raw-PDF entry must not inject reviewed layout hints");
  const inputHash = crypto.createHash("sha256")
    .update(JSON.stringify(source)).digest("hex");
  const result = build({ source, inputHash, python, pdftoppm, runDirectory,
    visualRegionMode });
  const summary = result.candidate.summary;
  if (summary.sourceLines !== summary.assigned + summary.pending + summary.excluded ||
    Object.keys(result.candidate.pages).length !== source.summary.pageCount)
    throw Error("Raw-PDF Object-first source accounting failed");
  return { ...result, observedSource: source,
    // Diagnostic output only. Never supplied to the Object-first producer.
    legacyStructureArtifact: extraction.output.semanticStructureArtifact,
    sourcePdfSha256: extraction.sourceSha, extractionMainSha256: extraction.mainSha };
}

module.exports = { buildFromPdf };
