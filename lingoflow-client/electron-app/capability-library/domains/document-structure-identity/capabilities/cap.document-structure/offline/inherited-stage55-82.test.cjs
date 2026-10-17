"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { build } = require("./inherited-stage55-82.cjs");

test("inherited chain requires explicit early diagnostics and PDF evidence", () => {
  assert.throws(() => build({}), /requires candidate/);
});

test("inherited chain has no Task or reviewed-result dependency", () => {
  const source = fs.readFileSync(path.join(__dirname, "inherited-stage55-82.cjs"), "utf8");
  assert.doesNotMatch(source, /require\(["']\.\.\//);
  assert.doesNotMatch(source, /require\(["']node:fs/);
  assert.doesNotMatch(source, /\.governance\/tasks|reviewed-stage82|writeFileSync/);
});
