"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { build, validatePage } = require("./terminal-prose.cjs");

function fixture() {
  const line = { sourceLineId: "l1", text: "A plain paragraph.", page: 1, column: 0,
    coverageClass: "reviewable_content", bbox: { x: 10, y: 20, width: 80, height: 10 } };
  return {
    prior: { pages: { "1:1": { objects: [{ objectId: "o1", type: "body", sourceLineIds: ["l1"],
      spatialFragments: [{ bbox: { x: 10, y: 10, width: 80, height: 10 }, sourceLineIds: ["l1"] }] }],
      pendingMembership: [], excludedSourceLines: [], summary: { objects: 1 } } },
      summary: { assigned: 1, pending: 0, excluded: 0, sourceLines: 1 } },
    frozen: { pages: { "1:1": { sourceLines: [line] } } },
    native: { pages: { "1:1": { lines: {} } } }
  };
}

test("offline pass takes explicit inputs and preserves unchanged source ownership", () => {
  const input = fixture(), before = structuredClone(input);
  const { candidate, source } = build(input);
  assert.deepEqual(input, before);
  assert.equal(candidate.stage82.operations.length, 0);
  assert.equal(candidate.summary.sourceLines, 1);
  assert.equal(source.pages["1:1"].sourceLines[0].sourceLineId, "l1");
});

test("source ownership rejects duplicate and missing members", () => {
  const input = fixture(), page = input.prior.pages["1:1"], source = input.frozen.pages["1:1"];
  page.pendingMembership.push({ sourceLineId: "l1" });
  assert.throws(() => validatePage("1:1", page, source), /source ownership failure/);
  page.pendingMembership = [];
  page.objects[0].sourceLineIds = ["missing"];
  assert.throws(() => validatePage("1:1", page, source), /unknown Object member/);
});

test("promoted module has no Task path or filesystem write", () => {
  const source = fs.readFileSync(path.join(__dirname, "terminal-prose.cjs"), "utf8");
  assert.doesNotMatch(source, /\.governance|stage\d+-output|writeFileSync|require\(["']node:fs["']\)/);
});
