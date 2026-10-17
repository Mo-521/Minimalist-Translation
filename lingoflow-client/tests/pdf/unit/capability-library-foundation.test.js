"use strict";

const assert = require("node:assert/strict");
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
  const capabilitySchema = JSON.parse(fs.readFileSync(path.join(LIBRARY_ROOT, "schemas", "capability.schema.json"), "utf8"));
  const corpusSchema = JSON.parse(fs.readFileSync(path.join(LIBRARY_ROOT, "schemas", "sample-corpus.schema.json"), "utf8"));
  const domainSchema = JSON.parse(fs.readFileSync(path.join(LIBRARY_ROOT, "schemas", "domain.schema.json"), "utf8"));
  assert.equal(capabilitySchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(corpusSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(domainSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(capabilitySchema.properties.runtimeDecisionUse.const, "forbidden");
  assert.equal(corpusSchema.properties.runtimeDecisionUse.const, "forbidden");
  assert.equal(domainSchema.properties.registryRole.const, "organization_and_presentation_only");
});

test("library loads one recursively frozen evidence snapshot without runtime decisions", () => {
  const snapshot = libraryModule.loadCapabilityLibrary();
  assert.equal(snapshot.role, "evidence_and_regression_only");
  assert.equal(snapshot.runtimeDecisionUse, "forbidden");
  assert.equal(snapshot.schemaVersion, "capability-library-snapshot/v2");
  assert.equal(snapshot.domains.length, 5);
  assert.equal(snapshot.capabilities.length, 11);
  assert.equal(snapshot.samples.length, 30);
  assert.deepEqual(snapshot.batches.map((batch) => [batch.capabilityId, batch.batchId]), [
    ["cap.column-recognition", "B001"],
    ["cap.layout-geometry", "B001"],
    ["cap.document-structure", "B001"],
  ]);
  assert.equal(Object.isFrozen(snapshot.batches), true);
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
  assert.equal(column.domain, "column-region-recognition");
  assert.equal(geometry.domain, "column-region-recognition");
  assert.equal(column.recordKind, "independent_capability");
  assert.equal(geometry.recordKind, "independent_capability");
  assert.deepEqual(geometry.dependencies.requires, [{
    capabilityId: "cap.column-recognition",
    facts: ["fact.column.canonical-page-column-model"],
    semantics: "canonical_read_only",
  }]);
  assert.deepEqual(column.dependencies.consumed_by, [{
    capabilityId: "cap.layout-geometry",
    facts: ["fact.column.canonical-page-column-model"],
  }]);
  assert.equal(snapshot.capabilities.filter((item) => item.recordKind === "acceptance_contract").length, 8);
  assert.equal(snapshot.capabilities.filter((item) => item.recordKind === "independent_capability").length, 3);
  const structure = snapshot.capabilities.find((item) => item.id === "cap.document-structure");
  const historicalContract = snapshot.capabilities.find((item) => item.id === "cap.semantic-structure");
  assert.equal(structure.recordKind, "independent_capability");
  assert.equal(structure.domain, "document-structure-identity");
  assert.equal(structure.status, "pilot_ready");
  assert.equal(structure.architectureRecord, "AA-STRUCTURE-001");
  assert.deepEqual(structure.dependencies.requires, []);
  assert.deepEqual(structure.dependencies.consumed_by, []);
  assert.deepEqual(structure.dependencies.produces.map((item) => item.factId), [
    "fact.structure.canonical-semantic-type", "fact.structure.source-segment-boundary",
  ]);
  assert.deepEqual(structure.regressionSampleIds, Array.from({ length: 10 }, (_, index) => `sample.document-structure.paper${index + 1}`));
  assert.equal(historicalContract.recordKind, "acceptance_contract");
  assert.deepEqual(historicalContract.dependencies.produces, []);
  assert.match(historicalContract.decisionAuthority.statement, /不产生第二套事实/);
  const columnSamples = snapshot.samples.filter((sample) => sample.expectedOutcomes.some((outcome) => outcome.capabilityId === "cap.column-recognition"));
  const geometrySamples = snapshot.samples.filter((sample) => sample.expectedOutcomes.some((outcome) => outcome.capabilityId === "cap.layout-geometry"));
  assert.equal(columnSamples.length, 10);
  assert.equal(geometrySamples.length, 10);
  const structureSamples = snapshot.samples.filter((sample) => sample.expectedOutcomes.some((outcome) => outcome.capabilityId === "cap.document-structure"));
  assert.equal(structureSamples.length, 10);
  assert.deepEqual(structure.regressionSampleIds, structureSamples.map((sample) => sample.id));
  assert.equal(structureSamples.reduce((total, sample) => total + sample.source.pageCount, 0), 126);
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

test("Capability dependencies are a validated canonical-fact DAG", () => {
  const snapshot = libraryModule.loadCapabilityLibrary();
  const capabilities = JSON.parse(JSON.stringify(snapshot.capabilities));
  const column = capabilities.find((item) => item.id === "cap.column-recognition");
  const geometry = capabilities.find((item) => item.id === "cap.layout-geometry");
  column.dependencies.requires.push({
    capabilityId: "cap.layout-geometry",
    facts: ["fact.geometry.reviewed-page-regions"],
    semantics: "canonical_read_only",
  });
  geometry.dependencies.consumed_by.push({
    capabilityId: "cap.column-recognition",
    facts: ["fact.geometry.reviewed-page-regions"],
  });
  assert.throws(
    () => libraryModule.validateCapabilityArchitecture(capabilities, snapshot.domains),
    (error) => error && error.code === "CAPABILITY_LIBRARY_DEPENDENCY_CYCLE"
  );
});

test("physical capability roots are limited to implemented Domains", () => {
  const domainsRoot = path.join(LIBRARY_ROOT, "domains");
  const domainDirectories = fs.readdirSync(domainsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(domainDirectories, ["column-region-recognition", "document-structure-identity"]);
  for (const domainId of domainDirectories) assert.equal(fs.existsSync(path.join(domainsRoot, domainId, "capabilities")), true);
  const capabilityRoot = path.join(domainsRoot, "column-region-recognition", "capabilities");
  assert.deepEqual(
    fs.readdirSync(capabilityRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(),
    ["cap.column-recognition", "cap.layout-geometry"]
  );
  const structureRoot = path.join(domainsRoot, "document-structure-identity", "capabilities", "cap.document-structure");
  assert.equal(fs.existsSync(path.join(structureRoot, "capabilities.json")), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(structureRoot, "corpus.json"), "utf8")).samples.length, 10);
  assert.equal(fs.existsSync(path.join(structureRoot, "batches", "B001", "README.md")), true);
  assert.equal(fs.existsSync(path.join(structureRoot, "offline", "INPUT_OUTPUT_CONTRACT.md")), true);
  for (const legacyPath of [
    "capabilities", "domains.json", "capabilities.json", "candidates.json", "corpus.json",
    "capability.schema.json", "domain.schema.json", "geometry-oracle.js", "geometry-oracle.schema.json",
  ]) assert.equal(fs.existsSync(path.join(LIBRARY_ROOT, legacyPath)), false, `legacy path must not remain authoritative: ${legacyPath}`);
  assert.equal(fs.existsSync(path.join(LIBRARY_ROOT, "registry", "domains.json")), true);
  assert.equal(fs.existsSync(path.join(LIBRARY_ROOT, "schemas", "capability.schema.json")), true);
  assert.equal(fs.existsSync(path.join(LIBRARY_ROOT, "shared", "corpus.json")), true);
  assert.equal(fs.existsSync(path.join(capabilityRoot, "cap.layout-geometry", "batches", "B001", "manifest.json")), true);
});

test("Column B001 public catalog retains cohort identity without private regression files", () => {
  const rootCatalog = JSON.parse(fs.readFileSync(path.join(LIBRARY_ROOT, "registry", "capabilities.json"), "utf8"));
  assert.equal(rootCatalog.capabilities.some((item) => item.id === "cap.column-recognition"), false);
  const columnRoot = path.join(LIBRARY_ROOT, "domains", "column-region-recognition", "capabilities", "cap.column-recognition");
  const columnCatalog = JSON.parse(fs.readFileSync(path.join(columnRoot, "capabilities.json"), "utf8"));
  const corpus = JSON.parse(fs.readFileSync(path.join(columnRoot, "corpus.json"), "utf8"));
  const batch = JSON.parse(fs.readFileSync(path.join(columnRoot, "batches", "B001", "manifest.json"), "utf8"));
  assert.deepEqual(columnCatalog.capabilities.map((item) => item.id), ["cap.column-recognition"]);
  assert.equal(corpus.samples.length, 10);
  assert.equal(batch.samples.length, 10);
  assert.equal(batch.samples.reduce((sum, sample) => sum + sample.pages, 0), 126);
  assert.equal(batch.runtimeDecisionUse, "forbidden");
  assert.equal(batch.capabilityStatus, "covered");
  const source = fs.readFileSync(path.join(LIBRARY_ROOT, "index.js"), "utf8");
  assert.doesNotMatch(source, /\.governance|column-capability-pilot/);
});

test("Geometry B001 public catalog retains cohort and authority boundary", () => {
  const geometryRoot = path.join(LIBRARY_ROOT, "domains", "column-region-recognition", "capabilities", "cap.layout-geometry");
  const manifest = JSON.parse(fs.readFileSync(path.join(geometryRoot, "batches", "B001", "manifest.json"), "utf8"));
  assert.equal(manifest.runtimeDecisionUse, "forbidden");
  assert.equal(manifest.capabilityStatus, "pilot_ready");
  assert.equal(manifest.samples.length, 10);
  assert.equal(manifest.samples.reduce((sum, sample) => sum + sample.pages, 0), 126);
});

test("evidence catalogs fail fast when a runtime decision field appears", () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(LIBRARY_ROOT, "registry", "capabilities.json"), "utf8"));
  catalog.capabilities[0].boundaries[0].semanticType = "body";
  assert.throws(
    () => libraryModule.validateCapabilityCatalog(catalog),
    (error) => error && error.code === "CAPABILITY_LIBRARY_RUNTIME_AUTHORITY_FORBIDDEN"
  );
});

