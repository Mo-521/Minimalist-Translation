"use strict";

// Pure Stage 75–82 composition. All default transformations are local to the
// capability library; neither Task files nor accepted labels are imported.
const clone = value => JSON.parse(JSON.stringify(value));
const builtins = {
  regionCompleteness: require("./region-completeness.cjs").build,
  tableNotes: require("./table-notes.cjs").build,
  displayRegion: require("./display-region-members.cjs").build,
  proseDisplaySplit: require("./prose-display-source.cjs").build,
  nestedFormula: require("./nested-formula-members.cjs").build,
  proseInk: require("./prose-ink-boundaries.cjs").build,
  reviewedBoundary: require("./reviewed-boundaries.cjs").build,
  terminalProse: require("./terminal-prose.cjs").build,
};
const required = ["regionCompleteness", "tableNotes", "displayRegion", "proseDisplaySplit",
  "nestedFormula", "proseInk", "reviewedBoundary", "terminalProse"];

function build({ candidate, source, stage37, postReference, native, transforms = builtins }) {
  if (!candidate || !source || !stage37 || !postReference || !native)
    throw Error("Late pipeline requires candidate, source, Stage 37, post-reference and native evidence");
  for (const name of required)
    if (typeof transforms?.[name] !== "function") throw Error(`Missing late-pipeline transform: ${name}`);

  const stage75 = transforms.regionCompleteness({ baseline: clone(candidate), inventory: clone(source),
    stage37, postReference });
  const stage76 = transforms.tableNotes({ prior: clone(stage75), inventory: clone(source) });
  const stage77 = transforms.displayRegion({ prior: clone(stage76), source: clone(source) });
  const stage78 = transforms.proseDisplaySplit({ prior: clone(stage77), source: clone(source), native });
  const stage79 = transforms.nestedFormula({ prior: clone(stage78.candidate),
    inventory: clone(stage78.source) });
  const stage80 = transforms.proseInk({ prior: clone(stage79), inventory: clone(stage78.source), native });
  const stage81 = transforms.reviewedBoundary({ prior: clone(stage80),
    inventory: clone(stage78.source), native });
  const stage82 = transforms.terminalProse({ prior: clone(stage81), frozen: clone(stage78.source), native });
  const counts = [stage75, stage76, stage77, stage78.candidate, stage79, stage80, stage81,
    stage82.candidate].map((value, i) => value[`stage${75 + i}`]?.operations?.length || 0);
  return { candidate: stage82.candidate, source: stage82.source,
    operationCounts: Object.fromEntries(counts.map((count, i) => [75 + i, count])) };
}

module.exports = { build };
