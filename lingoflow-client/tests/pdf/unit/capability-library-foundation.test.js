"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { PDFDocument } = require("../../../electron-app/node_modules/pdf-lib");

const APP_ROOT = path.join(__dirname, "..", "..", "..", "electron-app");
const LIBRARY_ROOT = path.join(APP_ROOT, "capability-library");
const libraryModule = require(LIBRARY_ROOT);
const intakeModule = require(path.join(__dirname, "..", "..", "..", "tools", "capability-library-intake.js"));

test("capability and corpus schemas are versioned evidence-only contracts", () => {
  const capabilitySchema = JSON.parse(fs.readFileSync(path.join(LIBRARY_ROOT, "capability.schema.json"), "utf8"));
  const corpusSchema = JSON.parse(fs.readFileSync(path.join(LIBRARY_ROOT, "sample-corpus.schema.json"), "utf8"));
  assert.equal(capabilitySchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(corpusSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(capabilitySchema.properties.runtimeDecisionUse.const, "forbidden");
  assert.equal(corpusSchema.properties.runtimeDecisionUse.const, "forbidden");
});

test("library loads one recursively frozen evidence snapshot without runtime decisions", () => {
  const snapshot = libraryModule.loadCapabilityLibrary();
  assert.equal(snapshot.role, "evidence_and_regression_only");
  assert.equal(snapshot.runtimeDecisionUse, "forbidden");
  assert.equal(snapshot.capabilities.length, 10);
  assert.equal(snapshot.samples.length, 20);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.capabilities), true);
  assert.equal(Object.isFrozen(snapshot.capabilities[0].boundaries[0]), true);
  const column = snapshot.capabilities.find((item) => item.id === "cap.column-recognition");
  assert.equal(column.architectureRecord, "AA-COLUMN-001");
  assert.match(column.decisionAuthority.statement, /Column Authority/);
  assert.equal(column.status, "covered");
  const geometry = snapshot.capabilities.find((item) => item.id === "cap.layout-geometry");
  assert.equal(geometry.architectureRecord, "AA-GEOMETRY-001");
  assert.equal(geometry.status, "pilot_ready");
  const columnSamples = snapshot.samples.filter((sample) => sample.expectedOutcomes.some((outcome) => outcome.capabilityId === "cap.column-recognition"));
  const geometrySamples = snapshot.samples.filter((sample) => sample.expectedOutcomes.some((outcome) => outcome.capabilityId === "cap.layout-geometry"));
  assert.equal(columnSamples.length, 10);
  assert.equal(geometrySamples.length, 10);
  assert.deepEqual(column.regressionSampleIds, columnSamples.map((sample) => sample.id));
  assert.deepEqual(geometry.regressionSampleIds, geometrySamples.map((sample) => sample.id));
  assert.equal(columnSamples.reduce((total, sample) => total + sample.source.pageCount, 0), 126);
  assert.equal(geometrySamples.reduce((total, sample) => total + sample.source.pageCount, 0), 126);
  const names = [
    "论文样本1.pdf", "论文样本2.pdf", "论文样本3.pdf", "论文样本4.pdf",
    "论文样本5.pdf", "论文样本6.pdf", "论文样本7.pdf", "论文样本8.pdf",
    "论文样本9.pdf", "论文样本10.pdf",
  ];
  assert.deepEqual(columnSamples.map((sample) => sample.source.fileName), names);
  assert.deepEqual(geometrySamples.map((sample) => sample.source.fileName), names);
});

