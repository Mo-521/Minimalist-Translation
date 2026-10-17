"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { build } = require("./late-pipeline.cjs");

test("late pipeline fails closed when a required transform or evidence is absent", () => {
  assert.throws(() => build({}), /requires candidate/);
  assert.throws(() => build({ candidate: {}, source: {}, stage37: {},
    postReference: {}, native: {}, transforms: {} }), /Missing late-pipeline transform/);
});

test("late pipeline and built-in transforms do not read Task files or saved review artifacts", () => {
  for (const name of ["late-pipeline.cjs", "region-completeness.cjs", "table-notes.cjs",
    "display-region-members.cjs", "prose-display-source.cjs", "nested-formula-members.cjs",
    "prose-ink-boundaries.cjs", "reviewed-boundaries.cjs"]) {
    const source = fs.readFileSync(path.join(__dirname, name), "utf8");
    assert.doesNotMatch(source, /require\(["']\.\.\//, name);
    assert.doesNotMatch(source, /require\(["']node:fs/, name);
    assert.doesNotMatch(source, /require\(["'][^"']+\.json["']\)/, name);
    assert.doesNotMatch(source, /reviewed-stage82|\.governance\/tasks|writeFileSync/, name);
  }
});
