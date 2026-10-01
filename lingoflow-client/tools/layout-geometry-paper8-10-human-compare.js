#!/usr/bin/env node
"use strict";

// Read-only match of regenerated paper8-10 machine boxes against human
// corrected drafts. Unconfirmed pages are excluded from training totals.
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const source = require("./layout-geometry-candidate-intake");

const ROOT = path.resolve(__dirname, "../..");
const APP = path.join(ROOT, "lingoflow-client", "electron-app");
const REVIEW = path.join(ROOT, ".governance", "archive", "evidence", "layout-geometry-capability-audit", "evidence", "phase-2-paper-geometry", "human-review-cross-sample-paper8-10-v1");
const PAPERS = ["paper8", "paper9", "paper10"];
const SOURCE_ROOTS = ["D:\\PDF测试", path.join(APP, "tmp", "pdfs")];

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
    .map((line) => String(line.text || "").replace(/\s+/g, " ").trim()).filter(Boolean).join(" | ").slice(0, 180);
}
function findPdf(paper) {
  const n = paper.replace("paper", "");
  const suffix = new RegExp(`样本${n}\\.pdf$`, "i");
  for (const root of SOURCE_ROOTS) {
    if (!fs.existsSync(root)) continue;
    const match = fs.readdirSync(root).find((name) => suffix.test(name));
    if (match) return path.join(root, match);
  }
  throw new Error(`Missing PDF for ${paper}`);
}

function latestHumanDraft(paper) {
  const names = fs.readdirSync(REVIEW).filter((name) => name.startsWith(`${paper}-non-body-ground-truth-draft`) && name.endsWith(".json"))
    .concat(fs.existsSync(path.join(REVIEW, "human-corrections"))
      ? fs.readdirSync(path.join(REVIEW, "human-corrections")).filter((name) => name.startsWith(`${paper}-non-body-ground-truth-draft`) && name.endsWith(".json")).map((name) => path.join("human-corrections", name))
      : []);
  const choices = names.map((name) => ({ name, path: path.join(REVIEW, name), mtime: fs.statSync(path.join(REVIEW, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!choices.length) throw new Error(`Missing human draft for ${paper}`);
  return choices[0];
}

async function main() {
  const localRequire = createRequire(path.join(APP, "main.js"));
  const pdfjs = await import(pathToFileURL(localRequire.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
  const report = {
    schemaVersion: "layout-geometry-paper8-10-human-comparison/v1",
    status: "under_review",
    candidateAcceptance: "not_performed",
    promotion: "not_performed",
    note: "Unconfirmed pages are listed but excluded from totals used as training evidence.",
    papers: [],
  };
  for (const paper of PAPERS) {
    const humanFile = latestHumanDraft(paper);
    const human = JSON.parse(fs.readFileSync(humanFile.path, "utf8"));
    const machine = JSON.parse(fs.readFileSync(path.join(REVIEW, `${paper}-non-body-candidate.json`), "utf8"));
    if (human.sourcePdfSha256 !== machine.sourcePdfSha256) throw new Error(`${paper} source hash mismatch`);
    const extracted = await source.extractPdf(pdfjs, findPdf(paper));
    const paperOut = {
      paper,
      humanFile: humanFile.name,
      pages: [],
      totalsConfirmed: { human: 0, machine: 0, matched: 0, missed: 0, extra: 0 },
      skippedUnconfirmed: [],
    };
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
      pairs.forEach((pair) => {
        if (!usedTruth.has(pair.ti) && !usedCandidate.has(pair.ci)) {
          usedTruth.add(pair.ti); usedCandidate.add(pair.ci);
        }
      });
      const missed = hp.corrected.map((item, index) => ({ item, index })).filter(({ index }) => !usedTruth.has(index))
        .map(({ item }) => ({ type: item.objectType, geometry: item.geometry, text: textFor(item.geometry, lines) }));
      const extra = mp.predicted.map((item, index) => ({ item, index })).filter(({ index }) => !usedCandidate.has(index))
        .map(({ item }) => ({ type: item.objectType, geometry: item.geometry, text: textFor(item.geometry, lines) }));
      const row = { pageNumber: hp.pageNumber, confirmed: hp.confirmed === true, human: hp.corrected.length, machine: mp.predicted.length, matched: usedTruth.size, missed, extra };
      if (!hp.confirmed) {
        paperOut.skippedUnconfirmed.push(row);
        continue;
      }
      paperOut.pages.push(row);
      paperOut.totalsConfirmed.human += hp.corrected.length;
      paperOut.totalsConfirmed.machine += mp.predicted.length;
      paperOut.totalsConfirmed.matched += usedTruth.size;
      paperOut.totalsConfirmed.missed += missed.length;
      paperOut.totalsConfirmed.extra += extra.length;
    }
    report.papers.push(paperOut);
  }
  const outPath = path.join(REVIEW, "HUMAN_COMPARISON_REPORT.json");
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  const summary = report.papers.map((item) => ({
    paper: item.paper,
    totalsConfirmed: item.totalsConfirmed,
    skippedUnconfirmed: item.skippedUnconfirmed.map((page) => page.pageNumber),
    missedPages: item.pages.filter((page) => page.missed.length).map((page) => ({ page: page.pageNumber, missed: page.missed.map((m) => m.type) })),
    extraPages: item.pages.filter((page) => page.extra.length).map((page) => ({ page: page.pageNumber, extra: page.extra.map((m) => m.type) })),
  }));
  console.log(JSON.stringify({ output: outPath, summary }, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
