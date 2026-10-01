"use strict";

// Offline Evidence workflow: converts confirmed exports to validated Geometry
// oracles and accepted Candidate Pool records. It never promotes or touches PDF runtime.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { PDFDocument } = require("../electron-app/node_modules/pdf-lib");
const oracleContract = require("../electron-app/capability-library/geometry-oracle");
const candidatePool = require("../electron-app/capability-library/candidate-pool");

const root = path.resolve(__dirname, "../..");
const library = path.join(root, "lingoflow-client/electron-app/capability-library");
const geometry = path.join(library, "capabilities/cap.layout-geometry");
const reviewed = path.join(geometry, "reviewed-v8");
const original = path.join(root, ".governance/archive/evidence/layout-geometry-capability-audit/evidence/phase-2-paper-geometry/human-review-final-paper1-10-v8");
const transaction = path.join(root, ".governance/archive/evidence/layout-geometry-capability-audit/evidence/geometry-accepted-stage-v1");
const oracles = path.join(geometry, "oracles");
const column = JSON.parse(fs.readFileSync(path.join(library, "capabilities/cap.column-recognition/corpus.json"), "utf8"));
const freeze = JSON.parse(fs.readFileSync(path.join(reviewed, "FREEZE_MANIFEST.json"), "utf8"));
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const hashCanonical = (value) => sha256(Buffer.from(canonical(value)));
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const at = new Date().toISOString();
const reviewer = "rioin (user-confirmed visual review)";

function reviewEvent(sequence, action, reason, previousHash) {
  const event = { sequence, action, actor: sequence === 1 ? "offline.geometry.oracle.builder" : reviewer, at, reason, previousHash };
  return { ...event, hash: hashCanonical(event) };
}

function region(box, paper, pageNumber, kind, exportName, pageRef) {
  const body = kind === "body";
  const spanning = body && box.canonicalColumnId === null;
  const regionClass = body ? (spanning ? "main_reading_flow_spanning" : "body_column") : box.regionClass;
  const result = {
    regionId: box.id,
    regionClass,
    owner: body ? (spanning ? "main_reading_flow:spanning" : `column:${box.canonicalColumnId}`) : `geometry:${box.objectType}`,
    expectedGeometry: box.geometry,
    toleranceProfileId: body ? "body-edge" : "object-edge",
    relations: [],
    sourceProvenance: [{
      sourceArtifactId: `${paper}:${exportName}:p${pageNumber}:${box.id}`,
      producer: "human-corrected-review-export",
      coordinateSpace: "pdf-page-top-left-points",
      transformChain: ["pdf-point-editor", "user-confirmed-corrected-box"],
    }],
    evidenceRefs: [`reviewed-v8/${exportName}`],
  };
  if (body && !spanning) {
    assert(["single", "left", "right"].includes(box.canonicalColumnId), `${paper} p${pageNumber}: unsupported lane ${box.canonicalColumnId}`);
    result.canonicalColumnRef = { pageColumnModelRef: pageRef, authority: "AA-COLUMN-001", columnId: box.canonicalColumnId };
  }
  if (!body && regionClass === "independent_region") result.semanticRegionType = box.semanticRegionType;
  if (!body && regionClass === "protected_region") result.protectedKind = box.protectedKind;
  return result;
}

function addLaneRelations(regions) {
  const left = regions.filter((r) => r.regionClass === "body_column" && r.canonicalColumnRef.columnId === "left");
  const right = regions.filter((r) => r.regionClass === "body_column" && r.canonicalColumnRef.columnId === "right");
  for (const a of left) for (const b of right) {
    const gap = b.expectedGeometry.x - a.expectedGeometry.x - a.expectedGeometry.width;
    assert(gap >= 0, `Reviewed left/right Body boxes cross the gutter: ${a.regionId}/${b.regionId}`);
    a.relations.push({ kind: "left_of", targetRegionId: b.regionId, minimumGapPoints: 0 });
    b.relations.push({ kind: "right_of", targetRegionId: a.regionId, minimumGapPoints: 0 });
  }
}

