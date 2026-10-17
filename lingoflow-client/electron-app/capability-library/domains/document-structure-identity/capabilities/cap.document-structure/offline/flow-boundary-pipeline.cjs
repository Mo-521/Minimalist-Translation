"use strict";

// Stage 55–57 semantic continuity, display boundaries, glyph alignment and
// flow-row rejoin. Each historical JSON boundary is preserved by cloning.
const { build: semanticContinuity } = require("./semantic-continuity.cjs");
const { build: displayBoundaries } = require("./display-boundaries.cjs");
const { build: glyphAlignment } = require("./display-glyph-alignment.cjs");
const { build: flowRowRejoin } = require("./flow-row-rejoin.cjs");
const clone = value => JSON.parse(JSON.stringify(value));

function build({ candidate, source, glyphExtents }) {
  if (!candidate || !source || !glyphExtents)
    throw Error("Flow-boundary pipeline requires candidate, source and glyph extents");
  const stage55 = semanticContinuity({ prior: clone(candidate), source: clone(source) });
  const boundary56 = displayBoundaries({ before: clone(stage55), inventory: clone(source) });
  const aligned56 = glyphAlignment({ candidate: clone(boundary56), supports: glyphExtents });
  return flowRowRejoin({ before: clone(aligned56), inventory: clone(source) });
}

module.exports = { build };
