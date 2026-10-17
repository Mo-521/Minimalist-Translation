"use strict";

// Stage 66 body reconstruction/alignment and Stage 67 semantic boundaries.
const { build: bodyBoundaries } = require("./body-boundaries.cjs");
const { build: bodyFrameAlignment } = require("./body-frame-alignment.cjs");
const { build: semanticBoundaries } = require("./semantic-boundaries.cjs");
const clone = value => JSON.parse(JSON.stringify(value));

function build({ candidate, source, bodyGlyphSupport, pdfGlyphEvidence }) {
  if (!candidate || !source || !bodyGlyphSupport || !pdfGlyphEvidence)
    throw Error("Semantic boundary pipeline requires candidate, source and two PDF-evidence inputs");
  const body = bodyBoundaries({ before: clone(candidate), source: clone(source) });
  const aligned = bodyFrameAlignment({ candidate: clone(body), support: bodyGlyphSupport });
  return semanticBoundaries({ before: clone(aligned), source: clone(source), glyph: pdfGlyphEvidence });
}

module.exports = { build };