async function build(record) {
  const paper = record.paper;
  const columnSample = column.samples.find((sample) => sample.id === record.columnSampleId);
  assert(columnSample && columnSample.source.sha256 === record.sourcePdfSha256, `${paper}: Column identity mismatch`);
  const capture = read(path.join(original, "column-capture", `${paper}.json`));
  const body = read(path.join(reviewed, record.exports.body.file));
  const nonBody = read(path.join(reviewed, record.exports["non-body"].file));
  const sourcePath = path.join("D:/PDF测试", columnSample.source.fileName);
  const pdfBytes = fs.readFileSync(sourcePath);
  assert(sha256(pdfBytes) === record.sourcePdfSha256, `${paper}: source PDF hash mismatch`);
  const pdf = await PDFDocument.load(pdfBytes);
  assert(pdf.getPageCount() === record.pages, `${paper}: PDF page count mismatch`);
  const expectedColumn = columnSample.expectedOutcomes.find((item) => item.assertionId === "assert.column.page-region-truth").expected;
  const pages = body.pages.map((bodyPage, index) => {
    const nonBodyPage = nonBody.pages[index];
    const sourcePage = pdf.getPage(index);
    const capturePage = capture.pages[index];
    const columnPage = expectedColumn.pages[index];
    const pageNumber = index + 1;
    assert(bodyPage.confirmed && nonBodyPage.confirmed && bodyPage.pageNumber === pageNumber && nonBodyPage.pageNumber === pageNumber, `${paper} p${pageNumber}: unconfirmed/misaligned export`);
    assert(capturePage.pageNumber === pageNumber && columnPage.pageNumber === pageNumber && capturePage.layoutType === columnPage.layout, `${paper} p${pageNumber}: Column truth mismatch`);
    const crop = sourcePage.getCropBox(), media = sourcePage.getMediaBox();
    const rotation = sourcePage.getRotation().angle;
    assert(rotation === 0 && crop.x === 0 && crop.y === 0 && media.x === 0 && media.y === 0, `${paper} p${pageNumber}: unsupported nonzero rotation/crop origin`);
    assert(Math.abs(bodyPage.pageSize.width - crop.width) < 0.1 && Math.abs(bodyPage.pageSize.height - crop.height) < 0.1, `${paper} p${pageNumber}: page size mismatch`);
    const pageRef = `page-column-model/v1:page-${pageNumber}`;
    const columnIdentity = {
      schemaVersion: "page-column-model/v1", authority: "AA-COLUMN-001", sourceDocumentId: columnSample.id,
      pageNumber, pageSize: capturePage.columnModel.pageSize, layoutType: capturePage.layoutType,
      columns: capturePage.columns,
      independentRegionTypes: expectedColumn.independentRegions.filter((item) => item.pageNumber === pageNumber).map((item) => item.type),
    };
    const regions = [
      ...bodyPage.corrected.map((box) => region(box, paper, pageNumber, "body", record.exports.body.file, pageRef)),
      ...nonBodyPage.corrected.map((box) => region(box, paper, pageNumber, "non-body", record.exports["non-body"].file, pageRef)),
    ];
    addLaneRelations(regions);
    return {
      identity: { sourceDocumentId: `doc.layout-geometry.${paper}`, pageNumber, pageId: `page-${pageNumber}`, pageColumnModelRef: pageRef, pageColumnModelHash: sha256(Buffer.from(JSON.stringify(columnIdentity))) },
      pageSize: bodyPage.pageSize, rotation,
      cropBox: { x: crop.x, y: crop.y, width: crop.width, height: crop.height },
      mediaBox: { x: media.x, y: media.y, width: media.width, height: media.height },
      regions,
    };
  });
  const first = pages[0];
  const event1 = reviewEvent(1, "created", "Oracle materialized from the hash-bound v8 corrected exports; no prediction substituted for corrected truth.", null);
  const event2 = reviewEvent(2, "review_started", "All 126 pages were confirmed separately for Body and non-Body in the editable visual review.", event1.hash);
  const event3 = reviewEvent(3, "accepted", "User reported no major issue in final paper1–10 review; minor imperfections remain visible in the machine audit.", event2.hash);
  const oracle = {
    schemaVersion: "layout-geometry-oracle/v1", capabilityId: "cap.layout-geometry", catalogRole: "regression_oracle", runtimeDecisionUse: "forbidden",
    sample: { sampleId: `sample.layout-geometry.${paper}`, sourceDocumentId: `doc.layout-geometry.${paper}`, fileName: columnSample.source.fileName,
      mediaType: "application/pdf", sha256: columnSample.source.sha256, bytes: columnSample.source.bytes, pageCount: columnSample.source.pageCount,
      provenance: { kind: "user_provided", reference: `reviewed-v8 exports; ${columnSample.id} is the read-only Column dependency` } },
    coordinateContract: { coordinateSpace: "pdf-page-top-left-points", unit: "point", origin: "top_left", xDirection: "right", yDirection: "down", rotationApplied: 0,
      cropBoxBaseline: first.cropBox, mediaBoxBaseline: first.mediaBox },
    toleranceProfiles: [
      { id: "body-edge", absolutePoints: 3, relativeToPage: 0.005, appliesTo: ["x", "y", "width", "height", "edge_distance"], rationale: "Human Body boundaries include small approximate safety room; identity and topology stay exact.", cannotOverride: ["identity_failure", "structural_failure"] },
      { id: "object-edge", absolutePoints: 4, relativeToPage: 0.006, appliesTo: ["x", "y", "width", "height", "edge_distance"], rationale: "Tight independent/protected object edges were visually reviewed; small PDF extraction differences are tolerated.", cannotOverride: ["identity_failure", "structural_failure"] },
    ],
    pages, failureClasses: ["identity_failure", "structural_failure", "tolerance_deviation"],
    evidenceRefs: [`reviewed-v8/FREEZE_MANIFEST.json`, `reviewed-v8/${record.exports.body.file}`, `reviewed-v8/${record.exports["non-body"].file}`],
    reviewHistory: [event1, event2, event3],
    authorityBoundary: { geometryOwner: "AA-GEOMETRY-001", columnDependency: "AA-COLUMN-001", columnDependencyMode: "read_only_reference", runtimeDecisionUse: "forbidden",
      forbiddenActions: ["reclassify_column", "mutate_column_truth", "auto_repair_runtime", "auto_promote_candidate", "override_identity_or_structure_with_tolerance"] },
  };
  oracleContract.validateOracle(oracle);
  const oracleName = `${paper}-geometry-oracle.json`;
  const oracleBytes = Buffer.from(JSON.stringify(oracle, null, 2) + "\n");
  const sample = {
    id: oracle.sample.sampleId, displayName: `Reviewed Layout Geometry ${paper}`, source: columnSample.source,
    provenance: { kind: "user_provided", reference: `Final v8 visual review; read-only Column dependency ${columnSample.id}` },
    rights: columnSample.rights,
    boundaryFeatureIds: ["boundary.geometry.main-reading-flow", "boundary.geometry.independent-object", "boundary.geometry.protected-object", "boundary.geometry.column-dependency"],
    expectedOutcomes: [
      { capabilityId: "cap.layout-geometry", assertionId: "assert.geometry.reviewed-boxes", oracleType: "manual", expected: { oracleFile: `oracles/${oracleName}`, oracleSha256: sha256(oracleBytes), bodyExportSha256: record.exports.body.sha256, nonBodyExportSha256: record.exports["non-body"].sha256 } },
      { capabilityId: "cap.layout-geometry", assertionId: "assert.geometry.identity-structure-tolerance", oracleType: "manual", expected: { oracleFile: `oracles/${oracleName}`, oracleSha256: sha256(oracleBytes), failureClasses: oracle.failureClasses } },
    ],
    evidenceRefs: [`cap.layout-geometry/reviewed-v8/FREEZE_MANIFEST.json`, `cap.layout-geometry/oracles/${oracleName}`],
    storage: { binaryCommitted: false, externalSourceRequiredForRun: true },
    authorityBoundary: { catalogRole: "regression_oracle", runtimeDecisionUse: "forbidden", finalDecisionsOwnedBy: ["AA-GEOMETRY-001"] },
  };
  return { paper, oracleName, oracleBytes, submission: { id: `candidate.layout-geometry.${paper}`, capabilityIds: ["cap.layout-geometry"], sample } };
}

