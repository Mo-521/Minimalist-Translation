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

test("reference lane starts at its earliest dated entry, not a later DOI line", () => {
  const row = (text, x, y, width) => ({
    text, x, y, width, height: 10, maxFont: 10, fontNames: ["Times-Roman"],
    items: [{ str: text, x, y, width, height: 10, fontSize: 10, fontName: "Times-Roman" }],
  });
  const page = { pageNumber: 11, pageSize: { width: 600, height: 800 }, drawings: [], images: [] };
  const model = { layoutType: "double_column", columnGeometry: {
    left: { x: 40, width: 250 }, right: { x: 310, width: 250 },
  } };
  const heading = { type: "references_section_header", geometry: { x: 50, y: 190, width: 80, height: 10 } };
  const rows = [
    row("Earlier body discussion by Brown (2019) remains in the left reading flow", 50, 30, 235),
    row("Jackson, F. 1998. From Metaphysics to Ethics: A Defence", 310, 30, 240),
    row("Kroedel, T. 2016. Grounding Mental Causation in Philosophy", 310, 55, 240),
    row("Brown, C. 2019. Exclusion Endures and the Reference List", 50, 215, 235),
    row("Moorfoot, W. 2024. Type-R Physicalism. doi.org/10.1000/example", 310, 215, 240),
    row("Wilson, J. 2016. Grounding-Based Formulations of Physicalism", 310, 240, 240),
  ];
  const regions = source.protectedRegionsFromSemantics(page, rows, [heading], 11,
    "double_column", model).filter((item) => item.kind === "reference_entries");
  assert.equal(regions.length, 2);
  const right = regions.find((item) => item.columnId === "right");
  const left = regions.find((item) => item.columnId === "left");
  assert.ok(right && right.geometry.y <= 30, "the right bibliography must begin at its first dated entry");
  assert.ok(left && left.geometry.y >= 190, "left prose before References must remain outside the reference box");
});

test("a short right-column heading number does not merge into left-column text", () => {
  const twoLanes = { ...page, headingStyleAllowed: false, headingLanes: {
    left: { x: 70, width: 220 }, right: { x: 306, width: 220 },
  } };
  const leftCaption = line("Table 2: Predicted-state matching accuracy", {
    x: 70, y: 280, width: 220, fontNames: ["Times-Roman"],
    items: [{ str: "Table 2: Predicted-state matching accuracy", x: 70, y: 280,
      width: 220, height: 11, fontSize: 10, fontName: "Times-Roman" }],
  });
  const rightNumber = line("4.2", { x: 306, y: 280, width: 18,
    items: [{ str: "4.2", x: 306, y: 280, width: 18, height: 11,
      fontSize: 10, fontName: "Times-Bold" }] });
  const rightTitle = line("WebPRMBench with trained reward", { x: 330, y: 280, width: 175,
    items: [{ str: "WebPRMBench with trained reward", x: 330, y: 280,
      width: 175, height: 11, fontSize: 10, fontName: "Times-Bold" }] });
  const rows = source.semanticHeadingRows([leftCaption, rightNumber, rightTitle], twoLanes);
  assert.equal(rows.length, 2);
  assert.ok(rows.some((row) => row.x >= 300 && source.isSectionHeadingLine(row, twoLanes)));
});

test("a spanning figure caption keeps its narrow final line when its center shifts across the gutter", () => {
  const item = (str, y, width) => ({ str, x: 70, y, width, height: 10,
    fontSize: 10, fontName: "Times-Roman" });
  const extracted = { pageNumber: 2, pageSize: { width: 600, height: 800 },
    items: [item("Figure 1: The comparison spans both columns", 200, 456),
      item("Its explanation continues across both columns", 212, 454),
      item("and ends on this shorter line.", 224, 230)], drawings: [], images: [] };
  const model = { layoutType: "double_column", columnGeometry: {
    left: { x: 70, width: 220 }, right: { x: 306, width: 220 },
  } };
  const predicted = source.buildIndependentRegions(extracted, ["figure_caption"],
    source.groupLines(extracted.items), model).regions;
  const caption = predicted.find((region) => region.type === "figure_caption");
  assert.ok(caption);
  assert.ok(caption.geometry.y + caption.geometry.height >= 224);
});

