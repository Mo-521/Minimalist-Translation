"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const REVIEW = path.join(__dirname, "..", "..", "..", "..", ".governance", "tasks", "layout-geometry-capability-audit", "evidence", "phase-2-paper-geometry", "human-review-cross-sample-paper8-10-v1");
const PAPERS = ["paper8", "paper9", "paper10"];
const COLUMN_CORPUS = path.join(__dirname, "..", "..", "..", "electron-app", "capability-library", "capabilities", "cap.column-recognition", "corpus.json");

test("paper8-10 cross-sample review pack is self-contained and not promoted", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(REVIEW, "MANIFEST.json"), "utf8"));
  assert.equal(manifest.candidateAcceptance, "not_performed");
  assert.equal(manifest.promotion, "not_performed");
  assert.equal(manifest.columnCorpusMutation, "not_performed");
  assert.equal(manifest.runtimeDecisionUse, "forbidden");
  assert.deepEqual(manifest.papers, PAPERS);
  PAPERS.forEach((paper) => {
    ["-body.html", "-non-body.html", "-complete.html"].forEach((suffix) => {
      const html = fs.readFileSync(path.join(REVIEW, `${paper}${suffix}`), "utf8");
      assert.match(html, /src="data:image\/jpeg;base64,/);
      assert.doesNotMatch(html, /src="pages\//);
      assert.match(html, /未 Accept/);
    });
    assert.equal(JSON.parse(fs.readFileSync(path.join(REVIEW, `${paper}-body-candidate.json`), "utf8")).promotion, "not_performed");
    assert.equal(JSON.parse(fs.readFileSync(path.join(REVIEW, `${paper}-non-body-candidate.json`), "utf8")).promotion, "not_performed");
  });
});

test("paper8-10 review did not add samples to frozen Column corpus", () => {
  const corpus = JSON.parse(fs.readFileSync(COLUMN_CORPUS, "utf8"));
  const ids = corpus.samples.map((sample) => sample.id);
  PAPERS.forEach((paper) => {
    assert.equal(ids.includes(`sample.column-pilot.${paper}`), false);
  });
});
