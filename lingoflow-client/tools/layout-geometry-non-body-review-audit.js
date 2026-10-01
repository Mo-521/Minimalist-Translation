#!/usr/bin/env node
"use strict";

// Read-only audit of human non-Body corrections against raw PDF evidence.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const source = require("./layout-geometry-candidate-intake");

const ROOT = path.resolve(__dirname, "../..");
const APP = path.join(ROOT, "lingoflow-client", "electron-app");
const EVIDENCE = path.join(ROOT, ".governance", "archive", "evidence", "layout-geometry-capability-audit", "evidence", "phase-2-paper-geometry");
const REVIEW = path.join(EVIDENCE, "human-review-non-body-editable-v1");
const COLUMN_CORPUS = path.join(APP, "capability-library", "capabilities", "cap.column-recognition", "corpus.json");
const requestedPaper = process.argv.find((value) => /^paper[1-7]$/.test(value));
const PAPERS = requestedPaper ? [requestedPaper] : Array.from({ length: 7 }, (_, index) => `paper${index + 1}`);

function latestReviewExport(paper) {
  const prefix = `${paper}-non-body-ground-truth-draft`;
  const matches = fs.readdirSync(REVIEW)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .map((name) => {
      const fullPath = path.join(REVIEW, name);
      return { fullPath, modifiedMs: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.modifiedMs - a.modifiedMs);
  if (!matches.length) throw new Error(`Missing human review export for ${paper}`);
  return matches[0].fullPath;
}

function overlap(a, b) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width), y1 = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
}

function lineTextFor(box, lines) {
  return lines.filter((line) => overlap(box, source.lineBox(line)) > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((line) => String(line.text || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" | ").slice(0, 500);
}

function lineEvidenceFor(box, lines, page) {
  return lines.filter((line) => overlap(box, source.lineBox(line)) > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .slice(0, 8)
    .map((line) => ({
      text: String(line.text || "").replace(/\s+/g, " ").trim(),
      x: Math.round(line.x * 100) / 100,
      y: Math.round(line.y * 100) / 100,
      width: Math.round(line.width * 100) / 100,
      height: Math.round(line.height * 100) / 100,
      maxFont: Math.round(line.maxFont * 100) / 100,
      fontNames: line.fontNames,
      fontFamilies: line.fontFamilies,
      sectionHeading: source.isSectionHeadingLine(line, page),
    }));
}

async function main() {
  const localRequire = createRequire(path.join(APP, "main.js"));
  const pdfjs = await import(pathToFileURL(localRequire.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
  const corpus = JSON.parse(fs.readFileSync(COLUMN_CORPUS, "utf8"));
  const report = { schemaVersion: "layout-geometry-non-body-human-diff-audit/v1", runtimeDecisionUse: "forbidden", papers: [] };
  for (const paper of PAPERS) {
    const sample = corpus.samples.find((entry) => entry.id === `sample.column-pilot.${paper}`);
    const reviewPath = latestReviewExport(paper);
    const review = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
    const pdfPath = source.resolvePdfByHash(sample.source.sha256, sample.source.bytes);
    const extracted = await source.extractPdf(pdfjs, pdfPath);
    const pages = [];
    for (const human of review.pages) {
      const raw = extracted.pages[human.pageNumber - 1];
      const lines = source.groupLines(raw.items);
      const correctedBySource = new Map(human.corrected.filter((item) => item.sourceRegionId).map((item) => [item.sourceRegionId, item]));
      const predictedById = new Map(human.predicted.map((item) => [item.id, item]));
      const deleted = human.predicted.filter((item) => !correctedBySource.has(item.id)).map((item) => ({ id: item.id, type: item.objectType, geometry: item.geometry, text: lineTextFor(item.geometry, lines), lineEvidence: lineEvidenceFor(item.geometry, lines, raw) }));
      const added = human.corrected.filter((item) => item.sourceRegionId === null || !predictedById.has(item.sourceRegionId)).map((item) => ({ id: item.id, type: item.objectType, geometry: item.geometry, text: lineTextFor(item.geometry, lines), lineEvidence: lineEvidenceFor(item.geometry, lines, raw) }));
      const changed = human.predicted.filter((item) => correctedBySource.has(item.id)).map((item) => {
        const corrected = correctedBySource.get(item.id);
        const typeChanged = item.objectType !== corrected.objectType;
        const geometryChanged = JSON.stringify(item.geometry) !== JSON.stringify(corrected.geometry);
        if (!typeChanged && !geometryChanged) return null;
        return { id: item.id, fromType: item.objectType, toType: corrected.objectType, predictedGeometry: item.geometry, correctedGeometry: corrected.geometry, text: lineTextFor(corrected.geometry, lines) };
      }).filter(Boolean);
      if (deleted.length || added.length || changed.length || !human.confirmed) pages.push({ pageNumber: human.pageNumber, confirmed: human.confirmed, deleted, added, changed });
    }
    report.papers.push({ paper, reviewFile: path.basename(reviewPath), pages });
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
