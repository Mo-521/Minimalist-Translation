"use strict";

// Evidence-driven continuation from Stage 53 to Stage 82. Each native PDF
// audit is computed from the candidate that immediately precedes its consumer.
const { build: semanticContinuity } = require("./semantic-continuity.cjs");
const { build: displayBoundaries } = require("./display-boundaries.cjs");
const { build: glyphAlignment } = require("./display-glyph-alignment.cjs");
const { build: flowRowRejoin } = require("./flow-row-rejoin.cjs");
const { build: edgeProposals } = require("./formula-edge-proposals.cjs");
const { build: edgeMembers } = require("./formula-edge-members.cjs");
const { build: numberedProposals } = require("./numbered-display-proposals.cjs");
const { build: numberedRecall } = require("./numbered-display-recall.cjs");
const { build: numericProposals } = require("./numeric-member-proposals.cjs");
const { build: numericMembers } = require("./numeric-member-reconstruction.cjs");
const { build: mixedProposals } = require("./mixed-display-proposals.cjs");
const { build: mixedRecall } = require("./mixed-display-recall.cjs");
const { build: glyphFrames } = require("./glyph-supported-frames.cjs");
const { build: embeddedMath } = require("./embedded-math-labels.cjs");
const { build: inlineRadicals } = require("./inline-radical-fragments.cjs");
const { build: spanFrames } = require("./span-aware-frames.cjs");
const { build: bodyBoundaries } = require("./body-boundaries.cjs");
const { build: bodyFrameAlignment } = require("./body-frame-alignment.cjs");
const { build: semanticBoundaries } = require("./semantic-boundaries.cjs");
const { build: formulaMembers } = require("./formula-members.cjs");
const { build: proseBoundaries } = require("./prose-boundaries.cjs");
const { build: frontFurniture } = require("./front-furniture.cjs");
const { build: ownedSpans } = require("./owned-spans.cjs");
const { build: memberBoundaries } = require("./member-boundaries.cjs");
const { build: proseContinuity } = require("./prose-continuity.cjs");
const { build: late } = require("./late-pipeline.cjs");
const { createEvidenceRunner } = require("./pdf-evidence-runner.cjs");
const clone = value => JSON.parse(JSON.stringify(value));

