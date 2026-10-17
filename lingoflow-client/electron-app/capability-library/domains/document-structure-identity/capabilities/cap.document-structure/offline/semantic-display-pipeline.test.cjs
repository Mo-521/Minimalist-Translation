"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { build } = require("./semantic-display-pipeline.cjs");

test("semantic-display pipeline requires source and region inputs", () => {
  assert.throws(() => build({}), /requires candidate/);
});

test("semantic-display transforms read no Task files or saved JSON", () => {
  for (const name of ["semantic-display-pipeline.cjs", "semantic-blocks.cjs", "display-formulas.cjs"]) {
    const source = fs.readFileSync(path.join(__dirname, name), "utf8");
    assert.doesNotMatch(source, /require\(["']\.\.\//, name);
    assert.doesNotMatch(source, /require\(["']node:fs/, name);
    assert.doesNotMatch(source, /require\(["'][^"']+\.json["']\)/, name);
    assert.doesNotMatch(source, /\.governance\/tasks|writeFileSync|__dirname/, name);
  }
});
