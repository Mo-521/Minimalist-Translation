"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { build } = require("./display-recall-pipeline.cjs");

test("display recall requires independent glyph evidence", () => {
  assert.throws(() => build({}), /requires candidate/);
});

test("display recall transforms read no Task files or saved JSON", () => {
  for (const name of ["display-recall-pipeline.cjs", "formula-edge-proposals.cjs",
    "formula-edge-members.cjs", "numbered-display-proposals.cjs", "numbered-display-recall.cjs",
    "numeric-member-proposals.cjs", "numeric-member-reconstruction.cjs",
    "mixed-display-proposals.cjs", "mixed-display-recall.cjs"]) {
    const source = fs.readFileSync(path.join(__dirname, name), "utf8");
    assert.doesNotMatch(source, /require\(["']\.\.\//, name);
    assert.doesNotMatch(source, /require\(["']node:fs/, name);
    assert.doesNotMatch(source, /require\(["'][^"']+\.json["']\)/, name);
    assert.doesNotMatch(source, /\.governance\/tasks|writeFileSync/, name);
  }
});
