"use strict";

// Portable transformation chain after the Stage 53 candidate. PDF evidence
// and early-stage diagnostics are explicit inputs, never corpus lookups.
const { build: flowBoundary } = require("./flow-boundary-pipeline.cjs");
const { build: displayRecall } = require("./display-recall-pipeline.cjs");
const { build: mathFrames } = require("./math-frame-pipeline.cjs");
const { build: semanticBoundary } = require("./semantic-boundary-pipeline.cjs");
const { build: formulaProse } = require("./formula-prose-pipeline.cjs");
const { build: ownership } = require("./ownership-pipeline.cjs");
const { build: late } = require("./late-pipeline.cjs");
const clone = value => JSON.parse(JSON.stringify(value));

function build({ candidate, source, stage37, postReference, evidence }) {
  if (!candidate || !source || !stage37 || !postReference || !evidence)
    throw Error("Stage 55–82 chain requires candidate, source, early diagnostics and PDF evidence");
  const flow = flowBoundary({ candidate: clone(candidate), source: clone(source),
    glyphExtents: evidence.stage56GlyphExtents });
  const recalled = displayRecall({ candidate: flow, source: clone(source),
    edgeGlyphs: evidence.stage58GlyphExtents,
    numberedGlyphs: evidence.stage59GlyphExtents,
    numericGlyphs: evidence.stage60GlyphExtents,
    mixedGlyphs: evidence.stage61GlyphExtents });
  const frames = mathFrames({ candidate: recalled, source: clone(source),
    bodyFormulaGlyphAudit: evidence.stage62GlyphAudit,
    spanGlyphAudit: evidence.stage65GlyphAudit });
  const boundary = semanticBoundary({ candidate: frames, source: clone(source),
    bodyGlyphSupport: evidence.stage66BodyGlyphSupport,
    pdfGlyphEvidence: evidence.stage67GlyphEvidence });
  const prose = formulaProse({ candidate: boundary.candidate, source: boundary.source,
    labelGlyphEvidence: evidence.stage68LabelEvidence,
    glyphEvidence: evidence.stage67GlyphEvidence,
    typographyEvidence: evidence.stage69Typography });
  const owned = ownership({ candidate: prose.candidate, source: prose.source,
    boundaryEvidence: evidence.stage70BoundaryEvidence,
    spanEvidence: evidence.stage71SpanEvidence,
    memberEvidence: evidence.stage72MemberEvidence,
    nativeEvidence: evidence.stage73NativeEvidence });
  return late({ candidate: owned.candidate, source: owned.source,
    stage37, postReference, native: evidence.stage73NativeEvidence });
}

module.exports = { build };