async function main() {
  assert(!fs.existsSync(transaction) && !fs.existsSync(oracles), "Acceptance staging already exists; refusing overwrite");
  assert(freeze.papers.length === 10, "Expected ten frozen papers");
  const built = await Promise.all(freeze.papers.map(build));
  let state = candidatePool.loadState();
  for (const item of built) {
    const precheck = candidatePool.precheck(state, item.submission);
    assert(!precheck.duplicateCandidateIds.length && !precheck.duplicateCorpusIds.length, `${item.paper}: duplicate candidate`);
  }
  fs.mkdirSync(oracles);
  for (const item of built) fs.writeFileSync(path.join(oracles, item.oracleName), item.oracleBytes, { flag: "wx" });
  fs.mkdirSync(transaction);
  let revision = 0;
  const save = () => candidatePool.saveState(state, path.join(transaction, `revision-${String(++revision).padStart(3, "0")}`));
  for (const item of built) {
    const reason = `${item.paper}: source and reviewed oracle hash verified; acceptance is Evidence-only and does not promote or authorize runtime use`;
    const audit = { actor: reviewer, at, reason, evidenceRefs: item.submission.sample.evidenceRefs };
    state = candidatePool.submitCandidate(state, item.submission, { ...audit, actor: "offline.geometry.candidate.builder" }); save();
    state = candidatePool.reviewCandidate(state, item.submission.id, "under_review", audit); save();
    state = candidatePool.reviewCandidate(state, item.submission.id, "accepted", audit); save();
  }
  const candidateFile = path.join(library, "candidates.json");
  const originalCandidates = fs.readFileSync(candidateFile);
  assert(sha256(originalCandidates) === sha256(fs.readFileSync(candidateFile)), "Candidate catalog changed during staging");
  fs.writeFileSync(candidateFile, JSON.stringify(state.pool, null, 2) + "\n");
  candidatePool.loadState();
  process.stdout.write(`Accepted ${built.length} Geometry candidates in ${revision} immutable revisions; formal corpus still empty.\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
