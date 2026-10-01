"use strict";

// Compare the independent pre-review v8 machine predictions against the
// accepted corrected oracle. Findings are Evidence only; no truth is mutated.
const fs = require("node:fs");
const path = require("node:path");
const oracleContract = require("../electron-app/capability-library/geometry-oracle");

const root = path.resolve(__dirname, "../..");
const capability = path.join(root, "lingoflow-client/electron-app/capability-library/capabilities/cap.layout-geometry");
const freeze = JSON.parse(fs.readFileSync(path.join(capability, "reviewed-v8/FREEZE_MANIFEST.json"), "utf8"));
const output = path.join(root, ".governance/archive/evidence/layout-geometry-capability-audit/evidence/geometry-accepted-stage-v1/CURRENT_REGRESSION.json");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

function observationRegion(box, kind, pageNumber) {
  const body = kind === "body";
  const spanning = body && box.canonicalColumnId === null;
  const observed = {
    regionId: box.id,
    owner: body ? (spanning ? "main_reading_flow:spanning" : `column:${box.canonicalColumnId}`) : `geometry:${box.objectType}`,
    geometry: box.geometry,
  };
  if (body && !spanning) observed.canonicalColumnRef = {
    pageColumnModelRef: `page-column-model/v1:page-${pageNumber}`,
    authority: "AA-COLUMN-001", columnId: box.canonicalColumnId,
  };
  return observed;
}

const papers = freeze.papers.map((record) => {
  const oracle = read(path.join(capability, "oracles", `${record.paper}-geometry-oracle.json`));
  const body = read(path.join(capability, "reviewed-v8", record.exports.body.file));
  const nonBody = read(path.join(capability, "reviewed-v8", record.exports["non-body"].file));
  const observed = {
    sourceDocumentId: oracle.sample.sourceDocumentId, sha256: oracle.sample.sha256,
    pages: oracle.pages.map((page, index) => ({
      pageId: page.identity.pageId,
      pageColumnModelRef: page.identity.pageColumnModelRef,
      pageColumnModelHash: page.identity.pageColumnModelHash,
      pageSize: page.pageSize,
      rotation: page.rotation,
      regions: [
        ...body.pages[index].predicted.map((box) => observationRegion(box, "body", index + 1)),
        ...nonBody.pages[index].predicted.map((box) => observationRegion(box, "non-body", index + 1)),
      ],
    })),
  };
  const findings = oracleContract.compareObserved(oracle, observed);
  return {
    paper: record.paper, sourcePdfSha256: record.sourcePdfSha256, oracleFile: `${record.paper}-geometry-oracle.json`,
    pageCount: oracle.pages.length, status: findings.length ? "regression_findings" : "pass",
    counts: {
      identityFailure: findings.filter((item) => item.failureClass === "identity_failure").length,
      structuralFailure: findings.filter((item) => item.failureClass === "structural_failure").length,
      toleranceDeviation: findings.filter((item) => item.failureClass === "tolerance_deviation").length,
    },
    findings,
  };
});

const report = {
  schemaVersion: "layout-geometry-reviewed-regression/v1",
  capabilityId: "cap.layout-geometry",
  baseline: "independent-v8-machine-predictions-vs-user-confirmed-corrected",
  runtimeDecisionUse: "forbidden",
  status: papers.some((paper) => paper.status !== "pass") ? "promotion_gate_failed" : "pass",
  paperCount: papers.length,
  pageCount: papers.reduce((sum, paper) => sum + paper.pageCount, 0),
  counts: {
    identityFailure: papers.reduce((sum, paper) => sum + paper.counts.identityFailure, 0),
    structuralFailure: papers.reduce((sum, paper) => sum + paper.counts.structuralFailure, 0),
    toleranceDeviation: papers.reduce((sum, paper) => sum + paper.counts.toleranceDeviation, 0),
  },
  papers,
};
fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
process.stdout.write(`${report.status}: ${JSON.stringify(report.counts)} across ${report.paperCount} papers / ${report.pageCount} pages\n`);
