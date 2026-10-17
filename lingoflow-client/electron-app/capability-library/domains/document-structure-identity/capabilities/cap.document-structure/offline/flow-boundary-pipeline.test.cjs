"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { build } = require("./flow-boundary-pipeline.cjs");

test("flow-boundary pipeline requires current glyph extents", () => {
  assert.throws(() => build({}), /requires candidate/);
});

test("flow-boundary transforms read no Task files or saved JSON", () => {
  for (const name of ["flow-boundary-pipeline.cjs", "semantic-continuity.cjs",
    "display-boundaries.cjs", "display-glyph-alignment.cjs", "flow-row-rejoin.cjs"]) {
    const source = fs.readFileSync(path.join(__dirname, name), "utf8");
    assert.doesNotMatch(source, /require\(["']\.\.\//, name);
    assert.doesNotMatch(source, /require\(["']node:fs/, name);
    assert.doesNotMatch(source, /require\(["'][^"']+\.json["']\)/, name);
    assert.doesNotMatch(source, /\.governance\/tasks|writeFileSync|__dirname/, name);
  }
});
