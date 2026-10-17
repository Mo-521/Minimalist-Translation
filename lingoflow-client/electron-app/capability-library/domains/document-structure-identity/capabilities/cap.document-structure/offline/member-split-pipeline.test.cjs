"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { build, buildThroughStage52 } = require("./member-split-pipeline.cjs");

test("member-split pipeline requires independent glyph evidence", () => {
  assert.throws(() => build({}), /requires recalled glyph extents/);
  assert.throws(() => buildThroughStage52({}), /requires candidate/);
});

test("member-split transforms read no Task files or saved JSON", () => {
  for (const name of ["member-split-pipeline.cjs", "member-refinement.cjs",
    "label-span-splitting.cjs", "formula-glyph-support.cjs", "semantic-barrier.cjs",
    "display-recall.cjs", "right-label-splitting.cjs", "recalled-glyph-alignment.cjs"]) {
    const source = fs.readFileSync(path.join(__dirname, name), "utf8");
    assert.doesNotMatch(source, /require\(["']\.\.\//, name);
    assert.doesNotMatch(source, /require\(["']node:fs/, name);
    assert.doesNotMatch(source, /require\(["'][^"']+\.json["']\)/, name);
    assert.doesNotMatch(source, /\.governance\/tasks|writeFileSync/, name);
  }
});
