"use strict";

// Repeatable interaction smoke using a real paper page. The output is a draft
// demonstration only; it does not alter the oracle or accept/promote a candidate.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const editor = require("./layout-geometry-body-editor");

const ROOT = path.resolve(__dirname, "../..");
const evidence = path.join(ROOT, ".governance/tasks/layout-geometry-capability-audit/evidence/phase-2-paper-geometry");
const output = path.join(evidence, "human-review-body-editable-v1");
const oracle = JSON.parse(fs.readFileSync(path.join(evidence, "oracles/paper1-geometry-oracle.json"), "utf8"));
const paper = "paper1";
const sha = oracle.sample.sha256;
const machinePages = () => oracle.pages.map((page) => editor.initialPage(
  paper,
  page.identity.pageNumber,
  page.pageSize,
  page.regions.filter((region) => region.regionClass === "body_column").map((region) => ({
    id: region.regionId,
    canonicalColumnId: region.canonicalColumnRef.columnId,
    geometry: region.expectedGeometry,
  })),
));
const pages = machinePages();
const page = pages[0];
const originalPrediction = JSON.stringify(page.predicted);
const original = { ...page.corrected[0].geometry };

// Convert the same PDF point at two rendered sizes; zoom must not change it.
const mappedAt140 = editor.pointFromClient(140, 280, { left: 0, top: 0, width: page.pageSize.width * 1.4, height: page.pageSize.height * 1.4 }, page.pageSize);
const mappedAt200 = editor.pointFromClient(200, 400, { left: 0, top: 0, width: page.pageSize.width * 2, height: page.pageSize.height * 2 }, page.pageSize);
assert.deepEqual(mappedAt140, mappedAt200);
assert.deepEqual(mappedAt140, { x: 100, y: 200 });

page.corrected[0].geometry = editor.moveBox(original, { x: 3, y: 4 }, page.pageSize);
page.corrected[0].geometry = editor.resizeBox(page.corrected[0].geometry, "se", { x: 5, y: 6 }, page.pageSize);
const movedAndResized = { ...page.corrected[0].geometry };
const temporary = editor.normalizeBox({ x: 360, y: 730 }, { x: 405, y: 760 }, page.pageSize);
page.corrected.push({ id: "demo-temp", sourceRegionId: null, canonicalColumnId: null, geometry: temporary });
page.corrected = page.corrected.filter((item) => item.id !== "demo-temp");
const newBox = editor.normalizeBox({ x: 420, y: 730 }, { x: 470, y: 760 }, page.pageSize);
page.corrected.push({ id: "demo-new-body", sourceRegionId: null, canonicalColumnId: null, geometry: newBox });
page.confirmed = true;

const exported = editor.exportGroundTruth(paper, pages, sha);
const restored = editor.restoreGroundTruth(JSON.parse(JSON.stringify(exported)), paper, sha, machinePages());
assert.deepEqual(editor.exportGroundTruth(paper, restored, sha), exported);
assert.equal(JSON.stringify(page.predicted), originalPrediction);
assert.equal(page.corrected.length, page.predicted.length + 1);
assert.equal(page.confirmed, true);

const trace = {
  schemaVersion: "layout-geometry-body-editor-demo/v1",
  status: "programmatic_smoke_pass",
  paper, pageNumber: 1,
  sourcePdfSha256: sha,
  importedInBrowser: false,
  actions: ["move predicted copy", "resize selected box", "create temporary box", "delete temporary box", "create retained box", "confirm page", "export JSON", "restore JSON"],
  zoomInvariantPdfPoint: mappedAt140,
  originalPrediction: page.predicted[0].geometry,
  movedAndResized,
  retainedNewBox: newBox,
  predictedUnchanged: JSON.stringify(page.predicted) === originalPrediction,
  exportImportExactMatch: true,
  note: "Import DEMO_GROUND_TRUTH_DRAFT.json in paper1.html to inspect the example visually. This is not accepted truth.",
};
fs.writeFileSync(path.join(output, "DEMO_GROUND_TRUTH_DRAFT.json"), `${JSON.stringify(exported, null, 2)}\n`);
fs.writeFileSync(path.join(output, "DEMO_TRACE.json"), `${JSON.stringify(trace, null, 2)}\n`);
console.log(JSON.stringify({ status: trace.status, paper, page: 1, exactRestore: true, zoomInvariant: true }));
