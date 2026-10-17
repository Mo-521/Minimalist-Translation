"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { build } = require("./source-formula-stage35.cjs");

const line = (sourceLineId, text, x, y, width) => ({ sourceLineId, text,
  column: "left", coverageClass: "reviewable_content",
  bbox: { x, y, width, height: 10 } });
const page = sourceLines => ({ paper: 9, pageNumber: 5,
  pageSize: { width: 600, height: 800 }, sourceLines });

test("source-only display keeps nearby formula members but excludes prose and equation numbers", () => {
  const input = { pages: { "9:5": page([
    line("prose-before", "We obtain the following relation", 50, 75, 380),
    line("formula", "x = y + α", 200, 100, 120),
    line("member", "β", 220, 112, 10),
    line("number", "(3.9)", 480, 100, 35),
    line("connector", "and", 220, 120, 25),
    line("prose-after", "Therefore the bound follows", 50, 145, 370)
  ]) } };
  const hash = crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const result = build(input, hash);
  assert.equal(result.inputSha256, hash);
  assert.equal(result.summary.totalPages, 1);
  assert.equal(result.summary.proposals, 1);
  assert.equal(result.summary.proposedSourceLineIds, 2);
  assert.deepEqual(result.proposals[0].sourceLineIds, ["formula", "member"]);
  assert.deepEqual(result.proposals[0].basis.includes("unique_spatially_compatible_compact_math_member"), true);
});

test("inline prose containing math and a standalone equation number are not display anchors", () => {
  const input = { pages: { "9:5": page([
    line("inline", "We have α = β", 50, 100, 350),
    line("number", "(3.9)", 480, 100, 35),
    line("connector", "and", 220, 112, 25)
  ]) } };
  const result = build(input, "compact-regression-input");
  assert.equal(result.summary.proposals, 0);
  assert.deepEqual(result.proposals, []);
});
