#!/usr/bin/env node
"use strict";

// Explicit offline Column promotion after human page-layout review. Never used by runtime.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const workflow = require("../electron-app/capability-library/candidate-pool");
const pilot = require("./column-capability-pilot");

const ROOT = path.resolve(__dirname, "../..");
const LIBRARY = path.join(ROOT, "lingoflow-client", "electron-app", "capability-library");
const COLUMN = path.join(LIBRARY, "capabilities", "cap.column-recognition");
const EVIDENCE = path.join(ROOT, ".governance", "archive", "evidence", "layout-geometry-capability-audit", "evidence", "phase-2-paper-geometry");
const REVIEW = path.join(EVIDENCE, "human-review-column-paper8-10-v1");
const NON_BODY = path.join(EVIDENCE, "human-review-cross-sample-paper8-10-v2-current");
const PREPARED = path.join(REVIEW, "PROMOTION_PREPARED");
const PAPERS = [8, 9, 10];
const NON_BODY_EXPORT = { 8: "paper8-non-body-ground-truth-draft (3).json", 9: "paper9-non-body-ground-truth-draft (2).json", 10: "paper10-non-body-ground-truth-draft (3).json" };
const REGION_TYPES = {
  title: "title", abstract: "abstract", figure: "figure", figure_caption: "figure_caption",
  table: "table", references_section_header: "references_section_header", author_affiliation: "other_independent",
};
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

function reviewedOracle(number) {
  const paper = `paper${number}`;
  const candidate = read(path.join(REVIEW, `${paper}-column-candidate.json`));
  const corrected = read(path.join(NON_BODY, NON_BODY_EXPORT[number]));
  if (candidate.source.sha256 !== corrected.sourcePdfSha256 || candidate.predicted.length !== corrected.pages.length || corrected.pages.some((page) => page.confirmed !== true)) {
    throw new Error(`${paper}: non-body review is incomplete or source mismatched`);
  }
  let layouts = candidate.predicted.map((row) => ({ pageNumber: row.pageNumber, layout: row.layoutType }));
  if (number === 10) {
    const exportFile = read(path.join(REVIEW, "paper10-column-ground-truth-draft.json"));
    if (exportFile.schemaVersion !== "column-human-review-draft/v1" || exportFile.source.sha256 !== candidate.source.sha256 ||
        exportFile.runtimeBaseline["main.js"] !== candidate.runtimeBaseline["main.js"] || exportFile.pages.length !== candidate.predicted.length ||
        exportFile.pages.some((row, index) => row.pageNumber !== index + 1 || row.predicted !== candidate.predicted[index].layoutType || row.confirmed !== true)) {
      throw new Error("paper10: Column export is incomplete or stale");
    }
    layouts = exportFile.pages.map((row) => ({ pageNumber: row.pageNumber, layout: row.corrected }));
  }
  const independentRegions = [];
  const seen = new Set();
  corrected.pages.forEach((page) => (page.corrected || []).forEach((box) => {
    const type = REGION_TYPES[box.objectType];
    if (!type) return;
    const key = `${page.pageNumber}/${type}`;
    if (seen.has(key)) return;
    seen.add(key);
    independentRegions.push({ pageNumber: page.pageNumber, type });
  }));
  independentRegions.sort((a, b) => a.pageNumber - b.pageNumber || a.type.localeCompare(b.type));
  pilot.validateIndependentRegions(independentRegions, layouts.length);
  return { candidate, oracle: { capabilityId: "cap.column-recognition", assertionId: "assert.column.page-region-truth", oracleType: "exact",
    expected: { pageLayoutBasis: "body_text_flow_only", pages: layouts, independentRegions },
    notes: number === 10 ? "10/10 pages confirmed in exported Column review; independent types from separately confirmed non-body review" :
      "User explicitly approved unchanged machine Column layout without JSON export; independent types from separately confirmed non-body review" } };
}