test("figure envelope excludes short fragments attached to preceding prose, including a shifted math glyph", () => {
  const picture = { sourceArtifactId: "drawing:test", operatorName: "vector-path",
    geometry: { x: 110, y: 300, width: 300, height: 120 } };
  const page = { pageNumber: 2, pageSize: { width: 600, height: 800 },
    images: [], drawings: [picture] };
  const rows = [
    line("These results explain why the preceding paragraph ends here", { x: 70, y: 278, width: 228 }),
    line("in P", { x: 300, y: 278, width: 45 }),
    line("2", { x: 343, y: 282.5, width: 4, height: 7, maxFont: 7 }),
    line("Figure 1. Outcome plot", { x: 110, y: 439, width: 180 }),
  ];
  const model = { layoutType: "single_column", columnGeometry: { single: { x: 70, width: 460 } } };
  const result = source.buildIndependentRegions(page, ["figure", "figure_caption"], rows, model);
  const figure = result.regions.find((region) => region.type === "figure");
  assert.ok(figure);
  assert.equal(figure.geometry.y, 300);
  assert.equal(figure.geometry.x, 110);
});

test("isolated small-font label immediately above a visual remains part of its figure", () => {
  const page = { pageNumber: 2, pageSize: { width: 600, height: 800 }, images: [],
    drawings: [{ sourceArtifactId: "drawing:test", operatorName: "vector-path",
      geometry: { x: 110, y: 300, width: 300, height: 120 } }] };
  const rows = [
    line("Panel A", { x: 160, y: 286, width: 52, height: 7, maxFont: 7 }),
    line("Figure 1. Outcome plot", { x: 110, y: 439, width: 180 }),
  ];
  const model = { layoutType: "single_column", columnGeometry: { single: { x: 70, width: 460 } } };
  const result = source.buildIndependentRegions(page, ["figure", "figure_caption"], rows, model);
  const figure = result.regions.find((region) => region.type === "figure");
  assert.ok(figure);
  assert.equal(figure.geometry.y, 286);
});

test("a previous figure caption tail does not become the next figure's visual top", () => {
  const page = { pageNumber: 2, pageSize: { width: 600, height: 800 }, images: [], drawings: [
    { sourceArtifactId: "drawing:first", operatorName: "vector-path",
      geometry: { x: 110, y: 100, width: 300, height: 130 } },
    { sourceArtifactId: "drawing:second", operatorName: "vector-path",
      geometry: { x: 110, y: 300, width: 300, height: 120 } },
  ] };
  const rows = [
    line("Figure 1. First chart", { x: 70, y: 250, width: 160 }),
    line("Its caption ends here.", { x: 70, y: 261, width: 145 }),
    line("A short final caption tail.", { x: 70, y: 272, width: 180 }),
    line("Figure 2. Second chart", { x: 70, y: 439, width: 165 }),
  ];
  const model = { layoutType: "single_column", columnGeometry: { single: { x: 70, width: 460 } } };
  const result = source.buildIndependentRegions(page, ["figure", "figure_caption"], rows, model);
  const second = result.regions.filter((region) => region.type === "figure")
    .find((region) => region.geometry.y > 240);
  assert.ok(second);
  assert.equal(second.geometry.y, 300);
});

test("a captioned repeated two-cell box grid stays a Table instead of joining the following Figure", () => {
  const drawings = [0, 1, 2, 3].flatMap((index) => [
    { sourceArtifactId: `drawing:left:${index}`, geometry: { x: 80, y: 90 + index * 27, width: 140, height: 26 } },
    { sourceArtifactId: `drawing:right:${index}`, geometry: { x: 220, y: 90 + index * 27, width: 310, height: 26 } },
  ]);
  const page = { pageNumber: 4, pageSize: { width: 600, height: 800 }, drawings,
    images: [{ sourceArtifactId: "image:workflow", geometry: { x: 70, y: 197, width: 460, height: 220 } }] };
  const rows = [
    line("Table 1 | Core pipeline specification", { x: 70, y: 65, width: 260 }),
    ...[0, 1, 2, 3].flatMap((index) => [
      line(`Component ${index}`, { x: 86, y: 97 + index * 27, width: 120 }),
      line(`Description of component ${index}`, { x: 226, y: 97 + index * 27, width: 270 }),
    ]),
    line("Figure 1 | Workflow", { x: 70, y: 439, width: 170 }),
  ];
  const model = { layoutType: "single_column", columnGeometry: { single: { x: 70, width: 460 } } };
  const { regions } = source.buildIndependentRegions(page, ["table", "figure", "figure_caption"], rows, model);
  const table = regions.find((region) => region.type === "table");
  const figure = regions.find((region) => region.type === "figure");
  assert.ok(table, "the repeated two-cell grid should materialize as a Table");
  assert.ok(figure, "the following raster should remain a Figure");
  assert.ok(table.geometry.y + table.geometry.height <= figure.geometry.y,
    "the two visual owners must not overlap");
  assert.ok(figure.geometry.y >= 197 && figure.geometry.y <= 201);
});

