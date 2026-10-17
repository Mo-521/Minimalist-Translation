"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { build } = require("./opaque-boundary-pipeline.cjs");

test("opaque-boundary pipeline requires current-PDF evidence", () => {
  assert.throws(() => build({}), /requires candidate/);
});

test("opaque-boundary transforms read no Task files or saved JSON", () => {
  for (const name of ["opaque-boundary-pipeline.cjs", "opaque-figures-and-spans.cjs",
    "display-blocks.cjs", "repaired-boundaries.cjs"]) {
    const source = fs.readFileSync(path.join(__dirname, name), "utf8");
    assert.doesNotMatch(source, /require\(["']\.\.\//, name);
    assert.doesNotMatch(source, /require\(["']node:fs/, name);
    assert.doesNotMatch(source, /require\(["'][^"']+\.json["']\)/, name);
    assert.doesNotMatch(source, /\.governance\/tasks|writeFileSync|__dirname/, name);
  }
});