async function prepare() {
  if (fs.existsSync(PREPARED)) throw new Error(`Preparation already exists: ${PREPARED}`);
  let state = workflow.loadCommittedState(path.join(REVIEW, "CANDIDATE_POOL_SNAPSHOT"));
  const accepted = [];
  for (const number of PAPERS) {
    const { candidate, oracle } = reviewedOracle(number);
    const id = `candidate.column-pilot.paper${number}`;
    const staged = state.pool.candidates.find((entry) => entry.id === id);
    if (!staged || staged.status !== "under_review" || staged.sample.source.sha256 !== candidate.source.sha256) throw new Error(`Staged candidate mismatch: ${id}`);
    state = workflow.reviewCandidate(state, id, "accepted", {
      actor: "User review, recorded by Codex", reason: number === 10 ?
        "User reviewed and exported all ten pages; approved promotion if validation passes" :
        "User explicitly approved the unchanged machine Column layouts without a separate JSON export",
      evidenceRefs: [`human-review-column-paper8-10-v1/${number === 10 ? "paper10-column-ground-truth-draft.json" : `paper${number}.html`}`,
        `human-review-cross-sample-paper8-10-v2-current/${NON_BODY_EXPORT[number]}`, "2026-09-27 user authorization to promote after verification"],
      expectedOutcomes: [oracle],
    });
    accepted.push(id);
  }
  const acceptedState = state;
  for (const id of accepted) {
    state = workflow.promoteCandidate(state, id, {
      actor: "User-authorized Column promotion, executed by Codex", reason: "Complete reviewed oracle and zero-finding 10-sample offline regression required before publication",
      evidenceRefs: ["human-review-column-paper8-10-v1/PROMOTION_PREPARED/VALIDATION.json"],
    });
  }
  const regressions = {};
  let pageCount = 0, passCount = 0, single = 0, double = 0, mixed = 0;
  const perPaper = [];
  for (let number = 1; number <= 10; number += 1) {
    const sample = state.corpus.samples.find((entry) => entry.id === `sample.column-pilot.paper${number}`);
    if (!sample) throw new Error(`Missing promoted sample paper${number}`);
    const source = path.join("D:\\PDF测试", `论文样本${number}.pdf`);
    const capture = await pilot.capture(source);
    if (capture.source.sha256 !== sample.source.sha256 || capture.source.bytes !== sample.source.bytes || capture.pages.length !== sample.source.pageCount) throw new Error(`Source identity mismatch paper${number}`);
    const preliminaryReport = number >= 8 ? pilot.compare(state, sample.id, capture) : {
      schemaVersion: "column-pilot-regression/v1", runtimeDecisionUse: "forbidden", sampleId: sample.id,
      results: sample.expectedOutcomes[0].expected.pages.map((truth) => {
        const page = capture.pages[truth.pageNumber - 1];
        return { sampleId: sample.id, pageNumber: truth.pageNumber, expected: truth.layout, actual: page.layoutType,
          status: truth.layout === page.layoutType ? "pass" : "finding", codeLocation: "main.js:detectPageColumns / buildStructuredPdfText", evidence: page };
      }),
      limitations: ["Region geometry and ownership require explicit reviewed region/object oracles; page matches alone do not certify them.", "No Issue lifecycle or runtime decisions are modified."],
    };
    const report = { ...preliminaryReport, findingCount: preliminaryReport.results.filter((entry) => entry.status === "finding").length };
    if (report.findingCount !== 0) throw new Error(`Column regression failed on paper${number}: ${report.findingCount} findings`);
    regressions[number] = report;
    pageCount += report.results.length;
    passCount += report.results.filter((entry) => entry.status === "pass").length;
    for (const page of report.results) {
      if (page.actual === "single_column") single += 1;
      else if (page.actual === "double_column") double += 1;
      else if (page.actual === "mixed") mixed += 1;
    }
    perPaper.push({ paper: number, pages: report.results.length, findings: report.findingCount, sourceSha256: capture.source.sha256 });
  }
  if (pageCount !== 126 || passCount !== 126 || state.corpus.samples.length !== 10) throw new Error("Expected 10 samples / 126 passing pages");
  const previous = read(path.join(COLUMN, "baseline", "summary.json"));
  const summary = { ...previous, sampleCount: 10, pageCount, passCount, findingCount: 0,
    layoutCoverage: { singleColumnPages: single, doubleColumnPages: double, mixedBodyFlowPages: mixed },
    samples: Array.from({ length: 10 }, (_, index) => ({ id: `sample.column-pilot.paper${index + 1}`, label: `paper${index + 1}`, pages: perPaper[index].pages, baseline: `paper${index + 1}-regression.json` })),
    limitations: ["当前正式样本仍没有真实 mixed 正文文本流页面；mixed 能力等待未来审核样本。", "能力库只提供离线 Evidence；Runtime 栏型事实仍由 AA-COLUMN-001 产生。"] };
  fs.mkdirSync(PREPARED);
  workflow.saveState(acceptedState, path.join(PREPARED, "ACCEPTED_SNAPSHOT"));
  workflow.saveState(state, path.join(PREPARED, "PROMOTED_SNAPSHOT"));
  const baseline = path.join(PREPARED, "baseline");
  fs.mkdirSync(baseline);
  fs.writeFileSync(path.join(baseline, "summary.json"), serialize(summary));
  for (let number = 1; number <= 10; number += 1) fs.writeFileSync(path.join(baseline, `paper${number}-regression.json`), serialize(regressions[number]));
  fs.writeFileSync(path.join(PREPARED, "VALIDATION.json"), serialize({ schemaVersion: "column-promotion-validation/v1", status: "ready_to_publish", accepted: 3, promoted: 3, sampleCount: 10, pageCount, passCount, findingCount: 0,
    reviewedColumnExport: "paper10-column-ground-truth-draft.json", paper8And9Review: "explicit user approval of unchanged predictions", reviewedIndependentRegions: PAPERS.map((number) => NON_BODY_EXPORT[number]), perPaper }));
  console.log(JSON.stringify({ prepared: PREPARED, samples: 10, pages: pageCount, findings: 0, layoutCoverage: summary.layoutCoverage }));
}

