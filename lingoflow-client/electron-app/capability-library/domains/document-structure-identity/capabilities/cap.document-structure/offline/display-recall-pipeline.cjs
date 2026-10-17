"use strict";

// Stage 58–61: independent proposals, then evidence-gated membership edits.
const { build: edgeProposals } = require("./formula-edge-proposals.cjs");
const { build: edgeMembers } = require("./formula-edge-members.cjs");
const { build: numberedProposals } = require("./numbered-display-proposals.cjs");
const { build: numberedRecall } = require("./numbered-display-recall.cjs");
const { build: numericProposals } = require("./numeric-member-proposals.cjs");
const { build: numericMembers } = require("./numeric-member-reconstruction.cjs");
const { build: mixedProposals } = require("./mixed-display-proposals.cjs");
const { build: mixedRecall } = require("./mixed-display-recall.cjs");
const clone = value => JSON.parse(JSON.stringify(value));

function build({ candidate, source, edgeGlyphs, numberedGlyphs, numericGlyphs, mixedGlyphs }) {
  if (!candidate || !source || !edgeGlyphs || !numberedGlyphs || !numericGlyphs || !mixedGlyphs)
    throw Error("Display recall pipeline requires candidate, source and four glyph-evidence inputs");
  const p58 = edgeProposals({ candidate: clone(candidate), source: clone(source) });
  const s58 = edgeMembers({ before: clone(candidate), source: clone(source),
    proposals: p58, glyph: edgeGlyphs });
  const p59 = numberedProposals({ candidate: clone(s58), source: clone(source) });
  const s59 = numberedRecall({ before: clone(s58), source: clone(source),
    proposalResult: p59, glyph: numberedGlyphs });
  const p60 = numericProposals({ candidate: clone(s59), source: clone(source) });
  const s60 = numericMembers({ before: clone(s59), source: clone(source),
    proposalResult: p60, glyph: numericGlyphs });
  const p61 = mixedProposals({ candidate: clone(s60), source: clone(source) });
  return mixedRecall({ before: clone(s60), source: clone(source),
    proposalResult: p61, glyph: mixedGlyphs });
}

module.exports = { build };
