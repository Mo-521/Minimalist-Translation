"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const pilot = require("../../../tools/column-capability-pilot");
const workflow = require("../../../electron-app/capability-library/candidate-pool");
function fixture(promote = true) {
  const sample = { id: "sample.column-contract", displayName: "Synthetic contract, not a reviewed PDF", source: { fileName: "fixture.pdf", mediaType: "application/pdf", sha256: "a".repeat(64), bytes: 10, pageCount: 2 },
    provenance: { kind: "synthetic", reference: "unit contract only" }, rights: { status: "metadata_only", canStoreMetadata: true, canStoreBinary: false }, boundaryFeatureIds: ["boundary.column.double"],
    expectedOutcomes: [{ capabilityId: "cap.column-recognition", assertionId: "assert.column.page-region-truth", oracleType: "exact", expected: { pageLayoutBasis: "body_text_flow_only", pages: [{ pageNumber: 1, layout: "double_column" }, { pageNumber: 2, layout: "single_column" }], independentRegions: [{ pageNumber: 1, type: "figure_caption" }] } }],
    evidenceRefs: ["unit-contract"], storage: { binaryCommitted: false, externalSourceRequiredForRun: true }, authorityBoundary: { catalogRole: "regression_oracle", runtimeDecisionUse: "forbidden", finalDecisionsOwnedBy: ["AA-COLUMN-001"] } };
  const audit = { actor: "synthetic unit fixture, not real acceptance", reason: "Test promotion gate" };
  let state = workflow.submitCandidate(workflow.loadState(), { id: "candidate.column-contract", capabilityIds: ["cap.column-recognition"], sample }, audit);
  if (promote) {
    state = workflow.reviewCandidate(state, "candidate.column-contract", "under_review", audit);
    state = workflow.reviewCandidate(state, "candidate.column-contract", "accepted", audit);
    state = workflow.promoteCandidate(state, "candidate.column-contract", audit);
  }
  const output = { source: sample.source, runtimeBaseline: pilot.runtimeBaseline(), pages: [{ pageNumber: 1, layoutType: "double_column" }, { pageNumber: 2, layoutType: "single_column" }] };
  return { state, output };
}
test("formal Column runner refuses unreviewed/unpromoted candidates", () => {
  const { state, output } = fixture(false);
  assert.throws(() => pilot.compare(state, "sample.column-contract", output), /promoted accepted/);
});
test("Column comparison returns frozen per-page findings, without fixing output", () => {
  const { state, output } = fixture();
  const before = JSON.stringify(state);
  assert.equal(pilot.compare(state, "sample.column-contract", output).findingCount, 0);
  output.pages[1].layoutType = "double_column";
  const report = pilot.compare(state, "sample.column-contract", output);
  assert.equal(report.findingCount, 1);
  assert.equal(report.results[1].pageNumber, 2);
  assert.ok(Object.isFrozen(report.results[1]));
  assert.equal(output.pages[1].layoutType, "double_column");
  assert.equal(JSON.stringify(state), before);
});
test("Column runner rejects stale/source-mismatched and partial page evidence", () => {
  const { state, output } = fixture();
  const source = output.source;
  output.source = { ...source, sha256: "b".repeat(64) };
  assert.throws(() => pilot.compare(state, "sample.column-contract", output), /metadata mismatch/);
  output.source = source;
  output.runtimeBaseline["main.js"] = "stale";
  assert.throws(() => pilot.compare(state, "sample.column-contract", output), /Stale/);
  output.runtimeBaseline = pilot.runtimeBaseline();
  output.pages.pop();
  assert.throws(() => pilot.compare(state, "sample.column-contract", output), /Incomplete/);
});
test("Column oracle keeps a finite independent-region vocabulary", () => {
  assert.deepEqual(pilot.INDEPENDENT_REGION_TYPES, ["title", "abstract", "figure", "figure_caption", "table", "references_section_header", "other_independent"]);
  assert.equal(pilot.validateIndependentRegions([{ pageNumber: 1, type: "figure_caption" }], 2), true);
  assert.throws(() => pilot.validateIndependentRegions([{ pageNumber: 1, type: "table_caption" }], 2), /Invalid independent region/);
});
test("pilot is offline-only; runtime does not import it or any regression corpus", () => {
  for (const name of Object.keys(pilot.runtimeBaseline())) {
    const source = fs.readFileSync(path.resolve(__dirname, "../../../electron-app", name), "utf8");
    assert.doesNotMatch(source, /column-capability-pilot|capability-library|candidate-pool|corpus\.json/);
  }
});
