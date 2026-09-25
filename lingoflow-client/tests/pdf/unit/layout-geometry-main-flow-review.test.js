"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { predictPage } = require("../../../tools/layout-geometry-main-flow-review");

const root = path.resolve(__dirname, "../../../..");
const evidence = path.join(root, ".governance", "tasks", "layout-geometry-capability-audit", "evidence", "phase-2-paper-geometry");
const output = path.join(evidence, "human-review-main-flow-v1");

test("main-flow revision preserves all original predictions and human corrections", () => {
  let pages = 0;
  let confirmed = 0;
  let confirmedInExports = 0;
  for (let number = 1; number <= 7; number += 1) {
    const paper = `paper${number}`;
    const candidate = JSON.parse(fs.readFileSync(path.join(output, `${paper}-comparison.json`), "utf8"));
    const draft = JSON.parse(fs.readFileSync(path.join(evidence, "human-review-body-editable-v1", candidate.correctedDraftFile), "utf8"));
    const html = fs.readFileSync(path.join(output, `${paper}.html`), "utf8");
    assert.equal(candidate.runtimeDecisionUse, "forbidden");
    assert.equal(candidate.candidateAcceptance, "not_performed");
    assert.equal(candidate.promotion, "not_performed");
    assert.equal(candidate.sourcePdfSha256, draft.sourcePdfSha256);
    assert.equal(candidate.pages.length, draft.pages.length);
    confirmedInExports += draft.pages.filter((page) => page.confirmed).length;
    assert.match(html, /data:image\/jpeg;base64,/);
    assert.match(html, /旧预测 \/ 新候选 \/ 人工 corrected/);
    assert.doesNotMatch(html, /independent_region|protected_region|writable_space_expectation/);
    for (const page of candidate.pages) {
      const original = draft.pages.find((item) => item.pageNumber === page.pageNumber);
      assert.deepEqual(page.predicted, original.predicted);
      assert.deepEqual(page.corrected, original.corrected);
      assert.equal(page.confirmed, original.confirmed);
      assert.ok(page.comparison.correctedCoverage >= 0 && page.comparison.correctedCoverage <= 1);
      assert.equal(new Set(page.candidate.map((item) => item.id)).size, page.candidate.length);
      for (const item of page.candidate) {
        const box = item.geometry;
        assert.ok(box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0);
        assert.ok(box.x + box.width <= page.pageSize.width + 0.01);
        assert.ok(box.y + box.height <= page.pageSize.height + 0.01);
      }
      pages++;
      if (page.confirmed) {
        confirmed++;
      }
    }
  }
  assert.equal(pages, 90);
  assert.equal(confirmed, confirmedInExports);
});

test("front-matter labels and isolated running titles do not anchor Body", () => {
  const first = (paper) => JSON.parse(fs.readFileSync(path.join(output, `${paper}-comparison.json`), "utf8")).pages[0];
  for (const paper of ["paper5", "paper6"]) {
    const body = first(paper).candidate.find((item) => item.canonicalColumnId === "single");
    assert.ok(body.geometry.y > 200, `${paper} Abstract label became a Body top anchor`);
  }
  const paper7 = first("paper7");
  const wide = paper7.candidate.find((item) => item.canonicalColumnId === null);
  assert.ok(wide.geometry.y > 120, "paper7 author or affiliation preamble joined the abstract flow");
  const paper3Last = JSON.parse(fs.readFileSync(path.join(output, "paper3-comparison.json"), "utf8")).pages[13];
  assert.deepEqual(paper3Last.candidate, [], "isolated running author header before References became Body");
});

test("formula is part of a continuous main reading-flow extent", () => {
  const item = (str, x, y, width) => ({ str, x, y, width, height: 10, fontSize: 10 });
  const page = {
    pageNumber: 2,
    pageSize: { width: 600, height: 800 },
    items: [
      item("The first paragraph of the main reading flow extends across this entire single column", 45, 260, 450),
      item("μ = α + β", 190, 319, 150),
      item("The next paragraph resumes the same reading flow after the displayed equation", 45, 372, 445),
    ],
  };
  const model = { columnGeometry: { left: { x: 40, width: 250 }, right: { x: 310, width: 250 } } };
  const predicted = predictPage(page, { layout: "single_column" }, model, null);
  const single = predicted.find((item) => item.canonicalColumnId === "single");
  assert.ok(single);
  assert.ok(single.geometry.y <= 250);
  assert.ok(single.geometry.y + single.geometry.height >= 372);
});

