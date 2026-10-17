"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { sourcePagesFromExtraction } = require("./pdf-source-adapter.cjs");
const sourceSha = "f".repeat(64);

test("turns observed extraction into stable per-page source identity without classification", () => {
  const output = { pages: 2, lines: [{ pageNumber: 1, column: "left", text: "x   =  y",
    bbox: { x: 20, y: 30, width: 50, height: 10 },
    items: [{ str: "x = y", x: 20, y: 30, width: 50, height: 10, fontSize: 10, fontName: "math" }] }],
    textItems: [{ pageNumber: 1, pageWidth: 600, pageHeight: 800 }] };
  const pages = sourcePagesFromExtraction(output, sourceSha);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].lines[0].text, "x = y");
  assert.match(pages[0].lines[0].id, /^offline-line-sha256:[a-f0-9]{64}$/);
  assert.deepEqual(pages[0].lines[0].fontNames, ["math"]);
  assert.deepEqual(pages[1], { page: 2, width: null, height: null, lines: [] });
  assert.deepEqual(sourcePagesFromExtraction(output, sourceSha), pages);
});

test("rejects repeated physical source identity and missing geometry", () => {
  const item = { pageNumber: 1, text: "x = y", bbox: { x: 20, y: 30, width: 50, height: 10 } };
  const output = { pages: 1, textItems: [{ pageNumber: 1, pageWidth: 600, pageHeight: 800 }], lines: [item, item] };
  assert.throws(() => sourcePagesFromExtraction(output, sourceSha), /repeats source line/);
  assert.throws(() => sourcePagesFromExtraction({ ...output, lines: [item], textItems: [] }, sourceSha), /no page width/);
});
