"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const APP_ROOT = path.join(__dirname, "..", "..", "..", "electron-app");
const LIBRARY_ROOT = path.join(APP_ROOT, "capability-library");
const TASK_SCHEMA = path.join(__dirname, "..", "..", "..", "..", ".governance", "tasks", "layout-geometry-capability-audit", "geometry-oracle.schema.json");
const oracle = require(path.join(LIBRARY_ROOT, "geometry-oracle"));

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function validOracle() {
  return {
    schemaVersion: "layout-geometry-oracle/v1",
    capabilityId: "cap.layout-geometry",
    catalogRole: "regression_oracle",
    runtimeDecisionUse: "forbidden",
    sample: {
      sampleId: "sample.geometry.synthetic-1",
      sourceDocumentId: "doc.geometry.synthetic-1",
      fileName: "geometry-synthetic.pdf",
      mediaType: "application/pdf",
      sha256: "a".repeat(64),
      bytes: 1024,
      pageCount: 1,
      provenance: { kind: "synthetic", reference: "layout-geometry-oracle.test" },
    },
    coordinateContract: {
      coordinateSpace: "pdf-page-top-left-points",
      unit: "point",
      origin: "top_left",
      xDirection: "right",
      yDirection: "down",
      rotationApplied: 0,
      cropBoxBaseline: { x: 0, y: 0, width: 612, height: 792 },
      mediaBoxBaseline: { x: 0, y: 0, width: 612, height: 792 },
    },
    toleranceProfiles: [{
      id: "body-edge",
      absolutePoints: 2,
      relativeToPage: 0.005,
      appliesTo: ["x", "y", "width", "height"],
      rationale: "glyph rounding in synthetic fixture",
      cannotOverride: ["identity_failure", "structural_failure"],
    }],
    pages: [{
      identity: {
        sourceDocumentId: "doc.geometry.synthetic-1",
        pageNumber: 1,
        pageId: "page-1",
        pageColumnModelRef: "page-column-model/v1:page-1",
        pageColumnModelHash: "b".repeat(64),
      },
      pageSize: { width: 612, height: 792 },
      rotation: 0,
      cropBox: { x: 0, y: 0, width: 612, height: 792 },
      mediaBox: { x: 0, y: 0, width: 612, height: 792 },
      regions: [
        {
          regionId: "body.left",
          regionClass: "body_column",
          owner: "column:left",
          canonicalColumnRef: {
            pageColumnModelRef: "page-column-model/v1:page-1",
            authority: "AA-COLUMN-001",
            columnId: "left",
          },
          expectedGeometry: { x: 54, y: 72, width: 240, height: 648 },
          toleranceProfileId: "body-edge",
          relations: [{ kind: "left_of", targetRegionId: "body.right" }],
          sourceProvenance: [{
            sourceArtifactId: "pcm:page-1:left",
            producer: "PageColumnModel.columnGeometry",
            coordinateSpace: "pdf-page-top-left-points",
            transformChain: ["read_frozen_page_column_model"],
          }],
          evidenceRefs: ["EVD-SYNTHETIC-GEOMETRY"],
        },
        {
          regionId: "body.right",
          regionClass: "body_column",
          owner: "column:right",
          canonicalColumnRef: {
            pageColumnModelRef: "page-column-model/v1:page-1",
            authority: "AA-COLUMN-001",
            columnId: "right",
          },
          expectedGeometry: { x: 318, y: 72, width: 240, height: 648 },
          toleranceProfileId: "body-edge",
          relations: [{ kind: "right_of", targetRegionId: "body.left" }],
          sourceProvenance: [{
            sourceArtifactId: "pcm:page-1:right",
            producer: "PageColumnModel.columnGeometry",
            coordinateSpace: "pdf-page-top-left-points",
            transformChain: ["read_frozen_page_column_model"],
          }],
          evidenceRefs: ["EVD-SYNTHETIC-GEOMETRY"],
        },
      ],
    }],
    failureClasses: ["identity_failure", "structural_failure", "tolerance_deviation"],
    evidenceRefs: ["EVD-SYNTHETIC-GEOMETRY"],
    reviewHistory: [{
      sequence: 1,
      action: "created",
      actor: "schema.fixture",
      at: "2026-09-18T08:00:00.000Z",
      reason: "Synthetic schema fixture, not paper truth",
      previousHash: null,
      hash: "c".repeat(64),
    }],
    authorityBoundary: {
      geometryOwner: "AA-GEOMETRY-001",
      columnDependency: "AA-COLUMN-001",
      columnDependencyMode: "read_only_reference",
      runtimeDecisionUse: "forbidden",
      forbiddenActions: [
        "reclassify_column",
        "mutate_column_truth",
        "auto_repair_runtime",
        "auto_promote_candidate",
        "override_identity_or_structure_with_tolerance",
      ],
    },
  };
}