test("cross-gutter PDF line joins do not fragment a continuous two-lane page", () => {
  const page = JSON.parse(fs.readFileSync(path.join(output, "paper1-comparison.json"), "utf8")).pages[3];
  assert.equal(page.pageNumber, 4);
  assert.deepEqual(page.candidate.map((item) => item.canonicalColumnId).sort(), ["left", "right"]);
  assert.ok(page.candidate.every((item) => item.geometry.height > 600));
});

test("supplementary content after references resumes Body generation without a page-specific exception", () => {
  const paper = JSON.parse(fs.readFileSync(path.join(output, "paper4-comparison.json"), "utf8"));
  for (const pageNumber of [13, 14, 15, 16]) {
    const page = paper.pages[pageNumber - 1];
    assert.ok(page.candidate.length > 0, `paper4 p${pageNumber} missing Body candidate`);
    assert.ok(page.comparison.correctedCoverage > (pageNumber === 16 ? 0.5 : 0.75), `paper4 p${pageNumber} corrected content not covered`);
  }
});

test("references start is lane-aware and does not swallow earlier Body or acknowledgements", () => {
  const paper4 = JSON.parse(fs.readFileSync(path.join(output, "paper4-comparison.json"), "utf8")).pages[9];
  const left = paper4.candidate.find((item) => item.canonicalColumnId === "left");
  const right = paper4.candidate.find((item) => item.canonicalColumnId === "right");
  assert.ok(left.geometry.y + left.geometry.height > 750);
  assert.ok(right.geometry.y + right.geometry.height < 400);
  const paper7 = JSON.parse(fs.readFileSync(path.join(output, "paper7-comparison.json"), "utf8")).pages[9];
  assert.deepEqual(paper7.candidate.map((item) => item.canonicalColumnId).sort(), ["left", "right"]);
  assert.ok(paper7.comparison.correctedCoverage > 0.9);
});

test("table and figure captions delimit Body instead of becoming Body boxes", () => {
  const page = (paper, number) => JSON.parse(fs.readFileSync(path.join(output, `${paper}-comparison.json`), "utf8")).pages[number - 1];
  assert.ok(page("paper4", 2).candidate.every((item) => item.geometry.y > 330));
  const rightOfSideBySideTable = page("paper4", 7).candidate.find((item) => item.canonicalColumnId === "right");
  assert.ok(rightOfSideBySideTable.geometry.y < 290, "left-column table blocked right-column Body");
  assert.equal(page("paper5", 8).candidate.length, 0, "figure-only page produced a Body caption");
  assert.ok(page("paper5", 9).candidate.every((item) => item.geometry.y > 120));
  assert.equal(page("paper5", 10).candidate.length, 0, "figure/table-only page produced Body captions");
  assert.ok(page("paper5", 5).candidate.some((item) => item.geometry.y < 445
    && item.geometry.y + item.geometry.height > 520), "prose immediately after a caption was swallowed");
  assert.ok(page("paper6", 8).candidate.every((item) => item.geometry.y > 300));
  for (const paper of ["paper4", "paper5", "paper6"]) {
    const comparison = JSON.parse(fs.readFileSync(path.join(output, `${paper}-comparison.json`), "utf8"));
    assert.ok(comparison.pages.every((item) => item.candidate.every((candidate) => candidate.evidence.kind !== "caption-reading-segment")));
  }
});

test("the visible lower glyphs of a displayed formula remain inside the Body extent", () => {
  const page = JSON.parse(fs.readFileSync(path.join(output, "paper6-comparison.json"), "utf8")).pages[3];
  const body = page.candidate.find((item) => item.canonicalColumnId === "single");
  assert.ok(body);
  assert.ok(body.geometry.y + body.geometry.height > 718);
});