test("library public validation executes complete schemas, including intake sample oracles", () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(LIBRARY_ROOT, "registry", "capabilities.json"), "utf8"));
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
  assert.match(html, /能力域只负责组织；工程事实、证据和回归仍由各独立能力分别拥有/);
  assert.match(html, /id="capabilityLibraryHome"/);
  assert.match(html, /id="capabilityDomainDetail"[^>]*hidden/);
  assert.match(html, /已建立 Capability/);
  assert.match(html, /验收契约/);
  assert.doesNotMatch(html, /id="page-capabilities"[\s\S]*?<\/section>[\s\S]*?<(?:button|input)[^>]+data-runtime-decision/);
  assert.match(renderer, /loadCapabilityLibrary\(\)/);
  assert.ok(packageJson.build.files.includes("capability-library/index.js"));
  assert.ok(packageJson.build.files.includes("capability-library/schemas/domain.schema.json"));
  assert.ok(packageJson.build.files.includes("capability-library/registry/domains.json"));
  assert.ok(packageJson.build.files.includes("capability-library/domains/*/capabilities/*/capabilities.json"));
  assert.ok(packageJson.build.files.includes("capability-library/domains/*/capabilities/*/corpus.json"));
  assert.equal(packageJson.scripts["capability:intake"], "node ../tools/capability-library-intake.js");
});
