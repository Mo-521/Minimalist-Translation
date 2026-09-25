"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const source = require("../../../tools/layout-geometry-candidate-intake");

function line(text, extras = {}) {
  return {
    text,
    x: extras.x || 72,
    y: extras.y || 120,
    width: extras.width || 180,
    height: extras.height || 11,
    maxFont: extras.maxFont || 10,
    fontNames: extras.fontNames || ["Times-Bold"],
    items: extras.items || [{ str: text, x: extras.x || 72, width: extras.width || 180, fontSize: extras.maxFont || 10, fontName: "Times-Bold" }],
  };
}

const page = {
  pageSize: { width: 595, height: 842 },
  headingFontNames: new Set(["Times-Bold"]),
  headingStyleAllowed: true,
  headingLanes: { single: { x: 54, width: 487 } },
};

test("small-caps PDF runs compact to References and roman section titles", () => {
  assert.equal(source.compactPdfSmallCaps("R EFERENCES"), "REFERENCES");
  assert.equal(source.compactPdfSmallCaps("III. M AIN R ESULTS"), "III. MAIN RESULTS");
  assert.equal(source.compactPdfSmallCaps("V. C ONCLUSIONS AND F UTURE W ORK"), "V. CONCLUSIONS AND FUTURE WORK");
  assert.equal(source.isReferencesHeadingLine(line("R EFERENCES")), true);
});

test("roman-numeral table captions are recognized", () => {
  assert.equal(source.isTableCaptionLine(line("Table II: Guidance gains.")), true);
  assert.equal(source.isTableCaptionLine(line("Table 2: Guidance gains.")), true);
  assert.equal(source.isTableCaptionLine(line("Figure 1: Not a table.")), false);
});

test("run-in Techniques. and numbered body sentences are not section headings", () => {
  assert.equal(source.isSectionHeadingLine(line("Techniques."), page), false);
  assert.equal(source.isSectionHeadingLine(line("Exact constants for small n."), page), false);
  assert.equal(source.isSectionHeadingLine(line("3. The learner incurs expected instantaneous loss"), page), false);
  assert.equal(source.isSectionHeadingLine(line("2. Multiplicative weights update:", { x: 85.38 }), page), false);
  assert.equal(source.isSectionHeadingLine(line("2. Multiplicative weights update", { x: 85.38 }), page), false);
  assert.equal(source.isSectionHeadingLine(line("1. Introduction", { x: 54, width: 110 }), page), true);

  assert.equal(source.isSectionHeadingLine(line("problem."), page), false);
  assert.equal(source.isSectionHeadingLine(line("Related work."), page), true);
  assert.equal(source.isSectionHeadingLine(line("Proof of Theorem 3.1."), page), true);
  assert.equal(source.isSectionHeadingLine(line("1.1 Our Contribution"), page), true);
});

test("tall multi-panel visual clusters are kept as one envelope", () => {
  const page = { pageSize: { width: 612, height: 792 }, drawings: [
    { geometry: { x: 80, y: 70, width: 200, height: 180 } },
    { geometry: { x: 300, y: 70, width: 200, height: 180 } },
    { geometry: { x: 80, y: 270, width: 200, height: 180 } },
    { geometry: { x: 300, y: 270, width: 200, height: 180 } },
    { geometry: { x: 80, y: 470, width: 200, height: 180 } },
    { geometry: { x: 300, y: 470, width: 200, height: 180 } },
  ], images: [] };
  const clusters = source.visualClusters(page, { tall: true });
  assert.ok(clusters.some((box) => box.height > page.pageSize.height * 0.52 && box.width > 400));
});

test("theorem labels stay tight and do not swallow the following sentence", () => {
  assert.equal(source.isSectionHeadingLine(line("Lemma 2."), page), true);
  const swallowed = line("Lemma 2 and corollary 1 extend by replacing", {
    items: [{ str: "Lemma 2 and corollary 1 extend by replacing", x: 54, width: 260, fontSize: 10, fontName: "Times-Bold" }],
    width: 260,
  });
  assert.equal(source.isSectionHeadingLine(swallowed, page), false);
  const runIn = line("Problem. Given t > t, construct a bounded lateral", {
    items: [
      { str: "Problem.", x: 303, width: 49, fontSize: 10, fontName: "Times-Bold" },
      { str: "Given t > t, construct a bounded lateral", x: 356, width: 180, fontSize: 10, fontName: "Times-Roman" },
    ],
    width: 233,
  });
  assert.equal(source.isSectionHeadingLine(runIn, page), true);
});
