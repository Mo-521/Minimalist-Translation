"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { build } = require("./ownership-pipeline.cjs");

test("ownership pipeline requires all independent evidence inputs", () => {
  assert.throws(() => build({}), /requires candidate/);
});

test("ownership transforms are Task-independent and read no saved JSON", () => {
  for (const name of ["ownership-pipeline.cjs", "front-furniture.cjs", "owned-spans.cjs",
    "member-boundaries.cjs", "prose-continuity.cjs"]) {
    const source = fs.readFileSync(path.join(__dirname, name), "utf8");
    assert.doesNotMatch(source, /require\(["']\.\.\//, name);
    assert.doesNotMatch(source, /require\(["']node:fs/, name);
    assert.doesNotMatch(source, /require\(["'][^"']+\.json["']\)/, name);
    assert.doesNotMatch(source, /\.governance\/tasks|writeFileSync/, name);
  }
});