function observedFrom(oracle, mutate) {
  const page = oracle.pages[0];
  const value = {
    sourceDocumentId: oracle.sample.sourceDocumentId,
    sha256: oracle.sample.sha256,
    pages: [{
      pageId: page.identity.pageId,
      pageColumnModelRef: page.identity.pageColumnModelRef,
      pageColumnModelHash: page.identity.pageColumnModelHash,
      pageSize: copy(page.pageSize),
      rotation: page.rotation,
      regions: page.regions.map((region) => ({
        regionId: region.regionId,
        owner: region.owner,
        canonicalColumnRef: copy(region.canonicalColumnRef),
        geometry: copy(region.expectedGeometry),
      })),
    }],
  };
  if (mutate) mutate(value);
  return value;
}

test("frozen schema is evidence-only and identical in Task and library", () => {
  const librarySchema = JSON.parse(fs.readFileSync(path.join(LIBRARY_ROOT, "geometry-oracle.schema.json"), "utf8"));
  const taskSchema = JSON.parse(fs.readFileSync(TASK_SCHEMA, "utf8"));
  assert.deepEqual(librarySchema, taskSchema);
  assert.equal(librarySchema.properties.runtimeDecisionUse.const, "forbidden");
  assert.equal(librarySchema.properties.capabilityId.const, "cap.layout-geometry");
  assert.equal(librarySchema.$defs.authorityBoundary.properties.geometryOwner.const, "AA-GEOMETRY-001");
  assert.equal(librarySchema.$defs.canonicalColumnRef.properties.authority.const, "AA-COLUMN-001");
});

test("S-01 valid complete synthetic oracle passes", () => {
  oracle.validateOracle(validOracle());
});

test("S-02 omit required field fails", () => {
  const item = validOracle();
  delete item.sample.sha256;
  assert.throws(() => oracle.validateOracle(item), (error) => error.code === "GEOMETRY_ORACLE_SCHEMA_INVALID");
});

test("S-03 unknown property fails", () => {
  const item = validOracle();
  item.extra = true;
  assert.throws(() => oracle.validateOracle(item), (error) => error.code === "GEOMETRY_ORACLE_SCHEMA_INVALID");
});

test("S-05 runtimeDecisionUse must stay forbidden", () => {
  const item = validOracle();
  item.runtimeDecisionUse = "allowed";
  assert.throws(() => oracle.validateOracle(item), (error) => error.code === "GEOMETRY_ORACLE_SCHEMA_INVALID");
});

test("S-06 Column reference authority other than AA-COLUMN-001 fails", () => {
  const item = validOracle();
  item.pages[0].regions[0].canonicalColumnRef.authority = "AA-GEOMETRY-001";
  assert.throws(() => oracle.validateOracle(item), (error) => error.code === "GEOMETRY_ORACLE_SCHEMA_INVALID");
});

test("S-07 body column missing canonical Column reference fails", () => {
  const item = validOracle();
  delete item.pages[0].regions[0].canonicalColumnRef;
  assert.throws(() => oracle.validateOracle(item), (error) => error.code === "GEOMETRY_ORACLE_SCHEMA_INVALID");
});

