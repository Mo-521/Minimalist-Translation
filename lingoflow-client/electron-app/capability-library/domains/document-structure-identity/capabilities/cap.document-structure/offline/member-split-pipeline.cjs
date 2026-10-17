"use strict";

// Stage 49–53: member refinement, character-span label splits, glyph support,
// semantic barriers, display recall, right-label splits and glyph alignment.
const { build: refineMembers } = require("./member-refinement.cjs");
const { build: splitLabels } = require("./label-span-splitting.cjs");
const { build: glyphSupport } = require("./formula-glyph-support.cjs");
const { build: semanticBarrier } = require("./semantic-barrier.cjs");
const { build: recallDisplay } = require("./display-recall.cjs");
const { build: splitRightLabels } = require("./right-label-splitting.cjs");
const { build: alignRecalledGlyphs } = require("./recalled-glyph-alignment.cjs");
const clone = value => JSON.parse(JSON.stringify(value));

function buildThroughStage52({ candidate, source, labelSpans, glyphEvidence,
  panelEvidence, rightLabelSpans }) {
  if (!candidate || !source || !labelSpans || !glyphEvidence || !panelEvidence || !rightLabelSpans)
    throw Error("Member-split pipeline requires candidate, source and four PDF-evidence inputs");
  const refined = refineMembers({ base: clone(candidate), source: clone(source) });
  const split = splitLabels({ candidate: clone(refined), source: clone(source), spans: labelSpans });
  const supported = glyphSupport({ candidate: clone(split.candidate), source: clone(split.source),
    evidence: glyphEvidence });
  const barrier = semanticBarrier({ before: clone(supported), source: clone(split.source),
    panels: panelEvidence, glyph: glyphEvidence });
  const recalled = recallDisplay({ previous: clone(barrier), source: clone(split.source),
    glyph: glyphEvidence });
  const right = splitRightLabels({ candidate: clone(recalled), source: clone(split.source),
    evidence: rightLabelSpans });
  return { candidate: right.candidate, source: right.source, recallAudit: recalled.stage51 };
}

function build(inputs) {
  if (!inputs?.recalledGlyphExtents) throw Error("Member-split pipeline requires recalled glyph extents");
  const stage52 = buildThroughStage52(inputs);
  return alignStage52(stage52, inputs.recalledGlyphExtents);
}

function alignStage52(stage52, recalledGlyphExtents) {
  if (!stage52?.candidate || !stage52?.source || !recalledGlyphExtents)
    throw Error("Member-split pipeline requires Stage 52 candidate, source and recalled glyph extents");
  const aligned = alignRecalledGlyphs({ candidate: clone(stage52.candidate), source: clone(stage52.source),
    supports: recalledGlyphExtents });
  return { candidate: aligned, source: stage52.source };
}

module.exports = { build, buildThroughStage52, alignStage52 };
