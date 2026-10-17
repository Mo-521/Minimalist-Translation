"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { build } = require("./source-to-post-reference.cjs");

test("source-to-post-reference pipeline requires explicit source", () => {
  assert.throws(() => build({}), /requires source pages/);
});

test("source-to-post-reference transforms read no Task files or saved JSON", () => {
  for (const name of ["source-to-post-reference.cjs", "reference-whole-entry.cjs",
    "compose-references.cjs", "post-reference-recovery.cjs", "compose-post-reference.cjs"]) {
    const source = fs.readFileSync(path.join(__dirname, name), "utf8");
    assert.doesNotMatch(source, /require\(["']\.\.\//, name);
    assert.doesNotMatch(source, /require\(["']node:fs/, name);
    assert.doesNotMatch(source, /require\(["'][^"']+\.json["']\)/, name);
    assert.doesNotMatch(source, /\.governance\/tasks|writeFileSync|__dirname/, name);
  }
});
