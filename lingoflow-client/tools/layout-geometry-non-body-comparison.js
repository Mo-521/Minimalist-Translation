#!/usr/bin/env node
"use strict";

// Read-only comparison between latest machine candidates and latest human exports.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const source = require("./layout-geometry-candidate-intake");

const ROOT = path.resolve(__dirname, "../..");
const APP = path.join(ROOT, "lingoflow-client", "electron-app");
const REVIEW = path.join(ROOT, ".governance", "archive", "evidence", "layout-geometry-capability-audit", "evidence", "phase-2-paper-geometry", "human-review-non-body-editable-v1");
const COLUMN_CORPUS = path.join(APP, "capability-library", "capabilities", "cap.column-recognition", "corpus.json");
const requested = process.argv.find((value) => /^paper[1-7]$/.test(value));
const PAPERS = requested ? [requested] : Array.from({ length: 7 }, (_, index) => `paper${index + 1}`);

function latestExport(paper) {
  return fs.readdirSync(REVIEW).filter((name) => name.startsWith(`${paper}-non-body-ground-truth-draft`) && name.endsWith(".json"))
    .map((name) => ({ name, mtime: fs.statSync(path.join(REVIEW, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0].name;
}
function hit(a, b) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width), y1 = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
}
function affinity(a, b) {
  const intersection = hit(a, b);
  if (!intersection) return 0;
  return intersection / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
}
function textFor(box, lines) {
  return lines.filter((line) => hit(box, source.lineBox(line)) > 0).sort((a, b) => a.y - b.y || a.x - b.x)
    .map((line) => String(line.text || "").replace(/\s+/g, " ").trim()).filter(Boolean).join(" | ").slice(0, 220);
}

async function main() {
  const localRequire = createRequire(path.join(APP, "main.js"));
  const pdfjs = await import(pathToFileURL(localRequire.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
  const corpus = JSON.parse(fs.readFileSync(COLUMN_CORPUS, "utf8"));
  const report = [];
  for (const paper of PAPERS) {
    const sample = corpus.samples.find((item) => item.id === `sample.column-pilot.${paper}`);
    const extracted = await source.extractPdf(pdfjs, source.resolvePdfByHash(sample.source.sha256, sample.source.bytes));
    const humanName = latestExport(paper);
    const human = JSON.parse(fs.readFileSync(path.join(REVIEW, humanName), "utf8"));
    const machine = JSON.parse(fs.readFileSync(path.join(REVIEW, `${paper}-non-body-candidate.json`), "utf8"));
    const paperOut = { paper, humanFile: humanName, pages: [], totals: { human: 0, machine: 0, matched: 0, missed: 0, extra: 0 } };
    for (const hp of human.pages) {
      const mp = machine.pages.find((item) => item.pageNumber === hp.pageNumber);
      const lines = source.groupLines(extracted.pages[hp.pageNumber - 1].items);
      const pairs = [];
      hp.corrected.forEach((truth, ti) => mp.predicted.forEach((candidate, ci) => {
        if (truth.objectType !== candidate.objectType) return;
        const score = affinity(truth.geometry, candidate.geometry);
        if (score >= 0.45) pairs.push({ ti, ci, score });
      }));
      pairs.sort((a, b) => b.score - a.score);
      const usedTruth = new Set(), usedCandidate = new Set();
      pairs.forEach((pair) => { if (!usedTruth.has(pair.ti) && !usedCandidate.has(pair.ci)) { usedTruth.add(pair.ti); usedCandidate.add(pair.ci); } });
      const missed = hp.corrected.map((item, index) => ({ item, index })).filter(({ index }) => !usedTruth.has(index))
        .map(({ item }) => ({ type: item.objectType, geometry: item.geometry, text: textFor(item.geometry, lines),
          visualClusters: item.objectType === "figure" ? source.visualClusters(extracted.pages[hp.pageNumber - 1]).filter((cluster) => affinity(cluster, item.geometry) > 0.25) : undefined,
          rawVisuals: item.objectType === "figure" ? [...extracted.pages[hp.pageNumber - 1].images, ...extracted.pages[hp.pageNumber - 1].drawings]
            .filter((visual) => affinity(visual.geometry, item.geometry) > 0.25).map((visual) => visual.geometry).slice(0, 8) : undefined,
          rawVisualCount: item.objectType === "figure" ? extracted.pages[hp.pageNumber - 1].images.length + extracted.pages[hp.pageNumber - 1].drawings.length : undefined,
          rawVisualSample: item.objectType === "figure" ? [...extracted.pages[hp.pageNumber - 1].images, ...extracted.pages[hp.pageNumber - 1].drawings].slice(0, 5).map((visual) => visual.geometry) : undefined,
          headingRows: item.objectType === "section_heading" ? source.semanticHeadingRows(lines, extracted.pages[hp.pageNumber - 1])
            .filter((line) => hit(line, item.geometry) > 0)
            .map((line) => ({ text: line.text, geometry: source.lineBox(line), classified: source.isSectionHeadingLine(line, extracted.pages[hp.pageNumber - 1]) })).slice(0, 6) : undefined }));
      const extra = mp.predicted.map((item, index) => ({ item, index })).filter(({ index }) => !usedCandidate.has(index))
        .map(({ item }) => ({ type: item.objectType, geometry: item.geometry, text: textFor(item.geometry, lines) }));
      if (missed.length || extra.length) paperOut.pages.push({ pageNumber: hp.pageNumber, missed, extra });
      paperOut.totals.human += hp.corrected.length; paperOut.totals.machine += mp.predicted.length;
      paperOut.totals.matched += usedTruth.size; paperOut.totals.missed += missed.length; paperOut.totals.extra += extra.length;
    }
    report.push(paperOut);
  }
  if (process.argv.includes("--write")) {
    const artifact = {
      schemaVersion: "layout-geometry-non-body-human-comparison/v1",
      status: "under_review",
      accepted: false,
      promoted: false,
      generatedAt: new Date().toISOString(),
      papers: report,
    };
    fs.writeFileSync(path.join(REVIEW, "HUMAN_COMPARISON_REPORT.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  }
  if (process.argv.includes("--summary")) {
    process.stdout.write(`${JSON.stringify(report.map(({ paper, humanFile, totals }) => ({ paper, humanFile, totals })), null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
