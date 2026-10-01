#!/usr/bin/env node
"use strict";

// Replay paper1-7 Geometry generators against frozen candidate JSON.
// Does not write freeze artifacts, review HTML, Column corpus, or runtime files.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const source = require("./layout-geometry-candidate-intake");
const bodyFlow = require("./layout-geometry-main-flow-review");
const nonBody = require("./layout-geometry-non-body-editable");

const ROOT = path.resolve(__dirname, "../..");
const APP = path.join(ROOT, "lingoflow-client", "electron-app");
const EVIDENCE = path.join(ROOT, ".governance", "archive", "evidence", "layout-geometry-capability-audit", "evidence", "phase-2-paper-geometry");
const FREEZE = path.join(EVIDENCE, "geometry-baseline-v1");
const BODY_FREEZE = path.join(EVIDENCE, "body-baseline-v1", "FREEZE_MANIFEST.json");
const COLUMN_CORPUS = path.join(APP, "capability-library", "capabilities", "cap.column-recognition", "corpus.json");
const PAPERS = Array.from({ length: 7 }, (_, index) => `paper${index + 1}`);
const hashFile = (filePath) => crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
const roundBox = (box) => ({
  x: Math.round(box.x * 100) / 100,
  y: Math.round(box.y * 100) / 100,
  width: Math.round(box.width * 100) / 100,
  height: Math.round(box.height * 100) / 100,
});
const signature = (item) => JSON.stringify({
  type: item.objectType || item.canonicalColumnId || "body",
  id: item.canonicalColumnId || item.id || null,
  geometry: roundBox(item.geometry),
});

function diffBoxes(live, frozen, key) {
  const left = live.map(signature).sort();
  const right = frozen.map(signature).sort();
  const extra = left.filter((item) => !right.includes(item));
  const missing = right.filter((item) => !left.includes(item));
  return {
    paper: key,
    live: live.length,
    frozen: frozen.length,
    equal: extra.length === 0 && missing.length === 0 && live.length === frozen.length,
    extra: extra.length,
    missing: missing.length,
    extraSamples: extra.slice(0, 6),
    missingSamples: missing.slice(0, 6),
  };
}

async function main() {
  const localRequire = createRequire(path.join(APP, "main.js"));
  const pdfjs = await import(pathToFileURL(localRequire.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
  const corpus = JSON.parse(fs.readFileSync(COLUMN_CORPUS, "utf8"));
  const geometryFreeze = JSON.parse(fs.readFileSync(path.join(FREEZE, "FREEZE_MANIFEST.json"), "utf8"));
  const bodyManifest = JSON.parse(fs.readFileSync(BODY_FREEZE, "utf8"));
  const report = { schemaVersion: "layout-geometry-paper1-7-freeze-replay/v1", papers: [] };
  for (const paper of PAPERS) {
    const sample = corpus.samples.find((entry) => entry.id === `sample.column-pilot.${paper}`);
    if (!sample) throw new Error(`Missing frozen Column sample: ${paper}`);
    const pdfPath = source.resolvePdfByHash(sample.source.sha256, sample.source.bytes);
    const extracted = await source.extractPdf(pdfjs, pdfPath);
    const models = source.loadColumnModels(paper);
    const referenceStart = bodyFlow.referenceBoundary(extracted);
    const bodyLive = extracted.pages.map((page) => {
      const column = source.columnIdentity(sample, page.pageNumber);
      const model = models.get(page.pageNumber);
      const hints = bodyFlow.visualHintsForPage(page);
      return bodyFlow.predictPage(page, column, model, referenceStart, hints.visualObjects, hints.pageVisuals);
    }).flat();
    const bodyFrozenFile = path.join(EVIDENCE, "human-review-main-flow-v1", `${paper}-comparison.json`);
    const bodyFrozenDoc = JSON.parse(fs.readFileSync(bodyFrozenFile, "utf8"));
    const bodyFrozen = bodyFrozenDoc.pages.flatMap((page) => page.candidate || []);
    const expectedBodyHash = bodyManifest.regressionEvidence.candidateFiles.find((item) => item.paper === paper).sha256;
    const objects = nonBody.predictNonBodyPages(paper, extracted, sample, models);
    const objectLive = objects.pages.flatMap((page) => page.predicted);
    const freezePaper = geometryFreeze.papers.find((item) => item.paper === paper);
    const objectFrozenDoc = JSON.parse(fs.readFileSync(path.join(FREEZE, freezePaper.candidate.path), "utf8"));
    const objectFrozen = objectFrozenDoc.pages.flatMap((page) => page.predicted);
    report.papers.push({
      paper,
      sourcePdfSha256: sample.source.sha256,
      bodyComparisonFileHash: hashFile(bodyFrozenFile),
      bodyComparisonFileHashMatchesFreeze: hashFile(bodyFrozenFile) === expectedBodyHash,
      body: diffBoxes(bodyLive, bodyFrozen, paper),
      nonBodyFreezeFileHash: hashFile(path.join(FREEZE, freezePaper.candidate.path)),
      nonBodyFreezeFileHashMatchesManifest: hashFile(path.join(FREEZE, freezePaper.candidate.path)) === freezePaper.candidate.sha256,
      nonBody: diffBoxes(objectLive, objectFrozen, paper),
    });
  }
  const out = path.join(EVIDENCE, "PAPER1-7-FREEZE-REPLAY.json");
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  const summary = report.papers.map((item) => ({
    paper: item.paper,
    bodyFileStillFrozen: item.bodyComparisonFileHashMatchesFreeze,
    bodyBoxesMatch: item.body.equal,
    body: `${item.body.live}/${item.body.frozen} extra=${item.body.extra} missing=${item.body.missing}`,
    nonBodyFileStillFrozen: item.nonBodyFreezeFileHashMatchesManifest,
    nonBodyBoxesMatch: item.nonBody.equal,
    nonBody: `${item.nonBody.live}/${item.nonBody.frozen} extra=${item.nonBody.extra} missing=${item.nonBody.missing}`,
  }));
  console.log(JSON.stringify({ output: out, summary }, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
