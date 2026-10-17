"use strict";

// Runnable current-PDF producer through Stage 53. Native evidence is derived
// at each checkpoint before the next pure transform; no reviewed hints enter.
const { build: sourceToPostReference } = require("./source-to-post-reference.cjs");
const { build: semanticDisplay } = require("./semantic-display-pipeline.cjs");
const { build: opaque } = require("./opaque-figures-and-spans.cjs");
const { build: displayBlocks } = require("./display-blocks.cjs");
const { build: boundaryRepair } = require("./repaired-boundaries.cjs");
const { build: refineMembers } = require("./member-refinement.cjs");
const { build: splitLabels } = require("./label-span-splitting.cjs");
const { build: glyphSupport } = require("./formula-glyph-support.cjs");
const { build: semanticBarrier } = require("./semantic-barrier.cjs");
const { build: recallDisplay } = require("./display-recall.cjs");
const { build: splitRightLabels } = require("./right-label-splitting.cjs");
const { build: alignRecalledGlyphs } = require("./recalled-glyph-alignment.cjs");
const { createEvidenceRunner } = require("./pdf-evidence-runner.cjs");
const clone = value => JSON.parse(JSON.stringify(value));

function build({ source, sourceBytes, inputHash, python, runDirectory } = {}) {
  const derive = createEvidenceRunner({ python, runDirectory });
  const early = sourceToPostReference({ source, sourceBytes, inputHash });
  const stage43 = semanticDisplay({ candidate: early.candidate, frozen: source,
    regions: early.regions });
  const stage44LabelSpans = derive("equation-label-spans.py",
    { candidate: stage43, "source-inventory": source });
  const preliminary = opaque({ input: clone(stage43), frozen: source, regions: early.regions,
    spanEvidence: stage44LabelSpans, glyphEvidence: { matched: [] } });
  const stage44GlyphBoxes = derive("formula-glyph-boxes.py",
    { candidate: preliminary.candidate, "source-inventory": preliminary.sourceInventory });
  const stage44 = opaque({ input: clone(stage43), frozen: source, regions: early.regions,
    spanEvidence: stage44LabelSpans, glyphEvidence: stage44GlyphBoxes });
  const stage45 = displayBlocks({ input: clone(stage44.candidate),
    source: clone(stage44.sourceInventory), glyph: stage44GlyphBoxes });
  const stage48MissedLabelSpans = derive("missed-label-spans.py",
    { candidate: stage45, "source-inventory": stage44.sourceInventory });
  const stage48 = boundaryRepair({ base: clone(stage45), source: clone(stage44.sourceInventory),
    regions: early.regions, glyph: stage44GlyphBoxes, spans: stage48MissedLabelSpans });
  const refined = refineMembers({ base: clone(stage48.candidate), source: clone(stage48.source) });
  const stage49LabelSpans = derive("leading-label-spans.py",
    { candidate: refined, "source-inventory": stage48.source });
  const split = splitLabels({ candidate: clone(refined), source: clone(stage48.source),
    spans: stage49LabelSpans });
  const stage49GlyphEvidence = derive("glyph-support.py",
    { candidate: split.candidate, "source-inventory": split.source });
  const supported = glyphSupport({ candidate: clone(split.candidate), source: clone(split.source),
    evidence: stage49GlyphEvidence });
  const stage50PanelEvidence = derive("panels.py", { "source-inventory": split.source });
  const barrier = semanticBarrier({ before: clone(supported), source: clone(split.source),
    panels: stage50PanelEvidence, glyph: stage49GlyphEvidence });
  const recalled = recallDisplay({ previous: clone(barrier), source: clone(split.source),
    glyph: stage49GlyphEvidence });
  const stage52RightLabelSpans = derive("right-label-spans.py",
    { candidate: recalled, "source-inventory": split.source });
  const stage52 = splitRightLabels({ candidate: clone(recalled), source: clone(split.source),
    evidence: stage52RightLabelSpans });
  const stage53RecalledGlyphExtents = derive("recalled-glyphs.py",
    { "source-inventory": stage52.source, "recall-audit": recalled.stage51 });
  const stage53 = alignRecalledGlyphs({ candidate: clone(stage52.candidate),
    source: clone(stage52.source), supports: stage53RecalledGlyphExtents });
  return { candidate: stage53, source: stage52.source, stage37: early.stage37,
    postReference: early.recoveryProposals, stage43, stage44, stage45, stage48,
    stage52, evidence: { stage44LabelSpans, stage44GlyphBoxes, stage48MissedLabelSpans,
      stage49LabelSpans, stage49GlyphEvidence, stage50PanelEvidence,
      stage52RightLabelSpans, stage53RecalledGlyphExtents } };
}

module.exports = { build };
