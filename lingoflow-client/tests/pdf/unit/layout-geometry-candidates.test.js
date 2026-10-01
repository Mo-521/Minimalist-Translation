"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const APP_ROOT = path.join(__dirname, "..", "..", "..", "electron-app");
const LIBRARY_ROOT = path.join(APP_ROOT, "capability-library");
const TASK_EVIDENCE = path.join(__dirname, "..", "..", "..", "..", ".governance", "archive", "evidence", "layout-geometry-capability-audit", "evidence", "phase-2-paper-geometry");
const oracle = require(path.join(LIBRARY_ROOT, "geometry-oracle"));
const workflow = require(path.join(LIBRARY_ROOT, "candidate-pool"));

const PAPERS = ["paper1", "paper2", "paper3", "paper4", "paper5", "paper6", "paper7"];

test("paper1-7 candidate oracles validate as layout-geometry-oracle/v1 evidence", () => {
  PAPERS.forEach((paper) => {
    const item = JSON.parse(fs.readFileSync(path.join(TASK_EVIDENCE, "oracles", `${paper}-geometry-oracle.json`), "utf8"));
    oracle.validateOracle(item);
    assert.equal(item.runtimeDecisionUse, "forbidden");
    assert.equal(item.capabilityId, "cap.layout-geometry");
    assert.deepEqual(item.failureClasses, ["identity_failure", "structural_failure", "tolerance_deviation"]);
    assert.equal(item.reviewHistory.some((event) => event.action === "accepted"), false);
    item.toleranceProfiles.forEach((profile) => {
      assert.ok(profile.cannotOverride.includes("identity_failure"));
      assert.ok(profile.cannotOverride.includes("structural_failure"));
    });
  });
});

test("latest immutable candidate snapshot is accepted but not promoted", () => {
  const state = workflow.loadCommittedState(path.join(TASK_EVIDENCE, "..", "geometry-accepted-stage-v1", "revision-030"));
  const geometry = state.pool.candidates.filter((candidate) => candidate.capabilityIds.includes("cap.layout-geometry"));
  assert.equal(geometry.length, 10);
  assert.equal(state.corpus.samples.filter((sample) => sample.expectedOutcomes.some((outcome) => outcome.capabilityId === "cap.layout-geometry")).length, 0);
  geometry.forEach((candidate) => {
    assert.equal(candidate.status, "accepted");
    assert.equal(candidate.promotedSampleId, null);
    assert.deepEqual(candidate.capabilityIds, ["cap.layout-geometry"]);
  });
});

test("precheck recorded format-valid intake without promotion", () => {
  const precheck = JSON.parse(fs.readFileSync(path.join(TASK_EVIDENCE, "precheck.json"), "utf8"));
  assert.equal(precheck.formatValid, true);
  assert.equal(precheck.promotion, "not_performed");
  assert.equal(precheck.runtimeDecisionUse, "forbidden");
  assert.equal(precheck.reports.length, 7);
});

