"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..", "..", "..", "electron-app", "capability-library", "capabilities", "cap.column-recognition");
const read = (...parts) => JSON.parse(fs.readFileSync(path.join(ROOT, ...parts), "utf8"));

test("canonical Column corpus preserves the promoted seven-sample truth byte-for-byte", () => {
  const corpusPath = path.join(ROOT, "corpus.json");
  const bytes = fs.readFileSync(corpusPath);
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), "987509d71d223469b15355f1512f59c8aedf20986e729950baf4e26973320c9b");
  const corpus = JSON.parse(bytes);
  assert.equal(corpus.runtimeDecisionUse, "forbidden");
  assert.equal(corpus.samples.length, 7);
  assert.equal(corpus.samples.reduce((total, sample) => total + sample.source.pageCount, 0), 90);
  assert.deepEqual(corpus.samples.map((sample) => sample.id), Array.from({ length: 7 }, (_, index) => `sample.column-pilot.paper${index + 1}`));
  corpus.samples.forEach((sample) => {
    assert.equal(sample.storage.binaryCommitted, false);
    assert.equal(sample.authorityBoundary.runtimeDecisionUse, "forbidden");
    assert.deepEqual(sample.authorityBoundary.finalDecisionsOwnedBy, ["AA-COLUMN-001"]);
    assert.equal(sample.expectedOutcomes[0].expected.pageLayoutBasis, "body_text_flow_only");
  });
});

test("current Column baseline is a complete 90-page zero-finding comparison against formal truth", () => {
  const corpus = read("corpus.json");
  const summary = read("baseline", "summary.json");
  const truthBySample = new Map(corpus.samples.map((sample) => [
    sample.id,
    new Map(sample.expectedOutcomes[0].expected.pages.map((page) => [page.pageNumber, page.layout])),
  ]));
  let pages = 0;
  let findings = 0;
  for (let index = 1; index <= 7; index += 1) {
    const result = read("baseline", `paper${index}-regression.json`);
    const truth = truthBySample.get(result.sampleId);
    assert.ok(truth, result.sampleId);
    assert.equal(result.runtimeDecisionUse, "forbidden");
    assert.equal(result.findingCount, 0);
    assert.equal(result.results.length, truth.size);
    result.results.forEach((page) => {
      assert.equal(page.expected, truth.get(page.pageNumber));
      assert.equal(page.actual, page.expected);
      assert.equal(page.status, "pass");
      assert.equal(page.evidence.columnModel.authority, "AA-COLUMN-001");
      assert.equal(page.evidence.columnModel.evidence.basis, "body_text_flow_only");
    });
    pages += result.results.length;
    findings += result.findingCount;
  }
  assert.equal(pages, summary.pageCount);
  assert.equal(findings, summary.findingCount);
  assert.deepEqual(summary.layoutCoverage, { singleColumnPages: 44, doubleColumnPages: 46, mixedBodyFlowPages: 0 });
});

test("pre-repair findings and RCA remain audit Evidence, not the canonical baseline", () => {
  let findings = 0;
  for (let index = 1; index <= 7; index += 1) {
    findings += read("evidence", "pre-repair-regression", `paper${index}-regression.json`).findingCount;
  }
  const rca = read("evidence", "root-cause-analysis.json");
  assert.equal(findings, 34);
  assert.equal(rca.regression.findings, 34);
  assert.equal(rca.runtimeDecisionUse, "forbidden");
  assert.equal(rca.corpus.pages, 90);
});
