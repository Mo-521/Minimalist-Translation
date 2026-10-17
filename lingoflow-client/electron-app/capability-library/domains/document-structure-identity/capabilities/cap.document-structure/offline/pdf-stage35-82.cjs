"use strict";

// Executable offline Structure candidate builder from observed source pages.
// The caller owns PDF extraction, native runtimes and the run directory.
const fs = require("node:fs");
const path = require("node:path");
const { createEvidenceRunner } = require("./pdf-evidence-runner.cjs");
const { build: early } = require("./pdf-stage35-53.cjs");
const { build: late } = require("./pdf-stage55-82.cjs");

function withNativeVisualRegions(source, python, runDirectory) {
  if (Object.values(source.pages).some(page => page.layoutHints?.length))
    throw Error("Native visual regions require source pages without layout hints");
  const visualDirectory = path.join(runDirectory, "visual");
  fs.mkdirSync(visualDirectory, { recursive: true });
  const proposals = createEvidenceRunner({ python, runDirectory: visualDirectory })(
    "visual-regions.py", { "source-inventory": source });
  const pages = Object.fromEntries(Object.entries(source.pages).map(([key, page]) => {
    if (!Array.isArray(proposals.pages[key])) throw Error(`Missing native visual regions for ${key}`);
    return [key, { ...page, layoutHints: proposals.pages[key] }];
  }));
  return { source: { ...source, pages }, proposals };
}

function build({ source, sourceBytes, inputHash, python, pdftoppm, runDirectory,
  visualRegionMode = "none" } = {}) {
  if (!source?.pages || !python || !pdftoppm || !runDirectory ||
    !fs.statSync(runDirectory).isDirectory())
    throw Error("PDF Stage 35–82 requires observed source, native runtimes and an existing run directory");
  if (!["none", "native"].includes(visualRegionMode)) throw Error("Unknown visual region mode");
  const visual = visualRegionMode === "native" ?
    withNativeVisualRegions(source, python, runDirectory) : null;
  const activeSource = visual?.source || source;
  const earlyDirectory = path.join(runDirectory, "early");
  const lateDirectory = path.join(runDirectory, "late");
  fs.mkdirSync(earlyDirectory, { recursive: true });
  fs.mkdirSync(lateDirectory, { recursive: true });
  const prepared = early({ source: activeSource, sourceBytes, inputHash, python, runDirectory: earlyDirectory });
  const completed = late({ candidate: prepared.candidate, source: prepared.source,
    stage37: prepared.stage37, postReference: prepared.postReference,
    python, pdftoppm, runDirectory: lateDirectory });
  return { candidate: completed.candidate, source: completed.source,
    nativeVisualRegions: visual?.proposals || null,
    evidence: { ...prepared.evidence, ...completed.evidence },
    checkpoints: { stage43: prepared.stage43, stage52: prepared.stage52,
      stage61: completed.stage61, stage73: completed.stage73 } };
}

module.exports = { build };
