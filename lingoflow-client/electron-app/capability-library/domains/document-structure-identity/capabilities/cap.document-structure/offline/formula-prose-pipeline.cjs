"use strict";

// Pure Stage 68–69 conversion; evidence must come from the current PDF.
const { build: formulaMembers } = require("./formula-members.cjs");
const { build: proseBoundaries } = require("./prose-boundaries.cjs");
const clone = value => JSON.parse(JSON.stringify(value));

function build({ candidate, source, labelGlyphEvidence, glyphEvidence, typographyEvidence }) {
  if (!candidate || !source || !labelGlyphEvidence || !glyphEvidence || !typographyEvidence)
    throw Error("Formula/prose pipeline requires candidate, source and three evidence inputs");
  const stage68 = formulaMembers({ before: clone(candidate), source: clone(source),
    evidence: labelGlyphEvidence, glyph: glyphEvidence });
  const stage69 = proseBoundaries({ before: clone(stage68.candidate), source: clone(stage68.source),
    typo: typographyEvidence, glyph: glyphEvidence });
  return { candidate: stage69, source: stage68.source };
}

module.exports = { build };
