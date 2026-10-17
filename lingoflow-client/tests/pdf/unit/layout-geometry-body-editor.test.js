"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const editor = require("../../../tools/layout-geometry-body-editor");

function machinePages(paper = "synthetic") {
  return {
    sha: "a".repeat(64),
    pages: [editor.initialPage(paper, 1, { width: 612, height: 792 }, [
      { id: "body-1", canonicalColumnId: "column-1", geometry: { x: 40, y: 60, width: 220, height: 500 } },
      { id: "body-2", canonicalColumnId: "column-2", geometry: { x: 320, y: 60, width: 220, height: 500 } },
    ])],
  };
}

test("PDF point conversion is invariant under page zoom", () => {
  const size = { width: 612, height: 792 };
  const p1 = editor.pointFromClient(242, 350, { left: 20, top: 20, width: 666, height: 862 }, size);
  const p2 = editor.pointFromClient(353, 515, { left: 20, top: 20, width: 999, height: 1293 }, size);
  assert.deepEqual(p1, p2);
});

test("multiple corrected Body boxes support create, move, resize, delete, reset and confirmation", () => {
  const { sha, pages } = machinePages();
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
  const exported = editor.exportGroundTruth("synthetic", pages, sha);
  const restored = editor.restoreGroundTruth(JSON.parse(JSON.stringify(exported)), "synthetic", sha, machinePages().pages);
  assert.deepEqual(editor.exportGroundTruth("synthetic", restored, sha), exported);
  assert.equal(JSON.stringify(page.predicted), prediction);
  assert.equal(exported.pages[0].confirmed, true);
  assert.equal(exported.pages[0].corrected.length, exported.pages[0].predicted.length + 1);
  page.corrected = editor.predictedCopy(page.predicted);
  page.confirmed = false;
  assert.deepEqual(page.corrected.map((item) => item.geometry), page.predicted.map((item) => item.geometry));
  assert.equal(page.confirmed, false);
});

test("import rejects stale prediction, wrong source PDF and invalid geometry", () => {
  const { sha, pages } = machinePages();
  const document = editor.exportGroundTruth("synthetic", pages, sha);
  assert.throws(() => editor.restoreGroundTruth(document, "synthetic", "wrong-hash", machinePages().pages));
  const stale = structuredClone(document);
  stale.pages[0].predicted[0].geometry.x += 1;
  assert.throws(() => editor.restoreGroundTruth(stale, "synthetic", sha, machinePages().pages));
  const invalid = structuredClone(document);
  invalid.pages[0].corrected[0].geometry.width = 9999;
  assert.throws(() => editor.restoreGroundTruth(invalid, "synthetic", sha, machinePages().pages));
});
