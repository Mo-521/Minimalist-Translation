"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Ajv = require("ajv/dist/2020");

const SCHEMA_PATH = path.join(__dirname, "geometry-oracle.schema.json");
const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
const ajv = new Ajv({ strict: true, allErrors: true });
const validateSchema = ajv.compile(schema);

const FORBIDDEN_RUNTIME_DECISION_FIELDS = new Set([
  "semanticType",
  "canonicalType",
  "detectedColumn",
  "columnType",
  "layoutType",
  "readingOrderKey",
  "layoutDecision",
  "writeDecision",
  "runtimeClassification",
  "productionRoute",
]);

function fail(code, message, details) {
  const error = new Error(message);
  error.name = "GeometryOracleError";
  error.code = code;
  error.details = details || {};
  throw error;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function walkForbiddenFields(value, trail) {
  const current = trail || "$";
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkForbiddenFields(item, `${current}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  Object.keys(value).forEach((key) => {
    if (FORBIDDEN_RUNTIME_DECISION_FIELDS.has(key)) {
      fail(
        "GEOMETRY_ORACLE_RUNTIME_AUTHORITY_FORBIDDEN",
        `Geometry oracle cannot contain runtime decision field '${key}'`,
        { field: key, trail: `${current}.${key}` }
      );
    }
    walkForbiddenFields(value[key], `${current}.${key}`);
  });
}

function requireFiniteBox(box, label) {
  ["x", "y", "width", "height"].forEach((key) => {
    if (!Number.isFinite(box[key])) {
      fail("GEOMETRY_ORACLE_IDENTITY_INVALID", `${label}.${key} must be finite`, { label, key });
    }
  });
}

function collectUnique(values, label) {
  const seen = new Set();
  values.forEach((value) => {
    if (seen.has(value)) {
      fail("GEOMETRY_ORACLE_IDENTITY_INVALID", `duplicate ${label}: ${value}`, { label, value });
    }
    seen.add(value);
  });
}

function validateSemantics(oracle) {
  if (oracle.runtimeDecisionUse !== "forbidden") {
    fail("GEOMETRY_ORACLE_RUNTIME_AUTHORITY_FORBIDDEN", "runtimeDecisionUse must remain forbidden");
  }
  if (oracle.authorityBoundary.geometryOwner !== "AA-GEOMETRY-001") {
    fail("GEOMETRY_ORACLE_AUTHORITY_MISMATCH", "geometryOwner must be AA-GEOMETRY-001");
  }
  if (oracle.authorityBoundary.columnDependency !== "AA-COLUMN-001") {
    fail("GEOMETRY_ORACLE_AUTHORITY_MISMATCH", "columnDependency must be AA-COLUMN-001");
  }
  if (oracle.pages.length !== oracle.sample.pageCount) {
    fail("GEOMETRY_ORACLE_IDENTITY_INVALID", "pages length must match sample.pageCount", {
      pages: oracle.pages.length,
      pageCount: oracle.sample.pageCount,
    });
  }

  collectUnique(oracle.toleranceProfiles.map((item) => item.id), "toleranceProfile.id");
  collectUnique(oracle.pages.map((page) => page.identity.pageId), "pageId");
  collectUnique(oracle.pages.map((page) => page.identity.pageNumber), "pageNumber");

  const regionIds = [];
  oracle.pages.forEach((page) => {
    if (page.identity.sourceDocumentId !== oracle.sample.sourceDocumentId) {
      fail("GEOMETRY_ORACLE_IDENTITY_INVALID", "page sourceDocumentId must match sample", {
        pageId: page.identity.pageId,
      });
    }
    const expectedRef = `page-column-model/v1:page-${page.identity.pageNumber}`;
    if (page.identity.pageColumnModelRef !== expectedRef) {
      fail("GEOMETRY_ORACLE_IDENTITY_INVALID", "pageColumnModelRef must match pageNumber", {
        expected: expectedRef,
        actual: page.identity.pageColumnModelRef,
      });
    }
    requireFiniteBox(page.cropBox, `${page.identity.pageId}.cropBox`);
    requireFiniteBox(page.mediaBox, `${page.identity.pageId}.mediaBox`);
    const pageRegionIds = page.regions.map((region) => region.regionId);
    collectUnique(pageRegionIds, `${page.identity.pageId}.regionId`);
    page.regions.forEach((region) => {
      regionIds.push(region.regionId);
      requireFiniteBox(region.expectedGeometry, region.regionId);
      const profile = oracle.toleranceProfiles.find((item) => item.id === region.toleranceProfileId);
      if (!profile) {
        fail("GEOMETRY_ORACLE_IDENTITY_INVALID", "unknown toleranceProfileId", {
          regionId: region.regionId,
          toleranceProfileId: region.toleranceProfileId,
        });
      }
      if (!profile.cannotOverride.includes("identity_failure") || !profile.cannotOverride.includes("structural_failure")) {
        fail("GEOMETRY_ORACLE_STRUCTURAL_INVALID", "tolerance cannot override identity or structure", {
          toleranceProfileId: profile.id,
        });
      }
      if ((region.regionClass === "body_column" || region.regionClass === "writable_space_expectation") && region.canonicalColumnRef) {
        if (region.canonicalColumnRef.pageColumnModelRef !== page.identity.pageColumnModelRef) {
          fail("GEOMETRY_ORACLE_IDENTITY_INVALID", "region column ref must stay on the same page", {
            regionId: region.regionId,
          });
        }
      }
      region.relations.forEach((relation) => {
        if (!pageRegionIds.includes(relation.targetRegionId)) {
          fail("GEOMETRY_ORACLE_IDENTITY_INVALID", "relation targetRegionId must exist on the same page", {
            regionId: region.regionId,
            targetRegionId: relation.targetRegionId,
          });
        }
      });
    });
  });
  collectUnique(regionIds, "regionId");
}

function validateOracle(oracle) {
  walkForbiddenFields(oracle);
  if (!validateSchema(oracle)) {
    fail("GEOMETRY_ORACLE_SCHEMA_INVALID", "Geometry oracle schema validation failed", {
      errors: validateSchema.errors,
    });
  }
  validateSemantics(oracle);
  return oracle;
}

function boxesOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function intersectionArea(a, b) {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y;
}

function iou(a, b) {
  const inter = intersectionArea(a, b);
  const union = a.width * a.height + b.width * b.height - inter;
  return union <= 0 ? 0 : inter / union;
}

function edgeLimit(profile, pageSize, edge) {
  const dimension = edge === "x" || edge === "width" ? pageSize.width : pageSize.height;
  return Math.max(profile.absolutePoints, profile.relativeToPage * dimension);
}

function relationHolds(kind, source, target) {
  if (kind === "disjoint") return !boxesOverlap(source, target);
  if (kind === "overlaps") return boxesOverlap(source, target);
  if (kind === "contains") {
    return source.x <= target.x && source.y <= target.y
      && source.x + source.width >= target.x + target.width
      && source.y + source.height >= target.y + target.height;
  }
  if (kind === "inside") return relationHolds("contains", target, source);
  if (kind === "left_of") return source.x + source.width <= target.x;
  if (kind === "right_of") return source.x >= target.x + target.width;
  if (kind === "above") return source.y + source.height <= target.y;
  if (kind === "below") return source.y >= target.y + target.height;
  if (kind === "touches") return boxesOverlap(source, target) && intersectionArea(source, target) === 0;
  return true;
}

function compareObserved(oracle, observed) {
  validateOracle(oracle);
  const findings = [];

  function add(failureClass, code, message, extra) {
    findings.push(Object.assign({ failureClass, code, message }, extra || {}));
  }

  if (!observed || observed.sourceDocumentId !== oracle.sample.sourceDocumentId || observed.sha256 !== oracle.sample.sha256) {
    add("identity_failure", "I-01", "source hash/document ID mismatch");
    return findings;
  }

  const expectedPages = new Map(oracle.pages.map((page) => [page.identity.pageId, page]));
  const observedPages = new Map((observed.pages || []).map((page) => [page.pageId, page]));
  expectedPages.forEach((expectedPage, pageId) => {
    const observedPage = observedPages.get(pageId);
    if (!observedPage) {
      add("identity_failure", "I-02", "missing page ID", { pageId });
      return;
    }
    if (observedPage.pageColumnModelRef !== expectedPage.identity.pageColumnModelRef
      || observedPage.pageColumnModelHash !== expectedPage.identity.pageColumnModelHash) {
      add("identity_failure", "I-03", "PageColumnModel ref/hash mismatch", { pageId });
      return;
    }
    if (observedPage.pageSize
      && (observedPage.pageSize.width !== expectedPage.pageSize.width
        || observedPage.pageSize.height !== expectedPage.pageSize.height
        || observedPage.rotation !== expectedPage.rotation)) {
      add("identity_failure", "D-05", "page size/crop/rotation baseline mismatch", { pageId });
      return;
    }

    const expectedRegions = new Map(expectedPage.regions.map((region) => [region.regionId, region]));
    const observedRegions = new Map((observedPage.regions || []).map((region) => [region.regionId, region]));
    expectedRegions.forEach((expectedRegion, regionId) => {
      const observedRegion = observedRegions.get(regionId);
      if (!observedRegion) {
        add("identity_failure", "I-02", "missing region ID", { pageId, regionId });
        return;
      }
      if (expectedRegion.canonicalColumnRef) {
        if (!observedRegion.canonicalColumnRef
          || observedRegion.canonicalColumnRef.columnId !== expectedRegion.canonicalColumnRef.columnId
          || observedRegion.canonicalColumnRef.pageColumnModelRef !== expectedRegion.canonicalColumnRef.pageColumnModelRef) {
          add("identity_failure", "I-04", "region column ref points to absent/wrong page/column", { pageId, regionId });
          return;
        }
      }
      if (observedRegion.owner && observedRegion.owner !== expectedRegion.owner) {
        add("identity_failure", "I-05", "region owner/source identity changed", { pageId, regionId });
        return;
      }

      let structural = false;
      expectedRegion.relations.forEach((relation) => {
        const expectedTarget = expectedRegions.get(relation.targetRegionId);
        const observedTarget = observedRegions.get(relation.targetRegionId);
        if (!expectedTarget || !observedTarget || !observedTarget.geometry) {
          add("identity_failure", "I-04", "relation target missing in observation", { pageId, regionId, targetRegionId: relation.targetRegionId });
          structural = true;
          return;
        }
        if (!relationHolds(relation.kind, observedRegion.geometry, observedTarget.geometry)) {
          add("structural_failure", "T-04", "expected relationship is violated", {
            pageId,
            regionId,
            kind: relation.kind,
            targetRegionId: relation.targetRegionId,
          });
          structural = true;
        }
      });
      if (structural) return;

      const profile = oracle.toleranceProfiles.find((item) => item.id === expectedRegion.toleranceProfileId);
      const pageSize = expectedPage.pageSize;
      const edges = profile.appliesTo.filter((edge) => edge !== "edge_distance");
      const outside = edges.filter((edge) => {
        const delta = Math.abs(observedRegion.geometry[edge] - expectedRegion.expectedGeometry[edge]);
        return delta > edgeLimit(profile, pageSize, edge);
      });
      if (outside.length) {
        add("tolerance_deviation", "D-02", "coordinate edge outside tolerance", {
          pageId,
          regionId,
          edges: outside,
        });
      }
    });
  });

  return findings;
}

function hashCanonical(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

module.exports = {
  SCHEMA_PATH,
  schema,
  validateOracle,
  compareObserved,
  boxesOverlap,
  iou,
  edgeLimit,
  hashCanonical,
};
