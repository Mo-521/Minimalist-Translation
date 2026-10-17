"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { build } = require("./source-semantics-pipeline.cjs");

test("source-semantics pipeline requires explicit source and input identity", () => {
  assert.throws(() => build({}), /requires source pages/);
  assert.throws(() => build({ source: { pages: {} } }), /requires exact input hash/);
});

test("source-semantics transforms read no Task files or saved JSON", () => {
  for (const name of ["source-semantics-pipeline.cjs", "source-page-boundaries.cjs",
    "semantic-regions.cjs", "compose-source-candidates.cjs"]) {
    const source = fs.readFileSync(path.join(__dirname, name), "utf8");
    assert.doesNotMatch(source, /require\(["']\.\.\//, name);
    assert.doesNotMatch(source, /require\(["']node:fs/, name);
    assert.doesNotMatch(source, /require\(["'][^"']+\.json["']\)/, name);
    assert.doesNotMatch(source, /\.governance\/tasks|writeFileSync|__dirname/, name);
  }
});
