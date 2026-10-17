"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { prepare, complete } = require("./inherited-stage35-82.cjs");

test("full pipeline fails closed when required evidence is absent", () => {
  assert.throws(() => prepare({}), /stage44LabelSpans/);
  assert.throws(() => prepare({ evidence: { stage44LabelSpans: {} } }), /stage44GlyphBoxes/);
  assert.throws(() => complete({}), /prepared Stage 52/);
  assert.throws(() => complete({ prepared: { stage52: {}, stage37: {}, postReference: {} } }),
    /stage53RecalledGlyphExtents/);
});

test("full pipeline imports only capability-local modules", () => {
  const source = fs.readFileSync(path.join(__dirname, "inherited-stage35-82.cjs"), "utf8");
  assert.doesNotMatch(source, /require\(["']\.\.\//);
  assert.doesNotMatch(source, /require\(["']node:fs/);
  assert.doesNotMatch(source, /\.governance\/tasks|readFileSync|writeFileSync|__dirname/);
});