test("one boxed pair without repeated rows is not promoted into a Table grid", () => {
  const page = { pageNumber: 4, pageSize: { width: 600, height: 800 }, drawings: [
    { sourceArtifactId: "drawing:left", geometry: { x: 80, y: 90, width: 140, height: 26 } },
    { sourceArtifactId: "drawing:right", geometry: { x: 220, y: 90, width: 310, height: 26 } },
  ], images: [{ sourceArtifactId: "image:workflow", geometry: { x: 70, y: 117, width: 460, height: 220 } }] };
  const rows = [line("Table 1 | A caption alone is not a grid", { x: 70, y: 65, width: 260 }),
    line("Figure 1 | Workflow", { x: 70, y: 349, width: 170 })];
  const model = { layoutType: "single_column", columnGeometry: { single: { x: 70, width: 460 } } };
  const { regions } = source.buildIndependentRegions(page, ["table", "figure", "figure_caption"], rows, model);
  assert.equal(regions.filter((region) => region.type === "table").length, 0);
});

test("centered numbered headings and styled bar-numbered headings are not treated as list prose", () => {
  const centered = { ...page, headingStyleAllowed: false, headingLanes: {
    single: { x: 36, width: 539 },
  } };
  assert.equal(source.isSectionHeadingLine(line("1. INTRODUCTION", {
    x: 259, width: 95, fontNames: ["Times-Section"],
  }), centered), true);
  assert.equal(source.isSectionHeadingLine(line("2. The key proposition", {
    x: 230, width: 140,
  }), centered), true);
  const twoLanes = { ...page, headingStyleAllowed: false, headingLanes: {
    left: { x: 36, width: 252 }, right: { x: 308, width: 252 },
  } };
  assert.equal(source.isSectionHeadingLine(line("3.1 | The Collapse Argument Against", {
    x: 306, width: 180,
  }), twoLanes), true);
  assert.equal(source.isSectionHeadingLine(line("3. The learner incurs expected instantaneous loss", {
    x: 54, width: 300, fontNames: ["Times-Roman"],
  }), twoLanes), false);
});

test("a heading split into number and title fragments ends the abstract before Body", () => {
  const item = (str, x, y, width, fontName = "Times-Roman") => ({
    str, x, y, width, height: 10, fontSize: 10, fontName,
  });
  const extracted = { pageNumber: 2, pageSize: { width: 600, height: 800 },
    items: [item("Abstract", 70, 100, 60, "Times-Bold"),
      item("A compact abstract paragraph", 70, 120, 220),
      item("1", 70, 160, 8, "Times-Bold"),
      item("Introduction", 94, 160, 95, "Times-Bold"),
      item("The body starts here", 70, 180, 200)], drawings: [], images: [],
    headingFontNames: new Set(["Times-Bold"]),
  };
  const model = { layoutType: "single_column", columnGeometry: { single: { x: 70, width: 460 } } };
  const regions = source.buildIndependentRegions(extracted, ["abstract", "section_heading"],
    source.groupLines(extracted.items), model).regions;
  const abstract = regions.find((region) => region.type === "abstract");
  const introduction = regions.find((region) => region.type === "section_heading"
    && region.geometry.y > 140);
  assert.ok(abstract && introduction);
  assert.ok(abstract.geometry.y + abstract.geometry.height < introduction.geometry.y);
});
