"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const source = require("../../../tools/layout-geometry-candidate-intake");

function line(text, x, y, width) {
  return {
    text, x, y, width, height: 9, maxFont: 9, fontNames: ["Body"],
    items: [{ str: text, x, width, fontSize: 9, fontName: "Body" }],
  };
}

function regions(lines, images = []) {
  const page = {
    pageNumber: 3,
    pageSize: { width: 612, height: 792 },
    items: [], images, drawings: [], headingFontNames: new Set(),
  };
  const columnModel = {
    layoutType: "double_column",
    columnGeometry: { left: { x: 50, width: 245 }, right: { x: 302, width: 260 } },
    independentRegions: [],
  };
  return source.buildIndependentRegions(page, ["figure_caption", "figure"], lines, columnModel).regions;
}

test("same-baseline gutter-spanning continuation belongs to the caption, not the visual anchor", () => {
  const image = { sourceArtifactId: "image:synthetic", imageObjectId: "synthetic",
    geometry: { x: 80, y: 100, width: 400, height: 145 } };
  const found = regions([
    line("Figure 1.", 50, 250, 42),
    line("A wide same-line explanation continuing across the gutter.", 97, 250, 465),
    line("Further caption text in the next row.", 50, 261, 245),
    line("Right-side caption text.", 301, 261, 260),
    line("Final caption line spanning both columns.", 50, 272, 511),
    line("Last caption line.", 50, 283, 105),
  ], [image]);
  const caption = found.find((item) => item.type === "figure_caption");
  const figure = found.find((item) => item.type === "figure");
  assert.ok(caption);
  assert.ok(figure);
  assert.deepEqual(caption.geometry, { x: 50, y: 250, width: 512, height: 44 });
  assert.deepEqual(figure.geometry, image.geometry);
});

test("unconnected opposite-column prose does not extend a lane-local caption", () => {
  const found = regions([
    line("Figure 2.", 50, 400, 42),
    line("Independent prose in the other column.", 302, 400, 250),
    line("Local caption continuation.", 50, 411, 245),
  ]);
  const caption = found.find((item) => item.type === "figure_caption");
  assert.ok(caption);
  assert.deepEqual(caption.geometry, { x: 50, y: 400, width: 245, height: 20 });
});

test("enclosed tiny math glyph does not truncate following caption lines", () => {
  const math = {
    text: "∥", x: 225, y: 254, width: 4, height: 6, maxFont: 6,
    fontNames: ["Math"], items: [{ str: "∥", x: 225, width: 4, fontSize: 6, fontName: "Math" }],
  };
  const found = regions([
    line("Figure 7.", 50, 250, 42),
    line("The measured parallel and perpendicular paths", 98, 250, 464),
    math,
    line("These values span the full observation period.", 50, 261, 512),
    line("The final caption line gives the model parameterization.", 50, 272, 330),
  ]);
  const caption = found.find((item) => item.type === "figure_caption");
  assert.ok(caption);
  assert.ok(caption.geometry.width >= 510);
  assert.ok(caption.geometry.y + caption.geometry.height >= 281,
    "math glyph terminated the caption before its final text line");
});

test("a later math fragment cannot extend a finished caption into following prose", () => {
  const math = {
    text: "2", x: 380, y: 328, width: 4, height: 6, maxFont: 6,
    fontNames: ["Math"], items: [{ str: "2", x: 380, width: 4, fontSize: 6, fontName: "Math" }],
  };
  const found = regions([
    line("Fig. 1: Schematic", 302, 300, 245),
    line("The caption describes the first coordinate.", 302, 311, 245),
    line("The caption ends with the second coordinate.", 302, 322, 245),
    math,
    line("Proof. The subsequent paragraph is not a caption.", 302, 333, 245),
  ]);
  const caption = found.find((item) => item.type === "figure_caption");
  assert.ok(caption);
  assert.ok(caption.geometry.y + caption.geometry.height <= 331,
    "later math fragment bridged caption into prose");
});
