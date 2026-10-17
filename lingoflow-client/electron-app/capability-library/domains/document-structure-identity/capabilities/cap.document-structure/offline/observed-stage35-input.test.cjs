"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { stage35InputFromObservedPages } = require("./observed-stage35-input.cjs");
const sha = "a".repeat(64);
test("observed input retains source geometry and does not invent reviewed layout hints", () => {
  const input = stage35InputFromObservedPages([{ page: 1, width: 600, height: 800,
    lines: [{ id: "s1", page: 1, column: "left", text: "x = y", bbox: { x: 10, y: 20, width: 50, height: 10 } }] }], sha);
  assert.deepEqual(input.pages["1:1"].layoutHints, []);
  assert.deepEqual(input.pages["1:1"].sourceLines[0], { sourceLineId: "s1", text: "x = y", page: 1,
    column: "left", bbox: { x: 10, y: 20, width: 50, height: 10 }, coverageClass: "reviewable_content" });
  assert.equal(input.summary.sourceLineCount, 1);
});
test("observed input rejects unstable source identity and missing page geometry", () => {
  assert.throws(() => stage35InputFromObservedPages([{ page: 2, width: 600, height: 800, lines: [] }], sha), /contiguous/);
  const line = { id: "same", page: 1, text: "a", bbox: { x: 1, y: 2, width: 3, height: 4 } };
  assert.throws(() => stage35InputFromObservedPages([{ page: 1, width: 600, height: 800, lines: [line, line] }], sha), /duplicated/);
});
