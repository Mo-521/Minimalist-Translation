"use strict";

// Input-driven Stage 70–73 source-ownership chain. PDF evidence is supplied by
// the caller; these transforms do not read historical Task artifacts.
const { build: frontFurniture } = require("./front-furniture.cjs");
const { build: ownedSpans } = require("./owned-spans.cjs");
const { build: memberBoundaries } = require("./member-boundaries.cjs");
const { build: proseContinuity } = require("./prose-continuity.cjs");
const clone = value => JSON.parse(JSON.stringify(value));

function build({ candidate, source, boundaryEvidence, spanEvidence,
  memberEvidence, nativeEvidence }) {
  if (!candidate || !source || !boundaryEvidence || !spanEvidence ||
      !memberEvidence || !nativeEvidence) throw Error("Ownership pipeline requires candidate, source and four evidence inputs");
  const stage70 = frontFurniture({ before: clone(candidate), source: clone(source), pdf: boundaryEvidence });
  const stage71 = ownedSpans({ before: clone(stage70.candidate), source: clone(stage70.source),
    evidence: spanEvidence, front: boundaryEvidence });
  const stage72 = memberBoundaries({ before: clone(stage71.candidate), source: clone(stage71.source),
    pdf: memberEvidence });
  const stage73 = proseContinuity({ before: clone(stage72.candidate), source: clone(stage72.source),
    native: nativeEvidence });
  return stage73;
}

module.exports = { build };
