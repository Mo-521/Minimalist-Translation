"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const editor = require("../../../tools/layout-geometry-body-editor");

const ROOT = path.resolve(__dirname, "../../../..");
const EVIDENCE = path.join(ROOT, ".governance/tasks/layout-geometry-capability-audit/evidence/phase-2-paper-geometry");
const OUTPUT = path.join(EVIDENCE, "human-review-body-editable-v1");
const PAPERS = ["paper1", "paper2", "paper3", "paper4", "paper5", "paper6", "paper7"];

function machinePages(paper) {
  const oracle = JSON.parse(fs.readFileSync(path.join(EVIDENCE, "oracles", `${paper}-geometry-oracle.json`), "utf8"));
  return {
    sha: oracle.sample.sha256,
    pages: oracle.pages.map((page) => editor.initialPage(paper, page.identity.pageNumber, page.pageSize,
      page.regions.filter((region) => region.regionClass === "body_column").map((region) => ({
        id: region.regionId,
        canonicalColumnId: region.canonicalColumnRef.columnId,
        geometry: region.expectedGeometry,
      })))),
  };
}

test("PDF point conversion is invariant under page zoom", () => {
  const size = { width: 612, height: 792 };
  const p1 = editor.pointFromClient(242, 350, { left: 20, top: 20, width: 666, height: 862 }, size);
  const p2 = editor.pointFromClient(353, 515, { left: 20, top: 20, width: 999, height: 1293 }, size);
  assert.deepEqual(p1, p2);
});

test("multiple corrected Body boxes support create, move, resize, delete, reset and confirmation", () => {
  const { sha, pages } = machinePages("paper1");
  const page = pages[0];
  const prediction = JSON.stringify(page.predicted);
  const first = page.corrected[0];
  first.geometry = editor.moveBox(first.geometry, { x: 4, y: 5 }, page.pageSize);
  first.geometry = editor.resizeBox(first.geometry, "se", { x: 8, y: 9 }, page.pageSize);
  const created = editor.normalizeBox({ x: 350, y: 700 }, { x: 410, y: 740 }, page.pageSize);
  page.corrected.push({ id: "new-1", sourceRegionId: null, canonicalColumnId: null, geometry: created });
  assert.equal(page.corrected.length, page.predicted.length + 1);
  page.corrected = page.corrected.filter((item) => item.id !== "new-1");
  assert.equal(page.corrected.length, page.predicted.length);
  page.corrected.push({ id: "new-2", sourceRegionId: null, canonicalColumnId: null, geometry: created });
  page.confirmed = true;
  const exported = editor.exportGroundTruth("paper1", pages, sha);
  const restored = editor.restoreGroundTruth(JSON.parse(JSON.stringify(exported)), "paper1", sha, machinePages("paper1").pages);
  assert.deepEqual(editor.exportGroundTruth("paper1", restored, sha), exported);
  assert.equal(JSON.stringify(page.predicted), prediction);
  assert.equal(exported.pages[0].confirmed, true);
  assert.equal(exported.pages[0].corrected.length, exported.pages[0].predicted.length + 1);
  page.corrected = editor.predictedCopy(page.predicted);
  page.confirmed = false;
  assert.deepEqual(page.corrected.map((item) => item.geometry), page.predicted.map((item) => item.geometry));
  assert.equal(page.confirmed, false);
});

test("import rejects stale prediction, wrong source PDF and invalid geometry", () => {
  const { sha, pages } = machinePages("paper1");
  const document = editor.exportGroundTruth("paper1", pages, sha);
  assert.throws(() => editor.restoreGroundTruth(document, "paper1", "wrong-hash", machinePages("paper1").pages));
  const stale = structuredClone(document);
  stale.pages[0].predicted[0].geometry.x += 1;
  assert.throws(() => editor.restoreGroundTruth(stale, "paper1", sha, machinePages("paper1").pages));
  const invalid = structuredClone(document);
  invalid.pages[0].corrected[0].geometry.width = 9999;
  assert.throws(() => editor.restoreGroundTruth(invalid, "paper1", sha, machinePages("paper1").pages));
});

test("all seven editable review pages remain self-contained and contain only Body overlays", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(OUTPUT, "LATEST_MACHINE_REVIEW_MANIFEST.json"), "utf8"));
  assert.equal(manifest.scope, "main_reading_flow_body_only");
  assert.equal(manifest.priorDraftsPreserved, true);
  assert.equal(manifest.runtimeDecisionUse, "forbidden");
  assert.equal(manifest.candidateAcceptance, "not_performed");
  assert.equal(manifest.promotion, "not_performed");
  assert.equal(manifest.papers.length, 7);
  assert.equal(manifest.papers.reduce((sum, item) => sum + item.pages, 0), 90);
  PAPERS.forEach((paper) => {
    const html = fs.readFileSync(path.join(OUTPUT, `${paper}.html`), "utf8");
    const comparison = JSON.parse(fs.readFileSync(path.join(EVIDENCE, "human-review-main-flow-v1", `${paper}-comparison.json`), "utf8"));
    const pages = comparison.pages;
    assert.equal((html.match(/class="editable-page"/g) || []).length, pages.length);
    assert.doesNotMatch(html, /class="predicted-rect"|旧预测 蓝|人工 corrected 橙/);
    assert.equal((html.match(/class="body-predicted"/g) || []).length, pages.length);
    assert.match(html, /src="data:image\/jpeg;base64,/);
    assert.match(html, /id="export-ground-truth"/);
    assert.match(html, /id="import-ground-truth"/);
    assert.doesNotMatch(html, /data-class="(?:independent_region|protected_region|writable_space_expectation)"/);
    const embedded = [...html.matchAll(/<script type="application\/json" class="body-predicted">([^<]*)<\/script>/g)];
    embedded.forEach((match, index) => assert.deepEqual(JSON.parse(match[1]), pages[index].candidate.map((item) => ({ id: item.id, canonicalColumnId: item.canonicalColumnId, geometry: item.geometry }))));
    const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    assert.equal(inlineScripts.length, 2);
    inlineScripts.forEach((source) => assert.doesNotThrow(() => new Function(source)));
  });
});

test("paper1 demonstration round-trips exact corrected boxes without changing predictions", () => {
  const demo = JSON.parse(fs.readFileSync(path.join(OUTPUT, "DEMO_GROUND_TRUTH_DRAFT.json"), "utf8"));
  const trace = JSON.parse(fs.readFileSync(path.join(OUTPUT, "DEMO_TRACE.json"), "utf8"));
  const { sha, pages } = machinePages("paper1");
  const restored = editor.restoreGroundTruth(demo, "paper1", sha, pages);
  assert.deepEqual(editor.exportGroundTruth("paper1", restored, sha), demo);
  assert.equal(trace.predictedUnchanged, true);
  assert.equal(trace.exportImportExactMatch, true);
  assert.equal(demo.pages[0].confirmed, true);
});
