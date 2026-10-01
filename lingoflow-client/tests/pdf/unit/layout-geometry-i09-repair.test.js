"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const source = require("../../../tools/layout-geometry-candidate-intake");

function line(text) {
  return {
    text,
    x: 84,
    y: 710,
    width: 180,
    height: 10,
    maxFont: 10,
    fontNames: ["BodyFont"],
    items: [{ str: text, x: 84, width: 180, fontSize: 10, fontName: "BodyFont" }],
  };
}

const page = {
  pageSize: { width: 612, height: 792 },
  headingFontNames: new Set(["HeadingFont"]),
  headingStyleAllowed: true,
  headingLanes: { single: { x: 36, width: 540 } },
};

test("bare four-digit metadata years are not numbered section headings", () => {
  assert.equal(source.isSectionHeadingLine(line("2020 Mathematics Subject Classification."), page), false);
  assert.equal(source.isSectionHeadingLine(line("2024 Dataset Metadata"), page), false);
});

test("ordinary numbered section headings remain recognized", () => {
  assert.equal(source.isSectionHeadingLine(line("12 Results"), page), true);
  assert.equal(source.isSectionHeadingLine(line("1.2 Background"), page), true);
});
