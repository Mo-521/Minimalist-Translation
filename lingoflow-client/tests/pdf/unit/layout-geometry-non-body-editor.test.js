"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const editor = require("../../../tools/layout-geometry-non-body-editor");
const { candidateChecks } = require("../../../tools/layout-geometry-non-body-editable");

const ROOT = path.resolve(__dirname, "../../../..");
const OUTPUT = path.join(ROOT, ".governance/archive/evidence/layout-geometry-capability-audit/evidence/phase-2-paper-geometry/human-review-final-paper1-10-v8");
const PAPERS = Array.from({ length: 10 }, (_, index) => `paper${index + 1}`);

test("non-Body coordinates are invariant under page zoom", () => {
  const size = { width: 612, height: 792 };
  const first = editor.pointFromClient(242, 350, { left: 20, top: 20, width: 666, height: 862 }, size);
  const second = editor.pointFromClient(353, 515, { left: 20, top: 20, width: 999, height: 1293 }, size);
  assert.deepEqual(first, second);
});

test("non-Body draft keeps machine prediction separate and supports type correction", () => {
  const predicted = [{ id: "p1.independent.title.1", sourceRegionId: "p1.independent.title.1", objectType: "title", regionClass: "independent_region", semanticRegionType: "title", protectedKind: null, geometry: { x: 10, y: 20, width: 80, height: 15 } }];
  const page = editor.initialPage("paper1", 1, { width: 612, height: 792 }, predicted);
  const before = JSON.stringify(page.predicted);
  editor.setObjectType(page.corrected[0], "header");
  page.corrected[0].geometry = editor.moveBox(page.corrected[0].geometry, { x: 2, y: 3 }, page.pageSize);
  page.corrected.push({ id: "manual", sourceRegionId: null, objectType: "figure", ...editor.descriptorForType("figure"), geometry: { x: 100, y: 100, width: 200, height: 160 } });
  page.confirmed = true;
  const document = editor.exportGroundTruth("paper1", [page], "a".repeat(64));
  const restored = editor.restoreGroundTruth(document, "paper1", "a".repeat(64), [editor.initialPage("paper1", 1, page.pageSize, predicted)]);
  assert.equal(JSON.stringify(page.predicted), before);
  assert.equal(restored[0].corrected[0].objectType, "header");
  assert.equal(restored[0].corrected[1].objectType, "figure");
  assert.equal(restored[0].confirmed, true);
});

test("generated HTML contains only editable non-Body candidates", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(OUTPUT, "MANIFEST.json"), "utf8"));
  assert.equal(manifest.runtimeDecisionUse, "forbidden");
  assert.equal(manifest.candidateAcceptance, "not_performed");
  assert.equal(manifest.promotion, "not_performed");
  assert.equal(manifest.results.reduce((sum, item) => sum + item.pages, 0), 126);
  PAPERS.forEach((paper) => {
    const html = fs.readFileSync(path.join(OUTPUT, `${paper}-non-body.html`), "utf8");
    const candidate = JSON.parse(fs.readFileSync(path.join(OUTPUT, `${paper}-non-body-ground-truth-draft.json`), "utf8"));
    assert.equal((html.match(/class="editable-page"/g) || []).length, candidate.pages.length);
    assert.equal((html.match(/class="machine-predicted"/g) || []).length, candidate.pages.length);
    assert.match(html, /src="data:image\/jpeg;base64,/);
    assert.match(html, /id="export-ground-truth"/);
    assert.match(html, /id="import-ground-truth"/);
    assert.doesNotMatch(html, /class="body-predicted"|aria-label="可编辑正文候选框"|data-class="body_column"/);
    candidate.pages.flatMap((page) => page.predicted).forEach((item) => {
      assert.notEqual(item.objectType, "formula");
      assert.notEqual(item.objectType, "margin");
      assert.ok(["independent_region", "protected_region"].includes(item.regionClass));
    });
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    assert.equal(scripts.length, 2);
    scripts.forEach((script) => assert.doesNotThrow(() => new Function(script)));
  });
});

test("double-column reference entries cannot cross the gutter or mutually swallow lanes", () => {
  const clean = candidateChecks([{
    pageNumber: 1,
    pageSize: { width: 600, height: 800 },
    columnLayout: "double_column",
    predicted: [
      { id: "left", objectType: "reference_entries", geometry: { x: 40, y: 100, width: 240, height: 500 } },
      { id: "right", objectType: "reference_entries", geometry: { x: 320, y: 80, width: 240, height: 520 } },
    ],
  }]);
  assert.deepEqual(clean.referenceLaneViolations, []);

  const broken = candidateChecks([{
    pageNumber: 1,
    pageSize: { width: 600, height: 800 },
    columnLayout: "double_column",
    predicted: [
      { id: "left", objectType: "reference_entries", geometry: { x: 40, y: 100, width: 500, height: 500 } },
      { id: "right", objectType: "reference_entries", geometry: { x: 60, y: 100, width: 500, height: 500 } },
    ],
  }]);
  assert.equal(broken.status, "review_required");
  assert.ok(broken.referenceLaneViolations.some((item) => item.reason === "crosses_column_gutter"));
  assert.ok(broken.referenceLaneViolations.some((item) => item.reason === "reference_boxes_mutually_overlap"));
});

test("caption and table overextension are surfaced for review", () => {
  const result = candidateChecks([{
    pageNumber: 4,
    pageSize: { width: 600, height: 800 },
    columnLayout: "single_column",
    predicted: [
      { id: "caption", objectType: "figure_caption", geometry: { x: 40, y: 100, width: 500, height: 120 } },
      { id: "table", objectType: "table", geometry: { x: 40, y: 300, width: 500, height: 380 } },
    ],
  }]);
  assert.equal(result.status, "review_required");
  assert.equal(result.captionOverextensionSuspects.length, 1);
  assert.equal(result.tableOverextensionSuspects.length, 1);
});

test("figure and table ownership overlap is surfaced for review", () => {
  const result = candidateChecks([{
    pageNumber: 4,
    pageSize: { width: 600, height: 800 },
    columnLayout: "single_column",
    predicted: [
      { id: "figure", objectType: "figure", geometry: { x: 40, y: 180, width: 500, height: 300 } },
      { id: "table", objectType: "table", geometry: { x: 40, y: 80, width: 500, height: 140 } },
    ],
  }]);
  assert.equal(result.status, "review_required");
  assert.equal(result.figureTableOwnershipConflicts.length, 1);
});
