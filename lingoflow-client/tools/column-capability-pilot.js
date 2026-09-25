#!/usr/bin/env node
"use strict";

// Offline Evidence adapter. No production entry point imports this tool.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const workflow = require("../electron-app/capability-library/candidate-pool");
const { deepFreeze } = require("../electron-app/capability-library");
const APP = path.resolve(__dirname, "../electron-app");
const PROTECTED = ["main.js", "semantic-structure-authority.js", "semantic-structure-consumer-authority.js", "paper-layout-authority.js", "pdf-pipeline-diagnostics.js"];
const INDEPENDENT_REGION_TYPES = Object.freeze(["title", "abstract", "figure", "figure_caption", "table", "references_section_header", "other_independent"]);
function validateIndependentRegions(regions, pageCount) {
  if (!Array.isArray(regions)) throw new Error("Independent regions are required");
  regions.forEach(region => {
    if (!Number.isInteger(region.pageNumber) || region.pageNumber < 1 || region.pageNumber > pageCount || !INDEPENDENT_REGION_TYPES.includes(region.type)) throw new Error("Invalid independent region oracle");
  });
  return true;
}
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
function runtimeBaseline() { return Object.fromEntries(PROTECTED.map(name => [name, hash(fs.readFileSync(path.join(APP, name)))])); }

