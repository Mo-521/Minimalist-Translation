"use strict";

const PAGE_COLUMN_MODEL_SCHEMA_VERSION = "page-column-model/v1";
const COLUMN_AUTHORITY_ID = "AA-COLUMN-001";

const PAGE_LAYOUT_TYPES = Object.freeze([
  "single_column",
  "double_column",
  "mixed",
  "scanned_or_image",
]);

const INDEPENDENT_REGION_TYPES = Object.freeze([
  "title",
  "abstract",
  "figure",
  "figure_caption",
  "table",
  "references_section_header",
  "other_independent",
]);

const PAGE_LAYOUT_TYPE_SET = new Set(PAGE_LAYOUT_TYPES);
const INDEPENDENT_REGION_TYPE_SET = new Set(INDEPENDENT_REGION_TYPES);

function clonePlain(value) {
  if (Array.isArray(value)) return value.map(clonePlain);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, entry] of Object.entries(value)) output[key] = clonePlain(entry);
  return output;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeBBox(bbox) {
  if (!bbox || typeof bbox !== "object") return null;
  const x = finiteNumber(bbox.x);
  const y = finiteNumber(bbox.y);
  const width = Math.max(0, finiteNumber(bbox.width));
  const height = Math.max(0, finiteNumber(bbox.height));
  return { x, y, width, height };
}

function normalizeIndependentRegion(region, index) {
  const type = String(region && region.type || "").trim();
  if (!INDEPENDENT_REGION_TYPE_SET.has(type)) {
    throw new Error(`Unknown independent region type at index ${index}: ${type || "<empty>"}`);
  }
  return {
    id: String(region && region.id || `independent-${index + 1}`),
    type,
    bbox: normalizeBBox(region && region.bbox),
    source: String(region && region.source || "semantic-structure"),
  };
}

function publishPageColumnModel(input) {
  const pageNumber = Math.max(1, Math.trunc(finiteNumber(input && input.pageNumber, 1)));
  const layoutType = String(input && input.layoutType || "").trim();
  if (!PAGE_LAYOUT_TYPE_SET.has(layoutType)) {
    throw new Error(`Unknown page layout type on page ${pageNumber}: ${layoutType || "<empty>"}`);
  }

  const columns = Array.isArray(input && input.columns)
    ? input.columns.map((column) => String(column || "").trim()).filter(Boolean)
    : [];
  const expectedColumns = layoutType === "double_column" || layoutType === "mixed"
    ? ["left", "right"]
    : ["single"];
  if (columns.length !== expectedColumns.length || expectedColumns.some((column) => !columns.includes(column))) {
    throw new Error(`Column set does not match ${layoutType} on page ${pageNumber}`);
  }

  const independentRegions = Array.isArray(input && input.independentRegions)
    ? input.independentRegions.map(normalizeIndependentRegion)
    : [];

  const model = {
    schemaVersion: PAGE_COLUMN_MODEL_SCHEMA_VERSION,
    authority: COLUMN_AUTHORITY_ID,
    pageNumber,
    pageSize: {
      width: Math.max(0, finiteNumber(input && input.pageWidth)),
      height: Math.max(0, finiteNumber(input && input.pageHeight)),
    },
    layoutType,
    columns,
    columnGeometry: clonePlain(input && input.columnGeometry || null),
    independentRegions,
    evidence: clonePlain(input && input.evidence || {}),
  };

  return deepFreeze(model);
}

function assertPageColumnModel(model, pageNumber = null) {
  if (!model || model.authority !== COLUMN_AUTHORITY_ID || model.schemaVersion !== PAGE_COLUMN_MODEL_SCHEMA_VERSION) {
    throw new Error(`Missing canonical PageColumnModel${pageNumber ? ` for page ${pageNumber}` : ""}`);
  }
  if (!Object.isFrozen(model)) {
    throw new Error(`PageColumnModel must be frozen${pageNumber ? ` for page ${pageNumber}` : ""}`);
  }
  return model;
}

module.exports = {
  COLUMN_AUTHORITY_ID,
  PAGE_COLUMN_MODEL_SCHEMA_VERSION,
  PAGE_LAYOUT_TYPES,
  INDEPENDENT_REGION_TYPES,
  publishPageColumnModel,
  assertPageColumnModel,
};
