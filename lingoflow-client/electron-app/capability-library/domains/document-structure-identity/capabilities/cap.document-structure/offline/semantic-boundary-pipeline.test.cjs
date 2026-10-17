"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { build } = require("./semantic-boundary-pipeline.cjs");

test("semantic boundary pipeline requires independent PDF evidence", () => {
  assert.throws(() => build({}), /requires candidate/);
});

test("semantic boundary transforms read no Task files or saved JSON", () => {
  for (const name of ["semantic-boundary-pipeline.cjs", "body-boundaries.cjs",
    "body-frame-alignment.cjs", "semantic-boundaries.cjs"]) {
    const source = fs.readFileSync(path.join(__dirname, name), "utf8");
    assert.doesNotMatch(source, /require\(["']\.\.\//, name);
    assert.doesNotMatch(source, /require\(["']node:fs/, name);
    assert.doesNotMatch(source, /require\(["'][^"']+\.json["']\)/, name);
    assert.doesNotMatch(source, /\.governance\/tasks|writeFileSync/, name);
  }
});