test("Column capability has one canonical subdirectory and a 126-page promoted baseline", () => {
  const rootCatalog = JSON.parse(fs.readFileSync(path.join(LIBRARY_ROOT, "capabilities.json"), "utf8"));
  assert.equal(rootCatalog.capabilities.some((item) => item.id === "cap.column-recognition"), false);
  const columnRoot = path.join(LIBRARY_ROOT, "capabilities", "cap.column-recognition");
  const columnCatalog = JSON.parse(fs.readFileSync(path.join(columnRoot, "capabilities.json"), "utf8"));
  const corpus = JSON.parse(fs.readFileSync(path.join(columnRoot, "corpus.json"), "utf8"));
  const baseline = JSON.parse(fs.readFileSync(path.join(columnRoot, "baseline", "summary.json"), "utf8"));
  assert.deepEqual(columnCatalog.capabilities.map((item) => item.id), ["cap.column-recognition"]);
  assert.equal(corpus.samples.length, 10);
  assert.equal(baseline.sampleCount, 10);
  assert.equal(baseline.pageCount, 126);
  assert.equal(baseline.passCount, 126);
  assert.equal(baseline.findingCount, 0);
  assert.deepEqual(baseline.layoutCoverage, { singleColumnPages: 71, doubleColumnPages: 55, mixedBodyFlowPages: 0 });
  assert.equal(fs.readdirSync(path.join(columnRoot, "baseline")).filter((name) => /^paper\d+-regression\.json$/.test(name)).length, 10);
  assert.equal(fs.readdirSync(path.join(columnRoot, "evidence", "pre-repair-regression")).filter((name) => /^paper\d-regression\.json$/.test(name)).length, 7);
  const source = fs.readFileSync(path.join(LIBRARY_ROOT, "index.js"), "utf8");
  assert.doesNotMatch(source, /\.governance|column-capability-pilot/);
});

test("reviewed Geometry v8 freeze remains hash-bound and confirmed across later revisions", () => {
  const geometryRoot = path.join(LIBRARY_ROOT, "capabilities", "cap.layout-geometry");
  const freezeRoot = path.join(geometryRoot, "reviewed-v8");
  const manifest = JSON.parse(fs.readFileSync(path.join(freezeRoot, "FREEZE_MANIFEST.json"), "utf8"));
  assert.equal(manifest.runtimeDecisionUse, "forbidden");
  assert.equal(manifest.status, "human_review_confirmed_formal_promotion_pending");
  assert.equal(manifest.papers.length, 10);
  assert.equal(manifest.papers.reduce((sum, paper) => sum + paper.pages, 0), 126);
  for (const paper of manifest.papers) {
    for (const kind of ["body", "non-body"]) {
      const entry = paper.exports[kind];
      const bytes = fs.readFileSync(path.join(freezeRoot, entry.file));
      assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), entry.sha256);
      const exportData = JSON.parse(bytes.toString("utf8"));
      assert.equal(exportData.sourcePdfSha256, paper.sourcePdfSha256);
      assert.equal(exportData.pages.length, paper.pages);
      assert.equal(exportData.pages.every((page) => page.confirmed === true), true);
    }
  }
});

test("Geometry candidates bind reviewed Oracle revisions and only explicitly promoted corpus samples", () => {
  const pool = require(path.join(LIBRARY_ROOT, "candidate-pool"));
  const oracle = require(path.join(LIBRARY_ROOT, "geometry-oracle"));
  const state = pool.loadState();
  const geometryRoot = path.join(LIBRARY_ROOT, "capabilities", "cap.layout-geometry");
  const accepted = state.pool.candidates.filter((candidate) => candidate.capabilityIds.includes("cap.layout-geometry"));
  assert.equal(accepted.length, 10);
  const geometryCorpus = state.corpus.samples.filter((sample) => sample.expectedOutcomes.some((outcome) => outcome.capabilityId === "cap.layout-geometry"));
  assert.equal(geometryCorpus.length, accepted.filter((candidate) => candidate.promotedSampleId).length);
  for (const candidate of accepted) {
    assert.equal(candidate.status, "accepted");
    const outcomes = new Map(candidate.sample.expectedOutcomes.map((outcome) => [outcome.assertionId, outcome]));
    for (const event of candidate.history) for (const outcome of event.expectedOutcomes) outcomes.set(outcome.assertionId, outcome);
    const assertion = outcomes.get("assert.geometry.reviewed-boxes");
    const bytes = fs.readFileSync(path.join(geometryRoot, assertion.expected.oracleFile));
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), assertion.expected.oracleSha256);
    const item = JSON.parse(bytes.toString("utf8"));
    oracle.validateOracle(item);
    assert.equal(item.sample.sha256, candidate.sample.source.sha256);
    assert.equal(item.reviewHistory.at(-1).action, "accepted");
    const promoted = geometryCorpus.find((sample) => sample.id === candidate.sample.id);
    assert.equal(Boolean(promoted), Boolean(candidate.promotedSampleId));
    if (promoted) {
      assert.equal(candidate.history.at(-1).action, "promote");
      assert.deepEqual(promoted.expectedOutcomes, [...outcomes.values()]);
    }
  }
});

