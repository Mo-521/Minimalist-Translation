"use strict";

// Stage 35–37: source-only page boundaries and formula proposals, semantic
// regions, then conservative ownership composition. No accepted labels used.
const crypto = require("node:crypto");
const { build: formulas } = require("./source-formula-stage35.cjs");
const { build: boundaries } = require("./source-page-boundaries.cjs");
const { build: regions } = require("./semantic-regions.cjs");
const { build: compose } = require("./compose-source-candidates.cjs");

function build({ source, sourceBytes, inputHash } = {}) {
  if (!source?.pages) throw Error("Source-semantics pipeline requires source pages");
  if (!inputHash && !sourceBytes)
    throw Error("Source-semantics pipeline requires exact input hash or source bytes");
  const hash = inputHash || crypto.createHash("sha256").update(sourceBytes).digest("hex");
  const formula = formulas(source, hash);
  const pageBoundaries = boundaries(source, hash);
  const semanticRegions = regions({ frozen: source, boundaries: pageBoundaries });
  const candidate = compose({ frozen: source, boundaries: pageBoundaries,
    formula, regions: semanticRegions });
  return { formula, boundaries: pageBoundaries, regions: semanticRegions, candidate };
}

module.exports = { build };