function publish() {
  const state = workflow.loadCommittedState(path.join(PREPARED, "PROMOTED_SNAPSHOT"));
  const validation = read(path.join(PREPARED, "VALIDATION.json"));
  const summary = read(path.join(PREPARED, "baseline", "summary.json"));
  if (validation.status !== "ready_to_publish" || validation.findingCount !== 0 || summary.pageCount !== 126 || state.corpus.samples.length !== 10) throw new Error("Prepared promotion is not valid");
  const current = workflow.loadState();
  if (current.corpus.samples.length !== 7 || current.pool.candidates.length !== 0) throw new Error("Canonical corpus changed since preparation");
  const oldSeven = JSON.stringify(current.corpus.samples);
  if (oldSeven !== JSON.stringify(state.corpus.samples.slice(0, 7))) throw new Error("Existing seven Column truths changed");
  const columnCapabilities = { ...read(path.join(COLUMN, "capabilities.json")), capabilities: [state.capabilities.capabilities.find((entry) => entry.id === "cap.column-recognition")] };
  const columnCorpus = { ...read(path.join(COLUMN, "corpus.json")), samples: state.corpus.samples };
  if (!columnCapabilities.capabilities[0]) throw new Error("Missing Column capability");
  // Generated catalog/baseline files are a mechanical publication of the
  // immutable, validated three-file promotion snapshot—not a second oracle.
  fs.writeFileSync(path.join(COLUMN, "capabilities.json"), serialize(columnCapabilities));
  fs.writeFileSync(path.join(COLUMN, "corpus.json"), serialize(columnCorpus));
  fs.writeFileSync(path.join(LIBRARY, "candidates.json"), serialize(state.pool));
  fs.writeFileSync(path.join(COLUMN, "baseline", "summary.json"), serialize(summary));
  for (let number = 1; number <= 10; number += 1) {
    fs.writeFileSync(path.join(COLUMN, "baseline", `paper${number}-regression.json`), fs.readFileSync(path.join(PREPARED, "baseline", `paper${number}-regression.json`)));
  }
  const published = workflow.loadState();
  if (published.corpus.samples.length !== 10 || published.pool.candidates.filter((entry) => entry.promotedSampleId).length !== 3 ||
      digest(JSON.stringify(published.corpus.samples.slice(0, 7))) !== digest(oldSeven)) throw new Error("Canonical publication verification failed");
  console.log(JSON.stringify({ published: COLUMN, samples: 10, pages: summary.pageCount, findings: summary.findingCount }));
}

const action = process.argv[2];
if (require.main === module) {
  Promise.resolve().then(() => action === "prepare" ? prepare() : action === "publish" ? publish() : Promise.reject(new Error("Use prepare or publish")))
    .catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
}
module.exports = { prepare, publish, reviewedOracle };