async function loadLiveExtraction() {
  const localRequire = createRequire(path.join(APP, "main.js"));
  const blocked = () => { throw new Error("Offline pilot cannot invoke Electron, network or child processes"); };
  const lifecycle = { then() {} };
  const electron = {
    app: { isPackaged: false, getPath: () => APP, setPath() {}, commandLine: { appendSwitch() {} }, whenReady: () => lifecycle, on() {} },
    ipcMain: { handle() {}, on() {} }, BrowserWindow: blocked, dialog: { showOpenDialog: blocked }, shell: { openPath: blocked, openExternal: blocked },
  };
  const context = vm.createContext({
    require: name => name === "electron" ? electron : name === "child_process" ? { spawn: blocked, execFile: blocked } : localRequire(name),
    __dirname: APP, __filename: path.join(APP, "main.js"), process: { platform: process.platform, env: {}, cwd: () => APP },
    Buffer, Uint8Array, URL, setTimeout, clearTimeout, console: { log() {}, warn() {}, error() {} },
    fetch: blocked,
  });
  // Evaluate the complete current source unchanged; only host lifecycle is inert.
  vm.runInContext(fs.readFileSync(path.join(APP, "main.js"), "utf8"), context, { filename: path.join(APP, "main.js"), timeout: 10000 });
  context.pilotPdfJs = await import(pathToFileURL(localRequire.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
  vm.runInContext("pdfjsLib = pilotPdfJs;", context);
  return async buffer => {
    context.pilotBuffer = buffer;
    return vm.runInContext("extractPdfTextWithPdfJs(pilotBuffer, getPdfPipelineConfig('paper_pdf'))", context);
  };
}

async function capture(sourcePath) {
  const bytes = fs.readFileSync(sourcePath);
  const before = runtimeBaseline();
  const extract = await loadLiveExtraction();
  const output = await extract(bytes);
  if (!Object.isFrozen(output.semanticStructureArtifact) || output.semanticStructureArtifact.frozen !== true) throw new Error("Semantic artifact is not frozen");
  if (JSON.stringify(before) !== JSON.stringify(runtimeBaseline())) throw new Error("Runtime source changed during capture");
  const pages = output.pipelineDebug.pages;
  if (!Array.isArray(pages) || pages.length !== output.pages) throw new Error("Incomplete page evidence");
  return deepFreeze({
    schemaVersion: "column-pilot-output/v1", runtimeDecisionUse: "forbidden", capturedAt: new Date().toISOString(),
    source: { fileName: path.basename(sourcePath), sha256: hash(bytes), bytes: bytes.length, pageCount: output.pages },
    runtimeBaseline: before, entryPoint: "main.js:extractPdfTextWithPdfJs(paper_pdf)",
    pages: JSON.parse(JSON.stringify(pages)),
    segments: output.segments.map(s => ({ id: s.id, pageNumber: s.pageNumber, column: s.column, type: s.type, bbox: s.bbox, sourceLineIds: s.sourceLineIds || [], lineBoxes: s.lineBoxes || [] })),
    artifact: JSON.parse(JSON.stringify(output.semanticStructureArtifact)),
  });
}

function compare(state, sampleId, output) {
  workflow.validateState(state);
  const sample = state.corpus.samples.find(s => s.id === sampleId);
  const candidate = state.pool.candidates.find(c => c.promotedSampleId === sampleId && c.status === "accepted");
  if (!sample || !candidate) throw new Error("Only explicitly promoted accepted samples may run formal regression");
  if (sample.source.sha256 !== output.source.sha256 || sample.source.pageCount !== output.source.pageCount || sample.source.bytes !== output.source.bytes) throw new Error("Source metadata mismatch");
  if (JSON.stringify(runtimeBaseline()) !== JSON.stringify(output.runtimeBaseline)) throw new Error("Stale runtime output; capture again");
  if (!Array.isArray(output.pages) || output.pages.length !== sample.source.pageCount || new Set(output.pages.map(p => p.pageNumber)).size !== sample.source.pageCount) throw new Error("Incomplete or duplicate output pages");
  const oracle = sample.expectedOutcomes.find(o => o.assertionId === "assert.column.page-region-truth" && o.capabilityId === "cap.column-recognition");
  if (!oracle || oracle.oracleType !== "exact" || !Array.isArray(oracle.expected.pages) || oracle.expected.pages.length !== sample.source.pageCount) throw new Error("Complete reviewed page oracle required");
  if (oracle.expected.pageLayoutBasis !== "body_text_flow_only") throw new Error("Body-text layout basis is required");
  validateIndependentRegions(oracle.expected.independentRegions, sample.source.pageCount);
  const results = oracle.expected.pages.map((truth, index) => {
    if (truth.pageNumber !== index + 1 || !["single_column", "double_column", "mixed", "scanned_or_image"].includes(truth.layout)) throw new Error("Invalid reviewed page oracle");
    const page = output.pages.find(p => p.pageNumber === truth.pageNumber);
    if (!page) throw new Error("Missing page output");
    return { sampleId, pageNumber: truth.pageNumber, expected: truth.layout, actual: page.layoutType || null,
      status: page.layoutType === truth.layout ? "pass" : "finding", codeLocation: "main.js:detectPageColumns / buildStructuredPdfText", evidence: JSON.parse(JSON.stringify(page)) };
  });
  return deepFreeze({ schemaVersion: "column-pilot-regression/v1", runtimeDecisionUse: "forbidden", sampleId,
    results, findingCount: results.filter(r => r.status === "finding").length,
    limitations: ["Region geometry and ownership require explicit reviewed region/object oracles; page matches alone do not certify them.", "No Issue lifecycle or runtime decisions are modified."] });
}

async function main(argv = process.argv.slice(2)) {
  const [action, ...args] = argv;
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--source", "--output", "--state", "--capture", "--sample"].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error("Invalid argument");
    options[args[i]] = args[i + 1];
  }
  if (!options["--output"]) throw new Error("Explicit new evidence --output required");
  let result;
  if (action === "capture") result = await capture(options["--source"]);
  else if (action === "compare") result = compare(workflow.loadCommittedState(options["--state"]), options["--sample"], JSON.parse(fs.readFileSync(options["--capture"], "utf8")));
  else throw new Error("Use capture or compare");
  fs.writeFileSync(options["--output"], JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ action, output: options["--output"], findingCount: result.findingCount ?? null }));
  if (result.findingCount) process.exitCode = 2; // measurable capability mismatch, not tool failure
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { capture, compare, runtimeBaseline, main, INDEPENDENT_REGION_TYPES, validateIndependentRegions };
