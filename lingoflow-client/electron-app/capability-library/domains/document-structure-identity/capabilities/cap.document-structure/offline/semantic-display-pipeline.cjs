"use strict";

// Stage 42–43: source-only semantic blocks followed by display formulas.
// Stage 41 was review presentation, not a producer transform.
const { build: semanticBlocks } = require("./semantic-blocks.cjs");
const { build: displayFormulas } = require("./display-formulas.cjs");
const clone = value => JSON.parse(JSON.stringify(value));

function build({ candidate, frozen, regions } = {}) {
  if (!candidate || !frozen || !regions)
    throw Error("Semantic-display pipeline requires candidate, source and regions");
  const semantic = semanticBlocks({ input: clone(candidate), frozen });
  return displayFormulas({ input: clone(semantic), frozen, regions });
}

module.exports = { build };