function build({ candidate, source, stage37, postReference, python, pdftoppm,
  runDirectory } = {}) {
  if (!candidate || !source || !stage37 || !postReference || !pdftoppm)
    throw Error("PDF Stage 55–82 requires Stage 53, source, diagnostics and PDF renderer");
  const derive = createEvidenceRunner({ python, runDirectory });
  const stage55 = semanticContinuity({ prior: clone(candidate), source: clone(source) });
  const boundary56 = displayBoundaries({ before: clone(stage55), inventory: clone(source) });
  const stage56GlyphExtents = derive("display-boundary-glyphs.py",
    { candidate: boundary56, "source-inventory": source });
  const aligned56 = glyphAlignment({ candidate: clone(boundary56), supports: stage56GlyphExtents });
  const stage57 = flowRowRejoin({ before: clone(aligned56), inventory: clone(source) });

  const p58 = edgeProposals({ candidate: clone(stage57), source: clone(source) });
  const stage58GlyphExtents = derive("edge-glyphs.py", { proposals: p58,
    "source-inventory": source });
  const stage58 = edgeMembers({ before: clone(stage57), source: clone(source),
    proposals: p58, glyph: stage58GlyphExtents });
  const p59 = numberedProposals({ candidate: clone(stage58), source: clone(source) });
  const stage59GlyphExtents = derive("numbered-glyphs.py", { proposals: p59,
    "source-inventory": source });
  const stage59 = numberedRecall({ before: clone(stage58), source: clone(source),
    proposalResult: p59, glyph: stage59GlyphExtents });
  const p60 = numericProposals({ candidate: clone(stage59), source: clone(source) });
  const stage60GlyphExtents = derive("numeric-glyphs.py", { proposals: p60,
    "source-inventory": source });
  const stage60 = numericMembers({ before: clone(stage59), source: clone(source),
    proposalResult: p60, glyph: stage60GlyphExtents });
  const p61 = mixedProposals({ candidate: clone(stage60), source: clone(source) });
  const stage61GlyphExtents = derive("mixed-display-glyphs.py", { proposals: p61,
    "source-inventory": source });
  const stage61 = mixedRecall({ before: clone(stage60), source: clone(source),
    proposalResult: p61, glyph: stage61GlyphExtents });

  const stage62GlyphAudit = derive("body-formula-glyph-audit.py",
    { candidate: stage61, "source-inventory": source });
  const stage62 = glyphFrames({ before: clone(stage61), audit: stage62GlyphAudit });
  const stage63 = embeddedMath({ before: clone(stage62), source: clone(source) });
  const stage64 = inlineRadicals({ before: clone(stage63), source: clone(source),
    glyphAudit: stage62GlyphAudit });
  const stage65GlyphAudit = derive("body-formula-glyph-audit.py",
    { candidate: stage64, "source-inventory": source }, ["--min-overlap", "0.03", "--span-aware"]);
  const stage65 = spanFrames({ before: clone(stage64), glyph: stage65GlyphAudit });
  const preliminary66 = bodyBoundaries({ before: clone(stage65), source: clone(source) });
  const stage66BodyGlyphSupport = derive("body-formula-glyph-audit.py",
    { candidate: preliminary66, "source-inventory": source,
      "changed-body-from": stage65 }, ["--span-aware"]);
  const stage66 = bodyFrameAlignment({ candidate: clone(preliminary66),
    support: stage66BodyGlyphSupport });
  const stage67GlyphEvidence = derive("semantic-glyphs.py",
    { candidate: stage66, "source-inventory": source });
  const stage67 = semanticBoundaries({ before: clone(stage66), source: clone(source),
    glyph: stage67GlyphEvidence });

  const stage68LabelEvidence = derive("label-glyphs.py",
    { candidate: stage67.candidate, "source-inventory": stage67.source });
  const stage68 = formulaMembers({ before: clone(stage67.candidate), source: clone(stage67.source),
    evidence: stage68LabelEvidence, glyph: stage67GlyphEvidence });
  const stage69Typography = derive("typography.py",
    { candidate: stage68.candidate, "source-inventory": stage68.source });
  const stage69 = proseBoundaries({ before: clone(stage68.candidate), source: clone(stage68.source),
    typo: stage69Typography, glyph: stage67GlyphEvidence });
  const stage70BoundaryEvidence = derive("front-furniture.py",
    { candidate: stage69, "source-inventory": stage68.source });
  const stage70 = frontFurniture({ before: clone(stage69), source: clone(stage68.source),
    pdf: stage70BoundaryEvidence });
  const stage71SpanEvidence = derive("prose-display-spans.py",
    { candidate: stage70.candidate, "source-inventory": stage70.source });
  const stage71 = ownedSpans({ before: clone(stage70.candidate), source: clone(stage70.source),
    evidence: stage71SpanEvidence, front: stage70BoundaryEvidence });
  const stage72MemberEvidence = derive("native-members.py",
    { candidate: stage71.candidate, "source-inventory": stage71.source },
    ["--pdftoppm", pdftoppm]);
  const stage72 = memberBoundaries({ before: clone(stage71.candidate), source: clone(stage71.source),
    pdf: stage72MemberEvidence });
  const stage73NativeEvidence = derive("native-members.py",
    { candidate: stage72.candidate, "source-inventory": stage72.source },
    ["--pdftoppm", pdftoppm, "--include-fraction-rules"]);
  const stage73 = proseContinuity({ before: clone(stage72.candidate), source: clone(stage72.source),
    native: stage73NativeEvidence });
  const result = late({ candidate: stage73.candidate, source: stage73.source,
    stage37, postReference, native: stage73NativeEvidence });
  return { ...result, stage57, stage61, stage65, stage67, stage68, stage69,
    stage70, stage71, stage72, stage73, evidence: { stage56GlyphExtents,
      stage58GlyphExtents, stage59GlyphExtents, stage60GlyphExtents,
      stage61GlyphExtents, stage62GlyphAudit, stage65GlyphAudit,
      stage66BodyGlyphSupport, stage67GlyphEvidence, stage68LabelEvidence,
      stage69Typography, stage70BoundaryEvidence, stage71SpanEvidence,
      stage72MemberEvidence, stage73NativeEvidence } };
}

module.exports = { build };
