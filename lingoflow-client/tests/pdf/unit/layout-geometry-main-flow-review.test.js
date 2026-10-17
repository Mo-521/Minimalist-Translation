"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { predictPage, visualHintsForPage } = require("../../../tools/layout-geometry-main-flow-review");

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

test("leading figure and caption cannot anchor a lane above its real prose", () => {
  const item = (str, x, y, width) => ({ str, x, y, width, height: 10, fontSize: 10 });
  const page = {
    pageNumber: 2,
    pageSize: { width: 600, height: 800 },
    items: [
      item("Left column prose continues above the illustration", 42, 95, 240),
      item("Left column prose continues below the illustration", 42, 500, 240),
      item("Plot legend and axis description", 320, 155, 210),
      item("The caption describes the illustration", 320, 400, 210),
      item("Right column prose begins below the caption", 320, 460, 210),
      item("Right column prose continues down the page", 320, 510, 210),
    ],
  };
  const model = { columnGeometry: { left: { x: 36, width: 250 }, right: { x: 314, width: 250 } } };
  const objects = [
    { objectType: "figure", geometry: { x: 314, y: 80, width: 250, height: 300 } },
    { objectType: "figure_caption", geometry: { x: 314, y: 390, width: 250, height: 30 } },
  ];
  const frames = predictPage(page, { layout: "double_column" }, model, null, [], [], objects);
  const left = frames.find((frame) => frame.canonicalColumnId === "left");
  const right = frames.find((frame) => frame.canonicalColumnId === "right");
  assert.ok(left.geometry.y < 100);
  assert.ok(right.geometry.y >= 440, "figure/caption text anchored the right Body top");
});

test("a tall leading caption remains outside Body while prose resumes below it", () => {
  const item = (str, x, y, width) => ({ str, x, y, width, height: 10, fontSize: 10 });
  const page = {
    pageNumber: 2,
    pageSize: { width: 600, height: 800 },
    items: [
      item("A long caption starts by describing the figure", 320, 210, 210),
      item("The caption continues with experimental detail", 320, 250, 210),
      item("The caption ends with additional measurements", 320, 325, 210),
      item("The independent prose begins after the figure caption", 320, 385, 210),
      item("The next sentence continues the main reading flow", 320, 425, 210),
    ],
  };
  const model = { columnGeometry: { left: { x: 36, width: 250 }, right: { x: 314, width: 250 } } };
  const objects = [
    { objectType: "figure", geometry: { x: 314, y: 65, width: 250, height: 135 } },
    { objectType: "figure_caption", geometry: { x: 314, y: 205, width: 250, height: 145 } },
  ];
  const frames = predictPage(page, { layout: "double_column" }, model, null, [], [], objects);
  const right = frames.find((frame) => frame.canonicalColumnId === "right");
  assert.ok(right);
  assert.ok(right.geometry.y > 350, "the safety band entered the caption");
  assert.ok(right.geometry.y < 370, "the first prose line lost its small safety band");
});

test("dense table text hint stops before larger two-lane prose resumes", () => {
  const item = (str, x, y, width, fontSize) => ({ str, x, y, width, height: fontSize, fontSize });
  const page = {
    pageNumber: 3,
    pageSize: { width: 600, height: 800 },
    items: [
      item("Table 4: Comparative results for the benchmark", 42, 100, 510, 10),
      ...[150, 165, 180].flatMap((y) => [
        item("Model A", 50, y, 90, 8), item("84.12", 220, y, 30, 8),
        item("92.31", 360, y, 30, 8), item("75.44", 490, y, 30, 8),
      ]),
      item("The prose returns in the left reading lane", 45, 215, 240, 11),
      item("The prose returns", 315, 215, 95, 11),
      item("in the right lane", 425, 215, 110, 11),
      item("A second left-lane sentence follows", 45, 230, 240, 11),
      item("A second right-lane sentence follows", 315, 230, 230, 11),
    ],
  };
  const hint = visualHintsForPage(page).visualObjects.find((object) => object.hintKind === "dense_table");
  assert.ok(hint, "the tabular rows should still form a dense-table hint");
  assert.ok(hint.y + hint.height < 205, "ordinary prose extended the table blocker");
});

test("a trailing object's coarse extent cannot truncate established prose", () => {
  const item = (str, y) => ({ str, x: 42, y, width: 230, height: 10, fontSize: 10 });
  const page = {
    pageNumber: 3,
    pageSize: { width: 600, height: 800 },
    items: [item("The main reading flow begins here", 90),
      item("The paragraph continues before the figure", 460),
      item("Its final line partly overlaps a coarse object region", 500)],
  };
  const model = { columnGeometry: { single: { x: 36, width: 250 } } };
  const objects = [{ objectType: "figure", geometry: { x: 36, y: 485, width: 250, height: 180 } }];
  const baseline = predictPage(page, { layout: "single_column" }, model, null);
  const frames = predictPage(page, { layout: "single_column" }, model, null, [], [], objects);
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0].geometry, baseline[0].geometry);
});

test("single Body flow beside a continuing bibliography keeps its physical lane width", () => {
  const item = (str, x, y, width) => ({ str, x, y, width, height: 10, fontSize: 10 });
  const page = {
    pageNumber: 10,
    pageSize: { width: 600, height: 800 },
    items: [
      item("The conclusion continues in the left lane", 42, 90, 240),
      item("Its final paragraph remains in that lane", 42, 130, 240),
      item("References", 135, 190, 80),
      item("Smith and Jones, Journal 2025", 320, 90, 230),
      item("Brown and White, Journal 2026", 320, 130, 230),
    ],
  };
  const model = { columnGeometry: { left: { x: 36, width: 250 }, right: { x: 314, width: 250 } } };
  const references = [{ objectType: "reference_entries", geometry: { x: 314, y: 75, width: 250, height: 140 } }];
  const frames = predictPage(page, { layout: "single_column" }, model,
    { pageNumber: 10, y: 180, x: 135, width: 80 }, [], [], references);
  assert.equal(frames.length, 1);
  assert.ok(frames[0].geometry.width <= 260);
  assert.ok(frames[0].geometry.x < 100);
});
