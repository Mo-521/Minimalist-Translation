"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { build } = require("./math-frame-pipeline.cjs");

test("math-frame pipeline requires both glyph audits", () => {
  assert.throws(() => build({}), /requires candidate/);
});

test("math-frame transforms read no Task files or saved JSON", () => {
  for (const name of ["math-frame-pipeline.cjs", "glyph-supported-frames.cjs",
    "embedded-math-labels.cjs", "inline-radical-fragments.cjs", "span-aware-frames.cjs"]) {
    const source = fs.readFileSync(path.join(__dirname, name), "utf8");
    assert.doesNotMatch(source, /require\(["']\.\.\//, name);
    assert.doesNotMatch(source, /require\(["']node:fs/, name);
    assert.doesNotMatch(source, /require\(["'][^"']+\.json["']\)/, name);
    assert.doesNotMatch(source, /\.governance\/tasks|writeFileSync/, name);
  }
});
