"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { bodyOwnershipChecks } = require("../../../tools/layout-geometry-cross-sample-review");

const REVIEW = path.join(__dirname, "..", "..", "..", "..", ".governance", "archive", "evidence", "layout-geometry-capability-audit", "evidence", "phase-2-paper-geometry", "human-review-final-paper1-10-v8");
const PAPERS = ["paper8", "paper9", "paper10"];
const COLUMN_CORPUS = path.join(__dirname, "..", "..", "..", "electron-app", "capability-library", "capabilities", "cap.column-recognition", "corpus.json");

test("latest paper8-10 review pack is self-contained and keeps predictions separate", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(REVIEW, "MANIFEST.json"), "utf8"));
  assert.equal(manifest.candidateAcceptance, "not_performed");
  assert.equal(manifest.promotion, "not_performed");
  assert.equal(manifest.columnCorpusMutation, "not_performed");
  assert.equal(manifest.runtimeDecisionUse, "forbidden");
  assert.deepEqual(manifest.papers.slice(-3), PAPERS);
  PAPERS.forEach((paper) => {
    ["-body.html", "-non-body.html", "-complete.html"].forEach((suffix) => {
      const html = fs.readFileSync(path.join(REVIEW, `${paper}${suffix}`), "utf8");
      assert.match(html, /src="data:image\/jpeg;base64,/);
      assert.doesNotMatch(html, /src="pages\//);
      assert.match(html, /未 Accept/);
    });
    assert.equal(JSON.parse(fs.readFileSync(path.join(REVIEW, `${paper}-body-ground-truth-draft.json`), "utf8")).pages.every((page) => page.confirmed), true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(REVIEW, `${paper}-non-body-ground-truth-draft.json`), "utf8")).pages.every((page) => page.confirmed), true);
  });
});

test("paper8-10 Geometry review artifacts remain unpromoted even after separate Column promotion", () => {
  const corpus = JSON.parse(fs.readFileSync(COLUMN_CORPUS, "utf8"));
  const ids = corpus.samples.map((sample) => sample.id);
  PAPERS.forEach((paper) => {
    assert.equal(ids.includes(`sample.column-pilot.${paper}`), true);
  });
});

test("Body ownership check catches leading figures and bibliography intrusion", () => {
  const body = [{ pageNumber: 1, candidate: [{ id: "body", geometry: { x: 40, y: 80, width: 520, height: 120 } }] }];
  const objects = [{ predicted: [
    { id: "figure", objectType: "figure", geometry: { x: 310, y: 60, width: 230, height: 100 } },
    { id: "refs", objectType: "reference_entries", geometry: { x: 310, y: 120, width: 230, height: 70 } },
  ] }];
  const result = bodyOwnershipChecks(body, objects);
  assert.equal(result.status, "review_required");
  assert.equal(result.leadingObjectIntrusions.length, 1);
  assert.equal(result.referenceIntrusions.length, 1);
});
