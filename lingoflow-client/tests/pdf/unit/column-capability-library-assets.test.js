"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..", "..", "..", "electron-app", "capability-library", "domains", "column-region-recognition", "capabilities", "cap.column-recognition");
const read = (...parts) => JSON.parse(fs.readFileSync(path.join(ROOT, ...parts), "utf8"));

test("canonical Column corpus preserves the original seven reviewed truths while adding three promoted samples", () => {
  const corpusPath = path.join(ROOT, "corpus.json");
  const bytes = fs.readFileSync(corpusPath);
  const corpus = JSON.parse(bytes);
  assert.equal(crypto.createHash("sha256").update(JSON.stringify(corpus.samples.slice(0, 7))).digest("hex"), "15bd329643cd0d726c4c9246b423c67c662b0c14d63e10783f1cf797a4c340d1");
  assert.equal(corpus.runtimeDecisionUse, "forbidden");
  assert.equal(corpus.samples.length, 10);
  assert.equal(corpus.samples.reduce((total, sample) => total + sample.source.pageCount, 0), 126);
  assert.deepEqual(corpus.samples.map((sample) => sample.id), Array.from({ length: 10 }, (_, index) => `sample.column-pilot.paper${index + 1}`));
  corpus.samples.forEach((sample) => {
    assert.equal(sample.storage.binaryCommitted, false);
    assert.equal(sample.authorityBoundary.runtimeDecisionUse, "forbidden");
    assert.deepEqual(sample.authorityBoundary.finalDecisionsOwnedBy, ["AA-COLUMN-001"]);
    assert.equal(sample.expectedOutcomes[0].expected.pageLayoutBasis, "body_text_flow_only");
  });
});

test("public Column batch summary identifies the accepted cohort without bundled per-page replay", () => {
  const corpus = read("corpus.json");
  const batch = read("batches", "B001", "manifest.json");
  assert.equal(batch.batchId, "B001");
  assert.equal(batch.runtimeDecisionUse, "forbidden");
  assert.deepEqual(batch.samples.map((sample) => sample.id), corpus.samples.map((sample) => sample.id));
  assert.equal(batch.samples.reduce((sum, sample) => sum + sample.pages, 0), 126);
});
