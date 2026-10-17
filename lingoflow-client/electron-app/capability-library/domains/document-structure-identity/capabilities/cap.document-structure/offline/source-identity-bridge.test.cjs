"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { bridgeSourceLines } = require("./source-identity-bridge.cjs");
const b = { x: 1, y: 2, width: 3, height: 4 };
const raw = { id: "raw", page: 1, text: "same", bbox: b };
test("direct, declared split and unique exact geometry bridge without semantic decisions", () => {
  const lines = [
    { sourceLineId: "raw", page: 1, text: "same", bbox: b },
    { sourceLineId: "split", parentSourceLineId: "raw", page: 1, text: "sa", bbox: b },
    { sourceLineId: "legacy", page: 1, text: "same", bbox: b }
  ];
  const result = bridgeSourceLines([raw], lines);
  assert.deepEqual(result.counts, { derived: 3, direct: 1, declaredSplitParent: 1, uniqueExactTextAndGeometry: 1, unresolved: 0 });
  assert.deepEqual(result.matches.map(match => match.runtimeId), ["raw", "raw", "raw"]);
});
test("ambiguous or shifted lines stay unresolved", () => {
  const result = bridgeSourceLines([raw, { ...raw, id: "other" }], [
    { sourceLineId: "legacy", page: 1, text: "same", bbox: b },
    { sourceLineId: "shifted", page: 1, text: "same", bbox: { ...b, x: 2 } }
  ]);
  assert.equal(result.counts.unresolved, 2);
});