test("S-08 non-positive box size fails", () => {
  const item = validOracle();
  item.pages[0].regions[0].expectedGeometry.width = 0;
  assert.throws(() => oracle.validateOracle(item), (error) => error.code === "GEOMETRY_ORACLE_SCHEMA_INVALID");
});

test("S-09 tolerance profile omitting identity/structure override ban fails", () => {
  const item = validOracle();
  item.toleranceProfiles[0].cannotOverride = ["identity_failure"];
  assert.throws(() => oracle.validateOracle(item), (error) => error.code === "GEOMETRY_ORACLE_SCHEMA_INVALID");
});

test("S-10 duplicate region IDs fail as identity even if schema parses objects", () => {
  const item = validOracle();
  item.pages[0].regions[1].regionId = "body.left";
  item.pages[0].regions[1].relations = [];
  item.pages[0].regions[0].relations = [];
  assert.throws(() => oracle.validateOracle(item), (error) => error.code === "GEOMETRY_ORACLE_IDENTITY_INVALID");
});

test("runtime decision fields are rejected even when schema would otherwise pass", () => {
  const item = validOracle();
  item.pages[0].regions[0].columnType = "double_column";
  assert.throws(() => oracle.validateOracle(item), (error) => error.code === "GEOMETRY_ORACLE_RUNTIME_AUTHORITY_FORBIDDEN");
});

test("identity mismatch is reported before coordinates", () => {
  const fixture = validOracle();
  const findings = oracle.compareObserved(fixture, observedFrom(fixture, (value) => {
    value.sha256 = "d".repeat(64);
    value.pages[0].regions[0].geometry.x += 100;
  }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].failureClass, "identity_failure");
  assert.equal(findings[0].code, "I-01");
});

test("wrong column identity is identity_failure even with high IoU", () => {
  const fixture = validOracle();
  const findings = oracle.compareObserved(fixture, observedFrom(fixture, (value) => {
    value.pages[0].regions[0].canonicalColumnRef.columnId = "right";
  }));
  assert.ok(findings.some((item) => item.failureClass === "identity_failure" && item.code === "I-04"));
});

test("pixel-equal boxes with broken left_of topology are structural_failure", () => {
  const fixture = validOracle();
  const findings = oracle.compareObserved(fixture, observedFrom(fixture, (value) => {
    const left = value.pages[0].regions[0].geometry;
    const right = value.pages[0].regions[1].geometry;
    left.x = right.x;
    left.width = right.width;
  }));
  assert.ok(findings.some((item) => item.failureClass === "structural_failure"));
  assert.equal(findings.some((item) => item.failureClass === "tolerance_deviation"), false);
});

test("same identity and topology within tolerance passes", () => {
  const fixture = validOracle();
  const findings = oracle.compareObserved(fixture, observedFrom(fixture, (value) => {
    value.pages[0].regions[0].geometry.x += 1;
  }));
  assert.deepEqual(findings, []);
});

test("same identity and topology outside tolerance is tolerance_deviation", () => {
  const fixture = validOracle();
  const findings = oracle.compareObserved(fixture, observedFrom(fixture, (value) => {
    value.pages[0].regions[0].geometry.x += 20;
  }));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].failureClass, "tolerance_deviation");
  assert.equal(findings[0].code, "D-02");
});

test("page size mismatch is identity/structural class before coordinate comparison", () => {
  const fixture = validOracle();
  const findings = oracle.compareObserved(fixture, observedFrom(fixture, (value) => {
    value.pages[0].pageSize.width = 500;
    value.pages[0].regions[0].geometry.x += 20;
  }));
  assert.ok(findings.every((item) => item.failureClass === "identity_failure"));
});

test("production pipeline files do not import geometry oracle or corpus paths", () => {
  const productionFiles = ["main.js", "renderer.js", "column-authority.js", "index.html"];
  productionFiles.forEach((name) => {
    const source = fs.readFileSync(path.join(APP_ROOT, name), "utf8");
    assert.doesNotMatch(source, /geometry-oracle/);
    assert.doesNotMatch(source, /layout-geometry-oracle/);
    assert.doesNotMatch(source, /cap\.layout-geometry/);
  });
});