test("evidence catalogs fail fast when a runtime decision field appears", () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(LIBRARY_ROOT, "capabilities.json"), "utf8"));
  catalog.capabilities[0].boundaries[0].semanticType = "body";
  assert.throws(
    () => libraryModule.validateCapabilityCatalog(catalog),
    (error) => error && error.code === "CAPABILITY_LIBRARY_RUNTIME_AUTHORITY_FORBIDDEN"
  );
});

test("library public validation executes complete schemas, including intake sample oracles", () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(LIBRARY_ROOT, "capabilities.json"), "utf8"));
  catalog.capabilities[0].extra = true;
  assert.throws(() => libraryModule.validateCapabilityCatalog(catalog), /schema/i);
  const sample = {
    id: "sample.audit", displayName: "Audit fixture",
    source: { fileName: "audit.pdf", mediaType: "application/pdf", sha256: "a".repeat(64), bytes: 100, pageCount: 1 },
    provenance: { kind: "synthetic", reference: "test" },
    rights: { status: "owned", canStoreMetadata: true, canStoreBinary: false },
    boundaryFeatureIds: ["boundary.structure.section-transition"],
    expectedOutcomes: [{ capabilityId: "cap.semantic-structure", assertionId: "assert.structure.single-producer", oracleType: "manual" }],
    evidenceRefs: [], storage: { binaryCommitted: false, externalSourceRequiredForRun: true },
    authorityBoundary: { catalogRole: "regression_oracle", runtimeDecisionUse: "forbidden", finalDecisionsOwnedBy: ["AA-STRUCTURE-001"] },
  };
  assert.throws(() => libraryModule.validateCorpusSample(sample), /schema/i);
  sample.expectedOutcomes[0].expected = "reviewed expectation";
  libraryModule.validateCorpusSample(sample);
  sample.rights.status = "unknown";
  assert.throws(() => libraryModule.validateCorpusSample(sample), /schema/i);
});

test("sample intake hashes and inspects a PDF without committing or routing the binary", async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "capability-library-"));
  try {
    const pdf = await PDFDocument.create();
    pdf.addPage([300, 400]);
    pdf.addPage([300, 400]);
    const sourcePath = path.join(temporaryRoot, "boundary-fixture.pdf");
    fs.writeFileSync(sourcePath, await pdf.save());
    const manifestPath = path.join(temporaryRoot, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({
      id: "sample.foundation-boundary",
      displayName: "Foundation boundary fixture",
      provenance: { kind: "synthetic", reference: "capability-library-foundation.test" },
      rights: { status: "owned", canStoreMetadata: true, canStoreBinary: false },
      boundaryFeatureIds: ["boundary.foundation.synthetic"],
      expectedOutcomes: [],
      evidenceRefs: [],
      finalDecisionsOwnedBy: ["AA-EVIDENCE-001"],
    }));
    const record = await intakeModule.buildCorpusRecord({ manifestPath, sourcePath });
    assert.equal(record.source.pageCount, 2);
    assert.match(record.source.sha256, /^[a-f0-9]{64}$/);
    assert.equal(record.storage.binaryCommitted, false);
    assert.equal(record.storage.externalSourceRequiredForRun, true);
    assert.equal(record.authorityBoundary.runtimeDecisionUse, "forbidden");
    assert.equal(JSON.stringify(record).includes(temporaryRoot), false);
    assert.equal(Object.isFrozen(record), true);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("the fourth page is read-only and capability files are included in packaging", () => {
  const html = fs.readFileSync(path.join(APP_ROOT, "index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(APP_ROOT, "renderer.js"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(APP_ROOT, "package.json"), "utf8"));
  assert.match(html, /data-page="capabilities"/);
  assert.match(html, /id="page-capabilities"/);
  assert.match(html, /能力库不是第二套权威/);
  assert.doesNotMatch(html, /id="page-capabilities"[\s\S]*?<\/section>[\s\S]*?<(?:button|input)[^>]+data-runtime-decision/);
  assert.match(renderer, /loadCapabilityLibrary\(\)/);
  assert.ok(packageJson.build.files.includes("capability-library/index.js"));
  assert.ok(packageJson.build.files.includes("capability-library/capabilities/*/capabilities.json"));
  assert.ok(packageJson.build.files.includes("capability-library/capabilities/*/corpus.json"));
  assert.equal(packageJson.scripts["capability:intake"], "node ../tools/capability-library-intake.js");
});
