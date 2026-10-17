"use strict";

// Stage 62–65 formula/paragraph ownership and visual-frame refinements.
const { build: glyphFrames } = require("./glyph-supported-frames.cjs");
const { build: embeddedMath } = require("./embedded-math-labels.cjs");
const { build: inlineRadicals } = require("./inline-radical-fragments.cjs");
const { build: spanFrames } = require("./span-aware-frames.cjs");
const clone = value => JSON.parse(JSON.stringify(value));

function build({ candidate, source, bodyFormulaGlyphAudit, spanGlyphAudit }) {
  if (!candidate || !source || !bodyFormulaGlyphAudit || !spanGlyphAudit)
    throw Error("Math-frame pipeline requires candidate, source and both glyph audits");
  const stage62 = glyphFrames({ before: clone(candidate), audit: bodyFormulaGlyphAudit });
  const stage63 = embeddedMath({ before: clone(stage62), source: clone(source) });
  const stage64 = inlineRadicals({ before: clone(stage63), source: clone(source),
    glyphAudit: bodyFormulaGlyphAudit });
  return spanFrames({ before: clone(stage64), glyph: spanGlyphAudit });
}

module.exports = { build };