test("latest review HTML is self-contained with inlined rasters and no pages/ URLs", () => {
  const reviewRoot = path.join(TASK_EVIDENCE, "human-review-final-paper1-10-v8");
  Array.from({ length: 10 }, (_, index) => `paper${index + 1}`).forEach((paper) => {
    const html = fs.readFileSync(path.join(reviewRoot, `${paper}-complete.html`), "utf8");
    assert.match(html, /src="data:image\/jpeg;base64,/);
    assert.doesNotMatch(html, /src="pages\//);
    assert.match(html, /paper/);
  });
});

test("latest body-only review exposes no non-Body overlays", () => {
  const reviewRoot = path.join(TASK_EVIDENCE, "human-review-final-paper1-10-v8");
  const manifest = JSON.parse(fs.readFileSync(path.join(reviewRoot, "MANIFEST.json"), "utf8"));
  assert.equal(manifest.results.reduce((sum, item) => sum + item.pages, 0), 126);
  Array.from({ length: 10 }, (_, index) => `paper${index + 1}`).forEach((paper) => {
    const html = fs.readFileSync(path.join(reviewRoot, `${paper}-body.html`), "utf8");
    assert.match(html, /class="body-predicted"/);
    assert.doesNotMatch(html, /data-class="independent_region"/);
    assert.doesNotMatch(html, /data-class="protected_region"/);
    assert.doesNotMatch(html, /data-class="writable_space_expectation"/);
  });
});

test("regenerated body bands require credible anchors and never use page-interior fallback", () => {
  PAPERS.forEach((paper) => {
    const item = JSON.parse(fs.readFileSync(path.join(TASK_EVIDENCE, "oracles", `${paper}-geometry-oracle.json`), "utf8"));
    item.pages.forEach((page) => {
      const bodies = page.regions.filter((region) => region.regionClass === "body_column");
      const lefts = bodies.filter((region) => region.canonicalColumnRef.columnId === "left");
      const rights = bodies.filter((region) => region.canonicalColumnRef.columnId === "right");
      const singles = bodies.filter((region) => region.canonicalColumnRef.columnId === "single");
      bodies.forEach((body) => {
        assert.match(body.regionId, /\.(?:left|right|single)\.\d+$/);
        assert.ok(body.sourceProvenance.some((source) => source.transformChain.includes("lane-local-text-flow-chain")));
        assert.ok(body.sourceProvenance.some((source) => source.transformChain.includes("semantic-unresolved-bridge")));
        assert.ok(body.sourceProvenance.some((source) => source.transformChain.includes("formula-has-no-truncation-authority")));
        assert.ok(body.sourceProvenance.some((source) => source.transformChain.includes("fixed-body-boundary-margin:2.5pt")));
        assert.equal(body.sourceProvenance.some((source) => source.transformChain.some((step) => /page-interior|fallback/i.test(step))), false);
      });
      [lefts, rights, singles].forEach((bands) => bands.sort((a, b) => a.expectedGeometry.y - b.expectedGeometry.y).forEach((band, index) => {
        if (index === 0) return;
        const previous = bands[index - 1].expectedGeometry;
        assert.ok(previous.y + previous.height <= band.expectedGeometry.y + 0.01, `${paper} p${page.identity.pageNumber} body bands overlap`);
      }));
      lefts.forEach((left) => {
        rights.forEach((right) => {
          assert.ok(
            left.expectedGeometry.x + left.expectedGeometry.width <= right.expectedGeometry.x + 0.01,
            `${paper} p${page.identity.pageNumber} body overlap`
          );
        });
      });
      page.regions.filter((region) => region.regionClass === "independent_region").forEach((region) => {
        const ratio = (region.expectedGeometry.width * region.expectedGeometry.height)
          / (page.pageSize.width * page.pageSize.height);
        const limit = region.semanticRegionType === "figure" || region.semanticRegionType === "table" ? 0.5 : 0.42;
        assert.ok(ratio <= limit, `${paper} ${region.regionId} huge independent ${ratio}`);
      });
    });
  });
});

test("safety margin is separate from tight content geometry and only cuts writable space", () => {
  PAPERS.forEach((paper) => {
    const item = JSON.parse(fs.readFileSync(path.join(TASK_EVIDENCE, "oracles", `${paper}-geometry-oracle.json`), "utf8"));
    item.pages.forEach((page) => {
      const margins = page.regions.filter((region) => region.regionClass === "protected_region" && region.protectedKind === "margin");
      const content = page.regions.filter((region) => region.regionClass === "independent_region"
        || (region.regionClass === "protected_region" && region.protectedKind !== "margin"));
      const writable = page.regions.filter((region) => region.regionClass === "writable_space_expectation");
      content.forEach((region) => {
        assert.equal(
          region.sourceProvenance.some((source) => source.transformChain.some((step) => /char-pad|equal-char-pad/.test(step))),
          false,
          `${paper} ${region.regionId} must remain a tight content box`
        );
      });
      margins.forEach((margin) => {
        assert.ok(margin.sourceProvenance.some((source) => source.producer === "offline-safety-margin-envelope"));
      });
      content.forEach((region) => {
        const owned = margins.filter((margin) => margin.sourceProvenance.some((source) => source.sourceArtifactId === region.regionId));
        const sides = new Set(owned.flatMap((margin) => margin.sourceProvenance.flatMap((source) => source.transformChain
          .filter((step) => step.startsWith("margin-side:"))
          .map((step) => step.slice("margin-side:".length)))));
        const geometry = region.expectedGeometry;
        const boundary = {
          top: geometry.y <= 0.5,
          bottom: geometry.y + geometry.height >= page.pageSize.height - 0.5,
          left: geometry.x <= 0.5,
          right: geometry.x + geometry.width >= page.pageSize.width - 0.5,
        };
        ["top", "bottom", "left", "right"].forEach((side) => {
          if (!sides.has(side) && !boundary[side]) {
            const checks = JSON.parse(fs.readFileSync(path.join(TASK_EVIDENCE, "geometry-generation-checks.json"), "utf8"));
            assert.ok(checks.missingSafetyMargins.some((item) => item.page === `${paper}.p${page.identity.pageNumber}` && item.regionId === region.regionId && item.side === side), `${paper} ${region.regionId} unreported missing ${side} safety clearance`);
          }
        });
      });
      margins.forEach((margin) => content.forEach((region) => {
        if (margin.sourceProvenance.some((source) => source.sourceArtifactId === region.regionId)) return;
        const a = margin.expectedGeometry;
        const b = region.expectedGeometry;
        const overlapWidth = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
        const overlapHeight = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
        assert.ok(overlapWidth * overlapHeight <= 0.5, `${paper} ${margin.regionId} overlaps ${region.regionId}`);
      }));
      writable.forEach((space) => margins.forEach((margin) => {
        const a = space.expectedGeometry;
        const b = margin.expectedGeometry;
        const overlapWidth = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
        const overlapHeight = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
        assert.ok(overlapWidth * overlapHeight <= 0.5, `${paper} ${space.regionId} invades ${margin.regionId}`);
      }));
    });
  });
});

test("generation checks enforce structure without accepting candidates", () => {
  const checks = JSON.parse(fs.readFileSync(path.join(TASK_EVIDENCE, "geometry-generation-checks.json"), "utf8"));
  assert.equal(checks.schemaVersion, "layout-geometry-generation-check/v8");
  assert.equal(checks.promotion, "not_performed");
  assert.equal(checks.runtimeDecisionUse, "forbidden");
  assert.equal(checks.totals.bodyColumnCountMismatches, 0);
  assert.equal(checks.totals.fragmentedBodyColumnIds, 0);
  assert.equal(checks.totals.contentBoxesWithSafetyInflation, 0);
  assert.equal(checks.totals.writableSafetyViolations, 0);
  assert.equal(checks.totals.unprotectedPeripheralLines, 0);
  assert.equal(checks.totals.mixedSemanticBoxes, 0);
  assert.equal(checks.totals.ownershipConflicts, 0);
  assert.equal(checks.totals.missingSafetyMargins, checks.missingSafetyMargins.length);
  assert.equal(checks.totals.invalidSafetyMargins, 0);
  assert.equal(checks.totals.ghostObjectBoxes, 0);
  assert.equal(checks.totals.writableContentViolations, 0);
  assert.equal(checks.totals.referenceBoundaryFailures, 0);
  assert.equal(checks.totals.bodyVerticalOverextensions, 0);
  assert.equal(checks.totals.bodyPrematureTruncations, 0);
  assert.equal(checks.totals.bodyCrossesCrossColumnObjects, checks.bodyCrossesCrossColumnObjects.length);
  assert.equal(checks.totals.headingFalsePositiveSuspects, 0);
  assert.equal(checks.totals.safetyMarginContentConflicts, 0);
  assert.equal(checks.coverageFirst.status, "pass");
  assert.equal(checks.coverageFirst.failureCount, 0);
  assert.ok(checks.coverageFirst.highConfidenceLineCount > 0);
  assert.equal(checks.coverageFirst.coveredLineCount, checks.coverageFirst.highConfidenceLineCount);
  assert.equal(checks.coverageFirst.bodyBoundaryMarginPoints, 2.5);
  assert.equal(checks.totals.bodyCoverageFailures, 0);
  ["bodyVerticalOverextensions", "bodyPrematureTruncations", "bodyCrossesCrossColumnObjects", "headingFalsePositiveSuspects", "safetyMarginContentConflicts"].forEach((name) => {
    assert.ok(Array.isArray(checks[name]), `${name} must remain auditable`);
  });
});

test("body-only coverage report audits complete line geometry including formula-like lines", () => {
  const report = JSON.parse(fs.readFileSync(path.join(TASK_EVIDENCE, "body-coverage-report.json"), "utf8"));
  assert.equal(report.schemaVersion, "layout-geometry-body-coverage-report/v1");
  assert.equal(report.scope, "body_column_only");
  assert.equal(report.status, "pass");
  assert.equal(report.highConfidenceLineCount, report.coveredLineCount);
  assert.equal(report.uncoveredLineCount, 0);
  assert.equal(report.constraints.formulaTruncationAuthority, "forbidden");
  assert.equal(report.constraints.pageInteriorFallback, "forbidden");
  assert.equal(report.constraints.columnTruthModified, false);
  assert.equal(report.constraints.accepted, false);
  assert.equal(report.constraints.promoted, false);
  assert.ok(report.pageLaneEvidence.some((item) => item.highConfidenceLineCount > 0));
});

test("production pipeline does not import the geometry candidate builder", () => {
  ["main.js", "renderer.js", "column-authority.js", "index.html"].forEach((name) => {
    const source = fs.readFileSync(path.join(APP_ROOT, name), "utf8");
    assert.doesNotMatch(source, /layout-geometry-candidate-intake/);
    assert.doesNotMatch(source, /layout-geometry-human-review/);
  });
});
