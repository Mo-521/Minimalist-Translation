"use strict";

// Full offline transformation boundary. Evidence is supplied by separate
// current-PDF producers, never looked up in the reviewed corpus. Stage 53
// needs a two-phase boundary because its glyph evidence depends on Stage 52.
const { build: sourceToPostReference } = require("./source-to-post-reference.cjs");
const { build: semanticDisplay } = require("./semantic-display-pipeline.cjs");
const { build: opaqueBoundary } = require("./opaque-boundary-pipeline.cjs");
const { buildThroughStage52, alignStage52 } = require("./member-split-pipeline.cjs");
const { build: afterStage53 } = require("./inherited-stage55-82.cjs");

const before53 = ["stage44LabelSpans", "stage44GlyphBoxes", "stage48MissedLabelSpans",
  "stage49LabelSpans", "stage49GlyphEvidence", "stage50PanelEvidence", "stage52RightLabelSpans"];
const after52 = ["stage53RecalledGlyphExtents", "stage56GlyphExtents", "stage58GlyphExtents",
  "stage59GlyphExtents", "stage60GlyphExtents", "stage61GlyphExtents", "stage62GlyphAudit",
  "stage65GlyphAudit", "stage66BodyGlyphSupport", "stage67GlyphEvidence",
  "stage68LabelEvidence", "stage69Typography", "stage70BoundaryEvidence",
  "stage71SpanEvidence", "stage72MemberEvidence", "stage73NativeEvidence"];

function requireEvidence(evidence, names) {
  for (const name of names)
    if (!Object.hasOwn(evidence || {}, name) || evidence[name] == null)
      throw Error(`Stage 35–82 pipeline requires current-PDF evidence: ${name}`);
}

function prepare({ source, sourceBytes, inputHash, evidence } = {}) {
  requireEvidence(evidence, before53);
  const early = sourceToPostReference({ source, sourceBytes, inputHash });
  const display = semanticDisplay({ candidate: early.candidate, frozen: source,
    regions: early.regions });
  const opaque = opaqueBoundary({ candidate: display, frozen: source,
    regions: early.regions, labelSpans: evidence.stage44LabelSpans,
    glyphBoxes: evidence.stage44GlyphBoxes,
    missedLabelSpans: evidence.stage48MissedLabelSpans });
  const stage52 = buildThroughStage52({ candidate: opaque.candidate,
    source: opaque.source, labelSpans: evidence.stage49LabelSpans,
    glyphEvidence: evidence.stage49GlyphEvidence,
    panelEvidence: evidence.stage50PanelEvidence,
    rightLabelSpans: evidence.stage52RightLabelSpans });
  return { stage37: early.stage37, postReference: early.recoveryProposals,
    stage43: display, stage48: opaque, stage52,
    stage51RecallAudit: stage52.recallAudit };
}

function complete({ prepared, evidence } = {}) {
  if (!prepared?.stage52 || !prepared?.stage37 || !prepared?.postReference)
    throw Error("Stage 35–82 pipeline requires prepared Stage 52 and early diagnostics");
  requireEvidence(evidence, after52);
  const stage53 = alignStage52(prepared.stage52, evidence.stage53RecalledGlyphExtents);
  return afterStage53({ candidate: stage53.candidate, source: stage53.source,
    stage37: prepared.stage37, postReference: prepared.postReference,
    evidence });
}

function build(inputs) {
  const prepared = prepare(inputs);
  return complete({ prepared, evidence: inputs.evidence });
}

module.exports = { prepare, complete, build };
