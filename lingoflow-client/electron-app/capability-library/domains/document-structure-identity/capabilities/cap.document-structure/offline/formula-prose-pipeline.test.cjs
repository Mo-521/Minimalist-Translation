"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { build } = require("./formula-prose-pipeline.cjs");

test("formula/prose pipeline requires PDF evidence", () => {
  assert.throws(() => build({}), /requires candidate/);
});

test("formula/prose transforms are Task-independent and read no saved JSON", () => {
  for (const name of ["formula-prose-pipeline.cjs", "formula-members.cjs", "prose-boundaries.cjs"]) {
    const source = fs.readFileSync(path.join(__dirname, name), "utf8");
    assert.doesNotMatch(source, /require\(["']\.\.\//, name);
    assert.doesNotMatch(source, /require\(["']node:fs/, name);
    assert.doesNotMatch(source, /require\(["'][^"']+\.json["']\)/, name);
    assert.doesNotMatch(source, /\.governance\/tasks|writeFileSync/, name);
  }
});
