"use strict";

// Stage 35–40 source-only sequence. Review presentation stages are omitted.
const { build: sourceSemantics } = require("./source-semantics-pipeline.cjs");
const { build: referenceEntries } = require("./reference-whole-entry.cjs");
const { build: composeReferences } = require("./compose-references.cjs");
const { build: recovery } = require("./post-reference-recovery.cjs");
const { build: composePostReference } = require("./compose-post-reference.cjs");

function build({ source, sourceBytes, inputHash } = {}) {
  const early = sourceSemantics({ source, sourceBytes, inputHash });
  const references = referenceEntries({ frozen: source, diagnostic: early.boundaries });
  const referenceIntegrated = composeReferences({ frozen: source,
    stage37: early.candidate, references });
  const inputs = { frozen: source, formula: early.formula, references,
    composed: referenceIntegrated };
  const recoveryProposals = recovery({}, inputs);
  const candidate = composePostReference(inputs);
  return { ...early, stage37: early.candidate, references, referenceIntegrated,
    recoveryProposals, candidate };
}

module.exports = { build };
