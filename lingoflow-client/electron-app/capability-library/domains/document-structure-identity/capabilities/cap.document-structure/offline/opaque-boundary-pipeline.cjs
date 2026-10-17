"use strict";

// Stage 44–48: opaque figure/table protection, whole display blocks and
// source-line boundary recovery. Review presentation Stages 46–47 are skipped.
const { build: opaque } = require("./opaque-figures-and-spans.cjs");
const { build: displayBlocks } = require("./display-blocks.cjs");
const { build: repairedBoundaries } = require("./repaired-boundaries.cjs");
const clone = value => JSON.parse(JSON.stringify(value));

function build({ candidate, frozen, regions, labelSpans, glyphBoxes, missedLabelSpans }) {
  if (!candidate || !frozen || !regions || !labelSpans || !glyphBoxes || !missedLabelSpans)
    throw Error("Opaque-boundary pipeline requires candidate, source, regions and PDF evidence");
  const stage44 = opaque({ input: clone(candidate), frozen, regions,
    spanEvidence: labelSpans, glyphEvidence: glyphBoxes });
  const stage45 = displayBlocks({ input: clone(stage44.candidate), source: clone(stage44.sourceInventory),
    glyph: glyphBoxes });
  return repairedBoundaries({ base: clone(stage45), source: clone(stage44.sourceInventory),
    regions, glyph: glyphBoxes, spans: missedLabelSpans });
}

module.exports = { build };
