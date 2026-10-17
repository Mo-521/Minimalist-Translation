"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { bodyOwnershipChecks } = require("../../../tools/layout-geometry-cross-sample-review");

test("Body ownership check catches leading figures and bibliography intrusion", () => {
  const body = [{ pageNumber: 1, candidate: [{ id: "body", geometry: { x: 40, y: 80, width: 520, height: 120 } }] }];
  const objects = [{ predicted: [
    { id: "figure", objectType: "figure", geometry: { x: 310, y: 60, width: 230, height: 100 } },
    { id: "refs", objectType: "reference_entries", geometry: { x: 310, y: 120, width: 230, height: 70 } },
  ] }];
  const result = bodyOwnershipChecks(body, objects);
  assert.equal(result.status, "review_required");
  assert.equal(result.leadingObjectIntrusions.length, 1);
  assert.equal(result.referenceIntrusions.length, 1);
});
