"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  COLUMN_AUTHORITY_ID,
  INDEPENDENT_REGION_TYPES,
  publishPageColumnModel,
  assertPageColumnModel,
} = require("../../../electron-app/column-authority");

test("PageColumnModel is canonical, complete and deeply frozen", () => {
  const model = publishPageColumnModel({
    pageNumber: 5,
    pageWidth: 612,
    pageHeight: 792,
    layoutType: "double_column",
    columns: ["left", "right"],
    columnGeometry: {
      left: { x: 36, width: 252, center: 162 },
      right: { x: 324, width: 252, center: 450 },
    },
    independentRegions: [
      { id: "title-1", type: "title", bbox: { x: 36, y: 40, width: 540, height: 30 } },
      { id: "caption-1", type: "figure_caption", bbox: { x: 36, y: 250, width: 252, height: 24 } },
    ],
    evidence: { basis: "body_text_flow_only" },
  });

  assert.equal(model.authority, COLUMN_AUTHORITY_ID);
  assert.equal(model.layoutType, "double_column");
  assert.deepEqual(model.columns, ["left", "right"]);
  assert.equal(model.independentRegions[1].type, "figure_caption");
  assert.equal(model.evidence.basis, "body_text_flow_only");
  assert.equal(assertPageColumnModel(model, 5), model);
  assert.ok(Object.isFrozen(model));
  assert.ok(Object.isFrozen(model.columnGeometry.left));
  assert.ok(Object.isFrozen(model.independentRegions));
});

test("independent regions use the frozen finite vocabulary and do not alter layout", () => {
  assert.deepEqual(INDEPENDENT_REGION_TYPES, [
    "title",
    "abstract",
    "figure",
    "figure_caption",
    "table",
    "references_section_header",
    "other_independent",
  ]);
  const model = publishPageColumnModel({
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    layoutType: "double_column",
    columns: ["left", "right"],
    independentRegions: [{ type: "figure", bbox: { x: 0, y: 0, width: 612, height: 200 } }],
  });
  assert.equal(model.layoutType, "double_column");
  assert.throws(() => publishPageColumnModel({
    pageNumber: 1,
    layoutType: "double_column",
    columns: ["left", "right"],
    independentRegions: [{ type: "publisher_logo" }],
  }), /Unknown independent region type/);
});

test("invalid layout-column combinations and mutable impostors fail fast", () => {
  assert.throws(() => publishPageColumnModel({
    pageNumber: 2,
    layoutType: "single_column",
    columns: ["left", "right"],
  }), /Column set does not match/);
  assert.throws(() => assertPageColumnModel({
    authority: COLUMN_AUTHORITY_ID,
    schemaVersion: "page-column-model/v1",
  }, 2), /must be frozen/);
});

test("runtime publishes once, binds segments, and keeps writer and report read-only", () => {
  const mainSource = fs.readFileSync(path.resolve(__dirname, "../../../electron-app/main.js"), "utf8");
  assert.match(mainSource, /columnAuthority\.publishPageColumnModel\(\{ \.\.\.draft, independentRegions \}\)/);
  assert.match(mainSource, /segments = bindSegmentsToPageColumnModels\(segments, pageColumnModelsByPage\)/);
  assert.match(mainSource, /columnAuthority\.assertPageColumnModel\(pipelinePage\.columnModel, pageNumber\)/);
  assert.match(mainSource, /columnReassignedByBbox: false/);
  assert.doesNotMatch(mainSource, /column = inferredColumn/);
  assert.doesNotMatch(mainSource, /const repairedColumn = \["left", "right"\]\.includes\(inferredColumn\)/);
});
